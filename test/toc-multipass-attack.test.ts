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
  renderDocumentMultiPass,
  type DestinationPageMap,
  type MultiPassSource,
} from '../src/runtime/server/engine/layout-passes'
import {
  layoutPdfTree,
  renderDocument,
} from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/fonts'
import { installPdfCanvasGlobals, parsePdf } from './utils/pdf'

// ===========================================================================
// SPIKE-ATTACK TESTS for the multi-pass TOC layout (layout-passes.ts).
//
// These adversarial fixtures probe the spike's load-bearing claims:
//   1. Contamination — re-laying-out the re-patched tree yields byte- and
//      geometry-identical output to a fresh single layout of the same final
//      state (no stale box/line/style state leaks between passes).
//   3. Dynamic text (page-number footers) survives the loop.
//   4. The dynamic-lineHeight shield does not accumulate or contaminate.
//
// They HOLD, and are asserted green below.
//
// Attack 2 (id on a page-spanning node) surfaced a genuine defect in the spike:
// the destination resolved to the section's LAST page instead of its first. That
// is now FIXED — `extractDestinationPages` is first-writer-wins and serialization
// anchors the destination at the first fragment — and Attack 2 is a permanent
// regression test at the bottom of this file.
// ===========================================================================

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

// A structural view over the laid-out node tree, typed just enough to snapshot it.
interface LaidOutNode {
  type?: string
  value?: string
  props?: { id?: string }
  box?: { top?: number, left?: number, width?: number, height?: number }
  lines?: { runs?: { glyphs?: { codePoints?: number[] }[] }[] }[]
  children?: LaidOutNode[]
}

// Deterministic snapshot of the laid-out geometry: box positions + shaped glyphs.
// Any pass-to-pass state leak would perturb one of these numbers.
const geometry = (node: LaidOutNode): unknown => {
  const box = node.box ?? {}
  return {
    type: node.type,
    id: node.props?.id,
    box: { t: box.top, l: box.left, w: box.width, h: box.height },
    lines: node.lines?.map(ln =>
      (ln.runs ?? []).map(r =>
        (r.glyphs ?? []).map(g => g.codePoints).join('')),
    ),
    value: node.value,
    children: (node.children ?? []).map(geometry),
  }
}

const asLaidOut = (node: unknown): LaidOutNode => node as LaidOutNode

interface Section { id: string, title: string, lines: number }
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

// Heading id lives on a small, non-splitting Text node (the recommended pattern).
const NormalDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { title: 'X', creationDate: new Date(0), modificationDate: new Date(0) }, {
        default: () => [
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

describe('ATTACK 1 — contamination across passes (holds)', () => {
  it('converged multipass geometry equals a fresh single layout of the final state', async () => {
    const b = await mountPdfComponent(NormalDoc, { resolved: {} })
    const result = await renderDocumentMultiPass(mountedSource(b))
    const geomMulti = geometry(asLaidOut(result.layout))

    // Fresh mount, feed the converged map ONCE, single layout.
    const a = await mountPdfComponent(NormalDoc, { resolved: {} })
    await a.update({ resolved: result.pages })
    const single = await layoutPdfTree(a.document as unknown as DocumentNode, createPdfFontStore())
    const geomSingle = geometry(asLaidOut(single))

    expect(geomMulti).toEqual(geomSingle)
    a.unmount()
    b.unmount()
  })

  it('multipass bytes are byte-identical to a single render of the final state', async () => {
    const b = await mountPdfComponent(NormalDoc, { resolved: {} })
    const multi = await renderDocumentMultiPass(mountedSource(b), { compress: false })

    const a = await mountPdfComponent(NormalDoc, { resolved: {} })
    await a.update({ resolved: multi.pages })
    const single = await renderDocument(a.document as unknown as DocumentNode, { compress: false })

    expect(Buffer.from(multi.bytes).equals(Buffer.from(single.bytes))).toBe(true)
    a.unmount()
    b.unmount()
  })
})

// ---------------------------------------------------------------------------
// ATTACK 3 — bookmarks (outline) + multipass. resolveBookmarks mutates
// props.bookmark IN PLACE (documented spike risk). Verify re-layout does not
// corrupt the outline: the converged outline AND bytes match a single fresh
// render of the same final state. (Holds: resolveBookmarks is idempotent under a
// structurally identical tree — refs increment identically each pass and the
// `{ ref, parent, ...bookmark }` spread re-derives the same values.)
// ---------------------------------------------------------------------------
const readOutline = async (bytes: Uint8Array): Promise<unknown> => {
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 }).promise
  interface OutlineItem { title: string, items?: OutlineItem[] }
  const simplify = (items: OutlineItem[]): unknown =>
    (items ?? []).map(i => ({ title: i.title, children: simplify(i.items ?? []) }))
  const result = simplify((await doc.getOutline()) as unknown as OutlineItem[])
  await doc.destroy()
  return result
}

const BookmarkDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { creationDate: new Date(0), modificationDate: new Date(0) }, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 20, marginBottom: 12 } }, { default: () => 'Contents' }),
              ...SECTIONS.map(s =>
                h(PdfLink, { src: `#${s.id}`, style: { fontSize: 12, marginBottom: 6 } }, {
                  default: () => `${s.title} ..... ${resolved()[s.id] ?? ''}`,
                }),
              ),
            ],
          }),
          ...SECTIONS.map(s =>
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => [
                h(PdfView, { id: s.id, bookmark: { title: s.title, expanded: true }, break: true }, {
                  default: () => [
                    h(PdfText, { style: { fontSize: 18, marginBottom: 8 } }, { default: () => `HEADING ${s.id}` }),
                    h(PdfText, { bookmark: `${s.title} detail`, style: { fontSize: 12 } }, { default: () => `${s.title} detail` }),
                    ...Array.from({ length: s.lines }, (_, i) =>
                      h(PdfText, { style: { fontSize: 11, marginBottom: 4 } }, { default: () => `${s.title} line ${i + 1}` }),
                    ),
                  ],
                }),
              ],
            }),
          ),
        ],
      })
  },
})

describe('ATTACK 3 — bookmarks + multipass (holds)', () => {
  it('converged outline and bytes equal a single fresh render (no in-place corruption)', async () => {
    const b = await mountPdfComponent(BookmarkDoc, { resolved: {} })
    const multi = await renderDocumentMultiPass(mountedSource(b), { compress: false })
    const outlineMulti = await readOutline(multi.bytes)

    const a = await mountPdfComponent(BookmarkDoc, { resolved: {} })
    await a.update({ resolved: multi.pages })
    const single = await renderDocument(a.document as unknown as DocumentNode, { compress: false })
    const outlineSingle = await readOutline(single.bytes)

    expect(outlineMulti).toEqual(outlineSingle)
    expect(Buffer.from(multi.bytes).equals(Buffer.from(single.bytes))).toBe(true)
    a.unmount()
    b.unmount()
  })
})

// ---------------------------------------------------------------------------
// ATTACK 4 — dynamic-lineHeight shield with a STABLE style reference. The shield
// appends `{ lineHeight: '' }` to node.style each pass and is only reset when the
// renderer re-patches `style`. A stable object reference makes Vue skip the patch,
// so the shield could accumulate or contaminate. Verify the converged geometry
// still equals a fresh single layout. (Holds: the shield value is idempotent and,
// for object styles, re-spread rather than grown.)
// ---------------------------------------------------------------------------
const STABLE_FOOTER_STYLE = { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 9, textAlign: 'center', lineHeight: 2 } as const

const StableStyleDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { creationDate: new Date(0), modificationDate: new Date(0) }, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 22 } }, { default: () => 'Contents' }),
              h(PdfLink, { src: '#s', style: { fontSize: 13 } }, { default: () => `S ..... ${resolved().s ?? ''}` }),
              h(PdfText, { fixed: true, style: STABLE_FOOTER_STYLE, render: ({ pageNumber }: { pageNumber: number }) => `Page ${pageNumber}` }),
            ],
          }),
          h(PdfPage, { size: 'A4', style: { padding: 48 } }, {
            default: () => [
              h(PdfText, { id: 's', break: true, style: { fontSize: 20 } }, { default: () => 'HEADING s' }),
              h(PdfText, { fixed: true, style: STABLE_FOOTER_STYLE, render: ({ pageNumber }: { pageNumber: number }) => `Page ${pageNumber}` }),
            ],
          }),
        ],
      })
  },
})

describe('ATTACK 4 — shield accumulation with a stable style reference (holds)', () => {
  it('converged geometry equals a fresh single layout; the shield does not contaminate', async () => {
    const b = await mountPdfComponent(StableStyleDoc, { resolved: {} })
    const result = await renderDocumentMultiPass(mountedSource(b))
    const geomMulti = geometry(asLaidOut(result.layout))

    // The live dynamic node's shield resolves to a single `lineHeight: ''`, not a
    // growing array of them.
    const dyn = (b.document.children[0] as PdfElementNode).children[2] as PdfElementNode
    expect(Array.isArray(dyn.style)).toBe(false)

    const a = await mountPdfComponent(StableStyleDoc, { resolved: {} })
    await a.update({ resolved: result.pages })
    const single = await layoutPdfTree(a.document as unknown as DocumentNode, createPdfFontStore())
    expect(geometry(asLaidOut(single))).toEqual(geomMulti)
    a.unmount()
    b.unmount()
  })
})

// ---------------------------------------------------------------------------
// ATTACK 2 — convergence to a WRONG number (FINDING, committed skipped).
//
// When the id-carrying node spans a page boundary, `extractDestinationPages`
// (last-writer-wins over the ordered page list) maps the id to the section's
// LAST page, and pdfkit's named-destination table (last `add` wins) also points
// the jump at the last page. So a section whose body spans pages 3–4 gets a TOC
// entry that prints "4" and a link that jumps to page 4 — even though the section
// STARTS on page 3. The loop still reaches a self-consistent fixed point (printed
// number == jump target), so it neither oscillates nor errors; it silently ships
// a wrong page number for a common authoring pattern (`<PdfView :id> … </PdfView>`
// wrapping a multi-page section).
//
// The recommended pattern (id on a small, non-splitting heading Text) sidesteps
// this, which is why the spike's own fixtures never hit it. Skipped until
// extractDestinationPages resolves an id to the FIRST page it appears on (and the
// named destination is emitted on the first fragment) or the constraint is
// documented as a hard requirement.
// ---------------------------------------------------------------------------
const SplitDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { creationDate: new Date(0), modificationDate: new Date(0) }, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfLink, { src: '#big', style: { fontSize: 14 } }, {
                default: () => `Big Section ..... ${resolved().big ?? ''}`,
              }),
            ],
          }),
          h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
            default: () => [
              h(PdfView, { id: 'big', break: true }, {
                default: () => Array.from({ length: 80 }, (_, i) =>
                  h(PdfText, { style: { fontSize: 12, marginBottom: 4 } }, { default: () => `big line ${i + 1}` }),
                ),
              }),
            ],
          }),
        ],
      })
  },
})

// The first-page guarantee has two independent mechanisms — first-writer-wins
// extraction and the serialization-time destination anchoring — so each gets
// its OWN test: a regression in one must fail its own assertion even if the
// other also regresses (a single sequential test would mask the second half).
describe('ATTACK 2 — id on a page-spanning container points at the section START', () => {
  const renderSplitDoc = async () => {
    const m = await mountPdfComponent(SplitDoc, { resolved: {} })
    try {
      const result = await renderDocumentMultiPass(mountedSource(m))
      const parsed = await parsePdf(result.bytes)
      const startPage = parsed.pages.find(p => p.text.includes('big line 1'))!.number
      const endPage = parsed.pages.find(p => p.text.includes('big line 80'))!.number
      expect(endPage).toBeGreaterThan(startPage) // section genuinely spans pages
      return { result, parsed, startPage }
    }
    finally {
      m.unmount()
    }
  }

  it('extracts the printed TOC number from the section START page', async () => {
    const { result, parsed, startPage } = await renderSplitDoc()

    expect(result.pages.big).toBe(startPage)
    expect(parsed.pages[0]!.text).toContain(`Big Section ..... ${startPage}`)
  })

  it('anchors the named destination at the section START page', async () => {
    const { result, startPage } = await renderSplitDoc()

    installPdfCanvasGlobals()
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(result.bytes), useWorkerFetch: false, verbosity: 0 }).promise
    const dest = await doc.getDestination('big') as [{ num: number, gen: number }]
    const destPage = (await doc.getPageIndex(dest[0])) + 1
    await doc.destroy()
    expect(destPage).toBe(startPage)
  })
})
