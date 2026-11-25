// The columns profile (I27): a column container of texts, blocks that cannot
// split and tables below a spacer, with 2 or 3 columns, balanced or filled in
// order, and a text after it. Every height follows from the spec (a line is
// 1.1 times its font size), so the rule can bound the balanced height.
//
// I27, on the page where the container ends and the pages before:
// - every token is printed once, and read column by column the tokens are in
//   source order;
// - every token lies inside its column: no column is wider than the column
//   width, and no two columns overlap;
// - balanced (`columnFill: 'balance'`, the default): on that page the highest
//   column is at most the even share of what the columns hold, plus the
//   highest unit that cannot end a column (a block, or three lines of a text
//   that orphans and widows keep together), plus a line for the candidate
//   heights. A container filled in order there has a first column of all of
//   it and fails this;
// - the text after the container starts below its highest column.
import fc from 'fast-check'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf, type Word } from './document'

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

// A4 with 40 pt padding: content box 515.28 pt wide.
const PAGE_HEIGHT = 841.89
const PADDING = 40
const CONTENT_WIDTH = 595.28 - 2 * PADDING
const FONT_SIZE = 10
const LINE = FONT_SIZE * 1.1
/** Positions read back from the PDF are this close: a baseline and its line box differ by the same offset everywhere. */
const TOLERANCE = 1

type Item
  = | { kind: 'text', lines: number }
    | { kind: 'block', height: number }
    | { kind: 'table', rows: number }

export type ColumnSpec = { spacer: number, count: 2 | 3, gap: number, auto: boolean, items: Item[] }

export type RawColumns = {
  spacer: number
  count: number
  gap: number
  auto: number
  items: Array<{ kind: number, size: number }>
}

export const rawColumns: fc.Arbitrary<RawColumns> = fc.record({
  spacer: fc.integer({ min: 0, max: 700 }),
  count: fc.integer({ min: 2, max: 3 }),
  gap: fc.integer({ min: 0, max: 20 }),
  auto: fc.integer({ min: 0, max: 3 }),
  items: fc.array(fc.record({ kind: fc.integer({ min: 0, max: 2 }), size: fc.integer({ min: 0, max: 1000 }) }), { minLength: 1, maxLength: 14 }),
})

export const normalizeColumns = (raw: RawColumns): ColumnSpec => ({
  spacer: raw.spacer,
  count: raw.count === 3 ? 3 : 2,
  gap: raw.gap,
  // One container in four fills in order.
  auto: raw.auto === 0,
  items: raw.items.map(({ kind, size }): Item => {
    if (kind === 0) return { kind: 'text', lines: 1 + size % 40 }
    if (kind === 1) return { kind: 'block', height: 12 + size % 189 }
    return { kind: 'table', rows: 1 + size % 30 }
  }),
})

const tokensOf = (item: Item, index: number): string[] => {
  switch (item.kind) {
    case 'text': return Array.from({ length: item.lines }, (_, line) => `T${index}x${line}`)
    case 'block': return [`B${index}`]
    case 'table': return Array.from({ length: item.rows }, (_, row) => `R${index}x${row}`)
  }
}

const nodeOf = (item: Item, index: number): VNode => {
  switch (item.kind) {
    case 'text': return h(PdfText, null, () => tokensOf(item, index).join('\n'))
    case 'block': return h(PdfView, { wrap: false, style: { height: item.height } }, () => [h(PdfText, null, () => `B${index}`)])
    case 'table': return h(PdfTable, { columns: [1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => `Head${index}`)]),
      ...tokensOf(item, index).map((token, row) => h(PdfTableRow, { key: row }, () => [h(PdfTableCell, null, () => token)])),
    ])
  }
}

export const renderColumns = async (spec: ColumnSpec): Promise<Uint8Array> => {
  const style = { columnCount: spec.count, columnGap: spec.gap, ...(spec.auto ? { columnFill: 'auto' as const } : {}) }
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: PADDING, fontSize: FONT_SIZE } }, () => [
      h(PdfView, { style: { height: spec.spacer } }),
      h(PdfView, { style }, () => spec.items.map(nodeOf)),
      h(PdfText, null, () => 'After'),
    ])))
  return (await renderPreparedPdfTemplate(component, {})).bytes
}

/** The top of a word's line from the page top (the same offset for every 10 pt line). */
const topOf = (word: Word): number => PAGE_HEIGHT - word.y - 0.8 * word.fontSize

export const checkColumns = async (spec: ColumnSpec, bytes: Uint8Array): Promise<string[]> => {
  const { words } = await readPdf(bytes)
  const expected = spec.items.flatMap(tokensOf)
  const owner = new Map(spec.items.flatMap((item, index) => tokensOf(item, index).map(token => [token, item] as const)))
  const found = new Map<string, Word[]>()
  for (const word of words) found.set(word.text, [...(found.get(word.text) ?? []), word])
  const messages = [...expected, 'After']
    .filter(token => found.get(token)?.length !== 1)
    .map(token => `${token} printed ${found.get(token)?.length ?? 0} times`)
  if (messages.length > 0) return messages

  // Column k spans [PADDING + k (w + gap), + w].
  const width = (CONTENT_WIDTH - (spec.count - 1) * spec.gap) / spec.count
  const columnOf = (word: Word): number =>
    Math.min(spec.count - 1, Math.max(0, Math.floor((word.x - PADDING + spec.gap / 2) / (width + spec.gap))))
  const inContainer = words.filter(word => owner.has(word.text) || word.text.startsWith('Head'))
  for (const word of inContainer) {
    const left = PADDING + columnOf(word) * (width + spec.gap)
    if (word.x < left - TOLERANCE || word.x + word.width > left + width + TOLERANCE) {
      messages.push(`I27: ${word.text} on page ${word.page} spans x ${word.x.toFixed(1)} to ${(word.x + word.width).toFixed(1)}, outside its column ${left.toFixed(1)} to ${(left + width).toFixed(1)}`)
    }
  }

  const read = expected.map(token => found.get(token)![0]!)
    .sort((a, b) => a.page - b.page || columnOf(a) - columnOf(b) || topOf(a) - topOf(b))
    .map(word => word.text)
  const first = read.findIndex((token, at) => token !== expected[at])
  if (first !== -1) messages.push(`I27: read column by column, token ${first} is ${read[first]}, expected ${expected[first]}`)

  // Where each column ends on the container's last page.
  const lastPage = Math.max(...expected.map(token => found.get(token)![0]!.page))
  const onLast = inContainer.filter(word => word.page === lastPage)
  const top = Math.min(...onLast.map(topOf))
  const bottoms = Array.from({ length: spec.count }, () => top)
  let unit = 3 * LINE
  for (const word of onLast) {
    const item = owner.get(word.text)
    const height = item?.kind === 'block' ? item.height : LINE
    if (item?.kind === 'block') unit = Math.max(unit, item.height)
    bottoms[columnOf(word)] = Math.max(bottoms[columnOf(word)]!, topOf(word) + height)
  }
  const heights = bottoms.map(bottom => bottom - top)
  const tallest = Math.max(...heights)
  const share = heights.reduce((sum, height) => sum + height, 0) / spec.count
  if (!spec.auto && tallest > share + unit + LINE + TOLERANCE) {
    messages.push(`I27: on page ${lastPage}, where the container ends, its highest column is ${tallest.toFixed(1)} pt, over the even share ${share.toFixed(1)} pt plus ${(unit + LINE).toFixed(1)} pt (columns ${heights.map(height => height.toFixed(1)).join(', ')})`)
  }

  const after = found.get('After')![0]!
  if (after.page === lastPage && topOf(after) < top + tallest - TOLERANCE) {
    messages.push(`I27: the text after the container starts at ${topOf(after).toFixed(1)} pt, above its highest column's end ${(top + tallest).toFixed(1)} pt`)
  }
  if (after.page < lastPage) messages.push(`I27: the text after the container is on page ${after.page}, before the container ends on page ${lastPage}`)
  return messages
}
