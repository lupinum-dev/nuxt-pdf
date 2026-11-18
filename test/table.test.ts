import { defineComponent, h, type Component, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import type { PdfStyleValue } from '../src/runtime/authoring'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../src/test/pdf'

installPdfCanvasGlobals()

const {
  PdfDocument,
  PdfImage,
  PdfLink,
  PdfPage,
  PdfPageNumber,
  PdfTable,
  PdfTableCell,
  PdfTableHeader,
  PdfTableRow,
  PdfText,
  PdfView,
} = PDF_COMPONENTS

// A4 with 40 pt padding: content box 515.28 × 761.89 pt.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const

const doc = (content: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, content)))

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

  // Catches: an orphan header (header alone at a page bottom). The spacer
  // leaves room for the header but not for the first row under it.
  it('moves a table to the next page instead of leaving its header alone', async () => {
    const { parsed, passes } = await render(lineTable(5, { spacer: 745 }))

    expect(pagesWith(parsed, 'Item')).toEqual([2])
    expect(pagesWith(parsed, 'Row 0')).toEqual([2])
    expect(passes).toBe(2)
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
      message: '<PdfTable> requires "columns"',
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
        h(PdfTableCell as Component, { rowspan: 2 }, () => 'x'),
      ])])],
      message: 'Unsupported prop "rowspan" on <PdfTableCell>.',
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
  // takes space there.
  it('shows a continuation head on pages 2 and 3 only, with no space on page 1', async () => {
    const plain = await render(section())
    const headed = await render(section(h(PdfText, { ...HEAD, fixed: true, pages: 'continuation' }, () => 'Running head')))
    const always = await render(section(h(PdfText, { ...HEAD, fixed: true }, () => 'Running head')))

    expect(headed.parsed.pageCount).toBe(3)
    expect(pagesWith(headed.parsed, 'Running head')).toEqual([2, 3])
    expect(headed.passes).toBe(1)

    // Page 1 starts exactly like the section without a head.
    expect(runsOf(headed.parsed, 'Line 0')[0]![0]!.y).toBe(runsOf(plain.parsed, 'Line 0')[0]![0]!.y)
    // Page 2 is laid out like an always-shown head: same head and first line.
    // (No line is squeezed: upstream would shrink page 2 to its earlier height.)
    const firstLine = (parsed: ParsedPdf) => {
      const run = parsed.pages[1]!.textRuns.find(candidate => candidate.text.startsWith('Line '))!
      return [run.text, run.y]
    }
    expect(runsOf(headed.parsed, 'Running head')[1]![0]!.y).toBe(runsOf(always.parsed, 'Running head')[1]![0]!.y)
    expect(firstLine(headed.parsed)).toEqual(firstLine(always.parsed))
    const lastLine = (parsed: ParsedPdf) => parsed.pages[1]!.textRuns.filter(run => run.text.startsWith('Line ')).at(-1)!.y
    expect(lastLine(headed.parsed)).toBe(lastLine(always.parsed))
    // Every line is printed once.
    const lines = headed.parsed.pages.flatMap(page => page.textItems.filter(item => item.startsWith('Line ')))
    expect(lines).toHaveLength(150)
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
  // head is on the right page in pass 1; the second pass of an in-flow head
  // only removes its space from the later pages. An absolute head needs none.
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
    expect(headed.passes).toBe(2)
    const firstLineY = (parsed: ParsedPdf) =>
      parsed.pages[1]!.textRuns.find(run => run.text.startsWith('Line '))!.y
    expect(firstLineY(headed.parsed)).toBe(firstLineY(plain.parsed))
    expect(pagesWith(absolute.parsed, 'Cover head')).toEqual([1])
    expect(absolute.passes).toBe(1)
  })

  // Several parents, each with a page-conditional head. Catches the parent's
  // first page coming from the previous pass: each pass then corrected only
  // the next parent, and these documents failed after 5 passes.
  it.each([
    { pages: 'first', sections: [23, 3, 4, 16, 19, 3, 12, 4, 13, 20, 17, 26], passes: 2 },
    { pages: 'first', sections: [9, 25, 16, 14, 26, 4, 22, 22, 23, 6, 3, 20], passes: 2 },
    { pages: 'continuation', sections: [23, 3, 4, 16, 19, 3, 12, 4, 13, 20, 17, 26], passes: 2 },
    { pages: 'continuation', sections: [9, 25, 16, 14, 26, 4, 22, 22, 23, 6, 3, 20], passes: 2 },
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
      message: '<PdfView> requires "pages" to be "all", "first" or "continuation".',
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
