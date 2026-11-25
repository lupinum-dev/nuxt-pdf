// The automatic columns profile of the invariant harness (D39, F3 design
// "Feature 2"): generated tables that mix 'auto', share and width columns,
// with cells over one column and spans over two, at table widths from just
// above the longest words of the columns to the whole content box, rendered
// through the public render. One rule:
//
// - I9c automatic widths: every row on every page has the same column edges;
//   no line of a cell runs past its column; when the table has room for every
//   'auto' column on one line, each is as wide as its widest cell on one line
//   (max-content plus padding) and none of its cells wraps; with less room each is between its longest
//   word (min-content plus padding) and its max-content, and all give up the
//   same part of their slack (max − min). A share column is never narrower
//   than its longest word, a width column keeps its width.
//
// The main profile (generator.ts) predicts every column edge from the spec,
// which 'auto' columns do not allow; this profile reads the edges from the
// PDF instead: each cell is left-aligned (I9 covers alignment), so its lines
// start at its column's left edge. A last width column (`MARK`) shows where
// the column before it ends when no share column fills the table.
import fc from 'fast-check'
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import type { PdfTableColumnWidth } from '../../src/runtime/primitives'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf, type Word } from './document'

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfView } = PDF_COMPONENTS

/** Page padding: the table starts at x = 40. */
const LEFT = 40
const CONTENT_WIDTH = 595.28 - 2 * LEFT
const FONT_SIZE = 10
const PAD = 4
/** Helvetica advance widths, in em, of the characters of the tokens. */
const EM: Record<string, number> = { ' ': 0.278, 'k': 0.5, 'w': 0.722, ...Object.fromEntries([...'0123456789'].map(digit => [digit, 0.556])) }
const SPACE = EM[' ']! * FONT_SIZE
/** The widest letter of a token, for the width bound. */
const WIDEST_LETTER = EM.w! * FONT_SIZE
const DIGIT = EM['0']! * FONT_SIZE
/** The advance width of a token at the table's font size. */
const widthOf = (text: string): number => [...text].reduce((sum, char) => sum + EM[char]!, 0) * FONT_SIZE
const TOLERANCE = 0.5
/** The last column: one short token per row, so the right edge of every generated column shows. */
const MARK = 40

// ---------------------------------------------------------------------------
// Specs

type Cell = { start: number, span: 1 | 2, words: string[] }

export type AutoTableSpec = {
  columns: PdfTableColumnWidth[]
  /** The width of the view the table fills. */
  width: number
  header: Cell[] | undefined
  rows: Cell[][]
}

/** What fast-check draws and shrinks; `normalizeAutoTable` makes any of it a valid spec. */
export type RawAutoTable = {
  columns: Array<{ kind: number, value: number }>
  room: number
  header: boolean
  rows: Array<{ cells: Array<{ words: number[] }>, span: number }>
}

export const rawAutoTables: fc.Arbitrary<RawAutoTable> = fc.record({
  columns: fc.array(fc.record({ kind: fc.nat(2), value: fc.nat(60) }), { minLength: 1, maxLength: 4 }),
  room: fc.double({ min: 0, max: 1, noNaN: true }),
  header: fc.boolean(),
  rows: fc.array(fc.record({
    cells: fc.array(fc.record({ words: fc.array(fc.nat(5), { minLength: 1, maxLength: 5 }) }), { minLength: 4, maxLength: 4 }),
    span: fc.nat(11),
  }), { minLength: 1, maxLength: 70 }),
})

/**
 * The en-us patterns hyphenate no token of these letters and digits (they do
 * split "mmmm"), so every word stays whole and can be found in the PDF.
 */
const LETTERS = ['w', 'k']
const MAX_LETTERS = 6

export const normalizeAutoTable = (raw: RawAutoTable): AutoTableSpec => {
  // Room for the longest word of a column: tokens up to 6 letters and a
  // number that grows with the cells. Every column gets at least this much
  // (a width column too), so no word overflows its cell: pdf.js would join
  // the texts of two cells in one run.
  const widest = MAX_LETTERS * WIDEST_LETTER + String(raw.rows.length * 5 * 6 + 30).length * DIGIT + 2 * PAD
  const columns = raw.columns.map(({ kind, value }): PdfTableColumnWidth =>
    kind === 0 ? 'auto' : kind === 1 ? 1 + (value % 3) : `${Math.ceil(widest) + (value % 30)}pt`)
  if (!columns.includes('auto')) columns[0] = 'auto'
  const generated = columns.length
  columns.push(`${MARK}pt`)
  let id = 0
  const mark = (): Cell => ({ start: generated, span: 1, words: [`k${id++}`] })
  // A unique token per word; its letters set its width.
  const word = (length: number) => `${LETTERS[id % LETTERS.length]!.repeat(1 + (length % MAX_LETTERS))}${id++}`
  const least = columns.reduce<number>((sum, column) => sum + (typeof column === 'string' && column !== 'auto' ? Number.parseFloat(column) : widest), 0)
  const width = Math.min(CONTENT_WIDTH, least + raw.room * Math.max(0, CONTENT_WIDTH - least))
  const cellsOf = (cells: RawAutoTable['rows'][number]['cells'], span: number): Cell[] => {
    // A span of two at `start` when the draw asks for one and there are two columns.
    const spanStart = span < generated - 1 ? span : undefined
    const out: Cell[] = []
    for (let start = 0; start < generated; start += 1) {
      const words = cells[start % cells.length]!.words
      if (start === spanStart) {
        // Short words: a span may be narrower than a long one.
        out.push({ start, span: 2, words: words.map(() => `${LETTERS[id % LETTERS.length]}${id++}`) })
        start += 1
      }
      else out.push({ start, span: 1, words: words.map(word) })
    }
    return [...out, mark()]
  }
  return {
    columns,
    width,
    header: raw.header ? [...columns.slice(0, generated).map((_, start): Cell => ({ start, span: 1, words: [word(start)] })), mark()] : undefined,
    rows: raw.rows.map(row => cellsOf(row.cells, row.span)),
  }
}

// ---------------------------------------------------------------------------
// Render

const cellNode = (cell: Cell) => h(PdfTableCell, { colspan: cell.span, style: { padding: PAD } }, () => cell.words.join(' '))

export const renderAutoTable = async (spec: AutoTableSpec): Promise<Uint8Array> => {
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: LEFT, fontSize: FONT_SIZE } }, () => [
      h(PdfView, { style: { width: spec.width } }, () => [h(PdfTable, { columns: spec.columns }, () => [
        ...(spec.header ? [h(PdfTableHeader, null, () => spec.header!.map(cellNode))] : []),
        ...spec.rows.map((cells, index) => h(PdfTableRow, { key: index }, () => cells.map(cellNode))),
      ])]),
    ])))
  return (await renderPreparedPdfTemplate(component, {})).bytes
}

// ---------------------------------------------------------------------------
// Rule

type Line = { page: number, y: number, start: number, end: number }

/** The lines of one occurrence of a cell, per page (a repeated header occurs once per page). */
const linesOf = (words: readonly Word[]): Line[] => {
  const lines: Line[] = []
  for (const word of words) {
    const line = lines.find(candidate => candidate.page === word.page && Math.abs(candidate.y - word.y) < 0.3 * word.fontSize)
    if (line === undefined) lines.push({ page: word.page, y: word.y, start: word.x, end: word.x + word.width })
    else {
      line.start = Math.min(line.start, word.x)
      line.end = Math.max(line.end, word.x + word.width)
    }
  }
  return lines
}

/** I9c on one rendered table; an empty list when it holds. */
export const checkAutoColumns = async (spec: AutoTableSpec, bytes: Uint8Array): Promise<string[]> => {
  const read = await readPdf(bytes)
  const byText = Map.groupBy(read.words, word => word.text)
  const cells = [...(spec.header ?? []), ...spec.rows.flat()]
  const messages: string[] = []
  const wordsOf = (cell: Cell): Word[] => cell.words.flatMap(text => byText.get(text) ?? [])
  for (const cell of cells) {
    const missing = cell.words.filter(text => !byText.has(text))
    if (missing.length > 0) messages.push(`cell at column ${cell.start + 1}: ${missing.slice(0, 3).join(', ')} not found`)
  }
  if (messages.length > 0) return messages

  // Widths of each column's content, from the font's advance widths.
  const single = cells.filter(cell => cell.span === 1)
  const content = spec.columns.map((_, index) => {
    const own = single.filter(cell => cell.start === index)
    return {
      max: Math.max(0, ...own.map(cell => cell.words.reduce((sum, text) => sum + widthOf(text), 0) + (cell.words.length - 1) * SPACE)) + 2 * PAD,
      min: Math.max(0, ...own.flatMap(cell => cell.words.map(widthOf))) + 2 * PAD,
    }
  })

  // Every row on every page: a left-aligned cell starts its lines at its column's left edge plus padding.
  const lefts: number[][] = spec.columns.map(() => [])
  for (const cell of cells) for (const line of linesOf(wordsOf(cell))) lefts[cell.start]!.push(line.start - PAD)
  const edges = lefts.map((found, index) => {
    if (found.length === 0) return undefined
    const spread = Math.max(...found) - Math.min(...found)
    if (spread > TOLERANCE) messages.push(`column ${index + 1} starts at ${Math.min(...found).toFixed(2)} to ${Math.max(...found).toFixed(2)} in different rows`)
    return Math.min(...found)
  })
  if (edges[0] !== undefined && Math.abs(edges[0] - LEFT) > TOLERANCE) messages.push(`the first column starts at ${edges[0].toFixed(2)}, the table at ${LEFT}`)
  // The mark column ends at the table's right edge only when a share column fills the table.
  const filled = spec.columns.some(column => typeof column === 'number')
  const rightOf = (index: number): number | undefined =>
    index < spec.columns.length - 1 ? edges[index + 1] : filled ? LEFT + spec.width : undefined
  const widths = spec.columns.map((_, index) => {
    const left = edges[index]
    const right = rightOf(index)
    return left === undefined || right === undefined ? undefined : right - left
  })

  // No line past its column, unless one of its words is wider than the column.
  for (const cell of cells) {
    const right = rightOf(cell.start + cell.span - 1)
    const left = edges[cell.start]
    if (right === undefined || left === undefined) continue
    const words = wordsOf(cell)
    if (Math.max(...cell.words.map(widthOf)) + 2 * PAD > right - left + TOLERANCE) continue
    for (const line of linesOf(words)) {
      if (line.end > right - PAD + TOLERANCE) messages.push(`a line of the cell at column ${cell.start + 1} on p${line.page} ends at ${line.end.toFixed(2)}, its column at ${(right - PAD).toFixed(2)}`)
    }
  }

  // The widths: 'auto' at max-content when all fit, else between min and max and in proportion to slack.
  const autos = spec.columns.flatMap((column, index) => column === 'auto' ? [index] : [])
  const fixed = spec.columns.reduce<number>((sum, column) => sum + (typeof column === 'string' && column !== 'auto' ? Number.parseFloat(column) : 0), 0)
  const shareMin = spec.columns.reduce<number>((sum, column, index) => sum + (typeof column === 'number' ? content[index]!.min : 0), 0)
  const autoMax = autos.reduce((sum, index) => sum + content[index]!.max, 0)
  const autoMin = autos.reduce((sum, index) => sum + content[index]!.min, 0)
  const room = spec.width
  spec.columns.forEach((column, index) => {
    const width = widths[index]
    if (width === undefined) return
    const name = `column ${index + 1} (${String(column)})`
    if (typeof column === 'string' && column !== 'auto' && Math.abs(width - Number.parseFloat(column)) > TOLERANCE) messages.push(`${name} is ${width.toFixed(2)} wide`)
    if (typeof column === 'number' && width < content[index]!.min - TOLERANCE) messages.push(`${name} is ${width.toFixed(2)} wide, its longest word needs ${content[index]!.min.toFixed(2)}`)
  })
  if (room + TOLERANCE >= fixed + shareMin + autoMax) {
    for (const index of autos) {
      const width = widths[index]
      if (width !== undefined && Math.abs(width - content[index]!.max) > TOLERANCE) {
        messages.push(`'auto' column ${index + 1} is ${width.toFixed(2)} wide, its widest cell on one line ${content[index]!.max.toFixed(2)}, with room for all`)
      }
    }
    // At its max-content every cell of an 'auto' column is one line.
    for (const cell of single.filter(candidate => spec.columns[candidate.start] === 'auto')) {
      const lines = linesOf(wordsOf(cell))
      if (new Set(lines.map(line => line.page)).size !== lines.length) messages.push(`a cell of 'auto' column ${cell.start + 1} wraps (${cell.words.join(' ')}), with room for all`)
    }
  }
  else if (room + TOLERANCE >= fixed + shareMin + autoMin) {
    // The part of its slack each 'auto' column gave up; equal for all.
    const parts: Array<{ index: number, part: number, slack: number }> = []
    for (const index of autos) {
      const width = widths[index]
      if (width === undefined) continue
      const { max, min } = content[index]!
      if (width < min - TOLERANCE || width > max + TOLERANCE) messages.push(`'auto' column ${index + 1} is ${width.toFixed(2)} wide, outside ${min.toFixed(2)} to ${max.toFixed(2)}`)
      if (max - min > 1) parts.push({ index, part: (max - width) / (max - min), slack: max - min })
    }
    const reference = parts.toSorted((a, b) => b.slack - a.slack)[0]
    for (const { index, part, slack } of parts) {
      if (reference !== undefined && Math.abs(part - reference.part) * slack > TOLERANCE) {
        messages.push(`'auto' column ${index + 1} gave up ${(part * 100).toFixed(1)} % of its slack, column ${reference.index + 1} ${(reference.part * 100).toFixed(1)} %`)
      }
    }
  }
  return messages
}
