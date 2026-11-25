import { defineComponent, h, type Component, type VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfStyle } from '../src/runtime/authoring'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import { countedWork } from '../src/runtime/server/engine/work'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { pageContents, ROBOTO } from './fixtures/tagged-document'
import { readPaint } from './invariants/document'

installPdfCanvasGlobals()

const { PdfDocument, PdfFootnote, PdfLink, PdfPage, PdfPageNumber, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS
// Untyped, for props that a template can pass and the prop types reject.
const LooseText: Component = PdfText
const LooseView: Component = PdfView

// Column containers with ordered fill (F6 M1). A4 with 40 pt padding: the
// content box is 515.28 pt wide and 761.89 pt high, a 10 pt line 11 pt high.
// Two columns with a 20 pt gap are 247.64 pt wide; the second starts at
// x = 40 + 247.64 + 20 = 307.64.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const
const TWO = { columnCount: 2, columnGap: 20 } as const
// The same in order: each column fills to the page end before the next.
const AUTO = { ...TWO, columnFill: 'auto' } as const

const doc = (content: () => VNode[], pageStyle: PdfStyle) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, { ...PAGE, style: { ...PAGE.style, ...pageStyle } }, content)))

const render = async (content: () => VNode[], pageStyle: PdfStyle = {}) => {
  const mounted = await mountPdfComponent(doc(content, pageStyle))
  try {
    // A pagination that does not end fails at the deadline, not in a hung run.
    const { result: { bytes, layoutWarnings }, work } = await countedWork(() => renderPlainDocument(mounted.document, { limits: createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 5_000 }) }))
    return { parsed: await parsePdf(bytes), warnings: layoutWarnings, work }
  }
  finally {
    mounted.unmount()
  }
}

/** Where each run with this text starts: page, x and top from the page top, rounded to 0.01 pt. */
const placesOf = (parsed: ParsedPdf, text: string): [number, number, number][] => parsed.pages.flatMap(page => page.textRuns
  .filter(run => run.text === text)
  .map(run => [page.number, Math.round(run.x * 100) / 100, Math.round((page.height - run.y - run.height) * 100) / 100] as [number, number, number]))

const lines = (count: number, prefix = 'L') => Array.from({ length: count }, (_, index) => h(PdfText, { key: index }, () => `${prefix}${index}`))

const absoluteText = () => h(PdfView, { style: { position: 'absolute', right: 0, top: 0, width: 50 } }, () => h(PdfText, null, () => 'Abs'))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('column containers', () => {
  // 69 lines of 11 pt fill a column. Catches columns that do not fill in
  // order (L69 not at the top of column 2), a second column at the wrong x
  // (the gap or the column width wrong), and a rest that skips a column.
  it('fills two columns in order and goes on in the first column of the next page', async () => {
    const { parsed, work } = await render(() => [h(PdfView, { style: AUTO }, () => lines(150))])
    expect(['L0', 'L68', 'L69', 'L137', 'L138', 'L149'].map(text => placesOf(parsed, text))).toEqual([
      [[1, 40, 39]],
      [[1, 40, 787]],
      [[1, 307.64, 39]],
      [[1, 307.64, 787]],
      [[2, 40, 39]],
      [[2, 40, 160]],
    ])
    // Page 1: a fill in order finds that the container goes on, and the split
    // fills its two columns; page 2: the rest ends in column 1. A fill per
    // line or per try of a page end would count more.
    expect(work.columnFills).toBe(5)
  })

  // Content after a container whose columns go on to the next page. A page
  // takes two columns of the galley, so the boxes a split passes on were
  // higher than the rest by a column more than after a plain split, and the
  // cut of page 2 held 'After' back although it starts above the page end.
  // Catches that: in tests the cut check throws ('Pagination held back
  // content that starts above the page end'), so these rows also show that
  // no render takes the full layout a production render falls back to.
  it.each([
    { label: 'no edge', style: {}, places: { L0: [1, 40, 39], L68: [1, 40, 787], L69: [1, 307.64, 39], L137: [1, 307.64, 787], L138: [2, 40, 39], L149: [2, 307.64, 94], After: [2, 40, 105] } },
    { label: 'a padding', style: { padding: 10 }, places: { L0: [1, 50, 49], L67: [1, 50, 786], L68: [1, 307.64, 49], L135: [1, 307.64, 786], L136: [2, 50, 39], L149: [2, 307.64, 105], After: [2, 40, 126] } },
    { label: 'a border', style: { borderWidth: 2 }, places: { L0: [1, 42, 41], L68: [1, 42, 789], L69: [1, 307.64, 41], L137: [1, 307.64, 789], L149: [2, 307.64, 94], After: [2, 40, 107] } },
    { label: 'a top margin', style: { marginTop: 10 }, places: { L0: [1, 40, 49], L67: [1, 40, 786], L68: [1, 307.64, 49], L135: [1, 307.64, 786], L136: [2, 40, 39], L149: [2, 307.64, 105], After: [2, 40, 116] } },
  ])('places content after a container over two pages with $label', async ({ style, places }) => {
    const { parsed } = await render(() => [h(PdfView, { style: { ...TWO, ...style } }, () => lines(150)), h(PdfText, null, () => 'After')])
    expect(Object.fromEntries(Object.keys(places).map(text => [text, placesOf(parsed, text)[0]]))).toEqual(places)
  })

  // Three columns of one text that continues on the next page: the text
  // after the container keeps its top from the layout before the fill, two
  // rooms below where it starts and beyond the cut's read limit, and moves up
  // with the lowered rest (`liftAfterLowered`). Without that the cut holds it
  // back and pagination throws. Two columns stay within the limit.
  it.each([
    { label: 'balanced', style: { columnCount: 3, columnGap: 20 }, places: { L219: [2, 396.85, 61], After: [2, 40, 94] } },
    { label: 'in order', style: { columnCount: 3, columnGap: 20, columnFill: 'auto' }, places: { L219: [2, 40, 171], After: [2, 40, 182] } },
  ] as const)('places content after a three-column text that continues on the next page, $label', async ({ style, places }) => {
    const text = Array.from({ length: 220 }, (_, index) => `L${index}`).join('\n')
    const { parsed } = await render(() => [h(PdfView, { style }, () => h(PdfText, null, () => text)), h(PdfText, null, () => 'After')])
    expect(Object.fromEntries(Object.keys(places).map(token => [token, placesOf(parsed, token)[0]]))).toEqual(places)
  })

  // The rest of a container inside a view, three pages: every container
  // around the galley passes on a box as high as its rest.
  // Catches only the container itself lowered, not the view around it.
  it('places content after a container inside a view over three pages', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { padding: 5 } }, () => h(PdfView, { style: { ...TWO, padding: 10 } }, () => lines(300))), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L149'), placesOf(parsed, 'After')]).toEqual([[[2, 55, 204]], [[3, 40, 208]]])
  })

  // An absolute child belongs to the container: placed against its box, at
  // its right edge (40 + 515.28 − 50), and not ending the segment its source
  // position is in. Catches it placed in the galley (x 237.64, the right edge
  // of column 1) and a segment ended there (M29 in column 1 of a second
  // segment, at 479).
  it('places an absolute child against the container and keeps one segment around it', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      ...lines(40),
      h(PdfView, { style: { position: 'absolute', right: 0, top: 0, width: 50 } }, () => h(PdfText, null, () => 'Abs')),
      ...lines(40, 'M'),
    ])])
    expect([placesOf(parsed, 'Abs'), placesOf(parsed, 'M29')]).toEqual([[[1, 505.28, 39]], [[1, 307.64, 358]]])
  })

  // A percentage height on an absolute child stays allowed: it is placed
  // against the container, not in the columns. Catches the mount check for
  // direct children applied to it.
  it('places an absolute child with a percentage height against the container', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { ...TWO, height: 200 } }, () => [
      ...lines(2),
      h(PdfView, { style: { position: 'absolute', right: 0, bottom: 0, width: 50, height: '50%' } }, () => h(PdfText, null, () => 'Abs')),
    ])])
    // Half of the 200 pt container, from its bottom: the text starts at 40 + 100.
    expect(placesOf(parsed, 'Abs')).toEqual([[1, 505.28, 139]])
  })

  // The engine paints in source order: an absolute child written before the
  // columns' content (a background, a watermark) is drawn before it, one
  // written after it over it. Catches the first one moved after its segment
  // (drawn over the text).
  it.each([
    { label: 'before', content: () => [absoluteText(), ...lines(3)], order: ['Abs', 'L0', 'L1', 'L2'] },
    { label: 'after', content: () => [...lines(3), absoluteText()], order: ['L0', 'L1', 'L2', 'Abs'] },
  ])('draws an absolute child written $label the content in that order', async ({ content, order }) => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, content)])
    // pdf.js adds a space between two runs on one line (L2 and Abs).
    expect(parsed.pages[0]!.textRuns.map(run => run.text).filter(text => text.trim() !== '')).toEqual(order)
  })

  // A fixed child of the galley repeats at the top of each column that has
  // content: column 1, and column 2 that a column break starts. After B
  // only the fixed child is left, which starts no column of its own.
  // Catches it passed on as a rest: the container then has a next part and
  // loses its filled columns (B under A in column 1).
  it('repeats a fixed child only in the columns that have content', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      h(PdfText, { fixed: true }, () => 'Head'),
      h(PdfText, null, () => 'A'),
      h(PdfText, { break: 'column' }, () => 'B'),
    ])])
    expect([placesOf(parsed, 'Head'), placesOf(parsed, 'B')]).toEqual([[[1, 40, 39], [1, 307.64, 39]], [[1, 307.64, 50]]])
  })

  // The container's gap spaces its children in each column (6 pt between
  // 11 pt lines: 45 lines a column), and is the column gap too. Catches the
  // galley without the container's row gap.
  it('spaces the children by the container\'s gap', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { ...AUTO, gap: 6 } }, () => lines(50))])
    expect(['L1', 'L44', 'L45'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 56]], [[1, 40, 787]], [[1, 300.64, 39]]])
  })

  // Catches lines that break at the container width instead of the column
  // width: 'one two three …' wraps inside 247.64 pt.
  it('breaks the lines of a text at the column width', async () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ')
    const { parsed } = await render(() => [h(PdfView, { style: AUTO }, () => [h(PdfText, null, () => words)])])
    const right = Math.max(...parsed.pages[0]!.textRuns.map(run => run.x + run.width))
    expect(right).toBeLessThanOrEqual(40 + 247.64)
  })

  // A container that ends on its page is balanced: 3 lines are 2 in column 1
  // and 1 in column 2, and the content after it starts below the longer
  // column. Catches columns in order (L2 under L1) and a container as high
  // as its galley (After at 72).
  it('balances a short container and puts the content after it below its longer column', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => lines(3)), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L2'), placesOf(parsed, 'After')]).toEqual([[[1, 307.64, 39]], [[1, 40, 61]]])
  })

  // Three columns: 7 lines are 3, 3 and 1, the lowest height at which the
  // columns hold them. Catches a search that stops at the first height that
  // works without going lower (one column of 7).
  it('balances three columns at the lowest height that holds the content', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { columnCount: 3, columnGap: 20 } }, () => lines(7)), h(PdfText, null, () => 'After')])
    expect(['L2', 'L3', 'L6', 'After'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 61]], [[1, 218.43, 39]], [[1, 396.85, 39]], [[1, 40, 72]]])
  })

  // A container about 11.5 content areas high (800 lines) fills in order on
  // pages 1 to 5 and is balanced only on page 6, where it ends: 55 lines a
  // column, found in one try. Catches tries on the pages before (a try per
  // page) and a last page left in order (L745 under L744 in column 1).
  it('balances a long container only on the page where it ends', async () => {
    const { parsed, work } = await render(() => [h(PdfView, { style: TWO }, () => lines(800))])
    expect([parsed.pageCount, placesOf(parsed, 'L744'), placesOf(parsed, 'L745'), work.columnBalanceTries]).toEqual([6, [[6, 40, 633]], [[6, 307.64, 39]], 1])
  })

  // Three columns from a galley two pages high: the balanced container is
  // about 1.3 content areas lower than the galley, and the 200 lines after
  // it move up by that much in the next layout, which reads the old boxes.
  // Catches a page cut that allows for one content area only: in tests it
  // throws 'Pagination held back content that starts above the page end'.
  it('places the content after a container that balancing made much lower', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { columnCount: 3, columnGap: 20 } }, () => lines(138)), ...lines(200, 'A')])
    expect(['L45', 'L46', 'L137', 'A0', 'A22', 'A23'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 534]], [[1, 218.43, 39]], [[1, 396.85, 534]], [[1, 40, 545]], [[1, 40, 787]], [[2, 40, 39]]])
  })

  // A block that cannot split stays whole in a balanced column: column 1
  // holds 10 lines and the block (210 pt), column 2 the 10 lines after it.
  // Catches a try that cuts the block at a lower column height (Block cut,
  // with a warning) and content after the container above the block's end.
  it('keeps a block that cannot split whole in a balanced column', async () => {
    const { parsed, warnings } = await render(() => [h(PdfView, { style: TWO }, () => [
      ...lines(10),
      h(PdfView, { wrap: false, style: { height: 100 } }, () => h(PdfText, null, () => 'Block')),
      ...lines(10, 'M'),
    ]), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'Block'), placesOf(parsed, 'M0'), placesOf(parsed, 'After'), warnings]).toEqual([[[1, 40, 149]], [[1, 307.64, 39]], [[1, 40, 249]], []])
  })

  // A fixed child 77 pt high repeats at the top of each column, so the even
  // share (368.5 pt) is too low: the balance steps to the next height where
  // a column changes, a line at a time (374, 385, 396), and the fifth try,
  // 407, works: 30 lines a column. Catches a balance with too few steps
  // before its fallback (three: the same columns, in more tries).
  it('finds the lowest height when the even share is too low', async () => {
    const { parsed, work } = await render(() => [h(PdfView, { style: TWO }, () => [h(PdfView, { fixed: true, style: { height: 77 } }), ...lines(60)])])
    expect([placesOf(parsed, 'L29'), placesOf(parsed, 'L30'), work.columnBalanceTries]).toEqual([[[1, 40, 435]], [[1, 307.64, 116]], 5])
  })

  // A block that cannot split, 300 pt high in a plain view, after 30 lines
  // in three columns: at a height under 300 it moves to column 3 and does
  // not fit there either, so those heights fail. The columns are 300 pt
  // high: 27 lines, 3 lines and the block. 300 is the block's own height at
  // a column top, which the galley's break heights do not hold; a search on
  // them alone ends at 308 (28 lines, 2 lines and the block; finding (am)).
  // Catches a try that reads a column top as a page top: there the view
  // stays, cut, below a lower height, as a view whose children all moved
  // does at a page top.
  it('balances at a height that the block that cannot split fits', async () => {
    const { parsed, warnings } = await render(() => [h(PdfView, { style: { columnCount: 3, columnGap: 20 } }, () => [
      ...lines(30),
      h(PdfView, null, () => h(PdfView, { wrap: false, style: { height: 300 } }, () => h(PdfText, null, () => 'Block'))),
    ]), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L29'), placesOf(parsed, 'Block'), placesOf(parsed, 'After'), warnings]).toEqual([[[1, 218.43, 61]], [[1, 396.85, 39]], [[1, 40, 339]], []])
  })

  // Three columns with no gap, a text of five lines (55 pt) and a block of
  // 56 pt that cannot split: the columns are 55, 56 and 0 pt high. 56 is the
  // lowest height that holds both: the text fills column 1 and the block
  // needs a column top of its own, so nothing is left for column 3. Column 1
  // ends where a later column needs more, at a height the galley's break
  // heights (44, 55 and 111) do not hold; a search on them alone puts
  // everything in column 1 at 111 (finding (am), I27 seed 23).
  it('balances at the height of a block that starts a column', async () => {
    const { parsed, warnings } = await render(() => [h(PdfView, { style: { columnCount: 3, columnGap: 0 } }, () => [
      h(PdfText, null, () => ['T0', 'T1', 'T2', 'T3', 'T4'].join('\n')),
      h(PdfView, { wrap: false, style: { height: 56 } }, () => h(PdfText, null, () => 'Block')),
    ]), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'T4'), placesOf(parsed, 'Block'), placesOf(parsed, 'After'), warnings]).toEqual([[[1, 40, 83]], [[1, 211.76, 39]], [[1, 40, 95]], []])
  })

  // Ten lines, a 100 pt block that cannot split and nine lines in two
  // columns: the columns are 110 and 199 pt high, the ten lines in column 1
  // and the block with the nine lines in column 2. 199 ends a line of column
  // 2, which starts at the block; the galley's break heights above the even
  // share (154.5) start at the block's end there (210), where column 1
  // holds the block too. The balance steps from 154.5 to the next height
  // where a column changes: 155, 166, 177, 188, then 199 (six tries).
  it('balances at a height that only a later column ends at', async () => {
    const { parsed, work } = await render(() => [h(PdfView, { style: TWO }, () => [
      ...lines(10),
      h(PdfView, { wrap: false, style: { height: 100 } }, () => h(PdfText, null, () => 'Block')),
      ...lines(9, 'M'),
    ]), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L9'), placesOf(parsed, 'Block'), placesOf(parsed, 'M8'), placesOf(parsed, 'After'), work.columnBalanceTries]).toEqual([[[1, 40, 138]], [[1, 307.64, 39]], [[1, 307.64, 227]], [[1, 40, 238]], 6])
  })

  // A 19 pt block that cannot split and moved to page 2 (the columns of
  // page 1, below a 556 pt spacer, hold the text and the 187 pt block) may
  // split on that fresh page, but not in its columns: it is balanced whole
  // in column 1, and the text after the container follows below it. Catches
  // a balance that cuts it at its text's line (11 pt) and puts the rest in
  // column 2, with the text after the container on the block (I27 seed 23).
  it('keeps a block that moved to the next page whole in its columns', async () => {
    const { parsed, warnings } = await render(() => [
      h(PdfView, { style: { height: 556 } }),
      h(PdfView, { style: TWO }, () => [
        h(PdfText, null, () => 'T0\nT1'),
        h(PdfView, { wrap: false, style: { height: 187 } }, () => h(PdfText, null, () => 'Large')),
        h(PdfView, { wrap: false, style: { height: 19 } }, () => h(PdfText, null, () => 'Small')),
      ]),
      h(PdfText, null, () => 'After'),
    ])
    expect([placesOf(parsed, 'Large'), placesOf(parsed, 'Small'), placesOf(parsed, 'After'), warnings]).toEqual([[[1, 307.64, 595]], [[2, 40, 39]], [[2, 40, 58]], []])
  })

  // A container with a height fills its columns to that height: 30 lines
  // (330 pt) in a height of 200 are balanced at 15 a column, or fill in
  // order to the height with columnFill 'auto' (18 lines of 11 pt in 200).
  // A maxHeight that the content passes is the column height too, and the
  // balanced container is as high as its columns. Catches columns filled to
  // the page end (L15 under L14) and the typed error of M1 for content that
  // fits the columns. With 30 pt of bottom padding and border the columns end
  // above them, at 170 pt (15 lines); at the box height they would hold 18.
  it.each([
    { label: 'a height', style: { ...TWO, height: 200 }, first: 'L15', after: [[1, 40, 239]] },
    { label: 'a height and columnFill auto', style: { ...AUTO, height: 200 }, first: 'L18', after: [[1, 40, 239]] },
    { label: 'a maxHeight', style: { ...TWO, maxHeight: 200 }, first: 'L15', after: [[1, 40, 204]] },
    { label: 'a height, a bottom padding and border and columnFill auto', style: { ...AUTO, height: 200, paddingBottom: 20, borderBottomWidth: 10 }, first: 'L15', after: [[1, 40, 239]] },
  ])('fills the columns of a container with $label to it', async ({ style, first, after }) => {
    const { parsed } = await render(() => [h(PdfView, { style }, () => lines(30)), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, first), placesOf(parsed, 'After')]).toEqual([[[1, 307.64, 39]], after])
  })

  // An empty view with padding and a border shows only its edges. With 2.89 pt
  // left in column 2 (594 pt spacer, 15 lines a column), less than its 5 pt
  // top edges, it moves whole to the next page, and After follows it. Catches a
  // part lower than its edges, which the layout makes 5 pt high (the builder
  // error "differs from the builder's sums").
  it('moves an empty view whose top edges do not fit the room left in a column to the next page', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { height: 594 } }), h(PdfView, { style: AUTO }, () => [h(PdfText, null, () => Array.from({ length: 30 }, (_, index) => `L${index}`).join('\n')), h(PdfView, { style: { borderWidth: 1, padding: 4 } }), h(PdfText, null, () => 'After')])])
    expect([placesOf(parsed, 'L15'), placesOf(parsed, 'After')]).toEqual([[[1, 307.64, 633]], [[2, 40, 49]]])
  })

  // With 7.89 pt left (589 pt spacer), its top edges fit: its first part ends
  // column 2, and its bottom edges start page 2. A footnote in the document
  // makes the page fit its notes; the fit counts the part's top edges as
  // content of page 1. Catches the fit clamping the part to the end of the
  // text above it (0 pt, lower than its edges: the builder error).
  it('keeps the top edges of an empty view at a column end on a page that fits notes', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { height: 589 } }), h(PdfView, { style: AUTO }, () => [h(PdfText, null, () => Array.from({ length: 30 }, (_, index) => `L${index}`).join('\n')), h(PdfView, { style: { borderWidth: 1, padding: 4 } }), h(PdfText, null, () => ['After', h(PdfFootnote, null, () => 'The note.')])])])
    expect([placesOf(parsed, 'L15'), placesOf(parsed, 'After')]).toEqual([[[1, 307.64, 628]], [[2, 40, 44.63]]])
  })

  // The box rule for a column container with a height. One no higher than the
  // content area moves whole to the next page when it crosses the page end, and
  // fills its columns to its height there (15 lines a column). Catches it split
  // at the page end, with columns on both pages (today's path).
  it('moves a column container with a height that fits the content area whole to the next page', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { height: 600 } }), h(PdfView, { style: { ...TWO, height: 200 } }, () => lines(30)), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L0'), placesOf(parsed, 'L15'), placesOf(parsed, 'After')]).toEqual([[[2, 40, 39]], [[2, 307.64, 39]], [[2, 40, 239]]])
  })

  // A higher one splits at the page ends: each part fills its columns to its
  // share of the height (14 lines a column in the 161.89 pt left on page 1),
  // and the parts add up to the height: the last 76.22 pt (1000 - 161.89 -
  // 761.89) take the top of page 3, below which the content after the
  // container starts. Its content ends on page 2, but the container goes on,
  // so the columns there fill in order (69 lines in column 1): as in CSS,
  // only the last part is balanced. Catches a part that ends with its content
  // (After at the top of page 3), columns filled past their part, and a part
  // balanced that is not the last.
  it('splits a column container with a height higher than the content area, its parts sharing the height', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { height: 600 } }), h(PdfView, { style: { ...TWO, height: 1000 } }, () => lines(150)), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L0'), placesOf(parsed, 'L14'), placesOf(parsed, 'L28'), placesOf(parsed, 'L97'), placesOf(parsed, 'After')])
      .toEqual([[[1, 40, 639]], [[1, 307.64, 639]], [[2, 40, 39]], [[2, 307.64, 39]], [[3, 40, 115.22]]])
  })

  // A spanning child stays full width between two segments, and each segment
  // fills its own columns. Catches a spanner inside a column (x or width) and
  // a second segment that goes on in the first one's columns.
  it('keeps a child with columnSpan all full width between the segments', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      ...lines(80, 'A'),
      h(PdfText, { style: { columnSpan: 'all', fontSize: 20 } }, () => 'Spanning heading'),
      ...lines(3, 'B'),
    ])])
    expect(['A39', 'A40', 'A79'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 468]], [[1, 307.64, 39]], [[1, 307.64, 468]]])
    expect(placesOf(parsed, 'Spanning heading')[0]!.slice(0, 2)).toEqual([1, 40])
    expect(['B0', 'B1', 'B2'].map(text => placesOf(parsed, text)[0]!.slice(0, 2))).toEqual([[1, 40], [1, 40], [1, 307.64]])
  })

  // `columnWidth` 150 with a 20 pt gap: (515.28 + 20) / 170 gives 3 columns
  // of (515.28 - 40) / 3 = 158.43 pt, at x 40, 218.43 and 396.85. With
  // `columnCount: 2` as a maximum, 2 columns.
  it.each([
    { label: 'a column width', style: { columnWidth: 150, columnGap: 20 }, xs: [40, 218.43, 396.85] },
    { label: 'a column width and a smaller count', style: { columnWidth: 150, columnCount: 2, columnGap: 20 }, xs: [40, 307.64] },
  ])('takes the number of columns from $label', async ({ style, xs }) => {
    const { parsed } = await render(() => [h(PdfView, { style }, () => lines(69 * xs.length))])
    expect(xs.map((_, column) => placesOf(parsed, `L${69 * column}`)[0])).toEqual(xs.map(x => [1, x, 39]))
  })

  // `column-gap: normal` is 1em of the container's font size, so column 2
  // starts at 40 + (515.28 - gap) / 2 + gap: 10 pt with the page's size,
  // 18 pt (a text's default size) with none set anywhere. Catches the gap
  // read from a fixed size (12 pt put column 2 at 303.64).
  it.each([
    ['the page\'s font size', {}, [[1, 302.64, 39]]],
    ['no font size anywhere', { fontSize: undefined }, [[1, 306.64, 38.2]]],
  ] satisfies [string, PdfStyle, [number, number, number][]][])('uses 1em of %s as the gap when none is set', async (_label, pageStyle, places) => {
    const { parsed } = await render(() => [h(PdfView, { style: { columnCount: 2 } }, () => lines(40))], pageStyle)
    expect(placesOf(parsed, 'L20')).toEqual(places)
  })

  // A table header repeats at the top of each column its table reaches.
  // Catches a header only on the page, or a column that starts with a body
  // row under no header.
  it('repeats a table header at the top of each column', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [h(PdfTable, { columns: [1, 1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
      ...Array.from({ length: 100 }, (_, index) => h(PdfTableRow, { key: index }, () => [h(PdfTableCell, null, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')])),
    ])])])
    expect(placesOf(parsed, 'Item')).toEqual([[1, 40, 39], [1, 307.64, 39]])
    expect(['Row 49', 'Row 50', 'Row 99'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 589]], [[1, 307.64, 50]], [[1, 307.64, 589]]])
  })

  // Finding (as): a table whose header would end a column alone (a header
  // and one row stay together) starts the next column, not the next page.
  // Catches the orphan rule's page break inside columns: the balanced
  // columns moved the table to page 2, and so did a header at the bottom of
  // column 1 in columns filled in order.
  const headedTable = () => h(PdfTable, { columns: [1, 1] }, () => [
    h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'H'), h(PdfTableCell, null, () => 'I')]),
    h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'A0'), h(PdfTableCell, null, () => 'B0')]),
  ])
  it.each<[string, () => VNode[], PdfStyle, Record<string, [number, number, number][]>]>([
    ['balanced, after a text', () => [h(PdfView, { style: TWO }, () => [h(PdfText, null, () => 'Intro text'), headedTable()])], {}, { 'Intro text': [[1, 40, 39]], 'H': [[1, 307.64, 39]], 'A0': [[1, 307.64, 50]] }],
    ['balanced, the table one level down (in a view)', () => [h(PdfView, { style: TWO }, () => [h(PdfText, null, () => 'Intro text'), h(PdfView, null, () => [headedTable()])])], {}, { 'Intro text': [[1, 40, 39]], 'H': [[1, 307.64, 39]], 'A0': [[1, 307.64, 50]] }],
    ['balanced on a page with columns', () => [h(PdfText, null, () => 'Intro text'), headedTable()], TWO, { 'Intro text': [[1, 40, 39]], 'H': [[1, 307.64, 39]], 'A0': [[1, 307.64, 50]] }],
    ['in order, at the bottom of column 1', () => [h(PdfView, { style: AUTO }, () => [...lines(68), headedTable()])], {}, { L67: [[1, 40, 776]], H: [[1, 307.64, 39]], A0: [[1, 307.64, 50]] }],
    ['in order, at the bottom of the last column (next page)', () => [h(PdfView, { style: AUTO }, () => [...lines(137), headedTable()])], {}, { L136: [[1, 307.64, 776]], H: [[2, 40, 39]], A0: [[2, 40, 50]] }],
  ])('moves a table whose header would end a column alone to the next column: %s', async (_label, content, pageStyle, places) => {
    const { parsed } = await render(content, pageStyle)
    expect(Object.fromEntries(Object.keys(places).map(text => [text, placesOf(parsed, text)]))).toEqual(places)
  })

  // An 'auto' table measures against the column width. Catches a table as
  // wide as the container.
  it('measures a table with \'auto\' columns inside the column width', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [h(PdfTable, { columns: ['auto', 'auto'] }, () => [
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'A rather long description of an item'), h(PdfTableCell, null, () => 'Total')]),
    ])])])
    const run = parsed.pages[0]!.textRuns.find(candidate => candidate.text.endsWith('Total'))!
    expect(run.x + run.width).toBeLessThan(40 + 247.64)
  })

  // A heading that keeps with the next text and ends column 1 moves to the
  // top of column 2 with it. Catches keeps that do not hold in a column.
  it('moves a heading that keeps with the next text to the next column', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: AUTO }, () => [
      ...lines(68),
      h(PdfText, { keepWithNext: true }, () => 'Heading'),
      h(PdfText, null, () => 'Body'),
    ])])
    expect([placesOf(parsed, 'L67'), placesOf(parsed, 'Heading'), placesOf(parsed, 'Body')]).toEqual([[[1, 40, 776]], [[1, 307.64, 39]], [[1, 307.64, 50]]])
  })

  // A column break goes on in the next column; in the last column it ends
  // the page. A page break leaves the other columns of its page empty.
  it.each([
    { label: 'a column break', breakB: 'column' as const, places: { A: [[1, 40, 39]], B: [[1, 307.64, 39]], C: [[2, 40, 39]] } },
    { label: 'a page break', breakB: true, places: { A: [[1, 40, 39]], B: [[2, 40, 39]], C: [[2, 307.64, 39]] } },
  ])('goes on after $label', async ({ breakB, places }) => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      h(PdfText, null, () => 'A'),
      h(PdfText, { break: breakB }, () => 'B'),
      h(PdfText, { break: 'column' }, () => 'C'),
    ])])
    expect({ A: placesOf(parsed, 'A'), B: placesOf(parsed, 'B'), C: placesOf(parsed, 'C') }).toEqual(places)
  })

  // A column break in a container that ends on its page: the container keeps
  // its place, as high as its highest column. Catches the break dropped (B
  // under A2) and a container as high as the page (After on page 2). In a
  // view with a fixed node after it, the split that leaves room for that
  // node is the one kept; catches its filled columns lost (B under A2).
  it.each([
    { label: 'alone', wrap: (container: VNode) => [container], places: { B: [[1, 307.64, 39]], After: [[1, 40, 61]] } },
    {
      label: 'in a view with a fixed node after it',
      wrap: (container: VNode) => [h(PdfView, null, () => [container, h(PdfText, { fixed: true }, () => 'Foot')])],
      places: { B: [[1, 307.64, 39]], After: [[1, 40, 72]] },
    },
  ])('keeps a container with a column break that ends on its page as high as its highest column, $label', async ({ wrap, places }) => {
    const { parsed } = await render(() => [
      ...wrap(h(PdfView, { style: TWO }, () => [h(PdfText, null, () => 'A'), h(PdfText, null, () => 'A2'), h(PdfText, { break: 'column' }, () => 'B')])),
      h(PdfText, null, () => 'After'),
    ])
    expect({ B: placesOf(parsed, 'B'), After: placesOf(parsed, 'After') }).toEqual(places)
  })

  // A column break in the last column is a forced break for the next page
  // (D25): the author put C at the top, so its negative top margin stays.
  // Catches it counted as automatic: C lifted to the content top (39).
  it('keeps the negative top margin of a node after a column break in the last column', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      h(PdfText, null, () => 'A'),
      h(PdfText, { break: 'column' }, () => 'B'),
      h(PdfText, { break: 'column', style: { marginTop: -10 } }, () => 'C'),
    ])])
    expect(placesOf(parsed, 'C')).toEqual([[2, 40, 29]])
  })

  // A column top is like a page top: a heading there stays although the
  // block it keeps with does not fit below it, as moving it leaves the column
  // empty. The container starts under a 400 pt spacer: 361.89 pt of room,
  // 32 lines. Catches column 2 read as having content above: the heading
  // moved to page 2 with the block.
  it('keeps a heading at the top of a column although its keep fails there', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { height: 400 } }), h(PdfView, { style: TWO }, () => [
      ...lines(32),
      h(PdfText, { keepWithNext: true }, () => 'Heading'),
      h(PdfView, { wrap: false, style: { height: 400 } }, () => h(PdfText, null, () => 'Block')),
    ])])
    expect([placesOf(parsed, 'L31'), placesOf(parsed, 'Heading'), placesOf(parsed, 'Block')]).toEqual([[[1, 40, 780]], [[1, 307.64, 439]], [[2, 40, 39]]])
  })

  // A block that cannot split, higher than the room left in column 1 but
  // not than a column, moves to column 2. Catches a block cut at the column
  // end or moved past the free column to the next page.
  it('moves a block that cannot split to the next column', async () => {
    const { parsed, warnings } = await render(() => [h(PdfView, { style: AUTO }, () => [
      ...lines(60),
      h(PdfView, { wrap: false, style: { height: 200 } }, () => h(PdfText, null, () => 'Block')),
    ])])
    expect(placesOf(parsed, 'Block')).toEqual([[1, 307.64, 39]])
    expect(warnings).toEqual([])
  })

  // The same block higher than the room under a spacer, but not than a page:
  // it moves on whole from column 2 to the next page. Catches the block cut
  // in column 2, where moving it from column 1 had made it splittable as at
  // a page top (`unsplittableAgain`).
  it('moves a block that cannot split past the next column when that column is too low for it', async () => {
    const { parsed, warnings } = await render(() => [h(PdfView, { style: { height: 462 } }), h(PdfView, { style: AUTO }, () => [
      ...lines(10),
      h(PdfView, { wrap: false, style: { height: 400 } }, () => h(PdfText, null, () => 'Block')),
    ])])
    expect(placesOf(parsed, 'Block')).toEqual([[2, 40, 39]])
    expect(warnings).toEqual([])
  })

  // A text whose box fits column 1 but whose 6 pt bottom margin crosses its
  // end (3 pt left) stays there and loses the margin, as on a page (D25); the
  // text after it starts column 2. Catches the text moved to column 2, which
  // left 113 pt of column 1 empty.
  it('keeps a text whose bottom margin crosses the column end in its column', async () => {
    const text = Array.from({ length: 10 }, (_, index) => `L${index}`).join('\n')
    const { parsed } = await render(() => [h(PdfView, { style: AUTO }, () => [
      h(PdfView, { style: { height: 761.89 - 110 - 3 } }),
      h(PdfText, { style: { marginBottom: 6 } }, () => text),
      h(PdfText, null, () => 'After'),
    ])])
    expect([placesOf(parsed, 'L9'), placesOf(parsed, 'After')]).toEqual([[[1, 40, 786.89]], [[1, 307.64, 39]]])
  })

  // One paragraph over two columns and two pages, read column by column:
  // the same 2,000 words in the same order as in one column. Catches a line
  // lost or drawn twice at a column or page seam.
  it('keeps every word of a long paragraph once and in order across columns and pages', async () => {
    const words = Array.from({ length: 2000 }, (_, index) => `w${index}`)
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => h(PdfText, null, () => words.join(' ')))])
    const read = parsed.pages.flatMap(page => [...page.textRuns]
      .sort((a, b) => Number(a.x > 300) - Number(b.x > 300) || b.y - a.y)
      .flatMap(run => run.text.split(/\s+/).filter(Boolean)))
    expect([parsed.pageCount, read]).toEqual([2, words])
  })

  // A page number and an internal link in column 2 of page 2. Catches a
  // number from another page (the column is laid out apart from its page)
  // and a link rectangle at the galley's x instead of the column's.
  it('numbers and links content in column 2 on its own page and at its x', async () => {
    const { parsed } = await render(() => [
      h(PdfView, { style: TWO }, () => [
        ...lines(207),
        h(PdfText, null, { default: () => ['on page ', h(PdfPageNumber)] }),
        h(PdfLink, { href: '#target' }, () => 'Jump'),
      ]),
      h(PdfText, { id: 'target', break: true }, () => 'Target'),
    ])
    expect([placesOf(parsed, 'on page 2'), placesOf(parsed, 'Jump'), parsed.links]).toEqual([[[2, 307.64, 402]], [[2, 307.64, 413]], [{ page: 2, destination: 'target' }]])
    expect(parsed.pages[1]!.annotations.map(annotation => annotation.rect?.[0])).toEqual([307.64])
  })

  // A container 300 pt wide in a row: columns of 140 pt, the second at
  // x = 200, the row's other child beside them. Catches columns sized from
  // the page instead of the row.
  it('lays out a column container in a row at the width the row gives it', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { flexDirection: 'row' } }, () => [
      h(PdfView, { style: { ...TWO, width: 300 } }, () => lines(150)),
      h(PdfView, { style: { flexGrow: 1 } }, () => h(PdfText, null, () => 'Beside')),
    ])])
    expect(['L68', 'L69', 'L138', 'Beside'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 787]], [[1, 200, 39]], [[2, 40, 39]], [[1, 340, 39]]])
  })

  // A height that the content fits keeps the container as high as it says:
  // 9 lines (99 pt) in the 100 pt inside a 10 pt padding. Catches the height
  // check below failing a container whose content fits, also by measuring
  // from the outer top (109 pt in 100 pt).
  it('keeps a column container with a height that its content fits', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: { ...TWO, height: 120, padding: 10 } }, () => lines(9)), h(PdfText, null, () => 'After')])
    expect([placesOf(parsed, 'L8'), placesOf(parsed, 'After')]).toEqual([[[1, 307.64, 82]], [[1, 40, 159]]])
  })

  // A column container that spans the columns of its parent is not inside a
  // column: its own two columns of 252.64 pt (gap 10) fill the page width.
  // Catches the nesting check below failing it.
  it('lays out a column container that spans the columns of its parent', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: TWO }, () => [
      h(PdfView, { style: { columnSpan: 'all', columnCount: 2, columnGap: 10 } }, () => lines(80)),
    ])])
    expect(['L39', 'L40', 'L79'].map(text => placesOf(parsed, text))).toEqual([[[1, 40, 468]], [[1, 302.64, 39]], [[1, 302.64, 468]]])
  })

  // Content that needs more columns than a container has at its height
  // (CSS adds columns beside the view), and columns inside columns, which
  // would need each outer column laid out again at its width. Catches
  // content squeezed into column 1 of a 200 pt view or drawn below it, and
  // the inner columns failing with an internal cut error.
  it.each([
    ['a height that the content passes', () => [h(PdfView, { style: { ...TWO, height: 200 } }, () => lines(150))], 'holds 1650 pt of content, more than its 2 columns of 200 pt hold'],
    ['a maxHeight that the content passes', () => [h(PdfView, { style: { ...TWO, maxHeight: 200 } }, () => lines(150))], 'holds 1650 pt of content, more than its 2 columns of 200 pt hold'],
    ['columns in a column of another', () => [h(PdfView, { style: TWO }, () => [h(PdfView, { style: { columnCount: 2, columnGap: 10 } }, () => lines(300))])], 'Columns inside columns are not supported yet'],
  ])('fails with a typed error for %s', async (_label, content, message) => {
    await expect(render(content)).rejects.toMatchObject({ code: 'PDF_LAYOUT_ERROR', message: expect.stringContaining(message) })
  })

  // Nothing fits a column on a fresh page: the fixed content leaves 6.89 pt,
  // less than a line, in every column of every page. Catches a pagination
  // that passes the columns on to the next page, which starts the same way,
  // until the deadline.
  it.each([
    ['a fixed view above the container', () => [h(PdfView, { fixed: true, style: { height: 755 } }), h(PdfView, { style: TWO }, () => lines(20))]],
    ['a fixed view at the top of the columns', () => [h(PdfView, { style: TWO }, () => [h(PdfView, { fixed: true, style: { height: 755 } }), ...lines(20)])]],
  ])('fails with a typed error when nothing fits a column under %s', async (_label, content) => {
    await expect(render(content)).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: expect.stringContaining('Pagination cannot end: pages 1 and 2 take no content from the flow'),
    })
  })
})

describe('rows at an area end', () => {
  // A row of a number cell and a three-line text cell starts 748 pt down:
  // the number and one line fit before the end, but three lines are too few
  // for two orphans and two widows, so the text moves whole. Its first line
  // fits by its place, so the row moves whole with it. Catches a row that
  // broke anyway: the number stayed alone at the end of the column or page
  // (a reference list in two columns).
  it.each([
    { label: 'at the end of a column', style: AUTO, place: [1, 307.64, 39] },
    { label: 'at the end of a page', style: {}, place: [2, 40, 39] },
    // The same with a text that does not split: it crosses the end and moves whole.
    { label: 'with a cell that does not split', style: AUTO, place: [1, 307.64, 39], wrap: false },
  ])('moves a row whole when a cell would start only after the break, $label', async ({ style, place, wrap }) => {
    const { parsed } = await render(() => [h(PdfView, { style }, () => [
      ...lines(68),
      h(PdfView, { style: { flexDirection: 'row' } }, () => [
        h(PdfText, { style: { width: 20 } }, () => 'Nr'),
        h(LooseText, { wrap, style: { flexGrow: 1 } }, () => 'R0\nR1\nR2'),
      ]),
    ])])
    expect({ number: placesOf(parsed, 'Nr'), text: placesOf(parsed, 'R0') }).toEqual({ number: [place], text: [[place[0], place[1]! + 20, place[2]]] })
  })
})

describe('column containers as authors write them', () => {
  // A page with columns: its flow goes into one implicit view with the
  // page's column styles; the fixed header and footer stay full width on
  // every page, and an absolute child keeps its offsets against the page
  // box. Catches the page's columns ignored (L67 under L66), the fixed nodes
  // put into a column (Head, Foot right-aligned at the column edge, 287.64),
  // and the absolute child placed against the content box (Stamp at 50).
  // The columns fill in order (`columnFill: 'auto'`), so the literals show
  // the fill and not the balance of the last page.
  it('lays out the flow of a page with columns between its full-width fixed header and footer', async () => {
    const { parsed } = await render(() => [
      h(PdfText, { fixed: true, style: { textAlign: 'right' } }, () => 'Head'),
      h(PdfText, { style: { position: 'absolute', top: 10, left: 10 } }, () => 'Stamp'),
      ...lines(150),
      h(PdfText, { fixed: true, style: { textAlign: 'right' } }, () => 'Foot'),
    ], AUTO)
    expect(Object.fromEntries(['Head', 'Foot', 'Stamp', 'L0', 'L66', 'L67', 'L133', 'L134', 'L149'].map(text => [text, placesOf(parsed, text)]))).toEqual({
      Head: [[1, 531.38, 39], [2, 531.38, 39]],
      Foot: [[1, 535.57, 789.89], [2, 535.57, 226]],
      Stamp: [[1, 10, 9]],
      L0: [[1, 40, 50]],
      L66: [[1, 40, 776]],
      L67: [[1, 307.64, 50]],
      L133: [[1, 307.64, 776]],
      L134: [[2, 40, 50]],
      L149: [[2, 40, 215]],
    })
  })

  // The shorthand sets the count, the width or both, and resets the one it
  // does not set, as CSS. 1em gap (10 pt): two columns put L69 at 302.64;
  // three of 165.09 pt put L69 at 215.09. Catches the shorthand ignored (one
  // column, L69 at 40) or not resetting an earlier columnWidth (min(3, 1)
  // = one column). The columns fill in order, so L69 starts a column.
  it.each([
    ['a count', { columns: 2 }, 'L69', [[1, 302.64, 39]]],
    ['a width that two columns fit', { columns: '200pt' }, 'L69', [[1, 302.64, 39]]],
    ['a count and a width', { columns: '3 100pt' }, 'L69', [[1, 215.09, 39]]],
    ['a count after a columnWidth', [{ columnWidth: 400 }, { columns: 3 }], 'L69', [[1, 215.09, 39]]],
  ] satisfies [string, PdfStyle | PdfStyle[], string, [number, number, number][]][])('lays out columns from the columns shorthand with %s', async (_label, style, text, places) => {
    const { parsed } = await render(() => [h(PdfView, { style: [style, { columnFill: 'auto' } as const].flat() }, () => lines(150))])
    expect(placesOf(parsed, text)).toEqual(places)
  })

  // columnGap 'normal' is 1em of the font size (10 pt), also after a style
  // that set a gap. Catches 'normal' read as 0 (L69 at 297.64) or left at
  // the 20 pt of the style before it (307.64).
  it('reads columnGap normal as 1em of the font size', async () => {
    const { parsed } = await render(() => [h(PdfView, { style: [AUTO, { columnGap: 'normal' }] }, () => lines(70))])
    expect(placesOf(parsed, 'L69')).toEqual([[1, 302.64, 39]])
  })

  // A column break below a view in a column ends that column; with one
  // column it starts the next page. `break` written as the template
  // shorthand (an empty string) is still a page break. Catches the break
  // in a nested view rejected or ignored (B under A), a one-column
  // container rejecting it, and the shorthand failing the new check.
  it.each([
    ['nested in a view in a column', TWO, () => [h(PdfText, null, () => 'A'), h(PdfView, null, () => h(PdfText, { break: 'column' }, () => 'B'))], [[1, 307.64, 39]]],
    ['in a container with one column', { columnCount: 1 }, () => [h(PdfText, null, () => 'A'), h(PdfText, { break: 'column' }, () => 'B')], [[2, 40, 39]]],
    ['written as the template shorthand', TWO, () => [h(PdfText, null, () => 'A'), h(LooseText, { break: '' }, () => 'B')], [[2, 40, 39]]],
  ] satisfies [string, PdfStyle, () => VNode[], [number, number, number][]][])('places a node after a break %s', async (_label, style, content, places) => {
    const { parsed } = await render(() => [h(PdfView, { style }, content)])
    expect(placesOf(parsed, 'B')).toEqual(places)
  })

  // A page container lays its flow out as a view container with the same
  // style: the view takes the page's gap and alignItems and stretches to the
  // page's width. With gap 10 (also the column gap), L1 is at top 60; with
  // alignItems center, L0 is centred in column 1 (x 158.26). Catches the gap
  // not reaching the flow (L1 at 50) and the view shrunk by the page's
  // alignItems (L0 at 163.82, centred in a narrower view).
  it.each([
    ['gap', { ...TWO, gap: 10 }, ['L1', [[1, 40, 60]]]],
    ['alignItems', { ...TWO, alignItems: 'center' }, ['L0', [[1, 158.26, 39]]]],
  ] satisfies [string, PdfStyle, [string, [number, number, number][]]][])('lays out the flow of a page container with %s as a view container', async (_label, style, [text, places]) => {
    const texts = Array.from({ length: 10 }, (_, index) => `L${index}`)
    const onPage = await render(() => lines(10), style)
    const inView = await render(() => [h(PdfView, { style }, () => lines(10))])
    expect(texts.map(line => placesOf(onPage.parsed, line))).toEqual(texts.map(line => placesOf(inView.parsed, line)))
    expect(placesOf(onPage.parsed, text)).toEqual(places)
  })

  // columnSpan 'all' without a column container above it has no effect, as
  // in CSS: a template that switches its columns off keeps its spans. Catches
  // the span failing at mount there (the terms workload of work-budget) or
  // changing the layout.
  it.each([
    ['in a view without columns', () => [h(PdfView, null, () => [h(PdfText, { style: { columnSpan: 'all' } }, () => 'Part'), ...lines(3)])], () => [h(PdfView, null, () => [h(PdfText, null, () => 'Part'), ...lines(3)])]],
    ['in a spanning child', () => [h(PdfView, { style: TWO }, () => h(PdfView, { style: { columnSpan: 'all' } }, () => [h(PdfText, { style: { columnSpan: 'all' } }, () => 'Part'), ...lines(3)]))], () => [h(PdfView, { style: TWO }, () => h(PdfView, { style: { columnSpan: 'all' } }, () => [h(PdfText, null, () => 'Part'), ...lines(3)]))]],
  ])('lays out columnSpan all %s as without it', async (_label, withSpan, without) => {
    const texts = ['Part', 'L0', 'L1', 'L2']
    const [spanned, plain] = [await render(withSpan), await render(without)]
    expect(texts.map(text => placesOf(spanned.parsed, text))).toEqual(texts.map(text => placesOf(plain.parsed, text)))
  })

  // Each of these the layout would ignore or change without a word.
  it.each([
    ['a column break outside a container', () => [h(PdfText, { break: 'column' }, () => 'A')], {}, 'has break="column" but is not in a column'],
    ['a column break in a spanning child', () => [h(PdfView, { style: TWO }, () => h(PdfView, { style: { columnSpan: 'all' } }, () => h(PdfText, { break: 'column' }, () => 'A')))], {}, 'is not in a column'],
    ['a column break in a block that stays whole', () => [h(PdfView, { style: TWO }, () => h(PdfView, { wrap: false }, () => h(PdfText, { break: 'column' }, () => 'A')))], {}, 'which has wrap={false}'],
    ['a column break on a fixed child of a page with columns', () => [h(PdfText, { fixed: true, break: 'column' }, () => 'A'), h(PdfText, null, () => 'B')], TWO, 'is not in a column'],
    ['a column break in a fixed child of a page with columns', () => [h(PdfView, { fixed: true }, () => h(PdfText, { break: 'column' }, () => 'A'))], TWO, 'a fixed node that repeats'],
    ['break "page"', () => [h(LooseText, { break: 'page' }, () => 'A')], {}, 'requires "break" to be true, false or "column"'],
    ['columnCount on a text', () => [h(PdfText, { style: TWO }, () => 'A')], {}, 'only a <PdfView> or a <PdfPage> lays its children out in columns'],
    ['the columns shorthand on a text', () => [h(PdfText, { style: { columns: 2 } }, () => 'A')], {}, 'cannot have columnCount, columnWidth or columns'],
    ['a fixed container', () => [h(PdfView, { fixed: true, style: TWO }, () => lines(2))], {}, 'with columns cannot be a fixed or absolute node'],
    ['a container in an absolute view', () => [h(PdfView, { style: { position: 'absolute' } }, () => h(PdfView, { style: TWO }, () => lines(2)))], {}, 'cannot be inside <PdfView>, a fixed or absolute node'],
    ['a container with a row direction', () => [h(PdfView, { style: { ...TWO, flexDirection: 'row' } }, () => lines(2))], {}, 'has flexDirection "row"'],
    ['columnSpan on a fixed child of a page with columns', () => [h(PdfText, { fixed: true, style: { columnSpan: 'all' } }, () => 'Head')], TWO, 'is a fixed child of a <PdfPage> with columns'],
    ['a percentage height on a direct child of a container', () => [h(PdfView, { style: TWO }, () => h(PdfView, { style: { height: '50%' } }, () => lines(2)))], {}, '<PdfView> has height "50%" on a direct child of a column container: a percentage height there is a share of the room the columns get on the page, not of the container'],
    ['a percentage minHeight on a spanning child', () => [h(PdfView, { style: TWO }, () => [...lines(2), h(PdfView, { style: { columnSpan: 'all', minHeight: '50%' } }, () => h(PdfText, () => 'Span')), ...lines(2, 'M')])], {}, '<PdfView> has minHeight "50%" on a direct child of a column container'],
    ['columnSpan in a column below a direct child', () => [h(PdfView, { style: TWO }, () => h(PdfView, null, () => h(PdfText, { style: { columnSpan: 'all' } }, () => 'A')))], {}, 'has columnSpan "all" inside a column, but it is not a direct child'],
    ['a page with columns and a row direction', () => lines(2), { ...TWO, flexDirection: 'row' }, 'with columns has flexDirection "row"'],
    ['columnFill balance-all', () => [h(LooseView, { style: { ...TWO, columnFill: 'balance-all' } }, () => lines(2))], {}, 'expected one of auto, balance'],
    ['a column rule on a text', () => [h(PdfText, { style: { columnRuleColor: 'red' } }, () => 'A')], {}, '<PdfText> cannot have columnRuleColor: only a <PdfView> or a <PdfPage> with columns draws a column rule'],
    ['a column rule style none', () => [h(LooseView, { style: { ...TWO, columnRuleWidth: 1, columnRuleStyle: 'none' } }, () => lines(2))], {}, 'expected one of solid, dashed, dotted'],
  ] satisfies [string, () => VNode[], PdfStyle, string][])('fails at mount for %s', async (_label, content, pageStyle, message) => {
    await expect(render(content, pageStyle)).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message: expect.stringContaining(message) })
  })
})

// The column rule, authored on the column container.
describe('column rules', () => {
  const RULE = { columnRuleWidth: 1, columnRuleStyle: 'solid', columnRuleColor: 'red' } as const satisfies PdfStyle
  const PAGE_HEIGHT = 841.89

  const renderRuled = async (content: () => VNode[], tagged = false, page: PdfStyle = {}) => {
    const pageStyle = { ...PAGE.style, ...page, ...(tagged ? { fontFamily: 'Roboto' } : {}) }
    const props = tagged ? { creationDate: new Date(0), conformance: 'PDF/UA-1', title: 'Rules', language: 'en' } as const : { creationDate: new Date(0) }
    const mounted = await mountPdfComponent(defineComponent(() => () => h(PdfDocument, props, () => h(PdfPage, { size: 'A4', style: pageStyle }, content))))
    try {
      const { bytes } = await renderPlainDocument(mounted.document, tagged ? { fontStore: createPdfFontStore([ROBOTO]) } : {})
      return bytes
    }
    finally {
      mounted.unmount()
    }
  }

  /**
   * Each vertical stroke of the rule's 1 pt width as page, x, top and bottom
   * from the page top (its box less half the width), rounded to 0.01 pt; the
   * note area's rule and link annotations are left out.
   */
  const rulesOf = async (bytes: Uint8Array): Promise<[number, number, number, number][]> => (await readPaint(bytes)).filter(({ rect: [x1, y1, x2, y2] }) => Math.abs(x2 - x1 - 1) < 1e-6 && y2 - y1 > 1).map(({ page, rect: [x1, y1, x2, y2] }) =>
    [page, (x1 + x2) / 2, PAGE_HEIGHT - y2 + 0.5, PAGE_HEIGHT - y1 - 0.5].map(value => Math.round(value * 100) / 100) as [number, number, number, number])

  const RULED = { ...TWO, ...RULE } as const
  const THREE = { columnCount: 3, columnGap: 20, ...RULE } as const

  // Two columns of 247.64 pt put the gap's middle at 297.64; three of
  // 158.43 pt at 208.43 and 386.85. A rule runs from the row's top to its
  // bottom, the end of its highest column (11 pt a line). Catches no rule, a
  // rule beside an empty column (three columns of 1, 1 and 0 lines), a rule
  // as high as the galley instead of the page part (the crossing container),
  // a rule through a spanning child, and one at the border box instead of
  // the content box (padding 10). With a height of 200 pt the rule is as
  // high as the content box, also with an absolute child after the row
  // (CSS: the column box fills the container); catches a rule that ends at
  // the last line (95).
  it.each([
    ['between two filled columns', () => [h(PdfView, { style: RULED }, () => lines(10))], [[1, 297.64, 40, 95]]],
    ['only between columns that hold content', () => [h(PdfView, { style: THREE }, () => lines(2))], [[1, 208.43, 40, 51]]],
    ['as high as the container on each page it crosses', () => [h(PdfView, { style: RULED }, () => lines(200))], [[1, 297.64, 40, 801.89], [2, 297.64, 40, 381]]],
    ['interrupted by a spanning child', () => [h(PdfView, { style: RULED }, () => [...lines(10), h(PdfText, { style: { columnSpan: 'all' } }, () => 'Title'), ...lines(10, 'M')])], [[1, 297.64, 40, 95], [1, 297.64, 106, 161]]],
    ['in both gaps of three columns', () => [h(PdfView, { style: THREE }, () => lines(30))], [[1, 208.43, 40, 150], [1, 386.85, 40, 150]]],
    ['inside the container\'s padding', () => [h(PdfView, { style: { ...RULED, padding: 10 } }, () => lines(10))], [[1, 297.64, 50, 105]]],
    ['as high as a container with a height', () => [h(PdfView, { style: { ...RULED, height: 200 } }, () => [...lines(10), absoluteText()])], [[1, 297.64, 40, 240]]],
  ] satisfies [string, () => VNode[], [number, number, number, number][]][])('draws a column rule %s', async (_label, content, rules) => {
    expect(await rulesOf(await renderRuled(content))).toEqual(rules)
  })

  // A page with columns lays its flow out in an implicit view
  // (engine/plain-tree.ts, `pageColumns`), which takes the rule keys from the
  // page. Its rules end at the end of each page's highest column. Catches no
  // rule on a page container (the keys left on the page), a rule down the
  // short last page (to the content bottom, 801.89), a rule into the note
  // area (its rule line at 787.75), and a rule through the page's fixed
  // header.
  it.each([
    ['on a full page and on the short last page', () => lines(200), [[1, 297.64, 40, 801.89], [2, 297.64, 40, 381]]],
    ['above the note area', () => [...lines(20), h(PdfText, null, () => ['Noted', h(PdfFootnote, null, () => 'The note.')]), ...lines(180, 'M')], [[1, 297.64, 40, 779.5], [2, 297.64, 40, 414]]],
    ['below a fixed header', () => [h(PdfText, { fixed: true }, () => 'Header'), ...lines(20)], [[1, 297.64, 51, 161]]],
  ] satisfies [string, () => VNode[], [number, number, number, number][]][])('draws the rule of a page with columns %s', async (_label, content, rules) => {
    expect(await rulesOf(await renderRuled(content, false, RULED))).toEqual(rules)
  })

  // The rule follows the library's borders: drawn with a width, solid and
  // black unless set. Catches a rule drawn without a width, one that needs a
  // style, and dashes that differ from the border's.
  it.each([
    ['no width', { columnRuleStyle: 'solid', columnRuleColor: 'red' }, 0, undefined],
    ['a width without a style (solid)', { columnRuleWidth: 1 }, 1, undefined],
    ['a dashed style', { ...RULE, columnRuleWidth: 2, columnRuleStyle: 'dashed' }, 1, '[4 2.4] 0 d'],
    ['a dotted style', { ...RULE, columnRuleWidth: 2, columnRuleStyle: 'dotted' }, 1, '[2 2.4] 0 d'],
  ] satisfies [string, PdfStyle, number, string | undefined][])('draws %s as a border would', async (_label, rule, count, dash) => {
    const bytes = await renderRuled(() => [h(PdfView, { style: { ...TWO, ...rule } }, () => lines(10))])
    expect(await readPaint(bytes)).toHaveLength(count)
    if (dash) expect(pageContents(bytes)[0]).toContain(dash)
    else expect(pageContents(bytes)[0]).not.toMatch(/\[[\d.]+ [\d.]+\] [\d.]+ d/)
  })

  // A width with a unit reaches the painter as points, as a border width
  // does: 1mm is 2.83 pt. Catches a length string the painter cannot read,
  // which draws no rule.
  it('draws a rule with a width in mm', async () => {
    const paint = await readPaint(await renderRuled(() => [h(PdfView, { style: { ...TWO, columnRuleWidth: '1mm' } }, () => lines(10))]))
    expect(paint.map(({ rect: [x1, , x2] }) => Math.round((x2 - x1) * 100) / 100)).toEqual([2.83])
  })

  // On a view without columns the rule has no effect, as in CSS, so a
  // template can switch its columns off and keep the rule. Catches a mount
  // failure there, or a line drawn beside a view without columns.
  it('draws nothing for a rule on a view without columns', async () => {
    expect(await readPaint(await renderRuled(() => [h(PdfView, { style: RULE }, () => lines(10))]))).toEqual([])
  })

  // PDF/UA: a rule is no content of the structure tree. Catches the rule
  // painted inside the marked content of a text.
  it('marks the rule as an artifact in a tagged document', async () => {
    const content = pageContents(await renderRuled(() => [h(PdfView, { style: RULED }, () => lines(10))], true))[0]!
    expect(content).toMatch(/\/Artifact BMC\n(?:(?!EMC)[^\n]*\n)*?257\.64\S* 0 m\n257\.64\S* [\d.]+ l\nS\n/)
  })
})
