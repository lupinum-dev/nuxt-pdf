import { Buffer } from 'node:buffer'
import { defineComponent, h, type VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfTableColumn } from '../src/runtime/components/table'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { installPdfCanvasGlobals, parsePdf, rasterizePdf, type ParsedPdf } from '../src/test/pdf'
import { pageContents, renderTagged, TAGGED_PROPS } from './fixtures/tagged-document'

installPdfCanvasGlobals()

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

// Cells over several rows (D39). A4 with 40 pt padding: content box 761.89 pt high. A 10 pt
// line or table row is 11 pt high.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const

const doc = (content: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, content)))

const renderBytes = async (content: () => VNode[]): Promise<Uint8Array> => {
  const mounted = await mountPdfComponent(doc(content))
  try {
    return (await renderPlainDocument(mounted.document)).bytes
  }
  finally {
    mounted.unmount()
  }
}

const render = async (content: () => VNode[]): Promise<ParsedPdf> => parsePdf(await renderBytes(content))

const renderWithWarnings = async (content: () => VNode[]) => {
  const mounted = await mountPdfComponent(doc(content))
  try {
    const { bytes, layoutWarnings } = await renderPlainDocument(mounted.document)
    return { parsed: await parsePdf(bytes), warnings: layoutWarnings }
  }
  finally {
    mounted.unmount()
  }
}

const cell = (text: string, props: Record<string, unknown> | null = null) => h(PdfTableCell, props, () => text)
const row = (cells: VNode[], props: Record<string, unknown> | null = null) => h(PdfTableRow, props, () => cells)
const table = (rows: () => VNode[], columns: readonly PdfTableColumn[] = ['60pt', '60pt', '60pt']) => h(PdfTable, { columns }, rows)
const spacer = (height: number) => h(PdfView, { style: { height } })

/** The top of each text run, from the page top, by its text (the first run with that text). */
const topsOf = (parsed: ParsedPdf, page = 1) => {
  const { height, textRuns } = parsed.pages[page - 1]!
  return (text: string): number => {
    const run = textRuns.find(candidate => candidate.text === text)
    if (run === undefined) throw new Error(`no run "${text}" on page ${page}`)
    return Math.round((height - run.y - run.height) * 100) / 100
  }
}

/** The pages with a line that is `word` or starts with it. */
const pagesWith = (parsed: ParsedPdf, word: string): number[] => parsed.pages
  .filter(page => page.textItems.some(item => item === word || item.startsWith(`${word} `)))
  .map(page => page.number)

/** One word per line in a 60 pt column: five lines, 55 pt. */
const TALL = 'Wednesday Thursday Saturday Wednesday Thursday'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rowspan', () => {
  // Catches: a span cell that takes only its first row's height (its text
  // would run into the row below its rows); growth in the first row instead
  // of the last (b1 would move down); a second growth of a row that two
  // spans end in (c2 would sit lower than the higher cell needs).
  it.each([
    {
      label: 'one cell higher than its rows',
      rows: () => [
        row([cell(TALL, { rowspan: 2 }), cell('b0'), cell('c0')]),
        row([cell('b1'), cell('c1')]),
        row([cell('a2'), cell('b2'), cell('c2')]),
      ],
      // b0 and b1 keep their rows; row 1 ends at the cell's fifth line.
      tops: { b0: 0, b1: 11, a2: 55 },
    },
    {
      label: 'two cells that end in the same row',
      rows: () => [
        row([cell(TALL, { rowspan: 3 }), cell('b0'), cell('c0')]),
        row([cell('Wednesday Thursday Saturday', { rowspan: 2 }), cell('c1')]),
        row([cell('c2')]),
        row([cell('a3'), cell('b3'), cell('c3')]),
      ],
      // The first cell needs 55 pt from the top, the second 33 pt from row 1
      // (44 pt): row 2 grows once, by 22 pt, to 33 pt.
      tops: { b0: 0, c1: 11, c2: 22, a3: 55 },
    },
  ])('grows the last row a cell covers: $label', async ({ rows, tops }) => {
    const parsed = await render(() => [table(rows)])
    const top = topsOf(parsed)
    const origin = top('b0')
    expect(Object.fromEntries(Object.keys(tops).map(text => [text, top(text) - origin]))).toEqual(tops)
  })

  // Catches: a span cell painted with its first row (the background of a row
  // it covers, painted later, would hide it); a span cell as high as its
  // first row only (its background would end there).
  it('paints a span cell over the rows it covers, after them', async () => {
    const bytes = await renderBytes(() => [table(() => [
      row([cell('Span', { rowspan: 2, style: { backgroundColor: '#dddddd' } }), cell('b0'), cell('c0')]),
      row([cell('b1'), cell('c1')], { style: { backgroundColor: '#eeeeee' } }),
    ])])
    const parsed = await parsePdf(bytes)
    expect(parsed.pages[0]!.textRuns.map(run => run.text).filter(text => text.trim() !== '')).toEqual(['b0', 'c0', 'b1', 'c1', 'Span'])
    // Row 1's background (the table is as wide as the page content), then the cell's over two rows.
    expect(pageContents(bytes)[0]!.split('\n').filter(line => line.endsWith(' re'))).toEqual(['0 11 515.280029 11 re', '0 0 60 22 re'])
  })

  // Catches a group split between its rows (the span cell on one page, the
  // rows it covers on the next). Spacer 740: row 0 ends at 751, row 1 at
  // 762 > 761.89.
  it('moves the rows of a span to the next page together', async () => {
    const parsed = await render(() => [spacer(740), table(() => [
      row([cell('Span', { rowspan: 2 }), cell('b0'), cell('c0')]),
      row([cell('b1'), cell('c1')]),
      row([cell('a2'), cell('b2'), cell('c2')]),
    ])])
    expect(['Span', 'b0', 'b1', 'a2'].map(text => pagesWith(parsed, text))).toEqual([[2], [2], [2], [2]])
  })

  // Catches a keep that ends at the first row of a span group (the heading or
  // the row would stay alone while the group moves). Spacer 730: the heading
  // ends at 745.4 and row 0 at 756.4, so row 0 fits; row 1 ends at 767.4.
  it.each([
    {
      label: 'a heading before a table that starts with a span group',
      content: () => [spacer(730), h(PdfText, { keepWithNext: true, style: { fontSize: 14 } }, () => 'Heading'), table(() => [
        row([cell('Span', { rowspan: 2 }), cell('b0'), cell('c0')]),
        row([cell('b1'), cell('c1')]),
      ])],
      kept: 'Heading',
    },
    {
      // "Above" ends at 730, row 0 at 741, row 1 at 752 and row 2 at 763:
      // row 1 fits, but the group of rows 1 and 2 moves, and row 0 with it.
      label: 'a row before a span group',
      content: () => [spacer(719), h(PdfText, null, () => 'Above'), table(() => [
        row([cell('a0'), cell('b0'), cell('c0')], { keepWithNext: true }),
        row([cell('Span', { rowspan: 2 }), cell('b1'), cell('c1')]),
        row([cell('b2'), cell('c2')]),
      ])],
      kept: 'a0',
    },
  ])('moves $label with the group', async ({ content, kept }) => {
    const parsed = await render(content)
    expect([kept, 'Span'].map(text => pagesWith(parsed, text))).toEqual([[2], [2]])
  })

  // Review decision 5: a group higher than the content area follows the rule
  // of an unbreakable block that is higher than a page (layout/paginate/split-stack.ts):
  // it stays where it starts, cut at the page end, with a warning; the rows
  // after it go on the next page. Catches a group that moves below the
  // spacer (it fits no page) and a group split between its rows.
  // A fixed node after the rows repeats on the page where they stay (FA).
  // Catches the fixed nodes after the rows left off that page, and a second
  // warning for the cell.
  it('keeps a span group higher than a page where it starts, cut at the page end', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 81 lines, 891 pt.
    const words = ['Start', ...Array.from({ length: 80 }, () => 'Wednesday')].join(' ')
    const { parsed, warnings } = await renderWithWarnings(() => [spacer(100), table(() => [
      row([cell(words, { rowspan: 2 }), cell('b0'), cell('c0')]),
      row([cell('b1'), cell('c1')]),
      row([cell('a2'), cell('b2'), cell('c2')]),
      h(PdfView, { fixed: true, style: { position: 'absolute', top: 0, right: 0 } }, () => [h(PdfText, null, () => 'FA')]),
    ])])
    expect(['Start', 'b0', 'b1', 'a2', 'FA'].map(text => pagesWith(parsed, text))).toEqual([[1], [1], [1], [2], [1, 2]])
    expect(warn).toHaveBeenCalledWith('Rows a table cell spans can\'t split between pages and they\'re bigger than available page height')
    // One warning for the rows, although the cell is higher than the page too, and no
    // PDF_CONTENT_HIDDEN for the cell lines the cut hides: one code per cause.
    expect(warnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 1, nodeType: 'PdfView', nodeHeight: 891, availableHeight: 761.89 }])
  })

  // Catches rows that stay cut without the layout warning: no row and no
  // cell of these 80 rows is higher than the page, only all of them.
  it('warns about the rows a span holds together when they are higher than a page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnings } = await renderWithWarnings(() => [table(() => Array.from({ length: 80 }, (_, index) =>
      row(index === 0 ? [cell('S', { rowspan: 80 }), cell('r0')] : [cell(`r${index}`)])), ['60pt', '60pt'])])
    expect(warnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 1, nodeType: 'PdfView', nodeHeight: 880, availableHeight: 761.89 }])
  })

  // 69 lines, 759 pt: the rows fit the content area (761.89 pt), but not
  // below the header row that repeats on the next page (750.89 pt). Catches
  // rows that move there anyway: the header and the rows overlap or the
  // rows are cut under the header.
  it('keeps the rows a span holds together where they start when they fit a page only without the header', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lines = Array.from({ length: 69 }, (_, index) => `G${index}`).join('\n')
    const { parsed, warnings } = await renderWithWarnings(() => [spacer(100), table(() => [
      h(PdfTableHeader, null, () => [cell('HA'), cell('HB'), cell('HC')]),
      row([cell(lines, { rowspan: 2 }), cell('b0'), cell('c0')]),
      row([cell('b1'), cell('c1')]),
      row([cell('a2'), cell('b2'), cell('c2')]),
    ])])
    expect(['G0', 'b1', 'a2'].map(text => pagesWith(parsed, text))).toEqual([[1], [1], [2]])
    expect(warnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 1, nodeType: 'PdfView', nodeHeight: 759, availableHeight: 750.89 }])
  })

  // The same rule for one row that cannot split (F6 open point 7). Catches
  // the row that moved to page 2 and was shrunk there under the header,
  // without a warning.
  it('keeps a row that cannot split where it starts when it fits a page only without the header', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lines = Array.from({ length: 69 }, (_, index) => `G${index}`).join('\n')
    const { parsed, warnings } = await renderWithWarnings(() => [spacer(100), table(() => [
      h(PdfTableHeader, null, () => [cell('HA'), cell('HB'), cell('HC')]),
      row([cell(lines), cell('b0'), cell('c0')], { wrap: false }),
      row([cell('a1'), cell('b1'), cell('c1')]),
    ])])
    expect(['G0', 'b0', 'a1'].map(text => pagesWith(parsed, text))).toEqual([[1], [1], [2]])
    expect(warnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 1, nodeType: 'PdfView', nodeHeight: 759, availableHeight: 750.89 }])
  })

  // Rows 730 to 763 pt: A holds rows 0 and 1, B (from row 1) rows 1 and 2.
  // Catches a group that only reads the spans of its first row: rows 0 and
  // 1 would stay on page 1 and row 2 would move, splitting B's rows.
  it('moves the rows whole that a span from a covered row adds to the group', async () => {
    const parsed = await render(() => [spacer(730), table(() => [
      row([cell('A0', { rowspan: 2 }), cell('b0'), cell('c0')]),
      row([cell('B1', { rowspan: 2 }), cell('c1')]),
      row([cell('a2'), cell('c2')]),
    ])])
    expect(['A0', 'B1', 'c2'].map(text => pagesWith(parsed, text))).toEqual([[2], [2], [2]])
  })

  // A fixed row after the rows of a table (a repeated footer row) stays on
  // the page the rows move from. Catches it left off that page.
  it('repeats a fixed row after rows that move whole on the page they leave', async () => {
    const parsed = await render(() => [spacer(730), table(() => [
      row([cell('p0'), cell('q0')]),
      row([cell('S', { rowspan: 3 }), cell('r1')]),
      row([cell('r2')]),
      row([cell('r3')]),
      h(PdfTableRow, { fixed: true }, () => [cell('FA'), cell('FB')]),
    ], ['60pt', '60pt'])])
    expect(['p0', 'S', 'FA'].map(text => pagesWith(parsed, text))).toEqual([[1], [2], [1, 2]])
  })

  // A (6 lines) ends in row 2 and comes first; B (4 lines) ends in row 1.
  // B makes row 1 33 pt; then A misses only 11 pt, which row 2 gets. Catches
  // spans that grow their rows in tree order: A would grow row 2 by 33 pt
  // before B grows row 1.
  it('grows each row by what its spans still need, in the order of their last rows', async () => {
    const lines = (count: number, mark: string) => Array.from({ length: count }, (_, index) => `${mark}${index}`).join('\n')
    const parsed = await render(() => [table(() => [
      row([cell(lines(6, 'A'), { rowspan: 3 }), cell(lines(4, 'B'), { rowspan: 2 }), cell('c0')]),
      row([cell('c1')]),
      row([cell('c2')]),
      row([cell('a3'), cell('b3'), cell('c3')]),
    ])])
    const top = topsOf(parsed)
    expect(['c1', 'c2', 'c3'].map(text => top(text) - top('c0'))).toEqual([11, 44, 66])
  })

  // Rows with 6 pt of vertical padding: a cell over two rows starts 6 pt
  // below its row's top. Its 5 lines (55 pt) cover 23 + 23 - 6 = 40 pt, so
  // row 1 grows by 15 pt. Catches a cell measured from the row's top: row 1
  // would grow by 9 pt only, and the cell would reach past it.
  it('measures a span from the top of its cell in rows with vertical padding', async () => {
    const padded = { style: { paddingVertical: 6 } }
    const parsed = await render(() => [table(() => [
      row([cell(TALL, { rowspan: 2 }), cell('b0')], padded),
      row([cell('b1')], padded),
      row([cell('a2'), cell('b2')], padded),
    ], ['60pt', '60pt'])])
    const top = topsOf(parsed)
    expect(top('b2') - top('b0')).toBe(61)
  })

  // The row's opacity reaches its cell over several rows, which paints after
  // the rows (D39): black under 0.5 is 127 in red on white (the texts are
  // white). Catches the
  // deferred paint without the row's opacity (0, black).
  it('paints a cell over several rows with the opacity of its row', async () => {
    const WHITE = { style: { color: '#ffffff' } }
    const bytes = await renderBytes(() => [table(() => [
      row([cell(' ', { rowspan: 2, style: { backgroundColor: '#000000' } }), cell('x', WHITE)], { style: { opacity: 0.5 } }),
      row([cell('y', WHITE)]),
    ], ['60pt', '60pt'])])
    const [page] = await rasterizePdf(bytes, { scale: 1 })
    let red = 255
    for (let index = 0; index < page!.pixels.length; index += 4) red = Math.min(red, page!.pixels[index]!)
    expect(red).toBeGreaterThan(120)
    expect(red).toBeLessThan(135)
  })

  // Catches a span resolved on a page part that holds only some of its rows:
  // pagination holds back the rows below the page end before it lays a rest
  // out again (layout/paginate/cut.ts), and growing the last row it kept
  // made that row higher on its own page. Every row stays 11 pt.
  it('keeps the rows of a long table with spans at their height on every page', async () => {
    const parsed = await render(() => [table(() => Array.from({ length: 280 }, (_, index) => row([
      ...(index % 4 === 0 ? [cell(`s${index}`, { rowspan: 4 })] : []),
      cell(`b${index}`),
      cell(`c${index}`),
    ], { key: index })))])
    expect(parsed.pageCount).toBe(5)
    const steps = new Set<number>()
    for (const page of parsed.pages) {
      const tops = page.textRuns.filter(run => run.text.startsWith('b')).map(run => page.height - run.y)
      tops.slice(1).forEach((top, index) => steps.add(Math.round((top - tops[index]!) * 100) / 100))
    }
    expect([...steps]).toEqual([11])
  })

  // Catches an 'auto' column that skips the visible span cell (it is
  // absolute inside the view that takes the column): the column would be as
  // wide as the other cells only, and the span text would wrap.
  it('measures a span cell for its \'auto\' column', async () => {
    const parsed = await render(() => [table(() => [
      row([cell('A wide span cell', { rowspan: 2 }), cell('b0')]),
      row([cell('b1')]),
    ], ['auto', '60pt'])])
    const page = parsed.pages[0]!
    const span = page.textRuns.find(run => run.text === 'A wide span cell')!
    const b0 = page.textRuns.find(run => run.text === 'b0')!
    expect(b0.x - span.x).toBeCloseTo(span.width, 1)
  })

  // Catches: a span cell without RowSpan (a screen reader would read the
  // rows it covers as rows without that cell); RowSpan on the visible cell
  // inside the view as a second TD; and a cell next to the hole a span
  // leaves in a row below, tagged as if it spanned the hole (ColSpan 2).
  it('tags a span cell with RowSpan and the cell beside its hole without ColSpan', async () => {
    const { bytes } = await renderTagged(TAGGED_PROPS, () => [h(PdfPage, { size: 'A6', style: { padding: 28, fontFamily: 'Roboto', fontSize: 10 } }, () => [
      table(() => [
        h(PdfTableHeader, null, () => [cell('A'), cell('B'), cell('C')]),
        row([cell('a0'), cell('Span', { rowspan: 2 }), cell('c0')]),
        row([cell('a1'), cell('c1')]),
        row([cell('Wide', { colspan: 2 }), cell('c2')]),
      ]),
    ])])
    const objects = [...Buffer.from(bytes).toString('latin1').matchAll(/\n\d+ 0 obj\n(<<[\s\S]*?>>)\nendobj/g)].map(match => match[1]!.replace(/\n/g, ' '))
    expect(objects.filter(body => body.includes('/S /TD'))).toHaveLength(7)
    expect(objects.filter(body => body.includes('/RowSpan'))).toEqual([expect.stringContaining('/A << /O /Table /RowSpan 2 >>')])
    expect(objects.filter(body => body.includes('/ColSpan'))).toEqual([expect.stringContaining('/A << /O /Table /ColSpan 2 >>')])
  }, 60_000)

  // Catches a span cell left out of the mount check of 'auto' columns (the
  // visible cell is absolute, and other absolute content is skipped): its
  // percentage padding has no width before layout.
  it('rejects a span cell with a percentage padding in an \'auto\' column at mount', async () => {
    const run = mountPdfComponent(doc(() => [table(() => [
      row([cell('Span', { rowspan: 2, style: { paddingLeft: '10%' } }), cell('b0')]),
      row([cell('b1')]),
    ], ['auto', '60pt'])]))
    await expect(run).rejects.toBeInstanceOf(NuxtPdfError)
    await expect(run).rejects.toMatchObject({
      code: PDF_ERROR_CODES.TreeInvalid,
      message: expect.stringContaining('<PdfTableCell> in an \'auto\' table column has paddingLeft "10%"'),
    })
  })
})
