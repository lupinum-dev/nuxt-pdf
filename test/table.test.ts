import { defineComponent, h, type Component, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { PdfStyleValue } from '../src/runtime/authoring'
import type { PdfTableColumn } from '../src/runtime/components/table'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { PDF_TABLE_CELL_PROP, PDF_TABLE_COLUMNS_PROP } from '../src/runtime/primitives'
import { mountPdfComponent } from '../src/runtime/renderer'
import type { PdfNode } from '../src/runtime/renderer/types'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import type { PdfLayoutWarning } from '../src/runtime/shared/template'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'

installPdfCanvasGlobals()

const {
  PdfDocument,
  PdfImage,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfPageNumber,
  PdfSvg,
  PdfTable,
  PdfTableCell,
  PdfTableHeader,
  PdfTableRow,
  PdfText,
  PdfTextField,
  PdfView,
} = PDF_COMPONENTS

// A4 with 40 pt padding: content box 515.28 × 761.89 pt.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const

const doc = (content: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0), language: 'en' }, () => h(PdfPage, PAGE, content)))

const render = async (component: Component, options?: Parameters<typeof renderPlainDocument>[1]) => {
  const mounted = await mountPdfComponent(component)
  try {
    const result = await renderPlainDocument(mounted.document, options)
    return { parsed: await parsePdf(result.bytes), passes: result.passes, warnings: result.layoutWarnings }
  }
  finally {
    mounted.unmount()
  }
}

const runsOf = (parsed: ParsedPdf, text: string) => parsed.pages.map(page =>
  page.textRuns.filter(run => run.text === text))

const pagesWith = (parsed: ParsedPdf, text: string): number[] => parsed.pages
  .filter(page => page.textItems.includes(text))
  .map(page => page.number)

const rowTexts = (parsed: ParsedPdf): string[] => parsed.pages.flatMap(page =>
  page.textItems.filter(item => /^Row \d+$/.test(item)))

const lineTable = (rows: number, options: { spacer?: number } = {}) => doc(() => [
  h(PdfView, { style: { height: options.spacer ?? 0 } }),
  h(PdfTable, { columns: ['50%', 1, 1] }, () => [
    h(PdfTableHeader, { style: { backgroundColor: '#eeeeee' } }, () => [
      h(PdfTableCell, null, () => 'Item'),
      h(PdfTableCell, { align: 'right' }, () => 'Qty'),
      h(PdfTableCell, { align: 'right' }, () => 'Amount'),
    ]),
    ...Array.from({ length: rows }, (_, index) => h(PdfTableRow, { key: index }, () => [
      h(PdfTableCell, null, () => `Row ${index}`),
      h(PdfTableCell, { align: 'right' }, () => String(index % 7)),
      h(PdfTableCell, { align: 'right' }, () => `${index}.00`),
    ])),
  ]),
])

describe('PdfTable', () => {
  // The table as a template sees it: props that its types reject still reach it.
  const LooseTable: Component = PdfTable
  // Catches: a header that prints once, or a repeat that duplicates or drops rows.
  it('repeats the header on every page and prints every row once, in order, in one pass', async () => {
    const { parsed, passes } = await render(lineTable(150))

    expect(parsed.pageCount).toBeGreaterThanOrEqual(3)
    expect(pagesWith(parsed, 'Item')).toEqual(parsed.pages.map(page => page.number))
    expect(rowTexts(parsed)).toEqual(Array.from({ length: 150 }, (_, index) => `Row ${index}`))
    expect(passes).toBe(1)

    // The header is the first line of every page.
    for (const page of parsed.pages) {
      const header = page.textRuns.find(run => run.text === 'Item')!
      const topRow = page.textRuns.filter(run => /^Row \d+$/.test(run.text))
        .reduce((top, run) => Math.max(top, run.y), Number.NEGATIVE_INFINITY)
      expect(header.y).toBeGreaterThan(topRow)
    }
  })

  // Catches a trailing fixed row that gets no room: the first part held every
  // row that fit the page (68), and the page relayout squeezed them to
  // 10.62 pt to fit the fixed row below them, so their lines crowded. The
  // header (11), 65 rows (715) and the fixed row (30) make 756 of 761.89 pt.
  // With 67 rows (header and rows 748 pt) the table fits the page only
  // without the fixed row, so all 67 stayed and were squeezed.
  it.each([
    { rows: 100 },
    { rows: 67 },
  ])('cuts a table of $rows rows above the room of a trailing fixed row and keeps its rows at their height', async ({ rows }) => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: [1, 1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
      ...Array.from({ length: rows }, (_, index) => h(PdfTableRow, { key: index }, () => [h(PdfTableCell, null, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')])),
      h(PdfTableRow, { fixed: true, style: { height: 30 } }, () => [h(PdfTableCell, null, () => 'Carried'), h(PdfTableCell, null, () => '')]),
    ])]))
    const [first, last] = [runsOf(parsed, 'Row 0')[0]![0]!, runsOf(parsed, 'Row 64')[0]![0]!]
    expect({ pageOf65: pagesWith(parsed, 'Row 65'), span: first.y - last.y, carried: pagesWith(parsed, 'Carried') })
      .toEqual({ pageOf65: [2], span: 704, carried: [1, 2] })
  })

  // Catches a page that never ends: under a fixed view 700 pt high the table
  // has 61.89 pt on every page, so the cut above a trailing fixed row of
  // 100 pt (above the page) or 55 pt (6.89 pt, less than a row) placed no row,
  // and every page started the same way. In a view that ends with a fixed
  // view, that cut leaves the table part only its header, which repeats on
  // every page and so places nothing. The time limit turns such a loop into a
  // failure. With nothing else above the table, the cut stays at the page end,
  // as without the trailing room: the page keeps the rows and squeezes them to
  // fit the fixed node.
  const rows = () => Array.from({ length: 5 }, (_, index) => h(PdfTableRow, { key: index }, () => [h(PdfTableCell, null, () => `Row ${index}`), h(PdfTableCell, null, () => '1.00')]))
  const carriedRow = (height: number) => h(PdfTableRow, { fixed: true, style: { height } }, () => [h(PdfTableCell, null, () => 'Carried'), h(PdfTableCell, null, () => '')])
  it.each<{ label: string, content: () => VNode, expected: string[][] }>([
    {
      label: 'a trailing fixed row of 100 pt',
      content: () => h(PdfTable, { columns: [1, 1] }, () => [...rows(), carriedRow(100)]),
      expected: [['Head', 'Row 0', 'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Carried']],
    },
    {
      label: 'a trailing fixed row of 55 pt',
      content: () => h(PdfTable, { columns: [1, 1] }, () => [...rows(), carriedRow(55)]),
      expected: [['Head', 'Row 0', 'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Carried']],
    },
    {
      label: 'a fixed view of 55 pt after a table with a header',
      content: () => h(PdfView, null, () => [
        h(PdfTable, { columns: [1, 1] }, () => [h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]), ...rows()]),
        h(PdfView, { fixed: true, style: { height: 55 } }, () => h(PdfText, null, () => 'Carried')),
      ]),
      expected: [['Head', 'Item', 'Row 0', 'Row 1', 'Row 2', 'Row 3', 'Carried'], ['Head', 'Item', 'Row 4', 'Carried']],
    },
  ])('ends a page whose fixed content leaves no room for a row: $label', async ({ content, expected }) => {
    const { parsed } = await render(doc(() => [
      h(PdfView, { fixed: true, style: { height: 700 } }, () => h(PdfText, null, () => 'Head')),
      content(),
    ]), { limits: createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 5_000 }) })
    expect(parsed.pages.map(page => page.textItems.filter(item => /^(?:Head|Item|Row \d+|Carried)$/.test(item)))).toEqual(expected)
  }, 30_000)

  // Catches rows a cell spans held at the cut above a trailing fixed row, with
  // a PDF_UNBREAKABLE_NODE_OVERFLOW warning, although they fit above the page
  // end. Below the fixed view and the header, the table has 50.89 pt on each
  // page; the cut above the fixed row (20 pt) leaves 30.89 pt, less than the
  // three rows (33 pt). They move to page 2 below the two rows, and start the
  // table there, where the cut stays at the page end and the page squeezes
  // them to fit the fixed row, as without the trailing room.
  it('keeps rows a cell spans that fit above the page end, without a warning, under a trailing fixed row', async () => {
    const row = (text: string) => h(PdfTableRow, null, () => [h(PdfTableCell, null, () => text), h(PdfTableCell, null, () => '1.00')])
    const { parsed, warnings } = await render(doc(() => [
      h(PdfView, { fixed: true, style: { height: 700 } }, () => h(PdfText, null, () => 'Head')),
      h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
        row('Row 0'),
        row('Row 1'),
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 3 }, () => 'Span'), h(PdfTableCell, null, () => 'Part 0')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Part 1')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Part 2')]),
        h(PdfTableRow, { fixed: true, style: { height: 20 } }, () => [h(PdfTableCell, null, () => 'Carried'), h(PdfTableCell, null, () => '')]),
      ]),
    ]))
    expect({ pages: parsed.pages.map(page => page.textItems.filter(item => /^(?:Row \d|Span|Part \d|Carried)$/.test(item))), warnings })
      .toEqual({ pages: [['Row 0', 'Row 1', 'Carried'], ['Part 0', 'Part 1', 'Part 2', 'Carried', 'Span']], warnings: [] })
  })

  // Catches a table below other content squeezed instead of moved: its cut
  // above the trailing fixed row (100 pt) places no row in the 61.89 pt below
  // the block, and only a page with nothing above the table falls back to the
  // page end. Here the block stays on page 1 and the table starts page 2.
  it('moves a table below other content whose cut above a trailing fixed row places no row', async () => {
    const { parsed } = await render(doc(() => [h(PdfView, null, () => [
      h(PdfView, { wrap: false, style: { height: 700 } }, () => h(PdfText, null, () => 'Block')),
      h(PdfTable, { columns: [1, 1] }, () => [...rows(), carriedRow(100)]),
    ])]), { limits: createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 5_000 }) })
    expect(parsed.pages.map(page => page.textItems.filter(item => /^(?:Block|Row \d+|Carried)$/.test(item))))
      .toEqual([['Block'], ['Row 0', 'Row 1', 'Row 2', 'Row 3', 'Row 4', 'Carried']])
  }, 30_000)

  // Catches room taken for an absolute fixed node written last on the page,
  // such as a page number in a corner: it is not in the flow, so the 69 lines
  // of 11 pt that fit the 761.89 pt page stay there, not 51 lines above its
  // 200 pt.
  it('keeps the flow at the page end above an absolute fixed node written last', async () => {
    const { parsed } = await render(doc(() => [
      ...Array.from({ length: 100 }, (_, index) => h(PdfText, { key: index }, () => `Line ${index}`)),
      h(PdfView, { fixed: true, style: { position: 'absolute', right: 0, bottom: 0, height: 200 } }, () => h(PdfText, null, () => 'Corner')),
    ]))
    expect(parsed.pages[0]!.textItems.filter(item => item.startsWith('Line ')).at(-1)).toBe('Line 68')
  })

  // Catches: an orphan header (header alone at a page bottom). The spacer
  // leaves room for the header but not for the first row under it. The page
  // builder moves the table in its one pass (today's path took a second).
  it('moves a table to the next page instead of leaving its header alone', async () => {
    const { parsed, passes } = await render(lineTable(5, { spacer: 745 }))

    expect(pagesWith(parsed, 'Item')).toEqual([2])
    expect(pagesWith(parsed, 'Row 0')).toEqual([2])
    expect(passes).toBe(1)
  })

  // Catches: cells that ignore their column (wrong index, width or alignment).
  it('places each cell in its column and aligns it', async () => {
    const { parsed } = await render(lineTable(1))
    const page = parsed.pages[0]!
    const run = (text: string) => page.textRuns.find(candidate => candidate.text === text)!
    const contentWidth = 595.28 - 80

    expect(run('Row 0').x).toBeCloseTo(40, 0)
    // The '50%' column ends in the middle; the two share columns split the rest.
    const amount = run('0.00')
    expect(amount.x + amount.width).toBeCloseTo(40 + contentWidth, 0)
    const quantity = run('0')
    expect(quantity.x + quantity.width).toBeCloseTo(40 + contentWidth * 0.75, 0)
  })

  // Catches: a cell with only text that is a text, not a view, so it ignores
  // justifyContent and its text stays at the top while a cell with other
  // content moves it down.
  it('places the text of a text-only cell as its justifyContent says, like a cell with other content', async () => {
    const bottom = { justifyContent: 'flex-end' } as const
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['60pt', '60pt', '60pt', '60pt'] }, () => [
        h(PdfTableRow, null, () => [
          h(PdfTableCell, { style: bottom }, () => 'Bare'),
          h(PdfTableCell, { style: bottom }, () => h(PdfText, null, () => 'Nested')),
          h(PdfTableCell, null, () => 'Top'),
          h(PdfTableCell, null, () => h(PdfView, { style: { height: 60 } })),
        ]),
      ]),
    ]))
    const y = (text: string) => parsed.pages[0]!.textRuns.find(run => run.text === text)!.y

    expect(y('Bare')).toBeCloseTo(y('Nested'), 2)
    expect(Math.abs(y('Bare') - y('Top'))).toBeGreaterThan(40)
  })

  // Catches: a cell with only text that loses the text-only keys of its
  // style now that it is a view: maxLines and textOverflow still cut it.
  it('cuts a text-only cell at the maxLines of its style', async () => {
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['60pt'] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { style: { maxLines: 1, textOverflow: 'ellipsis' } }, () => 'one two three four five six')]),
      ]),
    ]))

    expect(parsed.pages[0]!.textRuns.map(run => run.text)).toEqual([expect.stringMatching(/^one .*…$/)])
  })

  // Catches: a width column that shrinks when the columns are wider than the
  // content box (600 pt in 515.28 pt); a fixed width overflows instead.
  it('keeps each width column at its width when the columns do not fit', async () => {
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['300pt', '300pt'] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Left'), h(PdfTableCell, null, () => 'Right')]),
      ]),
    ]))
    const run = (text: string) => parsed.pages[0]!.textRuns.find(candidate => candidate.text === text)!

    expect(run('Right').x - run('Left').x).toBeCloseTo(300, 1)
  })

  // Catches: a cell below a row span that takes the spanned column instead of
  // the next free one, before, between and after the cells of its row; and a
  // row that a local component renders taken for a row inside another element.
  it('places the cells below a row span in the columns it leaves free', async () => {
    const cell = (text: string, rowspan?: number) => h(PdfTableCell, rowspan === undefined ? null : { rowspan }, () => text)
    const LocalRow = defineComponent(() => () => h(PdfTableRow, null, () => [cell('b1'), cell('c1')]))
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['60pt', '60pt', '60pt'] }, () => [
        h(PdfTableRow, null, () => [cell('a0', 2), cell('b0'), cell('c0')]),
        h(LocalRow),
        h(PdfTableRow, null, () => [cell('a2'), cell('b2', 2), cell('c2')]),
        h(PdfTableRow, null, () => [cell('a3'), cell('c3')]),
        h(PdfTableRow, null, () => [cell('a4'), cell('b4'), cell('c4', 2)]),
        h(PdfTableRow, null, () => [cell('a5'), cell('b5')]),
      ]),
    ]))
    const columnOf = (text: string) => (parsed.pages[0]!.textRuns.find(run => run.text === text)!.x - 40) / 60

    expect(['b1', 'c1', 'a3', 'c3', 'a5', 'b5'].map(columnOf).map(Math.round)).toEqual([1, 2, 0, 2, 0, 1])
  })

  // Catches: a cell inside a local component that loses its column.
  it('gives a cell wrapped in a local component its column', async () => {
    const MoneyCell = defineComponent({
      props: { value: { type: Number, required: true } },
      setup: props => () => h(PdfTableCell, { align: 'right' }, () => props.value.toFixed(2)),
    })
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: [1, '100pt'] }, () => [
        h(PdfTableRow, null, () => [
          h(PdfTableCell, null, () => 'Total'),
          h(MoneyCell, { value: 42 }),
        ]),
      ]),
    ]))
    const total = parsed.pages[0]!.textRuns.find(run => run.text === '42.00')!

    expect(total.x + total.width).toBeCloseTo(595.28 - 40, 0)
  })

  // Catches: a local component that renders several cells counted as one cell,
  // so its second cell takes the first one's column.
  it('gives each cell of a local component with several cells its own column', async () => {
    const QuantityAndAmount = defineComponent(() => () => [
      h(PdfTableCell, null, () => 'qty'),
      h(PdfTableCell, null, () => 'amount'),
    ])
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['80pt', 1, '100pt'] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'item'), h(QuantityAndAmount)]),
      ]),
    ]))
    const page = parsed.pages[0]!
    const run = (text: string) => page.textRuns.find(candidate => candidate.text === text)!

    expect(run('qty').x).toBeCloseTo(40 + 80, 0)
    expect(run('amount').x).toBeCloseTo(595.28 - 40 - 100, 0)
  })

  // Catches: a span cell with the width of one column, a sum that drops the
  // shares, the percentages or a unit conversion, and a wrapper (percentages
  // and lengths in one span) that shifts the cells after it.
  it('gives a span cell the width of the columns it covers, whatever their kinds', async () => {
    const columns = ['50pt', 1, '20%', '10mm', 2, '1in'] as const
    // [first column, colspan]: length + share, percentage + length,
    // share + percentage + length, mm + share + in, the whole row.
    const spans = [[0, 2], [2, 2], [1, 3], [3, 3], [0, 6]] as const
    const reference = (align: 'left' | 'right', prefix: string) => h(PdfTableRow, null, () =>
      columns.map((_, index) => h(PdfTableCell, { align }, () => `${prefix}${index}`)))
    const spanRow = (align: 'left' | 'right', prefix: string, [start, colspan]: readonly [number, number], row: number) =>
      h(PdfTableRow, null, () => [
        ...Array.from({ length: start }, () => h(PdfTableCell, null, () => '-')),
        h(PdfTableCell, { align, colspan }, () => `${prefix}${row}`),
        // Labels only after a left-aligned span: text right after a
        // right-aligned one would merge with it into one text run.
        ...Array.from({ length: columns.length - start - colspan }, (_, index) =>
          h(PdfTableCell, null, () => align === 'left' ? `A${row}${index}` : '')),
      ])
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns }, () => [
        reference('left', 'l'),
        reference('right', 'r'),
        ...spans.map((span, row) => spanRow('left', 'L', span, row)),
        ...spans.map((span, row) => spanRow('right', 'R', span, row)),
      ]),
      // Shares only: the span takes 1 + 1 of 4 shares, half the width.
      h(PdfTable, { columns: [1, 1, 2] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: 2, align: 'right' }, () => 'Half'),
        h(PdfTableCell, null, () => ''),
      ])]),
    ]))
    const page = parsed.pages[0]!
    const run = (text: string) => page.textRuns.find(candidate => candidate.text === text)!
    const left = (text: string) => run(text).x
    const right = (text: string) => run(text).x + run(text).width

    // The reference row itself: 50pt, then the shares split what is left.
    expect(left('l1')).toBeCloseTo(90, 0)
    expect(right('r5')).toBeCloseTo(595.28 - 40, 0)
    expect(right('Half')).toBeCloseTo(40 + (595.28 - 80) / 2, 0)
    spans.forEach(([start, colspan], row) => {
      const end = start + colspan - 1
      expect(left(`L${row}`), `span ${row} starts`).toBeCloseTo(left(`l${start}`), 1)
      expect(right(`R${row}`), `span ${row} ends`).toBeCloseTo(right(`r${end}`), 1)
      for (let index = 0; index < columns.length - end - 1; index += 1) {
        expect(left(`A${row}${index}`), `cell after span ${row}`).toBeCloseTo(left(`l${end + 1 + index}`), 1)
      }
    })
  })

  // The measure step of 'auto' columns (shared/table-columns.ts) reads the
  // column list on the table and the column indices on each view that takes
  // an 'auto' or share column: cells, the holes of row spans, empty columns.
  it('marks the column indices of the measured views of a table with \'auto\' columns', async () => {
    const columns = ['auto', 1, '80pt', 'auto'] as const
    const mounted = await mountPdfComponent(doc(() => [h(PdfTable, { columns }, () => [
      h(PdfTableHeader, null, () => ['A', 'B', 'C', 'D'].map(label => h(PdfTableCell, { key: label }, () => label))),
      h(PdfTableRow, null, () => [
        h(PdfTableCell, { rowspan: 2 }, () => 'tall'),
        h(PdfTableCell, { colspan: 2 }, () => 'share and width'),
        h(PdfTableCell, null, () => 'last'),
      ]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'b'), h(PdfTableCell, null, () => 'c')]),
      // An image with its own width is measurable.
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => [h(PdfImage, { src: 'logo.png', style: { width: '20pt' } })])]),
    ])]))
    try {
      const tables: unknown[] = []
      const marks: unknown[] = []
      const walk = (node: PdfNode) => {
        if (!('props' in node)) return
        if (PDF_TABLE_COLUMNS_PROP in node.props) tables.push(node.props[PDF_TABLE_COLUMNS_PROP])
        if (PDF_TABLE_CELL_PROP in node.props) marks.push(node.props[PDF_TABLE_CELL_PROP])
        node.children.forEach(walk)
      }
      walk(mounted.document)
      expect(tables).toEqual([columns])
      expect(marks).toEqual([
        [0], [1], [3],
        [0], [1, 2], [3],
        [0], [1], [3],
        [0], [1], [3],
      ])
    }
    finally {
      mounted.unmount()
    }
  })

  // Catches: a span that breaks the repeated header (wrong widths on the
  // second page, or a header that no longer repeats).
  it('repeats a header with a span cell on every page with the same widths', async () => {
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: ['50%', 1, 1] }, () => [
        h(PdfTableHeader, null, () => [
          h(PdfTableCell, { colspan: 2, align: 'right' }, () => 'Item and qty'),
          h(PdfTableCell, { align: 'right' }, () => 'Amount'),
        ]),
        ...Array.from({ length: 150 }, (_, index) => h(PdfTableRow, { key: index }, () => [
          h(PdfTableCell, null, () => `Row ${index}`),
          h(PdfTableCell, null, () => '1'),
          h(PdfTableCell, { align: 'right' }, () => `${index}.00`),
        ])),
      ]),
    ]))
    const contentWidth = 595.28 - 80

    expect(parsed.pageCount).toBeGreaterThanOrEqual(3)
    expect(rowTexts(parsed)).toEqual(Array.from({ length: 150 }, (_, index) => `Row ${index}`))
    for (const [index, page] of parsed.pages.entries()) {
      const span = runsOf(parsed, 'Item and qty')[index]!
      const amount = runsOf(parsed, 'Amount')[index]!
      expect(span, `page ${page.number}`).toHaveLength(1)
      expect(span[0]!.x + span[0]!.width).toBeCloseTo(40 + contentWidth * 0.75, 0)
      expect(amount[0]!.x + amount[0]!.width).toBeCloseTo(40 + contentWidth, 0)
    }
  })

  // Catches: a cell with page tokens that is laid out as a view, which cannot
  // hold text or tokens.
  it('prints page tokens in a cell', async () => {
    const { parsed } = await render(doc(() => [
      h(PdfTable, { columns: [1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => ['Page ', h(PdfPageNumber)])]),
      ]),
    ]))

    expect(parsed.pages[0]!.textItems).toContain('Page 1')
  })

  it.each([
    {
      label: 'missing columns',
      content: () => [h(PdfTable, null, () => [])],
      message: '<PdfTable> requires "columns"',
    },
    {
      label: 'an empty column list',
      content: () => [h(PdfTable, { columns: [] }, () => [])],
      message: '<PdfTable> requires "columns"',
    },
    {
      label: 'a column that is not a share or width',
      content: () => [h(PdfTable, { columns: [1, 0] }, () => [])],
      message: '<PdfTable> requires "columns": a non-empty list of shares (numbers), widths (\'30%\', \'80pt\'), \'auto\', or { width, align, style }.',
    },
    // Catches a column object that passes with a width the layout cannot
    // read, an align the cell would print as 'left', a key that does nothing
    // (such as a class the table never applies), or a style the cell's own
    // style would reject.
    {
      label: 'a column object without a width',
      content: () => [h(LooseTable, { columns: [1, { align: 'right' }] }, () => [])],
      message: '<PdfTable> column 2 requires "width": a share (number), a width (\'30%\', \'80pt\') or \'auto\'.',
    },
    {
      label: 'a column object with an unknown align',
      content: () => [h(LooseTable, { columns: [1, { width: 1, align: 'end' }] }, () => [])],
      message: '<PdfTable> column 2 requires "align" to be \'left\', \'center\' or \'right\'.',
    },
    {
      label: 'a column object with another key',
      content: () => [h(LooseTable, { columns: [1, { width: 1, class: 'num' }] }, () => [])],
      message: '<PdfTable> column 2 has the key "class": a column takes width, align and style. Use style here, or class on the cell.',
    },
    {
      label: 'a column style that is not an object',
      content: () => [h(LooseTable, { columns: [1, { width: 1, style: 'bold' }] }, () => [])],
      message: '<PdfTable> column 2 requires "style" to be a style object.',
    },
    {
      label: 'a column style with a key that is not a PDF style',
      content: () => [h(LooseTable, { columns: [1, { width: 1, style: { boxShadow: 'none' } }] }, () => [])],
      message: 'Unsupported PDF style "boxShadow" in the style of <PdfTable> column 2.',
    },
    {
      label: 'a column style with a value its key does not take',
      content: () => [h(PdfTable, { columns: [1, { width: 1, style: { fontSize: -4 } }] }, () => [])],
      message: '<PdfTable> column 2 style value -4 for "fontSize" is invalid: expected a value above 0.',
    },
    {
      label: 'more cells than columns',
      content: () => [h(PdfTable, { columns: [1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'a'), h(PdfTableCell, null, () => 'b')]),
      ])],
      message: '<PdfTableRow> needs 2 columns (counting colspan), but its <PdfTable> declares 1.',
    },
    {
      label: 'more cells than columns from a local component',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [
          h(PdfTableCell, null, () => 'a'),
          h(defineComponent(() => () => [1, 2].map(index => h(PdfTableCell, { key: index }, () => 'b')))),
        ]),
      ])],
      message: '<PdfTableRow> needs 3 columns (counting colspan), but its <PdfTable> declares 2.',
    },
    ...['wide', '80 pt', '2'].map(column => ({
      label: `the column string ${JSON.stringify(column)}`,
      content: () => [h(PdfTable, { columns: [column as '1pt'] }, () => [])],
      message: '<PdfTable> requires "columns"',
    })),
    {
      label: 'a row directly in a cell of an outer table',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, null, () => [h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'inner')])]),
      ])])],
      message: '<PdfTableRow> must be inside <PdfTable>.',
    },
    {
      label: 'a cell directly in a cell',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, null, () => [h(PdfTableCell, null, () => 'inner')]),
      ])])],
      message: '<PdfTableCell> must be inside <PdfTableRow> or <PdfTableHeader>.',
    },
    {
      label: 'spans that cover more columns than the table has',
      content: () => [h(PdfTable, { columns: [1, 1, 1] }, () => [h(PdfTableHeader, null, () => [
        h(PdfTableCell, { colspan: 2 }, () => 'a'),
        h(PdfTableCell, { colspan: 2 }, () => 'b'),
      ])])],
      message: '<PdfTableHeader> needs 4 columns (counting colspan), but its <PdfTable> declares 3.',
    },
    {
      label: 'a static colspan, which passes text',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: '2' as unknown as number }, () => 'x'),
      ])])],
      message: '<PdfTableCell> colspan="2" passes the text "2", not a number. Bind it: :colspan="2".',
    },
    // The negative right margin that widens such a span must stay its own.
    ...([{ marginRight: 4 }, { margin: '4pt' }, [{ color: 'red' }, { marginHorizontal: 4 }]] satisfies PdfStyleValue[]).map(style => ({
      label: `a right margin on a span over a percentage and a length: ${JSON.stringify(style)}`,
      content: () => [h(PdfTable, { columns: ['50%', '80pt'] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: 2, style }, () => 'x'),
      ])])],
      message: '<PdfTableCell> spans percentage and length columns, so it cannot take a right margin',
    })),
    ...[0, 1.5, 'two', Number.NaN].map(colspan => ({
      label: `colspan ${String(colspan)}`,
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: colspan as number }, () => 'x'),
      ])])],
      message: '<PdfTableCell> requires "colspan" to be a whole number from 1.',
    })),
    {
      label: 'a header that is not a boolean',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { header: 'yes' as unknown as boolean }, () => 'x'),
      ])])],
      message: '<PdfTableCell> requires "header" to be true or false.',
    },
    {
      label: 'a span over lengths that cannot be added',
      content: () => [h(PdfTable, { columns: ['20px', '30pt'] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: 2 }, () => 'x'),
      ])])],
      message: '<PdfTableCell> spans columns in "px" and "pt"; their widths cannot be added.',
    },
    {
      label: 'an unsupported prop on a cell, named as the authored component',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell as Component, { span: 2 }, () => 'x'),
      ])])],
      message: 'Unsupported prop "span" on <PdfTableCell>.',
    },
    ...[0, 1.5, 'two', Number.NaN].map(rowspan => ({
      label: `rowspan ${String(rowspan)}`,
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { rowspan: rowspan as number }, () => 'x'),
      ])])],
      message: '<PdfTableCell> requires "rowspan" to be a whole number from 1.',
    })),
    {
      label: 'a static rowspan, which passes text',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: '2' as unknown as number }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'z')]),
      ])],
      message: '<PdfTableCell> rowspan="2" passes the text "2", not a number. Bind it: :rowspan="2".',
    },
    {
      label: 'a row span past the last row',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'a'), h(PdfTableCell, null, () => 'b')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 3 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'z')]),
      ])],
      message: '<PdfTableCell> spans 3 rows, but its <PdfTable> has only 2 rows from its row to the end.',
    },
    {
      label: 'a row span in a header',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableHeader, null, () => [h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'z')]),
      ])],
      message: '<PdfTableCell> in <PdfTableHeader> cannot span rows: a header repeats as one row.',
    },
    {
      label: 'a row with wrap under a row span',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, { wrap: true }, () => [h(PdfTableCell, null, () => 'z')]),
      ])],
      message: '<PdfTableRow> sets wrap, but a rowspan covers it: the rows of a span stay together on one page. Remove wrap.',
    },
    {
      label: 'a row with break under a row span',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, { break: true }, () => [h(PdfTableCell, null, () => 'z')]),
      ])],
      message: '<PdfTableRow> sets break, but a rowspan from a row above covers it: the rows of a span stay together on one page. Remove break.',
    },
    {
      label: 'a column span over a column a row span takes',
      content: () => [h(PdfTable, { columns: [1, 1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'a'), h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'c')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, { colspan: 2 }, () => 'z')]),
      ])],
      message: '<PdfTableCell> spans 2 columns up to column 2, but a rowspan from a row above takes column 2.',
    },
    {
      label: 'a row under a row span inside another element of the table',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfView, null, () => [h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'z')])]),
      ])],
      message: '<PdfTableRow> is covered by a rowspan, so it must be a row of its <PdfTable> itself, not inside another element.',
    },
    {
      label: 'more cells than the columns a row span leaves free',
      content: () => [h(PdfTable, { columns: [1, 1] }, () => [
        h(PdfTableRow, null, () => [h(PdfTableCell, { rowspan: 2 }, () => 'x'), h(PdfTableCell, null, () => 'y')]),
        h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'z'), h(PdfTableCell, null, () => 'w')]),
      ])],
      message: '<PdfTableRow> needs 3 columns (counting colspan and the columns of row spans above), but its <PdfTable> declares 2.',
    },
    {
      label: 'a child the cell cannot hold, named as the authored component',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, null, () => ['text', h(PdfView)]),
      ])])],
      message: '<PdfTableCell> cannot contain text.',
    },
    {
      label: 'text directly in a row',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableRow, null, () => 'loose')])],
      message: '<PdfTableRow> holds <PdfTableCell> elements only.',
    },
    {
      label: 'a primitive directly in a header',
      content: () => [h(PdfTable, { columns: [1] }, () => [h(PdfTableHeader, null, () => [h(PdfText, null, () => 'x')])])],
      message: '<PdfTableHeader> holds <PdfTableCell> elements only.',
    },
    ...[
      { label: 'an image', content: () => h(PdfImage, { src: 'logo.png' }), name: '<PdfImage>' },
      { label: 'an SVG', content: () => h(PdfSvg, { viewBox: '0 0 10 10' }), name: '<PdfSvg>' },
      { label: 'a form field', content: () => h(PdfTextField, { name: 'note' }), name: '<PdfTextField>' },
      { label: 'a row view', content: () => h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfText, null, () => 'a')]), name: '<PdfView> with flexDirection \'row\'' },
    ].map(({ label, content, name }) => ({
      // Inside a local component and a view: the check reads the mounted tree.
      label: `${label} without a width in an 'auto' column`,
      content: () => [h(PdfTable, { columns: [1, 'auto'] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, null, () => 'a'),
        h(PdfTableCell, null, () => [h(PdfView, null, () => [h(defineComponent(() => () => content()))])]),
      ])])],
      message: `${name} in an 'auto' table column needs a width of its own`,
    })),
    // Catches: an edge or a width that has no value before layout counted as
    // 0 pt (the column would be too narrow by it, and a one-word cell wraps).
    ...[
      { label: 'a percentage padding on a text', content: () => h(PdfText, { style: { paddingLeft: '10%' } }, () => 'a'), message: '<PdfText> in an \'auto\' table column has paddingLeft "10%"' },
      { label: 'a percentage margin on an element with its own width', content: () => h(PdfText, { style: { width: 40, marginLeft: '10%' } }, () => 'a'), message: '<PdfText> in an \'auto\' table column has marginLeft "10%"' },
      { label: 'a percentage width', content: () => h(PdfText, { style: { width: '50%' } }, () => 'a'), message: '<PdfText> with width "50%" in an \'auto\' table column needs a width of its own in points' },
      { label: 'a percentage maximum width', content: () => h(PdfView, { style: { maxWidth: '50%' } }, () => [h(PdfText, null, () => 'a')]), message: '<PdfView> with maxWidth "50%" in an \'auto\' table column needs a width of its own in points' },
    ].map(({ label, content, message }) => ({
      label: `${label} in an 'auto' column`,
      content: () => [h(PdfTable, { columns: [1, 'auto'] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, null, () => 'a'),
        h(PdfTableCell, null, () => [h(PdfView, null, () => [h(defineComponent(() => () => content()))])]),
      ])])],
      message,
    })),
    {
      label: 'a percentage padding on an \'auto\' cell',
      content: () => [h(PdfTable, { columns: ['auto'] }, () => [h(PdfTableRow, null, () => [h(PdfTableCell, { style: { padding: '5%' } }, () => 'a')])])],
      message: '<PdfTableCell> in an \'auto\' table column has padding "5%"',
    },
    {
      label: 'a span over a percentage and an \'auto\' column',
      content: () => [h(PdfTable, { columns: ['30%', 'auto'] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: 2 }, () => 'a'),
      ])])],
      message: '<PdfTableCell> spans a percentage column and an \'auto\' or share column of a table with \'auto\' columns',
    },
    {
      label: 'a row outside a table',
      content: () => [h(PdfTableRow, null, () => [])],
      message: '<PdfTableRow> must be inside <PdfTable>.',
    },
    {
      label: 'a cell outside a row',
      content: () => [h(PdfView, null, () => [h(PdfTableCell, null, () => 'x')])],
      message: '<PdfTableCell> must be inside <PdfTableRow> or <PdfTableHeader>.',
    },
  ])('rejects $label', async ({ content, message }) => {
    await expect(mountPdfComponent(doc(content))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: expect.stringContaining(message),
    })
  })

  // Catches column defaults that the cells ignore, that skip header cells,
  // that win over the cell's own align or style (also a column textAlign
  // over the cell's align), and a cell that reads the
  // defaults of another column: a span (its first column), a cell after the
  // hole of a row span (its own start column). The same table with each
  // align on its cell is the reference for the places.
  it('gives each cell, header cells included, the align and style of the column it starts in, unless the cell sets its own', async () => {
    type Own = { align?: 'right' | 'center', style?: { fontSize: number } }
    const table = (columns: PdfTableColumn[], own: (column: 'right' | 'center') => Own) => doc(() => [h(PdfTable, { columns }, () => [
      h(PdfTableHeader, { style: { fontSize: 6 } }, () => [h(PdfTableCell, own('right'), () => 'H1'), h(PdfTableCell, { align: 'left', style: { fontSize: 8 } }, () => 'G1'), h(PdfTableCell, null, () => 'K1')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, own('right'), () => 'R1'), h(PdfTableCell, own('center'), () => 'C1'), h(PdfTableCell, null, () => 'L1')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, { ...own('right'), align: 'left' }, () => 'O2'), h(PdfTableCell, own('center'), () => 'C2'), h(PdfTableCell, null, () => 'L2')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, { ...own('right'), rowspan: 2 }, () => 'V3'), h(PdfTableCell, own('center'), () => 'C3'), h(PdfTableCell, null, () => 'L3')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, own('center'), () => 'C4'), h(PdfTableCell, null, () => 'L4')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, { ...own('right'), colspan: 2 }, () => 'S5'), h(PdfTableCell, { align: 'center' }, () => 'L5')]),
    ])])
    const texts = ['H1', 'G1', 'K1', 'R1', 'C1', 'L1', 'O2', 'C2', 'L2', 'V3', 'C3', 'L3', 'C4', 'L4', 'S5', 'L5']
    const placed = async (component: Component) => {
      const { parsed } = await render(component)
      const runOf = (text: string) => parsed.pages[0]!.textRuns.find(candidate => candidate.text === text)!
      return Object.fromEntries(texts.map(text => [text, { x: runOf(text).x.toFixed(2), size: runOf(text).fontSize }]))
    }
    const big = { fontSize: 12 }
    const byColumn = await placed(table([{ width: '100pt', align: 'right', style: big }, { width: '100pt', align: 'center', style: big }, '100pt'], () => ({})))
    const byCell = await placed(table(['100pt', '100pt', '100pt'], align => ({ align, style: big })))
    expect(byColumn).toEqual(byCell)
    // The defaults took effect: R1 sits right of the left cell O2, the span S5
    // right of C1, at the right end of its two columns. The column's font size
    // beats the size the header cells inherit from their row (6); the cell's
    // own size (8) beats the column's.
    expect(Number(byColumn.R1!.x)).toBeGreaterThan(Number(byColumn.O2!.x) + 50)
    expect(Number(byColumn.S5!.x)).toBeGreaterThan(Number(byColumn.C1!.x))
    expect([byColumn.H1!.size, byColumn.G1!.size, byColumn.K1!.size, byColumn.O2!.size, byColumn.L1!.size]).toEqual([12, 8, 6, 12, 10])
    // A textAlign in the column's style places a cell when the column sets no
    // align (Z ends at the column's right edge, 140), and the cell's own
    // align beats it (A starts at the left edge, 40).
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: [{ width: '100pt', style: { textAlign: 'right' } }, '100pt'] }, () => [
      h(PdfTableRow, null, () => [h(PdfTableCell, { align: 'left' }, () => 'A'), h(PdfTableCell, null, () => 'B')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Z'), h(PdfTableCell, { align: 'center' }, () => 'Y')]),
    ])]))
    const textRun = (text: string) => parsed.pages[0]!.textRuns.find(candidate => candidate.text === text)!
    expect([textRun('A').x, (textRun('Z').x + textRun('Z').width).toFixed(2)]).toEqual([40, '140.00'])
  })
  // The column decides a cell's box. Catches an 'auto' margin on a cell that
  // still places it: it shrank the box and moved it inside a share column,
  // moved a cell beside a width column over the next column, and was dropped
  // without a word in a table with 'auto' columns. The shorthands count as
  // the engine expands them, in key order; the last case keeps the right
  // side 'auto'. A percentage side margin, which the measure dropped without
  // a word in a share column and which a width column cannot take off its
  // width. A cell width outside 'auto' columns, which replaced the column for
  // its row. The same from a column's style, which the cell takes.
  const marginCell = (columns: PdfTableColumn[], style: Record<string, unknown>, props: Record<string, unknown> = {}) => () => [h(PdfTable, { columns }, () => [h(PdfTableRow, null, () => [
    h(PdfTableCell, { style, ...props }, () => 'x'),
    h(PdfTableCell, null, () => 'y'),
  ])])]
  const ownWidth = ': a cell is as wide as its columns. Set the width in columns, such as \'80pt\' or \'auto\'.'
  const inPercent = ': the margin sits inside the cell\'s columns, and a percentage cannot be taken off a column width. Use a length, such as \'4pt\'.'
  const placeBox = ': a cell is as wide as its columns, so the margin cannot place it. Use textAlign to place its text, align on the cell or its column to place its content, or a <PdfView> inside the cell to place a box.'
  it.each([
    { label: 'marginLeft \'auto\' beside a width column', content: marginCell(['200pt', '100pt'], { marginLeft: 'auto' }), message: `(marginLeft "auto")${placeBox}` },
    { label: 'margin \'0 auto\' in a share column', content: marginCell([1, 1], { margin: '0 auto' }), message: `(margin "0 auto")${placeBox}` },
    { label: 'marginHorizontal \'auto\' in an \'auto\' column', content: marginCell(['auto', 1], { marginHorizontal: 'auto' }), message: `(marginHorizontal "auto")${placeBox}` },
    { label: 'margin \'auto\' with only the left side set again', content: marginCell([1, 1], { margin: 'auto', marginLeft: 0 }), message: `(margin "auto")${placeBox}` },
    { label: 'an \'auto\' margin from the column\'s style', content: marginCell([{ width: 1, style: { marginRight: 'auto' } }, 1], {}), message: `(marginRight "auto")${placeBox}` },
    { label: 'a percentage margin on a measured cell in a share column', content: marginCell([1, 'auto'], { marginLeft: '5%' }), message: `<PdfTableCell> has a horizontal margin in percent (marginLeft "5%")${inPercent}` },
    { label: 'a percentage margin in a width column', content: marginCell(['200pt', '100pt'], { marginLeft: '5%' }), message: `<PdfTableCell> has a horizontal margin in percent (marginLeft "5%")${inPercent}` },
    { label: 'a width in a width column', content: marginCell(['200pt', '100pt'], { width: 50 }), message: `<PdfTableCell> sets width 50${ownWidth}` },
    { label: 'a minWidth in a share column', content: marginCell([1, 1], { minWidth: '80pt' }), message: `<PdfTableCell> sets minWidth "80pt"${ownWidth}` },
    { label: 'a maxWidth in a share column of a table with \'auto\' columns', content: marginCell([1, 'auto'], { maxWidth: 30 }), message: `<PdfTableCell> sets maxWidth 30${ownWidth}` },
    { label: 'a width on a span over an \'auto\' and a share column', content: marginCell(['auto', 1, 1], { width: 50 }, { colspan: 2 }), message: `<PdfTableCell> sets width 50${ownWidth}` },
    { label: 'a width from the column\'s style in a percentage column', content: marginCell([{ width: '30%', style: { width: 50 } }, 1], {}), message: `<PdfTableCell> sets width 50${ownWidth}` },
    // The flex keys size a cell in its row (flexBasis 200 moved the later
    // cells 100 pt right), and an absolute cell leaves its row (the cell
    // after it took its place). In every table kind, also from a column.
    { label: 'a flexBasis in a width column', content: marginCell(['100pt', '100pt', '100pt'], { flexBasis: 200 }), message: `<PdfTableCell> sets flexBasis 200${ownWidth}` },
    { label: 'a flexGrow in a share column', content: marginCell([1, 1], { flexGrow: 2 }), message: `<PdfTableCell> sets flexGrow 2${ownWidth}` },
    { label: 'a flexShrink in an \'auto\' column', content: marginCell(['auto', 'auto'], { flexShrink: 0 }), message: `<PdfTableCell> sets flexShrink 0${ownWidth}` },
    { label: 'a flex from the column\'s style in a percentage column', content: marginCell([{ width: '30%', style: { flex: 1 } }, 1], {}), message: `<PdfTableCell> sets flex 1${ownWidth}` },
    { label: 'an absolute cell', content: marginCell(['100pt', '100pt'], { position: 'absolute' }), message: '<PdfTableCell> sets position "absolute": a cell stays in its row. Put an absolute <PdfView> inside the cell.' },
    { label: 'an absolute cell from the column\'s style', content: marginCell([{ width: 'auto', style: { position: 'absolute' } }, 1], {}), message: '<PdfTableCell> sets position "absolute": a cell stays in its row. Put an absolute <PdfView> inside the cell.' },
  ])('rejects a cell margin or width that cannot hold: $label', async ({ content, message }) => {
    await expect(mountPdfComponent(doc(content))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: expect.stringContaining(message),
    })
  })

  // Catches a check that reads a shorthand without the keys after it: the
  // later lengths replace both 'auto' sides.
  it('accepts an \'auto\' margin on a cell that later margins replace', async () => {
    const { parsed } = await render(doc(marginCell([1, 1], { margin: 'auto', marginLeft: 0, marginRight: 0 })))
    expect(parsed.pages[0]!.textItems).toContain('x')
  })

  // The column decides a cell's width in every table kind. Catches a side
  // margin that widens a width or percentage column for its row (q1 and q2
  // 10 or 20 pt right of p1 and p2), and a width that does not reach an
  // 'auto' column as its request (p1 and q1 stay at the text's width).
  // Literal x of the later columns in a plain row (p) and a row whose first
  // cell has the style (q).
  it.each([
    { label: 'a margin in a width column', columns: ['100pt', '100pt', '100pt'], style: { marginLeft: 10, marginRight: 10 }, x: ['144.00', '244.00'] },
    { label: 'a margin in a percentage column', columns: ['20%', '20%', '20%'], style: { marginLeft: 10, marginRight: 10 }, x: ['147.06', '250.11'] },
    { label: 'a margin in a share column', columns: [1, 1, 1], style: { marginLeft: 10, marginRight: 10 }, x: ['215.76', '387.52'] },
    { label: 'a margin in an \'auto\' column', columns: ['auto', 'auto', 'auto'], style: { marginLeft: 10, marginRight: 10 }, x: ['83.12', '102.24'] },
    { label: 'a negative margin in a width column', columns: ['100pt', '100pt', '100pt'], style: { marginLeft: -10 }, x: ['144.00', '244.00'] },
    { label: 'a margin from the column\'s style in a width column', columns: [{ width: '100pt', style: { marginLeft: 10, marginRight: 10 } }, '100pt', '100pt'], style: {}, x: ['144.00', '244.00'] },
    { label: 'a width request in an \'auto\' column', columns: ['auto', 'auto', 'auto'], style: { width: 80 }, x: ['124.00', '143.12'] },
  ] satisfies { label: string, columns: PdfTableColumn[], style: Record<string, unknown>, x: string[] }[])('keeps the later cells of a row in their columns: $label', async ({ columns, style, x }) => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns }, () => [
      h(PdfTableRow, null, () => ['p0', 'p1', 'p2'].map(text => h(PdfTableCell, { style: { padding: 4 } }, () => text))),
      h(PdfTableRow, null, () => ['q0', 'q1', 'q2'].map((text, index) => h(PdfTableCell, { style: { padding: 4, ...(index === 0 ? style : {}) } }, () => text))),
    ])]))
    const at = (text: string) => parsed.pages[0]!.textRuns.find(candidate => candidate.text === text)!.x.toFixed(2)
    expect({ p: [at('p1'), at('p2')], q: [at('q1'), at('q2')] }).toEqual({ p: x, q: x })
  })
})

describe('automatic columns (\'auto\')', () => {
  const CONTENT_RIGHT = 595.28 - 40
  const padded = { style: { padding: 4 } } as const
  const cell = (text: string, props: Record<string, unknown> = {}) => h(PdfTableCell, { ...padded, ...props }, () => text)
  const run = (parsed: ParsedPdf, text: string, page = 0) => {
    const runs = runsOf(parsed, text)[page]!
    expect(runs, text).toHaveLength(1)
    return runs[0]!
  }

  // Catches: an 'auto' column laid out as a share, a measure without the
  // cell's padding, and a measure without the float margin (each makes a
  // widest cell wrap: one word, or two words at one space).
  it('makes an \'auto\' column as wide as its widest cell on one line, and gives a share column the rest', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 1, 'auto'] }, () => [
      h(PdfTableRow, null, () => [cell('1'), cell('Consulting'), cell('1,200.00 EUR', { align: 'right' })]),
      h(PdfTableRow, null, () => [cell('12'), cell('Hosting'), cell('Subscription')]),
    ])]))
    const widest = run(parsed, '12').width + 8
    expect(run(parsed, '1').x).toBeCloseTo(44, 3)
    expect(run(parsed, 'Consulting').x).toBeCloseTo(40 + widest + 4, 2)
    const amount = run(parsed, '1,200.00 EUR')
    expect(amount.x + amount.width).toBeCloseTo(CONTENT_RIGHT - 4, 2)
    expect(run(parsed, 'Subscription').x).toBeCloseTo(CONTENT_RIGHT - amount.width - 4, 2)
  })

  // Catches: an 'auto' margin that fails in an 'auto' column (it only takes
  // free space, so it counts 0) or that widens the column.
  it('counts an \'auto\' margin as 0 in an \'auto\' column and lets it push its element to the right', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 1] }, () => [
      h(PdfTableRow, null, () => [cell('Subscription'), cell('x')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, padded, () => [h(PdfText, { style: { width: 40, marginLeft: 'auto' } }, () => 'a')]), cell('y')]),
    ])]))
    const widest = run(parsed, 'Subscription').width
    expect(run(parsed, 'y').x).toBeCloseTo(40 + widest + 8 + 4, 2)
    expect(run(parsed, 'a').x).toBeCloseTo(40 + 4 + widest - 40, 2)
  })

  // A measured cell takes its columns itself (no view around it), so its own
  // style must not move the next column. Catches: the cell's margins left out
  // of the measure ("Alpha beta" wraps) or kept inside its flex basis (X moves
  // right by 16); its own maxWidth kept (Z moves left).
  it('keeps the next column in place whatever the margins and widths of a measured cell', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 'auto'] }, () => [
      h(PdfTableRow, null, () => [cell('Alpha beta', { style: { padding: 4, marginLeft: 10, marginRight: 6 } }), cell('X')]),
      h(PdfTableRow, null, () => [cell('Al'), cell('Y')]),
      h(PdfTableRow, null, () => [cell('B', { style: { padding: 4, maxWidth: 20 } }), cell('Z')]),
    ])]))
    const alpha = run(parsed, 'Alpha beta')
    expect(alpha.x).toBeCloseTo(54, 2)
    expect(['X', 'Y', 'Z'].map(text => run(parsed, text).x.toFixed(2)))
      .toEqual(Array.from({ length: 3 }, () => (40 + 10 + 4 + alpha.width + 4 + 6 + 4).toFixed(2)))
  })

  // Catches a shrink factor that is not scaled to the basis less the margins:
  // both columns give width, in proportion to what yoga reads as each cell's
  // shrink × basis, so the cell with margins would take a different share
  // than the plain cell of its column, and X and Y part.
  it('shrinks a measured cell with margins as far as the plain cells of its column', async () => {
    const { parsed } = await render(doc(() => [h(PdfView, { style: { width: 160 } }, () => [h(PdfTable, { columns: ['auto', 'auto'] }, () => [
      h(PdfTableRow, null, () => [cell('Alpha beta gamma delta epsilon', { style: { padding: 4, marginLeft: 20 } }), cell('X one two three four')]),
      h(PdfTableRow, null, () => [cell('Alpha beta gamma delta'), cell('Y one two three four')]),
    ])])]))
    const lineStarting = (word: string) => parsed.pages[0]!.textRuns.find(textRun => textRun.text.startsWith(`${word} `))!
    // Both columns gave width: their widest texts wrap.
    expect(parsed.pages[0]!.textItems).not.toContain('X one two three four')
    expect(lineStarting('Y').x).toBeCloseTo(lineStarting('X').x, 2)
  })

  // yoga never makes a box narrower than its padding and border. Catches a
  // span whose padding (60 pt) is wider than its share columns get: it kept
  // its padding and pushed Z2 11.67 pt right of Z1 in the 60 pt table, with
  // no warning. Its padding now counts as least width for its columns, so
  // the rows stay in line and a table narrower than that warns. Over 'auto'
  // columns, the least width is what the padding (80 pt) lacks, shared by the
  // 'auto' columns it covers (b at 80); a length column in the span counts
  // toward it (b at 100, not 120), and an 'auto' column whose least width
  // passes its content is as wide as that least width (Z at 120).
  it.each([
    { label: 'share columns, a 60 pt table', width: 60, columns: [1, 1, 'auto'], padding: 30, b: 70, z: 100, warnings: [{ code: 'PDF_TABLE_COLUMNS_TOO_NARROW', pageNumber: 1, tableWidth: 60, neededWidth: 71.67 }] },
    { label: 'share columns, a 120 pt table', width: 120, columns: [1, 1, 'auto'], padding: 30, b: 94.17, z: 148.33, warnings: [] },
    { label: '\'auto\' columns', width: 300, columns: ['auto', 'auto', 'auto'], padding: 40, b: 80, z: 120, warnings: [] },
    { label: 'an \'auto\' and a length column', width: 300, columns: ['auto', '20pt', 'auto'], padding: 40, b: 100, z: 120, warnings: [] },
  ] satisfies { label: string, width: number, columns: PdfTableColumn[], padding: number, b: number, z: number, warnings: unknown[] }[])('keeps a span with more padding than its columns in line with the rows above: $label', async ({ width, columns, padding, b, z, warnings }) => {
    const { parsed, warnings: got } = await render(doc(() => [h(PdfView, { style: { width } }, () => [h(PdfTable, { columns }, () => [
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'a'), h(PdfTableCell, null, () => 'b'), h(PdfTableCell, null, () => 'Z1')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, { colspan: 2, style: { paddingLeft: padding, paddingRight: padding } }, () => 's'), h(PdfTableCell, null, () => 'Z2')]),
    ])])]))
    expect({ b: run(parsed, 'b').x.toFixed(2), z1: run(parsed, 'Z1').x.toFixed(2), z2: run(parsed, 'Z2').x.toFixed(2), warnings: got })
      .toEqual({ b: b.toFixed(2), z1: z.toFixed(2), z2: z.toFixed(2), warnings })
  })

  // The limit that stays: in a table narrower than its longest words, a cell
  // with more padding than the other cells of its column keeps its padding
  // and pushes the next cell of its row (Y1 36.69 pt right of Y2). Catches
  // that case going silent: the table reports it with the warning.
  it('warns for a padded cell that pushes its row in a table narrower than its longest words', async () => {
    const { parsed, warnings } = await render(doc(() => [h(PdfView, { style: { width: 30 } }, () => [h(PdfTable, { columns: ['auto', 'auto'] }, () => [
      h(PdfTableRow, null, () => [h(PdfTableCell, { style: { paddingLeft: 15, paddingRight: 15 } }, () => 'alpha'), h(PdfTableCell, null, () => 'Y1')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'beta gamma'), h(PdfTableCell, null, () => 'Y2')]),
    ])])]))
    expect({ y1: run(parsed, 'Y1').x.toFixed(2), y2: run(parsed, 'Y2').x.toFixed(2), warnings })
      .toEqual({ y1: '94.46', y2: '57.77', warnings: [{ code: 'PDF_TABLE_COLUMNS_TOO_NARROW', pageNumber: 1, tableWidth: 30, neededWidth: 66.69 }] })
  })

  // Catches: 'auto' columns that shrink one after another (a min width that
  // freezes one), cut words, or a share column squeezed below its longest word.
  it('narrows the \'auto\' columns together, each by its share of the slack, and keeps a share column at its longest word', async () => {
    const first = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'
    const second = 'one two three four five six seven eight nine ten'
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 'auto', 1, '250pt'] }, () => [
      h(PdfTableRow, null, () => [cell(first), cell(second), cell('Supercalifragilistic'), cell('w')]),
    ])]))
    const page = parsed.pages[0]!
    const lines = (left: number, right: number) => page.textRuns.filter(item => item.x >= left && item.x < right).map(item => item.text)
    const share = run(parsed, 'Supercalifragilistic')
    const autoRight = share.x - 4
    expect(run(parsed, 'w').x).toBeCloseTo(CONTENT_RIGHT - 250 + 4, 2)
    expect(share.x + share.width + 4).toBeCloseTo(CONTENT_RIGHT - 250, 2)
    // Whole words on every line, in order.
    const start = run(parsed, 'one two three').x - 4
    expect(lines(0, start).join(' ')).toBe(first)
    expect(lines(start, autoRight).join(' ')).toBe(second)
    // Both 'auto' columns give up the same part of their slack (max − min);
    // a column that shrinks before the other gives other edges.
    expect([start, autoRight]).toEqual([expect.closeTo(141.005, 2), expect.closeTo(216.809, 2)])
  })

  // Catches: a table that fails, or an 'auto' column that stops at its
  // longest word and pushes the table wider than its box (review decision 1).
  it('narrows an \'auto\' column below its longest word, and the table stays in its box', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 'auto', '440pt'], style: { hyphens: 'auto' } }, () => [
      h(PdfTableRow, null, () => [cell('Extraordinary words'), cell('Unbelievable'), cell('w')]),
    ])]))
    const word = run(parsed, 'Unbelievable')
    expect(run(parsed, 'w').x).toBeCloseTo(CONTENT_RIGHT - 440 + 4, 2)
    // The one-word column has no slack and keeps its width; the other breaks its words.
    expect(word.x + word.width + 8).toBeCloseTo(CONTENT_RIGHT - 440 + 4, 2)
    expect(parsed.pages[0]!.textRuns.filter(item => item.x < word.x - 4).length).toBeGreaterThan(2)
  })

  // Catches: widths measured per page part, so the columns move from one
  // page to the next. The widest cell sits on the last page.
  it('gives every page the same column widths, from all rows and the header', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 1] }, () => [
      h(PdfTableHeader, null, () => [cell('No.'), cell('Item')]),
      ...Array.from({ length: 150 }, (_, index) => h(PdfTableRow, { key: index }, () => [
        cell(index === 149 ? 'Position 149' : String(index)),
        cell(`Row ${index}`),
      ])),
    ])]))
    expect(parsed.pageCount).toBeGreaterThanOrEqual(3)
    const widest = run(parsed, 'Position 149', parsed.pageCount - 1).width + 8
    for (const [index] of parsed.pages.entries()) {
      expect(run(parsed, 'Item', index).x, `page ${index + 1}`).toBeCloseTo(40 + widest + 4, 2)
    }
  })

  // Catches: a span that widens the columns it covers, or that does not get
  // their summed width in every row.
  it('gives a span over \'auto\' columns their summed width without widening them', async () => {
    const { parsed } = await render(doc(() => [h(PdfTable, { columns: ['auto', 'auto', 1] }, () => [
      h(PdfTableRow, null, () => [cell('Pos'), cell('Qty'), cell('c')]),
      h(PdfTableRow, null, () => [cell('a span with many words that wrap', { colspan: 2 }), cell('d')]),
    ])]))
    const columns = run(parsed, 'Pos').width + run(parsed, 'Qty').width + 16
    expect(run(parsed, 'c').x).toBeCloseTo(40 + columns + 4, 2)
    expect(run(parsed, 'd').x).toBeCloseTo(40 + columns + 4, 2)
    const spanLines = parsed.pages[0]!.textRuns.filter(item => item.x < 40 + columns && item.text.trim() !== '' && item.text !== 'Pos' && item.text !== 'Qty')
    expect(spanLines.map(item => item.text).join(' ')).toBe('a span with many words that wrap')
    expect(spanLines.length).toBeGreaterThan(1)
  })

  // Catches: a page token measured as its text on the first page ("1"), so
  // the column is too narrow for page 1000 (review decision 2).
  it('measures a page number in an \'auto\' column as four of the widest digit', async () => {
    const table = (first: () => unknown, last: string) => h(PdfTable, { columns: ['auto', 1] }, () => [
      h(PdfTableRow, null, () => [h(PdfTableCell, padded, first), cell(last)]),
    ])
    const { parsed } = await render(doc(() => [
      table(() => ['Page ', h(PdfPageNumber)], 'token'),
      table(() => 'Page 0000', 'literal'),
    ]))
    expect(run(parsed, 'token').x).toBeCloseTo(run(parsed, 'literal').x, 3)
  })

  // Catches: a warning per page or per column instead of per table, a page
  // that is not the table's first, and a warning for a table that fits
  // (review decision 1: narrow columns warn and render).
  // Needed: 'Extraordinary' and 'Unbelievable' with their padding (67.66 + 65.05) and 480 pt.
  it.each<{ label: string, before: number, fixed: PdfTableColumn, expected: PdfLayoutWarning[] }>([
    { label: 'too narrow, over three pages', before: 0, fixed: '480pt', expected: [{ code: 'PDF_TABLE_COLUMNS_TOO_NARROW', pageNumber: 1, tableWidth: 515.28, neededWidth: 612.71 }] },
    { label: 'too narrow, from page 2', before: 750, fixed: '480pt', expected: [{ code: 'PDF_TABLE_COLUMNS_TOO_NARROW', pageNumber: 2, tableWidth: 515.28, neededWidth: 612.71 }] },
    { label: 'wide enough', before: 0, fixed: '300pt', expected: [] },
  ])('warns once for a table narrower than the longest words of its columns: $label', async ({ before, fixed, expected }) => {
    const mounted = await mountPdfComponent(doc(() => [
      h(PdfView, { style: { height: before } }),
      h(PdfTable, { columns: ['auto', 'auto', fixed] }, () => Array.from({ length: 120 }, (_, index) => h(PdfTableRow, { key: index }, () => [
        cell('Extraordinary words'), cell('Unbelievable'), cell('w'),
      ]))),
    ]))
    try {
      const { layoutWarnings } = await renderPlainDocument(mounted.document)
      expect(layoutWarnings).toEqual(expected)
    }
    finally {
      mounted.unmount()
    }
  })

  // One row per branch of the measure that no other row reaches. Each 'auto'
  // column below holds "No" (padding 4); `second` is where the next column's
  // text must start when the branch works.
  const second = (parsed: ParsedPdf, extra = 0) => 40 + run(parsed, 'No').width + 8 + extra + 4
  it.each<{ label: string, content: () => VNode[], check: (parsed: ParsedPdf, warnings: readonly PdfLayoutWarning[]) => void }>([
    {
      // Catches: the cells of a nested table counted for the outer table (its
      // long label would widen the outer 'auto' column). In a width column,
      // whose cell takes no mark, so the walk reaches the nested cells.
      label: 'a nested table with its own \'auto\' columns keeps both widths',
      content: () => [h(PdfTable, { columns: ['auto', '300pt'] }, () => [h(PdfTableRow, null, () => [
        cell('No'),
        h(PdfTableCell, padded, () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [cell('A long nested label'), cell('x')])])]),
      ])])],
      check: (parsed) => {
        const label = run(parsed, 'A long nested label')
        expect(label.x).toBeCloseTo(second(parsed) + 4, 2)
        expect(run(parsed, 'x').x).toBeCloseTo(label.x + label.width + 8, 2)
      },
    },
    {
      // Catches: an absolute child counted in its cell's width.
      label: 'an absolute badge in a cell does not widen the column',
      content: () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, padded, () => [h(PdfText, null, () => 'No'), h(PdfView, { style: { position: 'absolute', top: 0, left: 0 } }, () => [h(PdfText, null, () => 'A wide absolute badge')])]),
        cell('next'),
      ])])],
      check: parsed => expect(run(parsed, 'next').x).toBeCloseTo(second(parsed), 2),
    },
    {
      // Catches: the margins of the texts in a cell left out (the text would
      // wrap at its space).
      label: 'a cell that is a column of texts with margins fits on one line',
      content: () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, padded, () => [h(PdfText, null, () => 'No'), h(PdfText, { style: { marginLeft: 6, marginRight: 6 } }, () => 'Consulting fee')]),
        cell('next'),
      ])])],
      check: (parsed) => {
        const text = run(parsed, 'Consulting fee')
        expect(run(parsed, 'next').x).toBeCloseTo(40 + text.width + 12 + 8 + 4, 2)
      },
    },
    {
      // Catches: the needed width without the room that a percentage column
      // takes (132.71 pt of longest words in the half the 50% column leaves:
      // without the widening, 132.71 pt fits the 200 pt table and no warning comes).
      label: 'the warning\'s needed width counts a percentage column',
      content: () => [h(PdfView, { style: { width: 200 } }, () => [h(PdfTable, { columns: ['auto', 'auto', '50%'] }, () => [h(PdfTableRow, null, () => [
        cell('Extraordinary words'), cell('Unbelievable'), cell('w'),
      ])])])],
      check: (_parsed, warnings) => expect(warnings).toEqual([{ code: 'PDF_TABLE_COLUMNS_TOO_NARROW', pageNumber: 1, tableWidth: 200, neededWidth: 265.42 }]),
    },
    {
      // Catches: a numeric maximum width ignored (the column would take the
      // text on one line, 'Consulting fee for the spring' is wider than 60 pt).
      label: 'a text with a maximum width counts as that width',
      content: () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, padded, () => [h(PdfText, { style: { maxWidth: 60 } }, () => 'Consulting fee for the spring')]),
        cell('next'),
      ])])],
      check: parsed => expect(run(parsed, 'next').x).toBeCloseTo(40 + 60 + 8 + 4, 2),
    },
    {
      // Catches: a numeric minimum width ignored (the column would be as wide
      // as "No", and the 70 pt text would run into the next column).
      label: 'a text with a minimum width counts as that width',
      content: () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, padded, () => [h(PdfText, { style: { minWidth: 70 } }, () => 'No')]),
        cell('next'),
      ])])],
      check: parsed => expect(run(parsed, 'next').x).toBeCloseTo(40 + 70 + 8 + 4, 2),
    },
    {
      // Catches: a note in a cell treated as unmeasurable (a typed layout
      // error); a note adds no width.
      label: 'a note in an \'auto\' cell renders and adds no width',
      content: () => [h(PdfTable, { columns: ['auto', 1] }, () => [h(PdfTableRow, null, () => [
        h(PdfTableCell, padded, () => [h(PdfText, null, () => 'No'), h(PdfNote, null, () => 'Reviewer note')]),
        cell('next'),
      ])])],
      check: parsed => expect(run(parsed, 'next').x).toBeCloseTo(second(parsed), 2),
    },
  ])('measures $label', async ({ content, check }) => {
    const mounted = await mountPdfComponent(doc(content))
    try {
      const result = await renderPlainDocument(mounted.document)
      check(await parsePdf(result.bytes), result.layoutWarnings)
    }
    finally {
      mounted.unmount()
    }
  })

  it.each([
    {
      // The internal props written by hand: the mount check of the table
      // components never sees this cell.
      label: 'content in an \'auto\' column that the mount check did not see',
      content: () => h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfText, null, () => 'a')]),
      columns: ['auto'],
      cells: [0],
      message: '<PdfView> with flexDirection \'row\' in an \'auto\' table column needs a width of its own, such as style width: \'80pt\'',
    },
    {
      label: 'a percentage padding in an \'auto\' column that the mount check did not see',
      content: () => h(PdfText, { style: { paddingLeft: '10%' } }, () => 'a'),
      columns: ['auto'],
      cells: [0],
      message: '<PdfText> in an \'auto\' table column has paddingLeft "10%"',
    },
    {
      label: 'a percentage width in an \'auto\' column that the mount check did not see',
      content: () => h(PdfText, { style: { width: '50%' } }, () => 'a'),
      columns: ['auto'],
      cells: [0],
      message: '<PdfText> with width "50%" in an \'auto\' table column needs a width of its own',
    },
    {
      label: 'a view marked with a column its table does not have',
      content: () => h(PdfText, null, () => 'x'),
      columns: ['auto', 1],
      cells: [2],
      message: '<PdfView> takes column 3 of a table with 2 columns.',
    },
  ])('fails with a typed layout error for $label', async ({ content, columns, cells, message }) => {
    await expect(render(doc(() => [h(PdfView, { [PDF_TABLE_COLUMNS_PROP]: columns }, () => [
      h(PdfView, { style: { flexDirection: 'row' } }, () => [h(PdfView, { [PDF_TABLE_CELL_PROP]: cells }, () => [content()])]),
    ])]))).rejects.toMatchObject({ code: 'PDF_LAYOUT_ERROR', message: expect.stringContaining(message) })
  })
})

// Body lines that fill three pages under an optional flow header.
const bodyLines = () => Array.from({ length: 150 }, (_, index) =>
  h(PdfText, { key: index }, () => `Line ${index}`))

const HEAD = { style: { fontSize: 14, paddingBottom: 20 } } as const

describe('fixed content with pages', () => {
  // A section view that runs over three pages, with an optional flow head.
  const section = (head?: VNode) => doc(() => [
    h(PdfView, null, () => [...(head ? [head] : []), ...bodyLines()]),
  ])

  // Catches: a continuation head on the parent's first page, or one that still
  // takes space there (the page builder knows the first page while it fills;
  // today's path broke up to one head height earlier, D15).
  it('shows a continuation head on pages 2 and 3 only, with no space on page 1', async () => {
    const plain = await render(section())
    const headed = await render(section(h(PdfText, { ...HEAD, fixed: true, pages: 'continuation' }, () => 'Running head')))
    const always = await render(section(h(PdfText, { ...HEAD, fixed: true }, () => 'Running head')))

    expect(headed.parsed.pageCount).toBe(3)
    expect(pagesWith(headed.parsed, 'Running head')).toEqual([2, 3])
    expect(headed.passes).toBe(1)

    // Page 1 is laid out exactly like the section without a head.
    const page = (parsed: ParsedPdf, index: number) => parsed.pages[index]!.textRuns.filter(run => run.text.startsWith('Line ')).map(run => [run.text, run.y])
    expect(page(headed.parsed, 0)).toEqual(page(plain.parsed, 0))
    // Page 2 is laid out like an always-shown head: same head and first line position.
    // (No line is squeezed: upstream would shrink page 2 to its earlier height.)
    const firstLine = (parsed: ParsedPdf) => parsed.pages[1]!.textRuns.find(candidate => candidate.text.startsWith('Line '))!.y
    expect(runsOf(headed.parsed, 'Running head')[1]![0]!.y).toBe(runsOf(always.parsed, 'Running head')[1]![0]!.y)
    expect(firstLine(headed.parsed)).toBe(firstLine(always.parsed))
    const lastLine = (parsed: ParsedPdf) => parsed.pages[1]!.textRuns.filter(run => run.text.startsWith('Line ')).at(-1)!.y
    expect(lastLine(headed.parsed)).toBe(lastLine(always.parsed))
    // Every line is printed once.
    const lines = headed.parsed.pages.flatMap(page => page.textItems.filter(item => item.startsWith('Line ')))
    expect(lines).toHaveLength(150)
  })

  // Catches: a form taking the earlier rules, where page 1 breaks up to one
  // head height earlier. A form field is placed whole, like an image.
  it('keeps page 1 of a form free of a continuation head\'s space', async () => {
    const form = (head?: VNode) => doc(() => [h(PdfView, null, () => [
      ...(head ? [head] : []),
      h(PdfTextField, { name: 'reference', style: { width: 200, height: 20 } }),
      ...bodyLines(),
    ])])
    const plain = await render(form())
    const headed = await render(form(h(PdfText, { ...HEAD, fixed: true, pages: 'continuation' }, () => 'Running head')))

    const page = (parsed: ParsedPdf) => parsed.pages[0]!.textRuns.filter(run => run.text.startsWith('Line ')).map(run => [run.text, run.y])
    expect(page(headed.parsed)).toEqual(page(plain.parsed))
  })

  // A consumer shape: an absolute running head with a page number, from page 2 on.
  it('keeps the offsets of an absolute head and prints its page number', async () => {
    const head = (pages?: 'continuation') => h(PdfText, {
      fixed: true,
      ...(pages ? { pages } : {}),
      style: { position: 'absolute', top: 14, right: 40, fontSize: 8 },
    }, () => ['Offer 7 · ', h(PdfPageNumber)])
    const plain = await render(doc(bodyLines))
    const headed = await render(doc(() => [head('continuation'), ...bodyLines()]))
    const always = await render(doc(() => [head(), ...bodyLines()]))

    expect(headed.parsed.pages.map(page => page.text)).toEqual(always.parsed.pages.map(page =>
      page.number === 1 ? page.text.replace('Offer 7 · 1', '').trim() : page.text))
    expect(headed.parsed.pages[0]!.text).not.toContain('Offer 7')
    expect(runsOf(headed.parsed, 'Line 0')[0]![0]!.y).toBe(runsOf(plain.parsed, 'Line 0')[0]![0]!.y)
    expect(headed.parsed.pages[1]!.text).toContain('Offer 7 · 2')
    expect(headed.parsed.pages[2]!.text).toContain('Offer 7 · 3')
    const position = (parsed: ParsedPdf) => {
      const run = parsed.pages[1]!.textRuns.find(candidate => candidate.text.startsWith('Offer 7'))!
      return [run.x, run.y]
    }
    expect(position(headed.parsed)).toEqual(position(always.parsed))
  })

  // Catches: a first-page head printed or leaving a gap on a later page. The
  // page builder knows the parent's first page while it fills, so one pass is
  // enough (today's path needed a second one for an in-flow head).
  it('shows a first-page head on the first page of its parent only', async () => {
    const plain = await render(doc(bodyLines))
    const headed = await render(doc(() => [
      h(PdfText, { ...HEAD, fixed: true, pages: 'first' }, () => 'Cover head'),
      ...bodyLines(),
    ]))
    const absolute = await render(doc(() => [
      h(PdfText, { fixed: true, pages: 'first', style: { position: 'absolute', top: 14, right: 40 } }, () => 'Cover head'),
      ...bodyLines(),
    ]))

    expect(pagesWith(headed.parsed, 'Cover head')).toEqual([1])
    expect(headed.passes).toBe(1)
    const firstLineY = (parsed: ParsedPdf) =>
      parsed.pages[1]!.textRuns.find(run => run.text.startsWith('Line '))!.y
    expect(firstLineY(headed.parsed)).toBe(firstLineY(plain.parsed))
    expect(pagesWith(absolute.parsed, 'Cover head')).toEqual([1])
    expect(absolute.passes).toBe(1)
  })

  // Without the first page from the previous pass, the sizing call cannot
  // tell where the parent starts, so every later page broke as if the head
  // were there. Catches: a later page sized with the head, so it ends up to
  // one head height early and the content after it moves to the next page.
  it('lays out later pages of a first-page head like the document without it', async () => {
    const lineYs = (parsed: ParsedPdf) => parsed.pages.map(page =>
      page.textRuns.filter(run => run.text.startsWith('Line ')).map(run => run.y))
    const plain = lineYs((await render(section())).parsed)
    const always = lineYs((await render(section(h(PdfText, { ...HEAD, fixed: true }, () => 'Head')))).parsed)
    const headed = await render(section(h(PdfText, { ...HEAD, fixed: true, pages: 'first' }, () => 'Head')))
    const ys = lineYs(headed.parsed)

    // One pass: the parent's first page is known while the pages fill.
    expect(headed.passes).toBe(1)
    expect(ys).toHaveLength(plain.length)
    expect(ys[0]).toEqual(always[0])
    // Every later page is filled on the same lines as a full page without
    // the head; only the last page ends early.
    const fullPage = plain[1]!
    ys.slice(1, -1).forEach(page => expect(page).toEqual(fullPage))
    expect(ys.at(-1)).toEqual(fullPage.slice(0, ys.at(-1)!.length))
  })

  // Several parents, each with a page-conditional head. Catches the parent's
  // first page coming from a previous pass: each pass then corrected only the
  // next parent, and these documents failed after 5 passes on today's path.
  it.each([
    { pages: 'first', sections: [23, 3, 4, 16, 19, 3, 12, 4, 13, 20, 17, 26], passes: 1 },
    { pages: 'first', sections: [9, 25, 16, 14, 26, 4, 22, 22, 23, 6, 3, 20], passes: 1 },
    { pages: 'continuation', sections: [23, 3, 4, 16, 19, 3, 12, 4, 13, 20, 17, 26], passes: 1 },
    { pages: 'continuation', sections: [9, 25, 16, 14, 26, 4, 22, 22, 23, 6, 3, 20], passes: 1 },
  ] as const)('converges with a $pages head in each of 12 sections', async ({ pages, sections, passes }) => {
    const result = await render(defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
      h(PdfPage, { size: [200, 200], style: { padding: 0, fontSize: 8 } }, () => sections.map((lines, section) =>
        h(PdfView, { key: section }, () => [
          h(PdfText, { fixed: true, pages, style: { height: 20 } }, () => `Head ${section}`),
          ...Array.from({ length: lines }, (_, line) =>
            h(PdfText, { key: line, style: { height: 10 } }, () => `s${section} line ${line}`)),
        ]))))))

    expect(result.passes).toBe(passes)
    sections.forEach((_, section) => {
      const sectionPages = result.parsed.pages
        .filter(page => page.textItems.some(item => item.startsWith(`s${section} line `)))
        .map(page => page.number)
      const expected = pages === 'first' ? sectionPages.slice(0, 1) : sectionPages.slice(1)
      expect(pagesWith(result.parsed, `Head ${section}`)).toEqual(expected)
    })
  })

  // A not-last node takes its room on every page of its parent, the last one
  // included, where that room stays empty: whether a page is the last is known
  // only after it is filled (CONFORMANCE, `pages`). Catches a last page filled
  // into that room: with k lines per page under the node, 3k + 1 lines take a
  // fourth page for the last line, where filling into the room would end on
  // page 3.
  it.each([
    { where: 'a page head', content: (node: VNode, lines: VNode[]) => [node, ...lines] },
    { where: 'a foot after the flow of a view', content: (node: VNode, lines: VNode[]) => [h(PdfView, null, () => [...lines, node])] },
  ])('reserves the room of a not-last node as $where on the last page too', async ({ content }) => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => h(PdfText, { key: index }, () => `Line ${index}`))
    const node = (pages?: 'not-last') => h(PdfText, { ...HEAD, fixed: true, ...(pages ? { pages } : {}) }, () => 'Carried')
    const always = await render(doc(() => content(node(), lines(150))))
    const perPage = always.parsed.pages[0]!.textItems.filter(item => item.startsWith('Line ')).length
    const notLast = await render(doc(() => content(node('not-last'), lines(3 * perPage + 1))))

    expect(notLast.passes).toBe(1)
    expect(notLast.parsed.pageCount).toBe(4)
    expect(pagesWith(notLast.parsed, 'Carried')).toEqual([1, 2, 3])
    expect(notLast.parsed.pages[3]!.textItems.filter(item => item.startsWith('Line '))).toEqual([`Line ${3 * perPage}`])
  })

  // The last part can also be one a split made: the view's last 50 lines fit
  // on page 3, its bottom padding does not and moves on, but no flow does.
  // Catches a not-last node painted on that part.
  it('leaves the room of a not-last node empty on a last part that a split made', async () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => h(PdfText, { key: index }, () => `Line ${index}`))
    const content = (pages: 'not-last' | undefined, count: number) => [h(PdfView, { style: { paddingBottom: 300 } }, () => [
      ...lines(count),
      h(PdfText, { ...HEAD, fixed: true, ...(pages ? { pages } : {}) }, () => 'Carried'),
    ])]
    const always = await render(doc(() => content(undefined, 150)))
    const perPage = always.parsed.pages[0]!.textItems.filter(item => item.startsWith('Line ')).length
    const notLast = await render(doc(() => content('not-last', 2 * perPage + 50)))

    expect(notLast.parsed.pages[2]!.textItems).toContain(`Line ${2 * perPage + 49}`)
    expect(pagesWith(notLast.parsed, 'Carried')).toEqual([1, 2])
  })

  // Catches: comparing with the document's page 1 instead of the parent's
  // first page. The table starts on page 2 and continues on page 3.
  it('counts continuation pages from the first page of the parent view', async () => {
    const { parsed } = await render(doc(() => [
      h(PdfText, null, () => 'Intro'),
      h(PdfTable, { columns: [1], break: true }, () => [
        h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Item')]),
        h(PdfText, { fixed: true, pages: 'continuation' }, () => 'continued'),
        ...Array.from({ length: 80 }, (_, index) => h(PdfTableRow, { key: index }, () => [
          h(PdfTableCell, null, () => `Row ${index}`),
        ])),
      ]),
    ]))

    const tablePages = pagesWith(parsed, 'Item')
    expect(tablePages).toEqual([2, 3])
    expect(pagesWith(parsed, 'continued')).toEqual(tablePages.slice(1))
  })

  it.each([
    {
      label: 'pages without fixed',
      content: () => [h(PdfView, null, () => [h(PdfText, { pages: 'continuation' }, () => 'x')])],
      message: '<PdfText> "pages" requires "fixed".',
    },
    {
      label: 'pages on a nested text',
      content: () => [h(PdfText, null, () => ['a ', h(PdfText, { fixed: true, pages: 'first' }, () => 'b')])],
      message: '"pages" is not supported on a <PdfText> nested inside another <PdfText>.',
    },
    {
      label: 'pages on a text deeper inside a text',
      content: () => [h(PdfText, null, () => ['a ', h(PdfLink, { href: 'https://example.com' }, () => [
        h(PdfText, { fixed: true, pages: 'continuation' }, () => 'b'),
      ])])],
      message: '"pages" is not supported on a <PdfText> nested inside another <PdfText>.',
    },
    {
      label: 'an unknown pages value',
      content: () => [h(PdfView as Component, { fixed: true, pages: 'odd' })],
      message: '<PdfView> requires "pages" to be "all", "first", "continuation" or "not-last".',
    },
    {
      label: 'an image inside a page-conditional node',
      content: () => [h(PdfView, null, () => [h(PdfView, { fixed: true, pages: 'continuation' }, () => [
        h(PdfImage, { src: new Uint8Array([1]) }),
      ])])],
      message: 'may contain only <PdfView>, <PdfText> and page tokens; found <PdfImage>.',
    },
    {
      label: 'nested page-conditional nodes',
      content: () => [h(PdfView, null, () => [h(PdfView, { fixed: true, pages: 'continuation' }, () => [
        h(PdfText, { fixed: true, pages: 'first' }, () => 'x'),
      ])])],
      message: 'cannot be nested inside another node with "pages".',
    },
  ])('rejects $label', async ({ content, message }) => {
    await expect(mountPdfComponent(doc(content))).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: expect.stringContaining(message),
    })
  })
})
