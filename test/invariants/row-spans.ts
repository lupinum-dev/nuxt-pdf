// The row-span profile (I9b, D39): a table of three 60 pt columns below a spacer, in groups of
// one to four rows. In each group, the cells of columns 0 and 1 cover one row
// or several; column 2 has a cell in every row, so every row has a line that
// shows where it is. A cell has one line per token, and every height follows
// from the spec (a line is 1.1 times its font size).
//
// I9b: every token is printed once; the rows that cells over several rows
// hold together are on one page; a cell starts at the top of its first row
// and in its column; a row is as high as its highest one-row cell, and the
// last row a cell covers grows by what the cell needs beyond its rows (no
// more); the background of a cell over several rows covers exactly its rows.
import fc from 'fast-check'
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf } from './document'

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableRow, PdfView } = PDF_COMPONENTS

const PADDING = 40
const COLUMN = 60
const FONT_SIZE = 10
const LINE = FONT_SIZE * 1.1
const SPAN_BACKGROUND = '#d0d0d0'
const TOLERANCE = 0.5
/** From the baseline of a cell's first line up to the top of the cell: the engine sets a 10 pt line 9 pt below the top of its 11 pt line box. */
const ABOVE_BASELINE = 9

export type SpanCell = { row: number, column: number, rows: number, lines: number }
export type SpanSpec = { spacer: number, rows: number, cells: SpanCell[] }

export type RawSpans = {
  spacer: number
  groups: Array<{ length: number, cuts: [number, number], lines: number[] }>
}

export const rawSpans: fc.Arbitrary<RawSpans> = fc.record({
  spacer: fc.integer({ min: 0, max: 740 }),
  groups: fc.array(fc.record({
    length: fc.integer({ min: 1, max: 4 }),
    // Bit k set: a cell of that column ends after row k of the group.
    cuts: fc.tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 })),
    lines: fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 12, maxLength: 12 }),
  }), { minLength: 1, maxLength: 40, size: 'max' }),
})

export const normalizeSpans = (raw: RawSpans): SpanSpec => {
  const cells: SpanCell[] = []
  let start = 0
  for (const { length, cuts, lines } of raw.groups) {
    let pick = 0
    for (const column of [0, 1, 2]) {
      // Column 2 ends a cell after every row.
      const mask = column === 2 ? 7 : cuts[column]!
      let first = 0
      for (let row = 0; row < length; row += 1) {
        if (row < length - 1 && (mask & (1 << row)) === 0) continue
        const rows = row - first + 1
        const value = lines[pick++ % lines.length]!
        // A cell over several rows has one to eight lines, a one-row cell one to three.
        cells.push({ row: start + first, column, rows, lines: rows > 1 ? 1 + value % 8 : 1 + value % 3 })
        first = row + 1
      }
    }
    start += length
  }
  cells.sort((a, b) => a.row - b.row || a.column - b.column)
  return { spacer: raw.spacer, rows: start, cells }
}

const tokensOf = (cell: SpanCell): string[] =>
  Array.from({ length: cell.lines }, (_, line) => `r${cell.row}c${cell.column}l${line}`)

export const renderSpans = async (spec: SpanSpec): Promise<Uint8Array> => {
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: PADDING, fontSize: FONT_SIZE } }, () => [
      h(PdfView, { style: { height: spec.spacer } }),
      h(PdfTable, { columns: [`${COLUMN}pt`, `${COLUMN}pt`, `${COLUMN}pt`] }, () =>
        Array.from({ length: spec.rows }, (_, row) => h(PdfTableRow, { key: row }, () => spec.cells
          .filter(cell => cell.row === row)
          .map(cell => h(PdfTableCell, cell.rows > 1 ? { rowspan: cell.rows, style: { backgroundColor: SPAN_BACKGROUND } } : null, () => tokensOf(cell).join('\n')))))),
    ])))
  return (await renderPreparedPdfTemplate(component, {})).bytes
}

/**
 * The height of each row: its highest one-row cell, and then, for the cells
 * over several rows in the order of their last row, what each still needs
 * beyond the rows it covers goes to its last row.
 */
export const rowHeights = (spec: SpanSpec): number[] => {
  const heights = Array.from({ length: spec.rows }, () => 0)
  for (const cell of spec.cells) {
    if (cell.rows === 1) heights[cell.row] = Math.max(heights[cell.row]!, cell.lines * LINE)
  }
  for (const cell of spec.cells.filter(cell => cell.rows > 1).sort((a, b) => (a.row + a.rows) - (b.row + b.rows))) {
    const end = cell.row + cell.rows - 1
    const covered = heights.slice(cell.row, end + 1).reduce((sum, height) => sum + height, 0)
    heights[end]! += Math.max(0, cell.lines * LINE - covered)
  }
  return heights
}

/** The rows that cells over several rows hold together, as [first, last] (disjoint, by construction). */
const groupsOf = (spec: SpanSpec): Array<[number, number]> => spec.cells
  .filter(cell => cell.rows > 1)
  .map((cell): [number, number] => [cell.row, cell.row + cell.rows - 1])

export const checkSpans = async (spec: SpanSpec, bytes: Uint8Array): Promise<string[]> => {
  const read = await readPdf(bytes, { ids: [], outline: false }, { details: true })
  const words = new Map<string, typeof read.words>()
  for (const word of read.words) words.set(word.text, [...(words.get(word.text) ?? []), word])
  const messages: string[] = []
  for (const cell of spec.cells) {
    for (const token of tokensOf(cell)) {
      const found = words.get(token)?.length ?? 0
      if (found !== 1) messages.push(`${token} printed ${found} times`)
    }
  }
  if (messages.length > 0) return messages

  const wordOf = (token: string) => words.get(token)![0]!
  const firstOf = (cell: SpanCell) => wordOf(tokensOf(cell)[0]!)
  // Column 2 has a cell in every row: its first line is where the row is.
  const reference = (row: number) => firstOf(spec.cells.find(cell => cell.row === row && cell.column === 2)!)
  const heights = rowHeights(spec)

  for (const [first, last] of groupsOf(spec)) {
    const pages = new Set(spec.cells.filter(cell => cell.row >= first && cell.row <= last).flatMap(cell => tokensOf(cell).map(token => wordOf(token).page)))
    if (pages.size !== 1) messages.push(`I9b: rows ${first} to ${last} are held together by a cell over several rows, but print on pages ${[...pages].join(', ')}`)
  }
  for (let row = 1; row < spec.rows; row += 1) {
    const above = reference(row - 1)
    const here = reference(row)
    if (above.page !== here.page) continue
    if (Math.abs(above.y - here.y - heights[row - 1]!) > TOLERANCE) messages.push(`I9b: row ${row - 1} is ${(above.y - here.y).toFixed(2)} pt high, expected ${heights[row - 1]!.toFixed(2)} pt`)
  }
  for (const cell of spec.cells) {
    const word = firstOf(cell)
    const row = reference(cell.row)
    if (word.page !== row.page || Math.abs(word.y - row.y) > TOLERANCE) messages.push(`I9b: cell r${cell.row}c${cell.column} starts at y ${word.y.toFixed(2)} on page ${word.page}, its row at y ${row.y.toFixed(2)} on page ${row.page}`)
    const left = PADDING + cell.column * COLUMN
    if (Math.abs(word.x - left) > TOLERANCE) messages.push(`I9b: cell r${cell.row}c${cell.column} starts at x ${word.x.toFixed(2)}, its column at ${left}`)
  }
  if (messages.length > 0) return messages

  // The background of a cell over several rows: from the top of its first
  // row (ABOVE_BASELINE above the baseline of that row's first line) down by
  // the heights of its rows.
  const fills = read.details!.fills.filter(fill => fill.color === SPAN_BACKGROUND)
  for (const cell of spec.cells.filter(cell => cell.rows > 1)) {
    const row = reference(cell.row)
    const left = PADDING + cell.column * COLUMN
    const top = row.y + ABOVE_BASELINE
    const height = heights.slice(cell.row, cell.row + cell.rows).reduce((sum, value) => sum + value, 0)
    const fill = fills.find(candidate => candidate.page === row.page && Math.abs(candidate.rect[0] - left) <= TOLERANCE && Math.abs(candidate.rect[3] - top) <= TOLERANCE)
    if (fill === undefined) {
      const near = fills.filter(candidate => candidate.page === row.page && Math.abs(candidate.rect[0] - left) <= TOLERANCE).map(candidate => candidate.rect[3].toFixed(2))
      messages.push(`I9b: no background of cell r${cell.row}c${cell.column} at x ${left}, top ${top.toFixed(2)} on page ${row.page} (backgrounds in its column start at ${near.join(', ') || 'none'})`)
      continue
    }
    const [x1, y1, x2, y2] = fill.rect
    if (Math.abs(x2 - x1 - COLUMN) > TOLERANCE || Math.abs(y2 - y1 - height) > TOLERANCE) {
      messages.push(`I9b: the background of cell r${cell.row}c${cell.column} is ${(x2 - x1).toFixed(2)} by ${(y2 - y1).toFixed(2)} pt, expected ${COLUMN} by ${height.toFixed(2)} pt (its ${cell.rows} rows)`)
    }
  }
  return messages
}
