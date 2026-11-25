// The column rules of tables, in one place: where a cell goes (`placeCell`),
// the styles the table
// components give a cell over its columns at mount (`tableColumnStyles`), and
// the measure step of 'auto' columns (`measureColumns`, D39),
// which turns measured content widths into flex styles so that the one yoga
// pass that runs anyway gives every column its width. Pure and without Vue:
// the components import it, and so does the layout, whose render worker
// loads no Vue code. The layout's hook (`withMeasuredColumns`,
// server/engine/layout/dimensions/table-columns.ts, before yoga) reads the
// column list from `PDF_TABLE_COLUMNS_PROP` on the table view and the column
// indices from `PDF_TABLE_CELL_PROP` on each measured view, measures each
// such view's content with the text layout, and writes the styles below into
// those views.
import type { PdfLengthUnit, PdfPercentage, PdfStyle, PdfUnitLength } from '../authoring'
import type { PdfTableColumnWidth } from '../primitives'
import { treeInvalid } from './errors'
import { PDF_LENGTH_UNITS } from './style-values'
import { pdfSourceOf } from './template'

/** A column whose width the measure step sets from content: `'auto'`, or a share in a table with `'auto'` columns. */
const isMeasured = (column: PdfTableColumnWidth): column is 'auto' | number => column === 'auto' || typeof column === 'number'

// Lengths the engine converts to points with a fixed factor. `px` depends on
// the page dpi, `rem` on the root font size, `vw`/`vh` on the page.
const POINTS_PER_UNIT: Partial<Record<PdfLengthUnit, number>> = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }

type Length = { value: number, unit: PdfLengthUnit }

/** A width column such as `'80pt'`; `isPdfTableColumnWidth` already matched its form. */
const parseLength = (column: PdfUnitLength): Length => ({
  value: Number.parseFloat(column),
  unit: PDF_LENGTH_UNITS.find(unit => column.endsWith(unit))!,
})

const isPercentage = (column: PdfUnitLength | PdfPercentage): column is PdfPercentage => column.endsWith('%')

const formatLength = ({ value, unit }: Length): PdfUnitLength => `${value}${unit}`

/** One length from lengths that add up: one unit, or absolute units in `pt`. */
const addLengths = (lengths: readonly Length[], attrs: Record<string, unknown>): Length => {
  const units = [...new Set(lengths.map(length => length.unit))]
  const sum = (toNumber: (length: Length) => number) =>
    lengths.reduce((total, length) => total + toNumber(length), 0)
  if (units.length === 1) return { value: sum(length => length.value), unit: units[0]! }
  if (units.every(unit => POINTS_PER_UNIT[unit] !== undefined)) {
    return { value: sum(length => length.value * POINTS_PER_UNIT[length.unit]!), unit: 'pt' }
  }
  return treeInvalid(`<PdfTableCell> spans columns in ${units.map(unit => `"${unit}"`).join(' and ')}; their widths cannot be added. Use one unit for the columns it spans.`, pdfSourceOf(attrs))
}

const fixedWidth = (width: PdfUnitLength | PdfPercentage): PdfStyle => ({ width, flexShrink: 0 })

type ColumnStyles = { wrapper?: PdfStyle, cell: PdfStyle, spansUnits?: true }

/**
 * Style of a cell over its columns: a share is a flex grow, a width a fixed
 * basis. A row gives each cell its basis plus `free width × grow / Σgrow`, so
 * a cell with the summed basis and the summed shares of the columns it spans
 * gets exactly their width.
 *
 * Two cases need a wrapper that takes the columns, with the visible cell
 * growing inside it:
 * - Only shares: the engine keeps a cell's padding as its smallest basis, so a
 *   padded cell with basis 0 would take its padding on top of its share. The
 *   wrapper has no padding.
 * - Percentages and lengths, which do not add up in one value: the wrapper
 *   takes the percentages, the shares and, as a right margin, the lengths, and
 *   a negative right margin widens the cell over that margin (`spansUnits`).
 */
const columnStyles = (columns: readonly PdfTableColumnWidth[], attrs: Record<string, unknown>): ColumnStyles => {
  let shares = 0
  let percent = 0
  const lengths: Length[] = []
  for (const column of columns) {
    // The layout sets the width of an 'auto' column (`measureColumns`).
    if (column === 'auto') continue
    if (typeof column === 'number') shares += column
    else if (isPercentage(column)) percent += Number.parseFloat(column)
    else lengths.push(parseLength(column))
  }
  const length = lengths.length > 0 ? addLengths(lengths, attrs) : undefined
  const percentage: PdfPercentage | undefined = percent > 0 ? `${percent}%` : undefined
  if (percentage !== undefined && length !== undefined) {
    return {
      wrapper: { ...fixedWidth(percentage), flexGrow: shares, marginRight: formatLength(length) },
      cell: { flexGrow: 1, marginRight: formatLength({ ...length, value: -length.value }) },
      spansUnits: true,
    }
  }
  const fixed = percentage ?? (length && formatLength(length))
  return fixed === undefined
    ? { wrapper: { flexGrow: shares, flexShrink: 1, flexBasis: 0 }, cell: { flexGrow: 1 } }
    : { cell: { ...fixedWidth(fixed), flexGrow: shares } }
}

/**
 * The styles of a view over `columns` of a table with the columns `declared`,
 * and whether the measure step sets its width (`measured`). In a table with
 * 'auto' columns, a view over an 'auto' or share column has no wrapper: it
 * carries `PDF_TABLE_CELL_PROP` itself, and the measure step replaces its flex
 * styles and drops its widths, so the column wins over the author's style. A
 * percentage and a measured width do not add up before layout, so such a view
 * must not span a percentage column.
 */
export const tableColumnStyles = (
  columns: readonly PdfTableColumnWidth[],
  declared: readonly PdfTableColumnWidth[],
  attrs: Record<string, unknown>,
): ColumnStyles & { measured: boolean } => {
  const measured = declared.includes('auto') && columns.some(isMeasured)
  if (measured && columns.some(column => typeof column === 'string' && column !== 'auto' && isPercentage(column))) {
    treeInvalid('<PdfTableCell> spans a percentage column and an \'auto\' or share column of a table with \'auto\' columns: a percentage and a measured width cannot be added before layout. Give the percentage column a length, or do not span it.', pdfSourceOf(attrs))
  }
  const styles = columnStyles(columns, attrs)
  return measured ? { cell: styles.wrapper ?? styles.cell, measured } : { ...styles, measured }
}

/**
 * Where a cell over `span` columns goes in its row, by the one rule of
 * `PdfTable` and rich text tables: at the first column from `from` (where the
 * row's previous cell ends) that no row span from above takes (`taken`). `fits`
 * is how many of its columns are free in a row from there: less than `span`
 * when a row span from above takes one of them. `PdfTable` fails then; a rich
 * text table cuts the span to `fits`, as a browser does.
 */
export const placeCell = (from: number, span: number, taken: (column: number) => boolean): { start: number, fits: number } => {
  let start = from
  while (taken(start)) start += 1
  let fits = 0
  while (fits < span && !taken(start + fits)) fits += 1
  return { start, fits }
}

/** One cell view of the table: the columns it takes and the width of its content, in points. */
export type TableCellMeasure = {
  /** Consecutive column indices, as `PDF_TABLE_CELL_PROP` holds them. */
  columns: readonly number[]
  /**
   * The width of the content on one line: text without breaks, page tokens
   * as four of the widest digit. Padding, borders and margins of the visible
   * cell count.
   */
  maxContent: number
  /** The widest piece that cannot break (a word, without hyphenation). At most `maxContent`. */
  minContent: number
  /**
   * For a cell over several columns: its own horizontal padding, border and
   * margins. yoga never makes a box narrower than its padding and border, so
   * the measured columns it covers get at least this width together.
   */
  edges?: number
}

/** The flex styles of one cell view, in points. */
export type TableCellStyle = {
  flexBasis: number
  flexGrow: number
  flexShrink: number
}

type TableColumnsMeasure = {
  /** The style of each cell, in the order of the input. */
  cells: TableCellStyle[]
  /**
   * The width below which the columns cut words (their min-contents and
   * widths, without percentage columns). The layout compares it with the
   * table and warns.
   */
  minWidth: number
}

/** What one column adds to a cell view that takes it. */
type ColumnPart = {
  basis: number
  /** The scaled shrink yoga gives it: shrink factor × basis. */
  slack: number
  grow: number
}

/**
 * The flex styles that give each column its width in one yoga pass:
 * - an 'auto' column has its max-content as basis and a scaled shrink of
 *   max − min, so all 'auto' columns shrink in proportion to their slack and
 *   reach their min-content at the same table width; no minWidth, so yoga
 *   never freezes one before another;
 * - a share column has its min-content as basis and grows by its share;
 * - a width column has its width;
 * - a cell over several columns has the sums: basis and scaled shrink are
 *   linear, so it is as wide as the columns it covers in every row.
 * Only cells over one column count for the width of a column: a span gets
 * the sum of its columns and wraps inside it. Its own padding, border and
 * margins (`edges`) do count: the measured columns it covers share what they
 * lack of them, as least width, so the span never pushes the cells after it.
 *
 * `points` converts a length column, which only the layout can do for
 * relative units. A cell must not take a percentage column (the table
 * component rejects such a cell at mount).
 */
export const measureColumns = (
  columns: readonly PdfTableColumnWidth[],
  cells: readonly TableCellMeasure[],
  points: (length: PdfUnitLength) => number,
): TableColumnsMeasure => {
  const max = columns.map(() => 0)
  const min = columns.map(() => 0)
  for (const cell of cells) {
    const [index] = cell.columns
    if (cell.columns.length !== 1 || index === undefined) continue
    max[index] = Math.max(max[index]!, cell.maxContent)
    min[index] = Math.max(min[index]!, cell.minContent)
  }
  for (const cell of cells) {
    if (cell.columns.length < 2 || cell.edges === undefined) continue
    const measured = cell.columns.filter(index => isMeasured(columns[index]!))
    const lengths = cell.columns.reduce((sum, index) => {
      const column = columns[index]!
      return isMeasured(column) || isPercentage(column) ? sum : sum + points(column)
    }, 0)
    const lacking = cell.edges - lengths - measured.reduce((sum, index) => sum + min[index]!, 0)
    if (lacking <= 0 || measured.length === 0) continue
    for (const index of measured) {
      min[index] = min[index]! + lacking / measured.length
      max[index] = Math.max(max[index]!, min[index]!)
    }
  }
  const parts = columns.map((column, index): ColumnPart | undefined => {
    if (column === 'auto') return { basis: max[index]!, slack: max[index]! - min[index]!, grow: 0 }
    if (typeof column === 'number') return { basis: min[index]!, slack: 0, grow: column }
    return isPercentage(column) ? undefined : { basis: points(column), slack: 0, grow: 0 }
  })
  const styles = cells.map((cell): TableCellStyle => {
    let basis = 0
    let slack = 0
    let grow = 0
    for (const index of cell.columns) {
      const part = parts[index]
      if (part === undefined) throw new Error(`A measured table cell takes column ${index + 1}, a percentage column.`)
      basis += part.basis
      slack += part.slack
      grow += part.grow
    }
    return slack > 0
      ? { flexBasis: basis, flexGrow: grow, flexShrink: slack / basis }
      : { flexBasis: basis, flexGrow: grow, flexShrink: 0 }
  })
  const minWidth = columns.reduce<number>((total, column, index) => {
    const part = parts[index]
    if (part === undefined) return total
    return total + (column === 'auto' ? min[index]! : part.basis)
  }, 0)
  return { cells: styles, minWidth }
}
