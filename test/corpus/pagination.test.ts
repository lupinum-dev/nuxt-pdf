import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, type Component, type VNodeChild } from 'vue'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mountPdfComponent, type PdfComponentProps } from '../../src/runtime/renderer'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderPlainDocument } from '../../src/runtime/server/engine/plain-tree'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../../src/runtime/server/render-limits'
import type { BundledPdfFontDescriptor } from '../../src/runtime/fonts'
import { createPdfFontStore } from '../../src/runtime/server/engine/fonts'
import {
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
  type ParsedPdf,
} from '../../src/test/pdf'
import {
  VueWrapFalseDocument,
  wrapFalseEnd,
  wrapFalseStart,
} from '../fixtures/corpus/pagination-wrap-false'
import {
  explicitBreakBlocks,
  VueExplicitBreakDocument,
} from '../fixtures/corpus/pagination-explicit-break'
import {
  minPresenceBody,
  minPresenceHeading,
  VueMinPresenceDocument,
} from '../fixtures/corpus/pagination-min-presence'
import {
  VueWidowsOrphansDocument,
  widowsOrphansEnd,
  widowsOrphansStart,
} from '../fixtures/corpus/pagination-widows-orphans'
import {
  fixedBody,
  fixedFooter,
  fixedHeader,
  VueFixedMultipageDocument,
} from '../fixtures/corpus/pagination-fixed-multipage'
import {
  dynamicPageMarker,
  VueDynamicPageNumberDocument,
} from '../fixtures/corpus/pagination-dynamic-page-number'
import { expectReviewedPage } from '../raster'

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const baselineDirectory = fileURLToPath(new URL(
  '../fixtures/baselines/corpus',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

// One font store per render, as the render worker makes it (worker-entry.ts):
// a store's font objects are per render (#83, engine/fonts.ts).
let fonts: readonly BundledPdfFontDescriptor[]
let temporaryRoot: string

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-pagination-'))
  const fontRoot = join(temporaryRoot, 'pdfs/fonts')
  const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
  await mkdir(dirname(bundledFontPath), { recursive: true })
  await copyFile(fontPath, bundledFontPath)

  fonts = await bundlePdfFonts(
    [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
    { fontRoots: [fontRoot] },
  )
})

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true })
})

interface Rendered {
  bytes: Uint8Array
  pdf: ParsedPdf
  texts: string[]
}

async function renderVue(component: Component, props: PdfComponentProps = {}): Promise<Rendered> {
  const mounted = await mountPdfComponent(component, props)
  try {
    const result = await renderPlainDocument(mounted.document,
      { fontStore: createPdfFontStore(fonts) },
    )
    const pdf = await parsePdf(result.bytes)
    return { bytes: result.bytes, pdf, texts: pdf.pages.map(page => page.text) }
  }
  finally {
    mounted.unmount()
  }
}

/** 1-based page number of the first page whose text contains `marker`, else 0. */
function pageOf(texts: string[], marker: string): number {
  const index = texts.findIndex(text => text.includes(marker))
  return index === -1 ? 0 : index + 1
}

describe('pagination conformance', () => {
  it('wrap=false grows one tall page to hold all overflow; wrap=true paginates', async () => {
    const vueUnwrapped = await renderVue(VueWrapFalseDocument, { wrap: false })
    expect(hasPdfHeader(vueUnwrapped.bytes)).toBe(true)

    // wrap=false must NOT paginate even though the rows exceed one A4 page height.
    expect(vueUnwrapped.pdf.pageCount).toBe(1)
    // Nothing is dropped: the first (only) page holds both the first and last row.
    expect(vueUnwrapped.texts[0]).toContain(wrapFalseStart)
    expect(vueUnwrapped.texts[0]).toContain(wrapFalseEnd)

    // Identical content with wrap=true is the control: it paginates.
    const vueWrapped = await renderVue(VueWrapFalseDocument, { wrap: true })
    expect(vueWrapped.pdf.pageCount).toBe(2)
    expect(vueWrapped.texts[0]).toMatch(/Row 47 content line$/)
    expect(vueWrapped.texts[1]).toMatch(/^Row 48 content line/)
    expect(pageOf(vueWrapped.texts, wrapFalseEnd)).toBe(2)

    // The single wrap=false page is TALLER than a standard A4 page (it grew
    // to fit). A4 portrait height is ~842pt; rasterizePdf at scale 1 yields
    // point-sized px.
    const vuePages = await rasterizePdf(vueUnwrapped.bytes)
    expect(vuePages).toHaveLength(1)
    const vuePage = vuePages[0]!
    expect([vuePage.width, vuePage.height]).toEqual([596, 1056])

    const baselinePath = join(baselineDirectory, 'pagination-wrap-false-page-1.png')
    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
      await writeFile(baselinePath, vuePage.png)
    }
    const baseline = await decodePngPage(await readFile(baselinePath), vuePage.number)
    await expectReviewedPage(vuePage, baseline, 'pagination-wrap-false')
  }, 30_000)

  it('explicit break on nested wrapped Views lands each block on its own page', async () => {
    const vue = await renderVue(VueExplicitBreakDocument)

    expect(vue.pdf.pageCount).toBe(3)
    expect(vue.texts).toEqual([
      'EB-A First block stays on page one',
      'EB-B Second block after an explicit break',
      'EB-C Third block after an explicit break',
    ])

    explicitBreakBlocks.forEach((block, index) => {
      const expectedPage = index + 1
      expect(pageOf(vue.texts, block.marker)).toBe(expectedPage)
      // Nothing from another block leaks onto this page.
      for (const other of explicitBreakBlocks) {
        if (other === block) continue
        expect(vue.texts[expectedPage - 1]).not.toContain(other.marker)
      }
    })
  }, 20_000)

  it('minPresenceAhead pushes a bottom-of-page heading onto the next page with its block', async () => {
    // Control: no minPresenceAhead — the heading fits at the bottom of page one
    // and its body is stranded onto page two.
    const vueControl = await renderVue(VueMinPresenceDocument)
    expect(vueControl.pdf.pageCount).toBe(2)
    expect(vueControl.texts).toEqual(['MPA-SPACER MPA-HEADING kept with block', 'MPA-BODY under the heading'])
    expect(pageOf(vueControl.texts, minPresenceHeading)).toBe(1)
    expect(pageOf(vueControl.texts, minPresenceBody)).toBe(2)

    // Treatment: minPresenceAhead demands more space than remains, so the heading
    // itself breaks to page two and rejoins its following block.
    const vueKept = await renderVue(VueMinPresenceDocument, { minPresenceAhead: 120 })
    expect(vueKept.pdf.pageCount).toBe(2)
    expect(vueKept.texts).toEqual(['MPA-SPACER', 'MPA-HEADING kept with block MPA-BODY under the heading'])
    expect(pageOf(vueKept.texts, minPresenceHeading)).toBe(2)
    expect(pageOf(vueKept.texts, minPresenceBody)).toBe(2)
  }, 30_000)

  it('widows/orphans split a wrapped paragraph at its boundary', async () => {
    const vue = await renderVue(VueWidowsOrphansDocument)

    expect(vue.pdf.pageCount).toBe(2)

    // The paragraph starts on page one and finishes on page two.
    expect(pageOf(vue.texts, widowsOrphansStart)).toBe(1)
    expect(pageOf(vue.texts, widowsOrphansEnd)).toBe(2)
    // The exact wrap boundary: page one ends at word47, page two resumes at word48.
    expect(vue.texts[0]).toContain('word47')
    expect(vue.texts[0]).not.toContain('word48')
    expect(vue.texts[1]).toContain('word48')
  }, 20_000)

  it('fixed header and footer repeat on every page of a wrapped multi-page flow', async () => {
    const vue = await renderVue(VueFixedMultipageDocument)

    expect(vue.pdf.pageCount).toBe(4)

    // The fixed header and footer appear on EVERY page.
    for (const pageText of vue.texts) {
      expect(pageText).toContain(fixedHeader)
      expect(pageText).toContain(fixedFooter)
    }
    // The flowing body advances across pages: first body line on page one, last
    // on the final page.
    expect(pageOf(vue.texts, fixedBody[0]!)).toBe(1)
    expect(pageOf(vue.texts, fixedBody[fixedBody.length - 1]!)).toBe(vue.pdf.pageCount)
  }, 30_000)

  it('dynamic page-number text is correct on every wrapped page (computed oracle)', async () => {
    const vue = await renderVue(VueDynamicPageNumberDocument)
    const totalPages = vue.pdf.pageCount
    expect(totalPages).toBeGreaterThanOrEqual(4)

    vue.texts.forEach((pageText, index) => {
      expect(pageText).toContain(dynamicPageMarker(index + 1, totalPages))
    })
    // A wrong page number must NOT appear (guards against a stale/duplicated
    // footer painting the same number on every page).
    expect(vue.texts[1]).not.toContain(dynamicPageMarker(1, totalPages))
  }, 30_000)
})

// A forced break starts a new page at every depth (D24, H5-A); before, a break
// inside a container that fit on the page was ignored. Each row lists, per
// page, the texts on it. A break inside a row, a table cell, a fixed node or a
// wrap={false} node fails tree validation (D26, test/renderer.test.ts).
describe('forced breaks inside containers', () => {
  const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS
  const text = (value: string, props: Record<string, unknown> = {}) => h(PdfText, props, () => value)
  const view = (props: Record<string, unknown>, ...children: VNodeChild[]) => h(PdfView, props, () => children)

  it.each([
    { label: 'a wrapper', content: () => [text('A'), view({}, view({ break: true }, text('B')))], pages: ['A', 'B'] },
    { label: 'two wrappers', content: () => [text('A'), view({}, view({}, view({ break: true }, text('B'))))], pages: ['A', 'B'] },
    { label: 'the middle of a wrapper', content: () => [view({}, text('A'), text('B', { break: true }), text('C')), text('D')], pages: ['A', 'BCD'] },
    { label: 'the first child of a wrapper at the page top', content: () => [view({}, text('A', { break: true }), text('B'))], pages: ['AB'] },
    { label: 'the first child of a wrapper below a text', content: () => [text('A'), view({}, text('B', { break: true }), text('C'))], pages: ['A', 'BC'] },
    { label: 'a wrapper that overflows', content: () => [text('A'), view({}, text('L1 L2 L3 L4 L5 L6 L7 L8 L9 L10 L11 L12 L13 L14 L15 L16', { style: { width: 20 } }), text('B', { break: true }))], pages: ['AL1L2L3L4L5L6L7L8L9L10L11L12L13', 'L14L15L16', 'B'] },
  ])('break inside $label', async ({ content, pages }) => {
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: [200, 200], style: { padding: 20, fontSize: 10 } }, content)))
    const { texts } = await renderVue(document)
    expect(texts.map(page => page.replace(/\s/g, ''))).toEqual(pages)
  })
})

// Pagination rules that no conformance or generated document reaches (branch
// coverage of layout/paginate). Page 200 x 200
// pt, padding 20 (160 pt of content), 10 pt Helvetica: a line is 11.56 pt.
describe('pagination rules at their edges', () => {
  const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS
  const text = (value: string, props: Record<string, unknown> = {}) => h(PdfText, props, () => value)
  const view = (props: Record<string, unknown>, ...children: VNodeChild[]) => h(PdfView, props, () => children)

  it.each([
    // A container whose first content starts below the page end stays when
    // no flow content is above it, cut at the page end: moved, it would start
    // every page the same way, and pagination would never end (E2). A fixed
    // head is no such content. Broken, the 2 s budget ends the render.
    { label: 'a container whose content starts below the page end, below a fixed head', content: () => [text('H', { fixed: true }), view({ style: { paddingTop: 150 } }, text('A')), text('B')], pages: ['HA', 'HB'] },
    // A row child that starts below the page end moves whole, with its top
    // margin (70 pt): its baseline on the next page is 70 + 29 pt below the
    // page top. A split part would lose the margin (29 pt).
    { label: 'a row child below the page end', content: () => [view({ style: { height: 100 } }), view({ style: { flexDirection: 'row' } }, text('A'), text('B', { style: { marginTop: 70 } }))], pages: ['A', 'B'], top: 99 },
    // A text with fewer lines than orphans moves whole when it does not fit.
    { label: 'a text with fewer lines than orphans', content: () => [text('F', { style: { height: 140 } }), text('X1 X2', { orphans: 3, style: { width: 24 } })], pages: ['F', 'X1X2'] },
    // A text whose line is higher than the content area (a 40 pt text in a
    // 40 pt box) can never fit: at a page top it keeps its line, cut at the
    // page end. Moved, it started every page the same way, forever.
    { label: 'a text whose line is higher than the content area', size: [200, 80] as const, content: () => [text('A', { style: { fontSize: 40 } }), text('B')], pages: ['A', 'B'] },
    // minPresenceAhead counts no content after a forced break, as a keep
    // does: that content never shares the page. Counting it, the view (10
    // lines, 33 pt left below it) moved to a page of its own.
    { label: 'a minPresenceAhead before a forced break', content: () => [text('intro'), view({ minPresenceAhead: 150 }, text('L1 L2 L3 L4 L5 L6 L7 L8 L9 L10', { style: { width: 24 } })), view({ break: true }, text('next N1 N2 N3 N4 N5 N6 N7 N8 N9 N10 N11 N12 N13 N14 N15 N16 N17 N18 N19 N20', { style: { width: 24 } }))], pages: ['introL1L2L3L4L5L6L7L8L9L10', 'nextN1N2N3N4N5N6N7N8N9N10N11N12N13', 'N14N15N16N17N18N19N20'] },
  ])('$label', async ({ content, pages, top, size = [200, 200] as const }) => {
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size, style: { padding: 20, fontSize: 10 } }, content)))
    const mounted = await mountPdfComponent(document)
    try {
      const limits = createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 2_000 })
      const { bytes } = await renderPlainDocument(mounted.document, { fontStore: createPdfFontStore(fonts), limits })
      const pdf = await parsePdf(bytes)
      expect(pdf.pages.map(page => page.text.replace(/\s/g, ''))).toEqual(pages)
      if (top !== undefined) {
        const page = pdf.pages[1]!
        const run = page.textRuns.find(textRun => textRun.text.trim() !== '')!
        expect(Math.round(page.height - run.y)).toBe(top)
      }
    }
    finally {
      mounted.unmount()
    }
  })
})

// Margins at a page top (D25, H5-C, H5-D): a node that moves whole to the next
// page keeps its top margin, after a break too; the continuation part of a
// split node has none. A neutral wrapper never changes a position. Page
// 200 x 200 pt, padding 20, 10 pt Helvetica: a first line with no margin above
// has its baseline 29 pt below the page top, with the 6 pt margin 35 pt.
describe('margins at a page top', () => {
  const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS
  type Kind = 'text' | 'view' | 'text, wrap false' | 'view, wrap false'
  const words = (count: number) => Array.from({ length: count }, (_, index) => `X${index + 1}`).join(' ')
  const node = (kind: Kind, props: Record<string, unknown>, lines: number) => {
    const all: Record<string, unknown> = { ...props, ...(kind.endsWith('wrap false') ? { wrap: false } : {}) }
    return kind.startsWith('text')
      ? h(PdfText, { ...all, style: { ...(all.style as object), width: 24 } }, () => words(lines))
      : h(PdfView, all, () => h(PdfText, { style: { width: 24 } }, () => words(lines)))
  }
  const wrapped = (depth: number, child: VNodeChild): VNodeChild => depth === 0 ? child : h(PdfView, null, () => wrapped(depth - 1, child))
  // Filler height, node props and line count place the node: 'moved' starts
  // below the last line that fits, 'continued' splits after two lines, 'break'
  // has a break, 'bottom margin' fits but its 12 pt bottom margin does not:
  // it stays on page 1 below the filler (6 + 9 pt below it) and loses the
  // margin, as CSS truncates a margin at a break (D25).
  const HOW = {
    'moved': { filler: 150, props: {}, lines: 4, pages: 2, first: 'X1', top: 35 },
    'continued': { filler: 125, props: {}, lines: 4, pages: 2, first: 'X3', top: 29 },
    'break': { filler: 10, props: { break: true }, lines: 4, pages: 2, first: 'X1', top: 35 },
    'bottom margin': { filler: 128, props: { style: { marginBottom: 12 } }, lines: 2, pages: 1, first: 'X1', top: 163 },
  } as const
  const cases = (['text', 'view', 'text, wrap false', 'view, wrap false'] as const).flatMap(kind =>
    (Object.keys(HOW) as (keyof typeof HOW)[])
      .filter(how => how !== 'continued' || !kind.endsWith('wrap false'))
      .flatMap(how => [0, 1, 2].map(depth => ({ kind, how, depth }))))

  // Where the node starts on the last page; with no `how`, it is the first
  // node of page 1.
  const place = async (kind: Kind, how: keyof typeof HOW | null, depth: number, marginTop: number) => {
    const { filler, props, lines } = how ? HOW[how] : { filler: null, props: {}, lines: HOW.break.lines }
    const style = { marginTop, ...('style' in props ? props.style : {}) }
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: [200, 200], style: { padding: 20, fontSize: 10 } }, () => [
        filler === null ? null : h(PdfView, { style: { height: filler } }),
        wrapped(depth, node(kind, { ...props, style }, lines)),
      ])))
    const { pdf } = await renderVue(document)
    const page = pdf.pages.at(-1)!
    const run = page.textRuns.find(textRun => textRun.text.trim().startsWith('X'))!
    return { pages: pdf.pageCount, first: run.text.trim().split(' ')[0], top: Math.round(page.height - run.y) }
  }

  it.each(cases)('$kind, $how, in $depth wrappers', async ({ kind, how, depth }) => {
    const { pages, first, top } = HOW[how]
    expect(await place(kind, how, depth, 6)).toEqual({ pages, first, top })
  })

  // An automatic break keeps a negative top margin from drawing the node it
  // moves above its new page: the node starts at the content top, where
  // 'continued' starts. Only a node kept whole moves for the margin; the
  // others split.
  const moved = cases.filter(({ kind, how }) => how === 'moved' && kind.endsWith('wrap false'))
  it.each(moved)('$kind, $how, in $depth wrappers, with a negative top margin', async ({ kind, how, depth }) => {
    expect(await place(kind, how, depth, -30)).toEqual({ pages: 2, first: 'X1', top: HOW.continued.top })
  })

  // After `break` the author put the node at the page top, as the first node
  // of page 1, so its negative top margin stays the same on both.
  const broken = cases.filter(({ how }) => how === 'break')
  it.each(broken)('$kind, $how, in $depth wrappers, with a negative top margin', async ({ kind, how, depth }) => {
    const first = await place(kind, null, depth, -30)
    expect(await place(kind, how, depth, -30)).toEqual({ ...first, pages: 2 })
  })

  // A forced break holds for the page it starts only: on a later page, an
  // automatic break still keeps the node it moves at the content top.
  it('a negative top margin after an automatic break, on a page after a forced break', async () => {
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: [200, 200], style: { padding: 20, fontSize: 10 } }, () => [
        h(PdfText, null, () => 'A'),
        h(PdfView, { break: true, style: { height: HOW.moved.filler } }),
        node('text, wrap false', { style: { marginTop: -30 } }, HOW.moved.lines),
      ])))
    const { pdf } = await renderVue(document)
    const page = pdf.pages.at(-1)!
    const run = page.textRuns.find(textRun => textRun.text.trim().startsWith('X'))!
    expect({ pages: pdf.pageCount, top: Math.round(page.height - run.y) }).toEqual({ pages: 3, top: HOW.continued.top })
  })
})

// A bottom margin at the page end (D25, amended): a node's own bottom margin
// never moves it. A4, padding 40 (761.89 pt of content), 10 pt Helvetica (a
// line is 11 pt): ten lines with a 6 pt bottom margin end 3 pt above the
// content end; the margin crosses it. The text stays and loses the margin,
// and the text after it starts page 2; at every depth (I13). Before the
// amendment the ten lines moved and left 113 pt empty. With
// `minPresenceAhead` the margin still counts: 2 pt fits the 3 pt left, 2 pt
// after the margin does not, so the text moves.
describe('a bottom margin at the page end', () => {
  const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS
  const LINES = Array.from({ length: 10 }, (_, index) => `L${index + 1}`).join('\n')
  const wrapped = (depth: number, child: VNodeChild): VNodeChild => depth === 0 ? child : h(PdfView, null, () => wrapped(depth - 1, child))

  it.each([
    { label: 'stays and loses its margin', depth: 0, props: {}, places: { L1: [1, 698], L10: [1, 797], After: [2, 49] } },
    { label: 'stays and loses its margin in two wrappers', depth: 2, props: {}, places: { L1: [1, 698], L10: [1, 797], After: [2, 49] } },
    { label: 'moves when minPresenceAhead after the margin does not fit', depth: 0, props: { minPresenceAhead: 2 }, places: { L1: [2, 49], L10: [2, 148], After: [2, 165] } },
  ])('a text whose box fits but whose bottom margin does not $label', async ({ depth, props, places }) => {
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 10 } }, () => [
        h(PdfView, { style: { height: 761.89 - 110 - 3 } }),
        wrapped(depth, h(PdfText, { ...props, style: { marginBottom: 6 } }, () => LINES)),
        h(PdfText, null, () => 'After'),
      ])))
    const { pdf } = await renderVue(document)
    const placeOf = (token: string) => pdf.pages.flatMap((page, index) => page.textRuns
      .filter(run => run.text.trim() === token)
      .map(run => [index + 1, Math.round(page.height - run.y)]))[0]
    expect(Object.fromEntries(Object.keys(places).map(token => [token, placeOf(token)]))).toEqual(places)
  })
})

// An auto margin takes the room yoga hands out in its column: on a page that
// is the room the page leaves, as for flexGrow and justifyContent. The
// builder used to sum it as 0, so the layout differed from its sums and the
// render failed with PDF_RENDER_ERROR. Page 300 x 400 pt, padding 20 (content
// 20 to 380 pt), 10 pt Helvetica: a first baseline is 29 pt below the page
// top, the last one that fits 378 pt. A place is [page, baseline from the top].
describe('auto margins', () => {
  const { PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS
  const text = (value: string, style: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => h(PdfText, { ...props, style }, () => value)
  const view = (style: Record<string, unknown>, children: VNodeChild[], props: Record<string, unknown> = {}) => h(PdfView, { ...props, style }, () => children)
  const lines = (count: number, prefix = 'L') => Array.from({ length: count }, (_, index) => text(`${prefix}${index + 1}`))
  const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index + 1}`).join(' ')
  const auto = 'auto'
  const placesOf = async (content: () => VNodeChild[], tokens: string[], pageStyle: Record<string, unknown> = {}) => {
    const document = defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: [300, 400], style: { padding: 20, fontSize: 10, ...pageStyle } }, content)))
    const { pdf } = await renderVue(document)
    // A token is the first word of its line.
    const placeOf = (token: string) => pdf.pages.flatMap((page, index) => page.textRuns
      .filter(run => run.text.trim().split(' ')[0] === token)
      .map(run => [index + 1, Math.round(page.height - run.y)]))[0]
    return Object.fromEntries(tokens.map(token => [token, placeOf(token)]))
  }

  it('a text with a bottom auto margin below a nearly full page pushes the next text to the page end', async () => {
    expect(await placesOf(() => [...lines(28), text('AUTO', { marginBottom: auto }), text('next')], ['AUTO', 'next']))
      .toEqual({ AUTO: [1, 337], next: [1, 378] })
  })

  it.each([
    { label: 'marginBottom on a page', content: () => [text('A', { marginBottom: auto }), text('B')], places: { A: [1, 29], B: [1, 378] } },
    { label: 'marginTop on a page', content: () => [text('A'), text('B', { marginTop: auto })], places: { A: [1, 29], B: [1, 378] } },
    { label: 'margin on a page', content: () => [text('A'), text('B', { margin: auto }), text('C')], places: { B: [1, 204], C: [1, 378] } },
    { label: 'marginVertical on a page', content: () => [text('A'), text('B', { marginVertical: auto }), text('C')], places: { B: [1, 204], C: [1, 378] } },
    { label: 'two that share the room', content: () => [text('A', { marginBottom: auto }), text('B', { marginBottom: auto }), text('C')], places: { B: [1, 204], C: [1, 378] } },
    { label: 'beside justifyContent, which gives way', content: () => [text('A', { marginBottom: auto }), text('B')], pageStyle: { justifyContent: 'center' }, places: { A: [1, 29], B: [1, 378] } },
    { label: 'beside flexGrow, which takes the room', content: () => [text('A', { marginBottom: auto }), view({ flexGrow: 1 }, [text('G')]), text('B')], places: { G: [1, 40], B: [1, 378] } },
    // Only the room below the last line that fits: 8 pt.
    { label: 'on a full page', content: () => [...lines(4), text('L5', { marginBottom: auto }), ...lines(40, 'M')], places: { M1: [1, 92], M27: [1, 378], M28: [2, 29] } },
    { label: 'on a node moved to the next page', content: () => [...lines(33), view({ height: 30, marginTop: auto }, [text('X')], { wrap: false }), text('Y')], places: { X: [2, 348], Y: [2, 378] } },
    { label: 'in the part of a view that breaks', content: () => [view({}, [text('a', { marginBottom: auto }), ...lines(40, 'M')]), text('after')], places: { M1: [1, 48], M31: [1, 378], M32: [2, 29], after: [2, 128] } },
    // Across a row an auto margin only places the cell: at the row's end, or in its middle.
    { label: 'marginTop on a row cell', content: () => [view({ flexDirection: 'row' }, [view({ height: 100, width: 100 }, [text('tall')]), view({ marginTop: auto }, [text('low')])]), text('after')], places: { low: [1, 118], after: [1, 129] } },
    { label: 'marginVertical on a row cell', content: () => [view({ flexDirection: 'row' }, [view({ height: 100, width: 100 }, [text('tall')]), view({ marginVertical: auto }, [text('mid')])]), text('after')], places: { mid: [1, 74], after: [1, 129] } },
    { label: 'marginTop on a cell of a row that breaks', content: () => [...lines(28), view({ flexDirection: 'row' }, [view({ width: 140 }, [text(words(80))]), view({ marginTop: auto }, [text('low')])]), text('after')], places: { w1: [1, 337], low: [2, 117], after: [2, 128] } },
    // minPresenceAhead counts the margin as 0: 40 pt fit below PRES, then the margin takes the rest.
    { label: 'with minPresenceAhead that fits', content: () => [...lines(28), text('PRES', { marginBottom: auto }, { minPresenceAhead: 40 }), text(words(30))], places: { PRES: [1, 337], w1: [1, 356] } },
    { label: 'with minPresenceAhead that moves the text', content: () => [...lines(29), text('PRES', { marginBottom: auto }, { minPresenceAhead: 40 }), text(words(30))], places: { PRES: [2, 29], w1: [2, 356] } },
  ])('$label', async ({ content, places, pageStyle }) => {
    expect(await placesOf(content, Object.keys(places), pageStyle)).toEqual(places)
  })
})
