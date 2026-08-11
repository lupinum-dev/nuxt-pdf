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
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { installPdfCanvasGlobals, parsePdf } from '../src/test/pdf'

// Regression coverage for state that is reused across layout passes. Each
// fixture compares the converged render with a fresh render of the same final
// page-number map or asserts a destination invariant directly.

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
      h(PdfDocument, { title: 'X', creationDate: new Date(0) }, {
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

describe('multi-pass state isolation', () => {
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

// Bookmark resolution mutates layout data. Comparing with a fresh final-state
// render proves that reuse across passes does not corrupt the outline.
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
      h(PdfDocument, { creationDate: new Date(0) }, {
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

describe('multi-pass bookmark isolation', () => {
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

// A stable style reference makes Vue skip the style patch between passes. The
// dynamic-line-height normalization must therefore remain idempotent.
const STABLE_FOOTER_STYLE = { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 9, textAlign: 'center', lineHeight: 2 } as const

const StableStyleDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { creationDate: new Date(0) }, {
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

describe('multi-pass dynamic line-height isolation', () => {
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

// A destination on a page-spanning node belongs to the first fragment. Both the
// printed TOC number and the PDF named destination must use that start page.
const SplitDoc = defineComponent({
  props: { resolved: { type: Object, default: () => ({}) } },
  setup(props) {
    const resolved = () => props.resolved as DestinationPageMap
    return () =>
      h(PdfDocument, { creationDate: new Date(0) }, {
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

// Extraction and serialization enforce the first-page guarantee independently,
// so regressions receive separate assertions.
describe('page-spanning destination anchoring', () => {
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

// Convergence must compare the produced map against the map the layout was FED,
// not against the previous pass's produced map. The two are equivalent from
// pass 2 onward (fed_N = produced_{N-1}), so the ONLY observable difference is
// pass 1: an id-less document produces {} == fed {} and must converge
// immediately. A previous-vs-current variant cannot converge on pass 1 and
// silently pays a redundant full layout for every id-less multi-pass render.
describe('convergence compares produced against fed', () => {
  it('converges an id-less document in exactly one pass', async () => {
    const NoIdsDoc = defineComponent({
      props: { resolved: { type: Object, default: () => ({}) } },
      setup() {
        return () =>
          h(PdfDocument, {}, {
            default: () => h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => h(PdfText, {}, { default: () => 'no destinations here' }),
            }),
          })
      },
    })

    const mounted = await mountPdfComponent(NoIdsDoc, { resolved: {} })
    try {
      const result = await renderDocumentMultiPass(mountedSource(mounted))
      expect(result.passes).toBe(1)
      expect(result.pages).toEqual({})
    }
    finally {
      mounted.unmount()
    }
  })
})
