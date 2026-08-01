import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode } from '@react-pdf/layout'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import type { PdfElementNode } from '../src/runtime/renderer/types'
import {
  extractDestinationPages,
  renderDocumentMultiPass,
  type DestinationPageMap,
  type MultiPassSource,
} from '../src/runtime/server/engine/layout-passes'
import { NuxtPdfError } from '../src/runtime/shared/errors'
import { parsePdf } from './utils/pdf'

// A MultiPassSource backed by the live mounted Vue tree. `feed` re-patches the
// tree in place through our renderer by updating a single reactive prop.
const mountedSource = (
  mounted: Awaited<ReturnType<typeof mountPdfComponent>>,
): MultiPassSource => ({
  get document() {
    return mounted.document as unknown as DocumentNode
  },
  feed: async (pages: DestinationPageMap) => {
    await mounted.update({ resolved: pages })
  },
})

// ---------------------------------------------------------------------------
// Normal fixture: TOC front page + sections behind page breaks + dynamic footer.
// One section is deliberately long enough to span two pages so the downstream
// section numbers are NOT a trivial 1:1 with section order — the page numbers
// genuinely come from pagination, which is what makes the feedback loop real.
// ---------------------------------------------------------------------------

interface Section {
  id: string
  title: string
  lines: number
}

const SECTIONS: Section[] = [
  { id: 'intro', title: 'Introduction', lines: 3 },
  { id: 'method', title: 'Method', lines: 60 }, // spans two pages
  { id: 'results', title: 'Results', lines: 3 },
  { id: 'conclusion', title: 'Conclusion', lines: 3 },
]

const footer = (): VNode =>
  h(PdfText, {
    fixed: true,
    style: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 9, textAlign: 'center' },
    render: ({ pageNumber, totalPages }: { pageNumber: number, totalPages?: number }) =>
      `Page ${pageNumber} / ${totalPages}`,
  })

const NormalDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { title: 'Multi-pass TOC' }, {
        default: () => [
          // TOC page
          h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 22, marginBottom: 16 } }, { default: () => 'Contents' }),
              ...SECTIONS.map(s =>
                h(PdfLink, { src: `#${s.id}`, style: { fontSize: 13, marginBottom: 8, color: 'black', textDecoration: 'none' } }, {
                  default: () => `${s.title} ..... ${resolved()[s.id] ?? ''}`,
                }),
              ),
              footer(),
            ],
          }),
          // Section pages, each forced onto a fresh page by `break`
          ...SECTIONS.map(s =>
            h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
              default: () => [
                h(PdfText, { id: s.id, break: true, style: { fontSize: 20, marginBottom: 12 } }, {
                  default: () => `HEADING ${s.id}`,
                }),
                ...Array.from({ length: s.lines }, (_, i) =>
                  h(PdfText, { style: { fontSize: 11, marginBottom: 4 } }, {
                    default: () => `${s.title} body line ${i + 1}`,
                  }),
                ),
                footer(),
              ],
            }),
          ),
        ],
      })
  },
})

// Locate the actual page each heading landed on by its unique "HEADING <id>"
// marker (the TOC uses the human title, so the two never collide).
const locateHeadingPages = (
  pages: { number: number, text: string }[],
): DestinationPageMap => {
  const located: DestinationPageMap = {}
  for (const s of SECTIONS) {
    const page = pages.find(p => p.text.includes(`HEADING ${s.id}`))
    if (page) located[s.id] = page.number
  }
  return located
}

const parseTocNumbers = (tocText: string): DestinationPageMap => {
  const printed: DestinationPageMap = {}
  for (const s of SECTIONS) {
    const match = tocText.match(new RegExp(`${s.title}[\\s.]*?(\\d+)`))
    if (match) printed[s.id] = Number(match[1])
  }
  return printed
}

describe('multi-pass TOC layout', () => {
  it('converges to correct page numbers and re-patches (not re-mounts) between passes', async () => {
    const mounted = await mountPdfComponent(NormalDoc, { resolved: {} })

    // Capture node identity of the live document + a specific TOC link, to prove
    // the feedback loop re-patches the SAME node objects rather than re-mounting.
    const documentBefore = mounted.document
    const tocPageBefore = documentBefore.children[0] as PdfElementNode
    const firstLinkBefore = tocPageBefore.children[1] as PdfElementNode
    expect(firstLinkBefore.type).toBe('LINK')

    const result = await renderDocumentMultiPass(mountedSource(mounted))

    // Re-patch, not re-mount: identical object references survive every pass.
    expect(mounted.document).toBe(documentBefore)
    expect((mounted.document.children[0] as PdfElementNode)).toBe(tocPageBefore)
    expect((tocPageBefore.children[1] as PdfElementNode)).toBe(firstLinkBefore)

    // Normal documents converge in exactly 2 passes: pass 1 discovers the map,
    // pass 2 confirms it is a fixed point.
    expect(result.passes).toBe(2)

    const parsed = await parsePdf(result.bytes)
    expect(parsed.pageCount).toBe(result.layout.children.length)
    expect(parsed.pageCount).toBeGreaterThanOrEqual(5) // TOC + 4 sections, one spanning 2 pages

    // Ground truth: where each heading actually rendered.
    const actualHeadingPages = locateHeadingPages(parsed.pages)
    expect(Object.keys(actualHeadingPages)).toHaveLength(SECTIONS.length)

    // The engine's extracted map must equal the visually-located pages.
    expect(result.pages).toEqual(actualHeadingPages)

    // The long section must push a later section off the naive index — proves the
    // numbers come from real pagination, not section order.
    expect(actualHeadingPages.results!).toBeGreaterThan(
      actualHeadingPages.method! + 1,
    )

    // The TOC page must PRINT those exact page numbers.
    const tocText = parsed.pages[0]!.text
    const printed = parseTocNumbers(tocText)
    expect(printed).toEqual(actualHeadingPages)

    // Internal link annotations exist on the TOC page and point at the headings.
    const tocLinks = parsed.pages[0]!.annotations.filter(a => a.subtype === 'Link')
    expect(tocLinks.length).toBeGreaterThanOrEqual(SECTIONS.length)
    for (const s of SECTIONS) {
      const hit = tocLinks.some(a =>
        a.destination === s.id
        || (Array.isArray(a.destination) && destinationPage(a.destination) === actualHeadingPages[s.id]),
      )
      expect(hit, `TOC link for #${s.id} must target its heading`).toBe(true)
    }

    // Dynamic footers keep working across passes: every page shows its own number.
    for (const page of parsed.pages) {
      expect(page.text).toContain(`Page ${page.number} / ${parsed.pageCount}`)
    }

    mounted.unmount()
  })

  it('extractDestinationPages maps every id to its final page', async () => {
    const mounted = await mountPdfComponent(NormalDoc, { resolved: {} })
    const result = await renderDocumentMultiPass(mountedSource(mounted))
    const direct = extractDestinationPages(result.layout)
    expect(direct).toEqual(result.pages)
    mounted.unmount()
  })
})

// pdfjs may report a named destination either as the raw name string or as an
// explicit [pageRef, /XYZ, ...] array. Resolve the page index when it is an array.
const destinationPage = (dest: Array<string | number | null | { number: number }>): number | undefined => {
  const first = dest[0]
  if (first && typeof first === 'object' && 'number' in first) {
    // Page object number is a ref, not a 1-based index; the string form is the
    // reliable check, so only fall back to array shape existence here.
    return undefined
  }
  if (typeof first === 'number') return first + 1
  return undefined
}

// ---------------------------------------------------------------------------
// Pathological fixture: a TOC entry whose HEIGHT depends on the page number it
// is told to print. When the section is predicted on page 2, the entry balloons
// and pushes the section to page 3; when predicted on page 3, the entry shrinks
// and the section falls back to page 2. The map oscillates 2 ↔ 3 forever.
// ---------------------------------------------------------------------------

const PathologicalDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, null, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfLink, { src: '#only', style: { fontSize: 14 } }, {
                default: () => `Chapter ..... ${resolved().only ?? ''}`,
              }),
              // Feedback spacer: tall only when the fed page number is exactly 2.
              // Predicting page 2 → tall spacer → TOC overflows → section to page 3.
              // Predicting page 3 → no spacer → TOC fits → section back to page 2.
              h(PdfView, { style: { height: resolved().only === 2 ? 790 : 0 } }),
            ],
          }),
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfText, { id: 'only', style: { fontSize: 20 } }, {
                default: () => 'HEADING only',
              }),
            ],
          }),
        ],
      })
  },
})

describe('multi-pass TOC layout — non-convergence', () => {
  it('fails cleanly with an actionable NuxtPdfError instead of looping forever', async () => {
    const mounted = await mountPdfComponent(PathologicalDoc, { resolved: {} })
    let feeds = 0
    const source = mountedSource(mounted)
    const counting: MultiPassSource = {
      get document() {
        return source.document
      },
      feed: async (pages) => {
        feeds += 1
        await source.feed(pages)
      },
    }

    const error = await renderDocumentMultiPass(counting, { maxPasses: 5 })
      .then(() => null)
      .catch(e => e as unknown)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect((error as NuxtPdfError).code).toBe('PDF_LIMIT_EXCEEDED')
    expect((error as NuxtPdfError).message).toContain('did not stabilize')
    expect((error as NuxtPdfError).message).toMatch(/#only→p[23]/)

    // Bounded: the cap stopped the loop; it did not run away.
    expect(feeds).toBe(5)

    mounted.unmount()
  })

  it('oscillates 2 ↔ 3 — proving the loop is catching real non-convergence', async () => {
    const mounted = await mountPdfComponent(PathologicalDoc, { resolved: {} })
    const source = mountedSource(mounted)
    const observed: number[] = []

    // Manually drive a few passes to record the oscillation the loop detects.
    const { layoutPdfTree } = await import('../src/runtime/server/engine/render-document')
    const { createPdfFontStore } = await import('../src/runtime/server/engine/fonts')
    const fontStore = createPdfFontStore()
    let fed: DestinationPageMap = {}
    for (let i = 0; i < 4; i++) {
      await source.feed(fed)
      const layout = await layoutPdfTree(source.document, fontStore)
      fed = extractDestinationPages(layout)
      observed.push(fed.only!)
    }
    // e.g. [2, 3, 2, 3] — a period-2 cycle that never reaches a fixed point.
    expect(new Set(observed).size).toBe(2)
    expect(observed[0]).not.toBe(observed[1])
    expect(observed[0]).toBe(observed[2])

    mounted.unmount()
  })
})
