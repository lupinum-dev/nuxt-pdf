import { Direction, FlexDirection, loadYoga, type Node } from 'yoga-layout/load'
import { describe, expect, it } from 'vitest'
import type { PdfTableColumnWidth } from '../src/runtime/primitives'
import { measureColumns, tableColumnStyles, type TableCellMeasure, type TableCellStyle } from '../src/runtime/shared/table-columns'

// The styles go through the yoga build and settings the layout uses
// (layout/dimensions/yoga.ts, setters.ts), so the test proves the widths the
// one yoga pass gives, not the formulas.
const COLUMNS: readonly PdfTableColumnWidth[] = ['auto', 1, '40pt', 'auto']
// The width column is not measured: its view keeps the table component's style.
const { cell: widthStyle } = tableColumnStyles(['40pt'], COLUMNS, {})
const WIDTH_COLUMN = { width: Number.parseFloat(String(widthStyle.width)), flexShrink: widthStyle.flexShrink ?? 1 }

// Each row as cell views in order: measured cells, and the width column
// (index 2) where a row takes it alone. Rows 2 to 4 hold spans.
const ROWS: readonly (readonly (TableCellMeasure | 'width')[])[] = [
  [
    { columns: [0], maxContent: 120, minContent: 40 },
    { columns: [1], maxContent: 300, minContent: 60 },
    'width',
    { columns: [3], maxContent: 80, minContent: 50 },
  ],
  // A span does not widen the columns it covers, however wide its content.
  [{ columns: [0, 1], maxContent: 900, minContent: 200 }, 'width', { columns: [3], maxContent: 30, minContent: 30 }],
  [{ columns: [0], maxContent: 10, minContent: 10 }, { columns: [1, 2], maxContent: 0, minContent: 0 }, { columns: [3], maxContent: 0, minContent: 0 }],
  [{ columns: [0], maxContent: 0, minContent: 0 }, { columns: [1], maxContent: 0, minContent: 0 }, { columns: [2, 3], maxContent: 0, minContent: 0 }],
]

/** The right edges of the cell views of one row laid out at `width`. */
const edgesOf = async (styles: readonly (TableCellStyle | typeof WIDTH_COLUMN)[], width: number): Promise<number[]> => {
  const yoga = await loadYoga()
  const config = yoga.Config.create()
  config.setPointScaleFactor(0)
  const row = yoga.Node.createWithConfig(config)
  row.setFlexDirection(FlexDirection.Row)
  row.setWidth(width)
  const cells = styles.map((style, index): Node => {
    const cell = yoga.Node.createWithConfig(config)
    if ('width' in style) cell.setWidth(style.width)
    else {
      cell.setFlexBasis(style.flexBasis)
      cell.setFlexGrow(style.flexGrow)
    }
    cell.setFlexShrink(style.flexShrink)
    row.insertChild(cell, index)
    return cell
  })
  row.calculateLayout(width, undefined, Direction.LTR)
  const edges = cells.map(cell => cell.getComputedLeft() + cell.getComputedWidth())
  row.freeRecursive()
  config.free()
  return edges
}

describe('measureColumns', () => {
  const measured = ROWS.flat().filter(cell => cell !== 'width')
  const { cells, minWidth } = measureColumns(COLUMNS, measured, length => Number.parseFloat(length))
  const stylesOf = (row: readonly (TableCellMeasure | 'width')[]) =>
    row.map(cell => cell === 'width' ? WIDTH_COLUMN : cells[measured.indexOf(cell)]!)

  it('needs the min-contents and widths of the columns', () => {
    expect(minWidth).toBe(40 + 60 + 40 + 50)
  })

  // Max-contents 120 and 80 with slacks 80 and 30; the share has its
  // min-content 60 as basis. Every row has the same column edges.
  it.each([
    { label: 'wider than the max-contents: the share takes the rest', width: 400, columns: [120, 160, 40, 80] },
    { label: 'the max-contents', width: 300, columns: [120, 60, 40, 80] },
    { label: 'between: the auto columns shrink in proportion to their slack', width: 245, columns: [80, 60, 40, 65] },
    { label: 'the min-contents', width: 190, columns: [40, 60, 40, 50] },
    { label: 'narrower: the auto columns keep shrinking, the words overflow', width: 168, columns: [24, 60, 40, 44] },
  ])('gives every row the same column edges at a table width of $width pt ($label)', async ({ width, columns }) => {
    const edges = columns.map((_, index) => columns.slice(0, index + 1).reduce((total, column) => total + column, 0))
    const [first, ...spans] = await Promise.all(ROWS.map(row => edgesOf(stylesOf(row), width)))
    expect(first!.map(edge => Math.round(edge * 1000) / 1000)).toEqual(edges)
    for (const [index, row] of spans.entries()) {
      const covered = ROWS[index + 1]!.map(cell => cell === 'width' ? 2 : cell.columns.at(-1)!)
      expect(row.map(edge => Math.round(edge * 1000) / 1000), `row ${index + 2}`).toEqual(covered.map(column => edges[column]))
    }
  })
})
