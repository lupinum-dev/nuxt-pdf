import { defineComponent, h, nextTick, shallowRef, type Component, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { parsePdf, type ParsedPdf } from '../src/test/pdf'
import {
  DESTINATION_FACTS,
  renderDocumentMultiPass,
  type DestinationPageMap,
  type MultiPassSource,
} from '../src/runtime/server/engine/layout-passes'
import { NuxtPdfError } from '../src/runtime/shared/errors'

const { PdfDocument, PdfLink, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

// The fixed-point loop on its own, with a source that builds each pass from a
// mounted component prop. The loop must stop at a fixed point and must not run
// away when the layout depends on the numbers it prints. PdfPageRef documents
// use this loop through the engine adapter (test/page-primitives.test.ts).
const mountSource = async (component: Component) => {
  const resolved = shallowRef<DestinationPageMap>({})
  const mounted = await mountPdfComponent(defineComponent(() => () =>
    h(component, { resolved: resolved.value })))
  const source: MultiPassSource<DestinationPageMap> = {
    ...DESTINATION_FACTS,
    get document() {
      return mounted.document as unknown as DocumentNode
    },
    feed: async (pages: DestinationPageMap) => {
      resolved.value = pages
      await nextTick()
    },
  }
  return { mounted, source }
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
              h(PdfLink, { href: '#only', style: { fontSize: 14 } }, {
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
    const { mounted, source } = await mountSource(PathologicalDoc)
    let feeds = 0
    const counting: MultiPassSource<DestinationPageMap> = {
      ...source,
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
    // Catches a message that prints one state twice: the last pass was fed one
    // page and produced the other, so the author sees what kept changing.
    const [, fedPage, producedPage] = (error as NuxtPdfError).message
      .match(/Last fed: #only→p(\d); last produced: #only→p(\d)\./) ?? []
    expect([fedPage, producedPage].sort()).toEqual(['2', '3'])

    // Bounded: the cap stopped the loop; it did not run away.
    expect(feeds).toBe(5)

    mounted.unmount()
  })
})

// Convergence must compare the produced map against the map the layout was FED,
// not against the previous pass's produced map. The only observable difference
// is pass 1: a document without destinations produces {} == fed {} and must
// converge at once instead of paying a redundant layout.
describe('multi-pass convergence', () => {
  it('converges a document without destinations in exactly one pass', async () => {
    const NoIdsDoc = defineComponent({
      props: { resolved: { type: Object, default: () => ({}) } },
      setup: () => () => h(PdfDocument, null, () =>
        h(PdfPage, null, () => h(PdfText, null, () => 'no destinations here'))),
    })

    const { mounted, source } = await mountSource(NoIdsDoc)
    try {
      const result = await renderDocumentMultiPass(source)
      expect(result.passes).toBe(1)
      expect(result.facts).toEqual({})
    }
    finally {
      mounted.unmount()
    }
  })
})

// A `pages="first"` head is painted on its parent's first page only. Without
// the first page from the previous pass, the sizing call cannot tell where
// the parent starts, so every later page broke as if the head were there.
describe('page-conditional geometry', () => {
  const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const
  const HEAD = { style: { fontSize: 14, paddingBottom: 20 } } as const
  const section = (head?: () => VNode) => defineComponent(() => () =>
    h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, () => [
      h(PdfView, null, () => [
        ...(head ? [head()] : []),
        ...Array.from({ length: 150 }, (_, index) => h(PdfText, { key: index }, () => `Line ${index}`)),
      ]),
    ])))

  const render = async (component: Component) => {
    const mounted = await mountPdfComponent(component)
    try {
      const result = await renderPlainDocument(mounted.document)
      return { parsed: await parsePdf(result.bytes), passes: result.passes }
    }
    finally {
      mounted.unmount()
    }
  }

  const lineYs = (parsed: ParsedPdf) => parsed.pages.map(page =>
    page.textRuns.filter(run => run.text.startsWith('Line ')).map(run => run.y))

  // Catches: a later page sized with the head, so it ends up to one head
  // height early and the content after it moves to the next page.
  it('lays out later pages of a first-page head like the document without it', async () => {
    const plain = lineYs((await render(section())).parsed)
    const always = lineYs((await render(section(() =>
      h(PdfText, { ...HEAD, fixed: true }, () => 'Head')))).parsed)
    const headed = await render(section(() =>
      h(PdfText, { ...HEAD, fixed: true, pages: 'first' }, () => 'Head')))
    const ys = lineYs(headed.parsed)

    // One pass to learn the parent's first page, one to use it.
    expect(headed.passes).toBe(2)
    expect(ys).toHaveLength(plain.length)
    expect(ys[0]).toEqual(always[0])
    // Every later page is filled on the same lines as a full page without
    // the head; only the last page ends early.
    const fullPage = plain[1]!
    ys.slice(1, -1).forEach(page => expect(page).toEqual(fullPage))
    expect(ys.at(-1)).toEqual(fullPage.slice(0, ys.at(-1)!.length))
  })
})
