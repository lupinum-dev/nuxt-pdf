// The keepWithNext profile (I26): a column of headings, unbreakable blocks,
// texts and tables below a spacer, some with keepWithNext, and a table row
// that keeps with the next row. Every height follows from the spec (a line is
// 1.1 times its font size), so the rule can tell which keeps fit a page.
//
// I26: a node with keepWithNext ends on the page where its next sibling
// starts, unless the node, the nodes its keeps chain to and the start of the
// first node that does not keep are higher than the content box: then the
// keep gives up and pagination splits as without it.
import fc from 'fast-check'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf } from './document'

const { PdfDocument, PdfPage, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

// A4 with 40 pt padding: content box 761.89 pt high.
const CONTENT_HEIGHT = 841.89 - 2 * 40
const FONT_SIZE = 10
const LINE = FONT_SIZE * 1.1
const HEADING_SIZE = 14
const HEADING = HEADING_SIZE * 1.1
/** A chain this close to the content height is not judged: float rounding could decide it. */
const MARGIN = 1

type Item = { keep: boolean } & (
  | { kind: 'heading' }
  | { kind: 'block', height: number }
  | { kind: 'text', lines: number }
  | { kind: 'table', rows: number, keepRow: number | null }
)

/**
 * One keep near the top whose room is chosen: the spacer leaves `room` points
 * on the first page at the top of item `index`, which keeps (the items before
 * it do not), so the rule can say whether it must stay or move.
 */
type Target = { index: number, room: number }

export type KeepSpec = { spacer: number, items: Item[], target: Target | null }

export type RawKeep = {
  spacer: number
  items: Array<{ kind: number, size: number, keep: boolean, keepRow: number }>
  target: { index: number, room: number } | null
}

export const rawKeeps: fc.Arbitrary<RawKeep> = fc.record({
  spacer: fc.integer({ min: 0, max: 740 }),
  target: fc.option(fc.record({ index: fc.integer({ min: 0, max: 2 }), room: fc.integer({ min: 0, max: 10_000 }) })),
  items: fc.array(fc.record({
    kind: fc.integer({ min: 0, max: 3 }),
    size: fc.integer({ min: 0, max: 1000 }),
    keep: fc.boolean(),
    keepRow: fc.integer({ min: 0, max: 20 }),
  }), { minLength: 2, maxLength: 12 }),
})

export const normalizeKeep = (raw: RawKeep): KeepSpec => targeted(raw, {
  spacer: raw.spacer,
  target: null,
  items: raw.items.map(({ kind, size, keep, keepRow }): Item => {
    if (kind === 0) return { kind: 'heading', keep }
    if (kind === 1) return { kind: 'block', keep, height: 12 + size % 189 }
    if (kind === 2) return { kind: 'text', keep, lines: 1 + size % 8 }
    const rows = 1 + size % 8
    // A keep on the last row has no next row: no keep row then.
    return { kind: 'table', keep, rows, keepRow: rows > 1 && keepRow % 2 === 0 ? keepRow % (rows - 1) : null }
  }),
})

const heightOf = (item: Item): number => {
  switch (item.kind) {
    case 'heading': return HEADING
    case 'block': return item.height
    case 'text': return item.lines * LINE
    case 'table': return (item.rows + 1) * LINE
  }
}

/**
 * The height a node needs to start a page: a text its orphans (2) unless it
 * is too short for orphans and widows (2); a table its header and first row,
 * and the second row when the first keeps with it.
 */
const startOf = (item: Item): number => {
  switch (item.kind) {
    case 'text': return (item.lines < 4 ? item.lines : 2) * LINE
    case 'table': return (item.keepRow === 0 ? 3 : 2) * LINE
    default: return heightOf(item)
  }
}

const firstToken = (item: Item, index: number): string => {
  switch (item.kind) {
    case 'heading': return `H${index}`
    case 'block': return `B${index}`
    case 'text': return `T${index}x0`
    case 'table': return `R${index}x0`
  }
}

const lastToken = (item: Item, index: number): string => {
  switch (item.kind) {
    case 'text': return `T${index}x${item.lines - 1}`
    case 'table': return `R${index}x${item.rows - 1}`
    default: return firstToken(item, index)
  }
}

const tokensOf = (item: Item, index: number): string[] => {
  switch (item.kind) {
    case 'text': return Array.from({ length: item.lines }, (_, line) => `T${index}x${line}`)
    case 'table': return Array.from({ length: item.rows }, (_, row) => `R${index}x${row}`)
    default: return [firstToken(item, index)]
  }
}

const nodeOf = (item: Item, index: number): VNode => {
  const keepWithNext = item.keep
  switch (item.kind) {
    case 'heading': return h(PdfText, { keepWithNext, style: { fontSize: HEADING_SIZE } }, () => `H${index}`)
    case 'block': return h(PdfView, { keepWithNext, wrap: false, style: { height: item.height } }, () => [h(PdfText, null, () => `B${index}`)])
    case 'text': return h(PdfText, { keepWithNext }, () => tokensOf(item, index).join('\n'))
    case 'table': return h(PdfTable, { keepWithNext, columns: [1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => `Head${index}`)]),
      ...tokensOf(item, index).map((token, row) => h(PdfTableRow, { key: row, keepWithNext: row === item.keepRow }, () => [h(PdfTableCell, null, () => token)])),
    ])
  }
}

export const renderKeep = async (spec: KeepSpec): Promise<Uint8Array> => {
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: FONT_SIZE } }, () => [
      h(PdfView, { style: { height: spec.spacer } }),
      ...spec.items.map(nodeOf),
    ])))
  return (await renderPreparedPdfTemplate(component, {})).bytes
}

/**
 * The height from the top of item `index` to the end of its keep: the items
 * its keeps chain to, whole, and the start of the first item that does not
 * keep (or the start of the last item). Undefined when it has no next sibling.
 */
const keepHeight = (items: readonly Item[], index: number): number | undefined => {
  if (index + 1 >= items.length) return undefined
  let height = heightOf(items[index]!)
  let next = index + 1
  while (items[next]!.keep && next + 1 < items.length) {
    height += heightOf(items[next]!)
    next += 1
  }
  // The last item keeps with nothing: the chain ends at its start.
  return height + startOf(items[next]!)
}

/**
 * Places the target: its room runs from its own height to its keep plus 60 pt
 * (at most the content box), so both sides of the keep are generated. No
 * target when the items before it leave no spacer.
 */
const targeted = (raw: RawKeep, spec: KeepSpec): KeepSpec => {
  if (raw.target === null) return spec
  const index = raw.target.index % (spec.items.length - 1)
  const items = spec.items.map((item, at) => at < index ? { ...item, keep: false } : at === index ? { ...item, keep: true } : item)
  const own = heightOf(items[index]!)
  const highest = Math.min(keepHeight(items, index)! + 60, CONTENT_HEIGHT)
  const room = Math.floor(own) + raw.target.room % Math.max(1, Math.floor(highest - own))
  const spacer = Math.floor(CONTENT_HEIGHT - items.slice(0, index).reduce((sum, item) => sum + heightOf(item), 0) - room)
  return spacer < 1 ? spec : { spacer, items, target: { index, room: CONTENT_HEIGHT - spacer - items.slice(0, index).reduce((sum, item) => sum + heightOf(item), 0) } }
}

/**
 * Where the target must be: on the first page when its keep fits its room or
 * is higher than the content box (the keep gives up), on the second when it
 * fits a page but not the room. Undefined near a boundary or when the target
 * itself does not fit its room.
 */
const targetPage = (spec: KeepSpec, target: Target): 1 | 2 | undefined => {
  const height = keepHeight(spec.items, target.index)!
  if (target.room < heightOf(spec.items[target.index]!) + MARGIN) return undefined
  if (height > CONTENT_HEIGHT + MARGIN) return 1
  if (height > CONTENT_HEIGHT - MARGIN) return undefined
  if (target.room >= height + MARGIN) return 1
  if (target.room <= height - MARGIN) return 2
  return undefined
}

export const checkKeep = async (spec: KeepSpec, bytes: Uint8Array): Promise<string[]> => {
  const read = await readPdf(bytes)
  const pages = new Map<string, number[]>()
  for (const word of read.words) pages.set(word.text, [...(pages.get(word.text) ?? []), word.page])
  const messages: string[] = []
  for (const [index, item] of spec.items.entries()) {
    for (const token of tokensOf(item, index)) {
      const found = pages.get(token)?.length ?? 0
      if (found !== 1) messages.push(`${token} printed ${found} times`)
    }
  }
  if (messages.length > 0) return messages

  const pageOf = (token: string): number => pages.get(token)![0]!
  const expected = spec.target === null ? undefined : targetPage(spec, spec.target)
  if (spec.target !== null && expected !== undefined) {
    const { index, room } = spec.target
    const page = pageOf(firstToken(spec.items[index]!, index))
    if (page !== expected) messages.push(`I26: ${spec.items[index]!.kind} ${index} with keepWithNext starts on page ${page}, expected ${expected} (room ${room.toFixed(1)} pt, keep ${keepHeight(spec.items, index)!.toFixed(1)} pt high)`)
  }
  for (const [index, item] of spec.items.entries()) {
    if (item.kind === 'table' && item.keepRow !== null) {
      const row = `R${index}x${item.keepRow}`
      const next = `R${index}x${item.keepRow + 1}`
      if (pageOf(row) !== pageOf(next)) messages.push(`I26: table row ${row} with keepWithNext is on page ${pageOf(row)}, the next row ${next} on page ${pageOf(next)}`)
    }
    const height = item.keep ? keepHeight(spec.items, index) : undefined
    if (height === undefined || height > CONTENT_HEIGHT - MARGIN) continue
    const end = pageOf(lastToken(item, index))
    const start = pageOf(firstToken(spec.items[index + 1]!, index + 1))
    if (end !== start) messages.push(`I26: ${item.kind} ${index} with keepWithNext ends on page ${end}, its next sibling starts on page ${start} (keep ${height.toFixed(1)} pt high)`)
  }
  return messages
}
