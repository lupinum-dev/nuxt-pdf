// Where the cells of a rich text table go: one column count and one span
// rule for the mapping (which repairs spans that do not fit, as a browser
// does) and the model check (which reports them). The placement is the one
// of `PdfTable` (`placeCell`).

import { placeCell } from '../shared/table-columns'
import type { PdfRichTableCell } from './types'

/** Columns in one rich text table at most. */
export const MAX_RICH_TABLE_COLUMNS = 64

/** A span that does not fit: the cell at `rows[row][cell]` fits `fits` columns or rows. */
export interface RichTableSpanProblem {
  readonly row: number
  readonly cell: number
  readonly span: 'colspan' | 'rowspan'
  readonly fits: number
}

export interface RichTableLayout {
  /** The number of columns: the widest row, the header included. */
  readonly columns: number
  /** The first column of each body cell, by row and cell. */
  readonly starts: readonly (readonly number[])[]
  /** The body rows that a row span covers, the row it starts in included. */
  readonly spannedRows: ReadonlySet<number>
  /** Spans that run into a row span from above or past the last row; placed cut to what fits. */
  readonly problems: readonly RichTableSpanProblem[]
}

type Spans = Pick<PdfRichTableCell, 'colspan' | 'rowspan'>

const spanOf = (value: number | undefined): number => value ?? 1

/** The layout of a table's cells; the header is one row without row spans. */
export const richTableLayout = (header: readonly Spans[], rows: readonly (readonly Spans[])[]): RichTableLayout => {
  let columns = header.reduce((sum, cell) => sum + spanOf(cell.colspan), 0)
  // For each column, the first body row that no row span from above takes.
  const freeFrom: number[] = []
  const spannedRows = new Set<number>()
  const problems: RichTableSpanProblem[] = []
  const starts = rows.map((cells, row) => {
    let column = 0
    return cells.map((cell, index) => {
      let across = spanOf(cell.colspan)
      const { start, fits } = placeCell(column, across, taken => (freeFrom[taken] ?? 0) > row)
      if (fits < across) {
        problems.push({ row, cell: index, span: 'colspan', fits })
        across = fits
      }
      let down = spanOf(cell.rowspan)
      if (row + down > rows.length) {
        problems.push({ row, cell: index, span: 'rowspan', fits: rows.length - row })
        down = rows.length - row
      }
      if (down > 1) for (let covered = row; covered < row + down; covered += 1) spannedRows.add(covered)
      for (let taken = start; taken < start + across; taken += 1) freeFrom[taken] = row + down
      column = start + across
      columns = Math.max(columns, column)
      return start
    })
  })
  return { columns, starts, spannedRows, problems }
}
