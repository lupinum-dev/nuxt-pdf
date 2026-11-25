import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'

installPdfCanvasGlobals()

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

// A4 with 40 pt padding: content box 761.89 pt high. A line is 1.1 times its
// font size: a 14 pt heading 15.4 pt, a 10 pt line or table row 11 pt.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const
const HEADING = { fontSize: 14 } as const

const doc = (content: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, content)))

const render = async (content: () => VNode[]): Promise<ParsedPdf> => {
  const mounted = await mountPdfComponent(doc(content))
  try {
    return await parsePdf((await renderPlainDocument(mounted.document)).bytes)
  }
  finally {
    mounted.unmount()
  }
}

const pagesWith = (parsed: ParsedPdf, text: string): number[] => parsed.pages
  .filter(page => page.textItems.includes(text))
  .map(page => page.number)

/** The page whose lines start with the first word of a paragraph. */
const pageStarting = (parsed: ParsedPdf, word: string): number | undefined => parsed.pages
  .find(page => page.textItems.some(item => item === word || item.startsWith(`${word} `)))?.number

const spacer = (height: number) => h(PdfView, { style: { height } })

const table = (rows: number, keepRow?: number) => h(PdfTable, { columns: [1, 1] }, () => [
  h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
  ...Array.from({ length: rows }, (_, index) => h(PdfTableRow, { key: index, keepWithNext: index === keepRow }, () => [
    h(PdfTableCell, null, () => `Row ${index}`),
    h(PdfTableCell, null, () => '1.00'),
  ])),
])

const paragraph = (props: Record<string, unknown> | null = null) => h(PdfText, props, () => Array.from({ length: 200 }, (_, index) => `word${index}`).join(' '))

describe('keepWithNext', () => {
  // Catches: a keep that is ignored; a keep that ends at the whole next
  // sibling (the heading would leave a table or paragraph whose start fits);
  // a keep that ends at a table's header only, or at a text's first line
  // instead of its orphans (the heading would stay although the start does
  // not fit). Without the keep, the heading stays above every next sibling.
  it.each([
    // Heading ends at 750.4, the header at 761.4, row 0 at 772.4: only the header fits.
    { label: 'a table whose first row does not fit', spacer: 735, next: () => table(3), first: 'Row 0', keep: true, heading: 2, start: 2 },
    { label: 'the same table without keepWithNext', spacer: 735, next: () => table(3), first: 'Row 0', keep: false, heading: 1, start: 2 },
    // Row 0 ends at 757.4, row 1 at 768.4: the table splits after row 0.
    { label: 'a table whose first row fits', spacer: 720, next: () => table(3), first: 'Row 0', keep: true, heading: 1, start: 1 },
    // The same room, but row 0 keeps with row 1: the table's start ends at row 1.
    { label: 'a table whose first row keeps with the second', spacer: 720, next: () => table(3, 0), first: 'Row 0', keep: true, heading: 2, start: 2 },
    // Heading ends at 745.4, line 1 at 756.4, line 2 (orphans) at 767.4.
    { label: 'a text whose orphans do not fit', spacer: 730, next: paragraph, first: 'word0', keep: true, heading: 2, start: 2 },
    { label: 'the same text without keepWithNext', spacer: 730, next: paragraph, first: 'word0', keep: false, heading: 1, start: 2 },
    // Line 2 ends at 757.4: the paragraph splits after its orphans.
    { label: 'a text whose orphans fit', spacer: 720, next: paragraph, first: 'word0', keep: true, heading: 1, start: 1 },
  ])('starts a heading on the page where $label starts', async ({ spacer: height, next, first, keep, heading, start }) => {
    const parsed = await render(() => [spacer(height), h(PdfText, { style: HEADING, keepWithNext: keep }, () => 'Heading'), next()])
    expect({ heading: pagesWith(parsed, 'Heading'), start: pageStarting(parsed, first) }).toEqual({ heading: [heading], start })
  })

  // Catches: a keep that starts with an absolute or fixed sibling instead of
  // skipping it; a row whose start ends at its earliest child start instead
  // of its latest; a view without flow children whose start is its top
  // instead of its whole box. Each would leave the heading on page 1. The
  // heading ends at 745.4, so 16.5 pt are left.
  it.each([
    // The badge is drawn at the top of the page; the table's row 0 ends at 767.4.
    {
      label: 'a table after an absolute badge',
      next: () => [h(PdfView, { style: { position: 'absolute', top: 0, right: 0, width: 10, height: 10 } }), table(3)],
      first: 'Row 0',
    },
    // The left text starts with one line (11 pt), the right one with its two
    // orphan lines (22 pt): the row starts when both have.
    {
      label: 'a row whose children start with one and with two lines',
      next: () => [h(PdfView, { style: { flexDirection: 'row' } }, () => [
        h(PdfText, { style: { width: 100 } }, () => 'Left'),
        h(PdfView, { style: { flexGrow: 1 } }, () => [paragraph()]),
      ])],
      first: 'word0',
    },
    // A view 30 pt high whose only child is absolute.
    {
      label: 'a view with only an absolute child',
      next: () => [h(PdfView, { style: { height: 30 } }, () => [h(PdfText, { style: { position: 'absolute', top: 0 } }, () => 'Badge')])],
      first: 'Badge',
    },
    // An anchor shows nothing: the view starts with the paragraph's orphans.
    {
      label: 'a view whose first child is an empty anchor view',
      next: () => [h(PdfView, null, () => [h(PdfView, { id: 'part-2' }), paragraph()])],
      first: 'word0',
    },
    // An anchor shows nothing: the keep reaches the paragraph after it.
    {
      label: 'an empty anchor view and a text',
      next: () => [h(PdfView, { id: 'part-2' }), paragraph()],
      first: 'word0',
    },
    // A next sibling with fixed: false is in the flow.
    {
      label: 'a text with fixed: false',
      next: () => [paragraph({ fixed: false })],
      first: 'word0',
    },
  ])('moves a heading with $label', async ({ next, first }) => {
    const parsed = await render(() => [spacer(730), h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), ...next()])
    expect({ heading: pagesWith(parsed, 'Heading'), start: pageStarting(parsed, first) }).toEqual({ heading: [2], start: 2 })
  })

  // Catches: a keep on the last child of a view that the view ignores (CSS
  // passes break-after: avoid to the parent), also when an anchor that shows
  // nothing follows it, and through two views; a keep on a node with
  // fixed: false that is ignored. Each would leave the heading on page 1.
  // The heading is all the content of its views, so the views move whole.
  it.each([
    { label: 'the last child of a view, to the view', heading: () => h(PdfView, null, () => [h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading')]) },
    { label: 'a child before an anchor at the end of a view, to the view', heading: () => h(PdfView, null, () => [h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), h(PdfView, { id: 'part-2' })]) },
    { label: 'the last child of a view in a view, to the outer view', heading: () => h(PdfView, null, () => [h(PdfView, null, () => [h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading')])]) },
    { label: 'a node with fixed: false', heading: () => h(PdfText, { style: HEADING, keepWithNext: true, fixed: false }, () => 'Heading') },
  ])('applies a keep on $label', async ({ heading }) => {
    const parsed = await render(() => [spacer(730), heading(), paragraph()])
    expect({ heading: pagesWith(parsed, 'Heading'), start: pageStarting(parsed, 'word0') }).toEqual({ heading: [2], start: 2 })
  })

  // Catches minPresenceAhead that skips a node with fixed: false: as the
  // node, the heading would stay on page 1 with 46 pt below it; as the next
  // node, the one-line tail that ends the column would not count, and the
  // heading would move for 200 pt that nothing needs. Catches a fixed node
  // that caps the presence: the heading would stay.
  it.each([
    { label: 'a node with fixed: false', content: () => [spacer(730), h(PdfText, { style: HEADING, minPresenceAhead: 60, fixed: false }, () => 'Heading'), paragraph()], heading: [2] },
    { label: 'the last node after it with fixed: false', content: () => [spacer(700), h(PdfText, { style: HEADING, minPresenceAhead: 200 }, () => 'Heading'), h(PdfText, { fixed: false }, () => 'Tail')], heading: [1] },
    // Only a fixed node after it: nothing in the flow caps the presence.
    { label: 'a node with only a fixed node after it', content: () => [spacer(700), h(PdfText, { style: HEADING, minPresenceAhead: 200 }, () => 'Heading'), h(PdfText, { fixed: true, style: { position: 'absolute', top: 0 } }, () => 'F')], heading: [2] },
  ])('applies minPresenceAhead to $label', async ({ content, heading }) => {
    expect(pagesWith(await render(content), 'Heading')).toEqual(heading)
  })

  // The last row keeps with the totals after the table, a 120 pt box that
  // cannot split. Page 1: a 320 pt masthead, the header from 320 pt and 30
  // rows to 661 pt; the totals end at 781 pt, past the content box (761.89).
  // The keep of the last row splits the table before that row, and the row
  // moves with the totals under the repeated header. Catches the whole table
  // moving (page 1 with the masthead only) and a keep that does nothing.
  const masthead = () => h(PdfView, { style: { height: 320 } }, () => [h(PdfText, null, () => 'Masthead')])
  const totals = () => h(PdfView, { wrap: false, style: { height: 120 } }, () => [h(PdfText, null, () => 'Totals')])
  it.each([
    { label: 'without a keep', keepRow: undefined, pages: { 'Masthead': [1], 'Row 28': [1], 'Row 29': [1], 'Item': [1], 'Totals': [2] } },
    { label: 'with the keep on the last row', keepRow: 29, pages: { 'Masthead': [1], 'Row 28': [1], 'Row 29': [2], 'Item': [1, 2], 'Totals': [2] } },
  ])('places a table and its totals $label', async ({ keepRow, pages }) => {
    const parsed = await render(() => [masthead(), table(30, keepRow), totals()])
    expect(Object.fromEntries(Object.keys(pages).map(text => [text, pagesWith(parsed, text)]))).toEqual(pages)
  })

  // The table goes on over a second page: rows 0 to 38 on page 1, rows 39 to
  // 98 on page 2 (671 pt with the header), where the totals do not fit
  // (791 pt). The table's rest splits before its last row there.
  it('keeps the last row of a table over two pages with the totals', async () => {
    const parsed = await render(() => [masthead(), table(99, 98), totals()])
    expect(['Row 38', 'Row 39', 'Row 97', 'Row 98', 'Item', 'Totals'].map(text => pagesWith(parsed, text))).toEqual([[1], [2], [2], [3], [1, 2, 3], [3]])
  })

  // The table is all the content of a view, and its last row keeps: the keep
  // passes up to the view, and the tail is still the last row. Catches a
  // tail that stops at the table: it would be all the view's content, and
  // the view would move whole with the totals.
  it('keeps the last row of a table inside a view with the totals', async () => {
    const parsed = await render(() => [masthead(), h(PdfView, null, () => [table(30, 29)]), totals()])
    expect(['Row 28', 'Row 29', 'Totals'].map(text => pagesWith(parsed, text))).toEqual([[1], [2], [2]])
  })

  // The tail of the table starts where the keep of the last row starts: at
  // row 28 when row 28 keeps with row 29 too, or when a cell from row 28
  // covers row 29. Catches a tail of the last row only: row 28 would stay on
  // page 1 (and the cell over both rows would be split from its row).
  it.each([
    { label: 'a row that keeps with the last row', rows: () => Array.from({ length: 30 }, (_, index) => h(PdfTableRow, { key: index, keepWithNext: index >= 28 }, () => [h(PdfTableCell, null, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')])) },
    { label: 'a cell over the last two rows', rows: () => Array.from({ length: 30 }, (_, index) => h(PdfTableRow, { key: index, keepWithNext: index === 29 }, () => index === 28
      ? [h(PdfTableCell, { rowspan: 2 }, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')]
      : index === 29 ? [h(PdfTableCell, null, () => 'Row 29')] : [h(PdfTableCell, null, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')])) },
  ])('starts the tail of a table at $label', async ({ rows }) => {
    const parsed = await render(() => [masthead(), h(PdfTable, { columns: [1, 1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
      ...rows(),
    ]), totals()])
    expect(['Row 27', 'Row 28', 'Row 29', 'Totals'].map(text => pagesWith(parsed, text))).toEqual([[1], [2], [2], [2]])
  })

  // A view whose last paragraph (10 lines, 571 to 681 pt) keeps with a box
  // after the view that ends at 801 pt. The view splits before the
  // paragraph, and the whole paragraph moves, as a node with its own keep
  // moves whole: the keep moves the node that keeps, not some of its lines.
  it('moves the last paragraph of a view with the box after the view', async () => {
    const lines = Array.from({ length: 10 }, (_, index) => `L${index}`)
    const parsed = await render(() => [spacer(560), h(PdfView, null, () => [
      h(PdfText, null, () => 'First'),
      h(PdfText, { keepWithNext: true }, () => lines.join('\n')),
    ]), h(PdfView, { wrap: false, style: { height: 120 } }, () => [h(PdfText, null, () => 'Box')])])
    expect(['First', 'L0', 'L9', 'Box'].map(text => pagesWith(parsed, text))).toEqual([[1], [2], [2], [2]])
  })

  // A view with a 1 pt border and 4 pt padding ends in a heading that keeps
  // with the text after the view. The heading ends at 799.4 pt and fits; only
  // the view's bottom padding and border (to 804.4 pt) cross the page end, so
  // the text after the view starts on page 2. Catches a keep that counts only
  // a view that crosses with content: the heading stayed alone on page 1.
  // With content before it the view splits before the heading; alone, the
  // heading moves with its whole view.
  it.each([
    { label: 'splits the view before a heading that ends it', spacer: 728, first: true, pages: [[1], [2], [2]] },
    { label: 'moves a view that holds only the heading', spacer: 739, first: false, pages: [[], [2], [2]] },
    // The view inside another view: the heading ends at 798.4 pt, the two views' bottom edges reach 808.4 pt.
    { label: 'splits a view in a view before a heading that ends both', spacer: 722, first: true, nested: true, pages: [[1], [2], [2]] },
  ])('$label when only the view\'s bottom edges cross the page end', async ({ spacer: height, first, nested, pages }) => {
    const edged = (children: () => VNode[]) => h(PdfView, { style: { borderWidth: 1, padding: 4 } }, children)
    const inner = () => [
      ...(first ? [h(PdfText, null, () => 'First')] : []),
      h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'),
    ]
    const parsed = await render(() => [spacer(height), nested === true ? edged(() => [edged(inner)]) : edged(inner), h(PdfText, null, () => 'Next')])
    expect(['First', 'Heading', 'Next'].map(text => pagesWith(parsed, text))).toEqual(pages)
  })

  // Catches a keep break taken as a forced break: the paragraph's negative
  // top margin would stay at the top of page 2 (as after `break`), so L0
  // would sit 20 pt higher than without the margin.
  it('lifts a negative top margin at the start of a tail, as after an automatic break', async () => {
    const lineTop = async (marginTop: number) => {
      const parsed = await render(() => [spacer(560), h(PdfView, null, () => [
        h(PdfText, null, () => 'First'),
        h(PdfText, { keepWithNext: true, style: { marginTop } }, () => Array.from({ length: 10 }, (_, index) => `L${index}`).join('\n')),
      ]), h(PdfView, { wrap: false, style: { height: 120 } }, () => [h(PdfText, null, () => 'Box')])])
      return parsed.pages[1]?.textRuns.find(run => run.text === 'L0')?.y
    }
    const plain = await lineTop(0)
    expect({ lifted: await lineTop(-20), found: typeof plain }).toEqual({ lifted: plain, found: 'number' })
  })

  // Catches a view without content whose start is its top although it
  // paints a box: the heading would stay above a grey band that moves.
  it('moves a heading with a view that paints only a background', async () => {
    const parsed = await render(() => [spacer(730), h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), h(PdfView, { style: { height: 30, backgroundColor: '#eeeeee' } })])
    expect({ pages: parsed.pageCount, heading: pagesWith(parsed, 'Heading') }).toEqual({ pages: 2, heading: [2] })
  })

  // Catches a keep before a node with break: its orphans end at 767.4, so
  // the heading would move alone to page 2 and the text break to page 3.
  it('keeps nothing with a node that has break', async () => {
    const parsed = await render(() => [spacer(730), h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), paragraph({ break: true })])
    expect({ heading: pagesWith(parsed, 'Heading'), start: pageStarting(parsed, 'word0') }).toEqual({ heading: [1], start: 2 })
  })

  // Catches a row start that counts a child that shows nothing: a row
  // stretches an empty view to its height (40 lines), so its start was the
  // whole row and the heading moved, although the row splits after the
  // text's orphans. The heading ends at 715.4, line 2 at 737.4. (An empty
  // PdfTableCell renders a text without lines, whose start is its top.)
  it('starts a row with its children that show content', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `L${index}`)
    const parsed = await render(() => [spacer(700), h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), h(PdfView, { style: { flexDirection: 'row' } }, () => [
      h(PdfView, { style: { width: 100 } }),
      h(PdfText, { style: { flexGrow: 1 } }, () => lines.join('\n')),
    ])])
    expect({ heading: pagesWith(parsed, 'Heading'), first: pagesWith(parsed, 'L0') }).toEqual({ heading: [1], first: [1] })
  })

  // Catches: a chain that stops after one keep (the first heading would stay:
  // it ends at 730.4 and the second heading at 745.8, both fit).
  // Part ends at 730.4, Section at 745.8, line 1 at 756.8, line 2 at 767.8.
  it.each([
    { label: 'a chain of keeps', partKeeps: true, part: 2 },
    { label: 'one keep', partKeeps: false, part: 1 },
  ])('moves what $label holds together', async ({ partKeeps, part }) => {
    const parsed = await render(() => [
      spacer(715),
      h(PdfText, { style: HEADING, keepWithNext: partKeeps }, () => 'Part'),
      h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Section'),
      paragraph(),
    ])
    expect({ part: pagesWith(parsed, 'Part'), section: pagesWith(parsed, 'Section') }).toEqual({ part: [part], section: [2] })
  })

  // Catches: a table row that drops the prop. Row 2 ends at 754, the total row at 765.
  it('keeps the last row of a table with the total row after it', async () => {
    const parsed = await render(() => [spacer(710), table(4, 2)])
    expect({ row2: pagesWith(parsed, 'Row 2'), total: pagesWith(parsed, 'Row 3') }).toEqual({ row2: [2], total: [2] })
  })

  // Catches: a chain taller than a page that moves a heading per page, or
  // drops content. 60 headings and the paragraph's orphans need 946 pt. From
  // H12 on, the rest of the chain (48 headings and 2 lines, 761.2 pt) fits
  // the content box (761.89 pt), so the chain splits between H11 and H12.
  it('splits a chain of keeps taller than a page where the rest fits a page', async () => {
    const titles = Array.from({ length: 60 }, (_, index) => `H${index}`)
    const parsed = await render(() => [
      ...titles.map(title => h(PdfText, { style: HEADING, keepWithNext: true }, () => title)),
      paragraph(),
    ])
    expect(titles.map(title => pagesWith(parsed, title))).toEqual(titles.map((_, index) => [index < 12 ? 1 : 2]))
    expect(pageStarting(parsed, 'word0')).toBe(2)
  })

  it.each([
    {
      label: 'on a page',
      component: defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { ...PAGE, keepWithNext: true }, () => [h(PdfText, null, () => 'a')]))),
      message: '<PdfPage> cannot have "keepWithNext": every page starts a new page. Remove "keepWithNext".',
    },
    {
      label: 'on a fixed node',
      component: doc(() => [h(PdfText, { fixed: true, keepWithNext: true }, () => 'a')]),
      message: '<PdfText> cannot have "keepWithNext": it is a fixed node that repeats on every page. Remove "keepWithNext".',
    },
    {
      label: 'on a nested text',
      component: doc(() => [h(PdfText, null, () => [h(PdfText, { keepWithNext: true }, () => 'a')])]),
      message: '<PdfText> cannot have "keepWithNext" inside another <PdfText>: the nested text is part of its parent\'s lines. Put "keepWithNext" on the outer <PdfText>.',
    },
    {
      label: 'inside a table cell',
      component: doc(() => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [h(PdfTableCell, null, () => [h(PdfText, { keepWithNext: true }, () => 'a'), h(PdfText, null, () => 'b')])])])]),
      message: '<PdfText> cannot have "keepWithNext" inside <PdfTableCell>: the cells of a table row move to the next page together. Put "keepWithNext" on the <PdfTableRow>.',
    },
    {
      label: 'inside a row',
      component: doc(() => [h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfText, { keepWithNext: true }, () => 'a'), h(PdfText, null, () => 'b')])]),
      message: '<PdfText> cannot have "keepWithNext" inside <PdfView>, whose flexDirection is "row": its children sit side by side, so none of them starts before the next. Put "keepWithNext" on <PdfView> instead.',
    },
    {
      label: 'inside a column-reverse container',
      component: doc(() => [h(PdfView, { style: { flexDirection: 'column-reverse' } }, () => [h(PdfText, { keepWithNext: true }, () => 'a'), h(PdfText, null, () => 'b')])]),
      message: '<PdfText> cannot have "keepWithNext" inside <PdfView>, whose flexDirection is "column-reverse": the next node in the tree is drawn above it, not after it. Use flexDirection "column", or remove "keepWithNext".',
    },
  ])('rejects keepWithNext $label', async ({ component, message }) => {
    await expect(mountPdfComponent(component)).rejects.toMatchObject({ code: 'PDF_TREE_INVALID', message })
  })
})

// A keep that cannot hold breaks the nodes as without it, which the PDF does
// not show. Catches such a keep dropped without a warning, a warning for a
// keep that holds, and one warning per node or per page for one chain.
describe('PDF_KEEP_IGNORED', () => {
  const keepWarnings = async (content: () => VNode[]) => {
    const mounted = await mountPdfComponent(doc(content))
    try {
      const { layoutWarnings } = await renderPlainDocument(mounted.document)
      return layoutWarnings.filter(warning => warning.code === 'PDF_KEEP_IGNORED')
    }
    finally {
      mounted.unmount()
    }
  }
  const block = (index: number, keepWithNext: boolean) => h(PdfView, { wrap: false, keepWithNext, style: { height: 200 } }, () => h(PdfText, null, () => `Block ${index}`))

  it.each([
    { label: 'a chain of blocks higher than the page', content: () => Array.from({ length: 6 }, (_, index) => block(index, index < 5)), warnings: [{ code: 'PDF_KEEP_IGNORED', pageNumber: 1, nodeType: 'PdfView' }] },
    { label: 'minPresenceAhead higher than the page', content: () => [spacer(700), h(PdfText, { style: HEADING, minPresenceAhead: 900 }, () => 'Heading'), ...Array.from({ length: 20 }, () => paragraph())], warnings: [{ code: 'PDF_KEEP_IGNORED', pageNumber: 2, nodeType: 'PdfText' }] },
    { label: 'a heading that moves with its paragraph', content: () => [spacer(700), h(PdfText, { style: HEADING, keepWithNext: true }, () => 'Heading'), paragraph()], warnings: [] },
  ])('reports $label', async ({ content, warnings }) => {
    expect(await keepWarnings(content)).toEqual(warnings)
  })

  it('reports a table where every row keeps with the next once', async () => {
    const rows = h(PdfTable, { columns: [1, 1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
      ...Array.from({ length: 300 }, (_, index) => h(PdfTableRow, { key: index, keepWithNext: true }, () => [
        h(PdfTableCell, null, () => `Row ${index}`),
        h(PdfTableCell, null, () => '1.00'),
      ])),
    ])
    expect(await keepWarnings(() => [rows])).toEqual([{ code: 'PDF_KEEP_IGNORED', pageNumber: 1, nodeType: 'PdfView' }])
  })
})
