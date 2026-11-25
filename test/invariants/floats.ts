// The floats profile (I28, D49): texts, headings with keepWithNext and floats
// of both sides below a spacer, some inside plain sections with edges, in the
// page flow or in a column container of 2 or 3 columns. In a container some
// floats of its own list have columnSpan "all" (spanning floats). Some floats
// hold a footnote mark, and some headings stand right before a float. Every
// height follows from the spec (a line is 1.1 times its font size).
//
// I28:
// - every token and every note is printed once;
// - read by page, column and top, the flow's tokens keep source order;
// - each float lies inside the content area and inside one column, with no
//   flow token of its area between it and its edge: none above a top float,
//   none below a bottom one; no flow token and no other float overlaps it,
//   and the notes of its page are below it;
// - a spanning float spans the columns and lies in its container's part on
//   its page: no flow token and no column float of its side of that page
//   between it and the part's edge. A top one starts at the part's top or
//   right below another spanning top float; a bottom one in a part that goes
//   on ends at the page end, or right above another spanning bottom float;
// - the floats of one side keep source order over page, column and top; on a
//   page the spanning top floats come before the column ones, the spanning
//   bottom floats after them (one queue per side);
// - no float is in an area (page, column) before the area of the last flow
//   token before it in source order (its anchor); a spanning float not on a
//   page before its anchor's;
// - the note of a mark inside a float is on the float's page;
// - a heading with keepWithNext is in the area of the next flow token, the
//   floats between them left out (not where the keep rules let it give up;
//   see the check).
import fc from 'fast-check'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf, type Word } from './document'

const { PdfDocument, PdfFootnote, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

// A4 with 40 pt padding: content box 515.28 pt wide, from 40 to 801.89 pt.
const PAGE_HEIGHT = 841.89
const PADDING = 40
const CONTENT_WIDTH = 595.28 - 2 * PADDING
const CONTENT_BOTTOM = PAGE_HEIGHT - PADDING
const FONT_SIZE = 10
const LINE = FONT_SIZE * 1.1
const HEADING_SIZE = 14
/** Positions read back from the PDF are this close: a baseline and its line box differ by the same offset everywhere. */
const TOLERANCE = 1

type Float = { kind: 'float', side: 'top' | 'bottom', height: number, note: boolean, span?: true }
type Leaf = { kind: 'text', lines: number } | { kind: 'heading' } | Float
type Item = Leaf | { kind: 'section', items: Leaf[] }

export type FloatSpec = { spacer: number, columns: 0 | 2 | 3, gap: number, items: Item[] }

type RawLeaf = { kind: number, size: number, note: boolean }
export type RawFloats = {
  spacer: number
  columns: number
  gap: number
  items: Array<RawLeaf & { section: RawLeaf[] }>
}

const rawLeaf = fc.record({ kind: fc.integer({ min: 0, max: 5 }), size: fc.integer({ min: 0, max: 1000 }), note: fc.boolean() })

export const rawFloats: fc.Arbitrary<RawFloats> = fc.record({
  spacer: fc.integer({ min: 0, max: 600 }),
  columns: fc.integer({ min: 0, max: 2 }),
  gap: fc.integer({ min: 6, max: 30 }),
  items: fc.array(fc.record({
    kind: fc.integer({ min: 0, max: 6 }),
    size: fc.integer({ min: 0, max: 1000 }),
    note: fc.boolean(),
    section: fc.array(rawLeaf, { minLength: 1, maxLength: 6 }),
  }), { minLength: 2, maxLength: 14 }),
})

/** A leaf; `spans` when it is a float of a column container's own list, which may then span the columns. */
const leafOf = ({ kind, size, note }: RawLeaf, spans = false): Leaf => {
  // Texts are as likely as floats, so most areas hold flow.
  if (kind <= 1) return { kind: 'text', lines: 1 + size % 30 }
  if (kind === 2) return { kind: 'heading' }
  // Up to 300 pt: lower than any column of a page, so every float fits an empty area.
  const float: Float = { kind: 'float', side: kind % 2 === 0 ? 'top' : 'bottom', height: 20 + size % 281, note }
  return spans && Math.floor(size / 281) === 1 ? { ...float, span: true } : float
}

export const normalizeFloats = (raw: RawFloats): FloatSpec => {
  const columns = ([0, 2, 3] as const)[raw.columns]!
  return {
    spacer: raw.spacer,
    columns,
    gap: raw.gap,
    items: raw.items.map(item => item.kind === 6 ? { kind: 'section', items: item.section.map(leaf => leafOf(leaf)) } : leafOf(item, columns > 0)),
  }
}

/** The leaves in source order with their tokens' index. */
const leavesOf = (spec: FloatSpec): Array<{ leaf: Leaf, index: number }> => {
  const leaves = spec.items.flatMap(item => item.kind === 'section' ? item.items : [item])
  return leaves.map((leaf, index) => ({ leaf, index }))
}

const tokensOf = (leaf: Leaf, index: number): string[] => {
  switch (leaf.kind) {
    case 'text': return Array.from({ length: leaf.lines }, (_, line) => `T${index}x${line}`)
    case 'heading': return [`H${index}`]
    case 'float': return [`F${index}`]
  }
}

const nodeOf = (leaf: Leaf, index: number): VNode => {
  switch (leaf.kind) {
    case 'text': return h(PdfText, null, () => tokensOf(leaf, index).join('\n'))
    case 'heading': return h(PdfText, { keepWithNext: true, style: { fontSize: HEADING_SIZE } }, () => `H${index}`)
    // A spanning float's text ends at its right edge, so its width shows in the PDF.
    case 'float': return h(PdfView, { style: { float: leaf.side, height: leaf.height, backgroundColor: '#eeeeee', ...(leaf.span ? { columnSpan: 'all' } as const : {}) } }, () => [
      h(PdfText, leaf.span ? { style: { textAlign: 'right' } } : null, () => leaf.note ? [`F${index} `, h(PdfFootnote, () => `N${index}`)] : `F${index}`),
    ])
  }
}

/** A rendered spec: its bytes, and whether pagination dropped a keep chain higher than a page (`PDF_KEEP_IGNORED`). */
export type RenderedFloats = { bytes: Uint8Array, keepDropped: boolean }

export const renderFloats = async (spec: FloatSpec): Promise<RenderedFloats> => {
  const leaves = leavesOf(spec)
  let at = 0
  const children = spec.items.map((item) => {
    if (item.kind !== 'section') return nodeOf(item, leaves[at++]!.index)
    const nodes = item.items.map(leaf => nodeOf(leaf, leaves[at++]!.index))
    return h(PdfView, { tag: 'section', style: { borderWidth: 1, padding: 4 } }, () => nodes)
  })
  const style = { columnCount: spec.columns, columnGap: spec.gap }
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () =>
    h(PdfPage, { size: 'A4', style: { padding: PADDING, fontSize: FONT_SIZE } }, () => [
      h(PdfView, { style: { height: spec.spacer } }),
      spec.columns === 0 ? children : h(PdfView, { style }, () => children),
    ])))
  const { bytes, result } = await renderPreparedPdfTemplate(component, {})
  return { bytes, keepDropped: result.diagnostics.layoutWarnings.some(warning => warning.code === 'PDF_KEEP_IGNORED') }
}

/** The top of a word's line from the page top: Helvetica's baseline is 0.9 font sizes below it in a line of 1.1. */
const topOf = (word: Word): number => PAGE_HEIGHT - word.y - 0.9 * word.fontSize
/** A float's text with a footnote mark sits this much lower: the raised mark makes its line taller. */
const MARK_SHIFT = 0.6

export const checkFloats = async (spec: FloatSpec, { bytes, keepDropped }: RenderedFloats): Promise<string[]> => {
  const { words } = await readPdf(bytes)
  const leaves = leavesOf(spec)
  const notes = leaves.flatMap(({ leaf, index }) => leaf.kind === 'float' && leaf.note ? [`N${index}`] : [])
  const found = new Map<string, Word[]>()
  for (const word of words) found.set(word.text, [...(found.get(word.text) ?? []), word])
  const messages = [...leaves.flatMap(({ leaf, index }) => tokensOf(leaf, index)), ...notes]
    .filter(token => found.get(token)?.length !== 1)
    .map(token => `${token} printed ${found.get(token)?.length ?? 0} times`)
  if (messages.length > 0) return messages
  const word = (token: string): Word => found.get(token)![0]!

  const count = Math.max(1, spec.columns)
  const width = spec.columns === 0 ? CONTENT_WIDTH : (CONTENT_WIDTH - (count - 1) * spec.gap) / count
  const columnOf = (at: Word): number => spec.columns === 0 ? 0 : Math.min(count - 1, Math.max(0, Math.floor((at.x - PADDING + spec.gap / 2) / (width + spec.gap))))
  /** An area in reading order: page, then column. */
  const areaOf = (at: Word): number => at.page * 10 + columnOf(at)
  const areaText = (area: number) => `page ${Math.floor(area / 10)}${spec.columns === 0 ? '' : `, column ${area % 10 + 1}`}`

  const flow = leaves.filter(({ leaf }) => leaf.kind !== 'float')
  const flowTokens = flow.flatMap(({ leaf, index }) => tokensOf(leaf, index))
  const read = flowTokens.map(word)
    .sort((a, b) => areaOf(a) - areaOf(b) || topOf(a) - topOf(b))
    .map(at => at.text)
  const first = read.findIndex((token, at) => token !== flowTokens[at])
  if (first !== -1) messages.push(`I28: read by page, column and top, flow token ${first} is ${read[first]}, expected ${flowTokens[first]}`)

  const flowBoxes = flow.flatMap(({ leaf, index }) => tokensOf(leaf, index).map((token) => {
    const at = word(token)
    return { token, page: at.page, area: areaOf(at), top: topOf(at), bottom: topOf(at) + (leaf.kind === 'heading' ? HEADING_SIZE * 1.1 : LINE) }
  }))
  // A spanning float's area is its page; its text ends at its right edge, so its column says nothing.
  const floats = leaves.flatMap(({ leaf, index }) => {
    if (leaf.kind !== 'float') return []
    const at = word(`F${index}`)
    const column = leaf.span ? 0 : columnOf(at)
    const top = topOf(at) - (leaf.note ? MARK_SHIFT : 0)
    return [{ leaf, index, at, page: at.page, column, area: at.page * 10 + column, top, bottom: top + leaf.height }]
  })
  const notesOn = (page: number) => notes.map(word).filter(at => at.page === page)
  /** The top of the column container's part on a page: below the spacer on page 1. */
  const partTop = (page: number) => page === 1 ? PADDING + spec.spacer : PADDING
  /** Whether the container goes on after a page: a token or a float of it prints later. */
  const goesOn = (page: number) => flowBoxes.some(box => box.page > page) || floats.some(float => float.page > page)
  for (const float of floats) {
    const name = `${float.leaf.span ? 'spanning ' : ''}float F${float.index} (${float.leaf.side})`
    const { page } = float
    if (float.top < PADDING - TOLERANCE || float.bottom > CONTENT_BOTTOM + TOLERANCE) messages.push(`I28: ${name} on page ${page} spans ${float.top.toFixed(1)} to ${float.bottom.toFixed(1)} pt, outside the content area`)
    if (float.leaf.span) {
      const right = float.at.x + float.at.width
      if (right < PADDING + CONTENT_WIDTH - 20 || right > PADDING + CONTENT_WIDTH + TOLERANCE) messages.push(`I28: ${name} on page ${page} ends its text at x ${right.toFixed(1)}, not at the right edge of the columns, ${(PADDING + CONTENT_WIDTH).toFixed(1)}`)
      if (float.top < partTop(page) - TOLERANCE) messages.push(`I28: ${name} on page ${page} starts at ${float.top.toFixed(1)} pt, above its container's part, which starts at ${partTop(page).toFixed(1)} pt`)
      for (const box of flowBoxes.filter(box => box.page === page)) {
        if (box.top < float.bottom - TOLERANCE && box.bottom > float.top + TOLERANCE) messages.push(`I28: ${name} on page ${page} (${float.top.toFixed(1)} to ${float.bottom.toFixed(1)} pt) overlaps ${box.token} (${box.top.toFixed(1)} to ${box.bottom.toFixed(1)} pt)`)
        else if (float.leaf.side === 'top' && box.top < float.top) messages.push(`I28: ${name} on page ${page} is below ${box.token}, not at the top of its container's part`)
        else if (float.leaf.side === 'bottom' && box.top > float.top) messages.push(`I28: ${name} on page ${page} is above ${box.token}, not at the bottom of its container's part`)
      }
      for (const other of floats.filter(other => !other.leaf.span && other.page === page && other.leaf.side === float.leaf.side)) {
        if (float.leaf.side === 'top' && other.top < float.top) messages.push(`I28: ${name} on page ${page} is below the column float F${other.index}: the spanning top floats of a page come first`)
        if (float.leaf.side === 'bottom' && other.top > float.top) messages.push(`I28: ${name} on page ${page} is above the column float F${other.index}: the spanning bottom floats of a page come last`)
      }
      const spanning = floats.filter(other => other !== float && other.leaf.span && other.page === page && other.leaf.side === float.leaf.side)
      if (float.leaf.side === 'top') {
        // At the part's top, or right below another spanning top float.
        const edges = [partTop(page), ...spanning.map(other => other.bottom)]
        if (!edges.some(edge => Math.abs(float.top - edge) <= TOLERANCE)) messages.push(`I28: ${name} on page ${page} starts at ${float.top.toFixed(1)} pt, not at its container's top (${partTop(page).toFixed(1)} pt) or below another spanning top float`)
      }
      else if (goesOn(page) && notesOn(page).length === 0) {
        // In a part that goes on: at the page end, or right above another spanning bottom float.
        const edges = [CONTENT_BOTTOM, ...spanning.map(other => other.top)]
        if (!edges.some(edge => Math.abs(float.bottom - edge) <= TOLERANCE)) messages.push(`I28: ${name} on page ${page} ends at ${float.bottom.toFixed(1)} pt, not at the page end (${CONTENT_BOTTOM.toFixed(1)} pt) or above another spanning bottom float, while its container goes on`)
      }
    }
    else {
      const left = PADDING + float.column * (width + spec.gap)
      if (float.at.x < left - TOLERANCE || float.at.x + float.at.width > left + width + TOLERANCE) messages.push(`I28: ${name} on page ${page} starts at x ${float.at.x.toFixed(1)}, outside its column ${left.toFixed(1)} to ${(left + width).toFixed(1)}`)
      for (const box of flowBoxes.filter(box => box.area === float.area)) {
        if (box.top < float.bottom - TOLERANCE && box.bottom > float.top + TOLERANCE) messages.push(`I28: ${name} on ${areaText(float.area)} (${float.top.toFixed(1)} to ${float.bottom.toFixed(1)} pt) overlaps ${box.token} (${box.top.toFixed(1)} to ${box.bottom.toFixed(1)} pt)`)
        else if (float.leaf.side === 'top' && box.top < float.top) messages.push(`I28: ${name} on ${areaText(float.area)} is below ${box.token}, not at the top of its area`)
        else if (float.leaf.side === 'bottom' && box.top > float.top) messages.push(`I28: ${name} on ${areaText(float.area)} is above ${box.token}, not at the bottom of its area`)
      }
    }
    for (const other of floats) {
      const shared = float.leaf.span || other.leaf.span ? other.page === page : other.area === float.area
      if (other.index > float.index && shared && other.top < float.bottom - TOLERANCE && other.bottom > float.top + TOLERANCE) messages.push(`I28: ${name} overlaps float F${other.index} on page ${page}`)
    }
    for (const note of notesOn(page)) {
      if (topOf(note) < float.bottom - TOLERANCE) messages.push(`I28: ${name} on page ${page} ends at ${float.bottom.toFixed(1)} pt, below the note ${note.text} at ${topOf(note).toFixed(1)} pt`)
    }
    if (float.leaf.note && word(`N${float.index}`).page !== page) messages.push(`I28: the note of ${name} is on page ${word(`N${float.index}`).page}, the float on page ${page}`)
    // The anchor: the last flow token before the float. A spanning float's area is its container's part on a page.
    const before = flow.filter(({ index }) => index < float.index).flatMap(({ leaf, index }) => tokensOf(leaf, index)).at(-1)
    if (before !== undefined && (float.leaf.span ? page < word(before).page : float.area < areaOf(word(before)))) messages.push(`I28: ${name} is on ${float.leaf.span ? `page ${page}` : areaText(float.area)}, before its anchor after ${before} on ${areaText(areaOf(word(before)))}`)
  }
  // One queue per side: read by page, the spanning top floats before the column ones, the spanning bottom floats after them.
  for (const side of ['top', 'bottom'] as const) {
    const rank = (float: typeof floats[number]) => (float.leaf.span === true) === (side === 'top') ? 0 : 1
    const placed = floats.filter(float => float.leaf.side === side)
    const order = [...placed].sort((a, b) => a.page - b.page || rank(a) - rank(b) || a.column - b.column || a.top - b.top).map(float => float.index)
    const wrong = order.findIndex((index, at) => index !== placed[at]!.index)
    if (wrong !== -1) messages.push(`I28: the ${side} floats print in the order ${order.map(index => `F${index}`).join(', ')}, not in source order`)
  }
  // A heading keeps with the next flow token, the floats between them left
  // out (I26 through the floats). Three cases are right by the keep rules, so
  // they are not checked:
  // - a heading whose keep chain starts first in its area (no flow token or
  //   float above the chain's first heading there): a move gains nothing, so
  //   the keep gives up (I26);
  // - a heading whose next node is a section of floats alone: the section's
  //   frame (border and padding) stays in the flow when its floats leave, and
  //   the heading keeps with that frame, which holds no token;
  // - when pagination dropped a chain (`PDF_KEEP_IGNORED`), a heading in a
  //   chain through a whole section that ends in a heading: such a chain holds
  //   that section whole, so it can be higher than a page, and then I26 drops
  //   it. Other chains here are a few lines high and are checked.
  const unchecked = new Set<number>()
  type Node = { item: Item, first: number, keeps: boolean, tail: number[] }
  const nodes: Node[] = []
  let offset = 0
  for (const item of spec.items) {
    if (item.kind === 'float') {
      offset += 1
      continue
    }
    if (item.kind === 'heading' || item.kind === 'text') {
      nodes.push({ item, first: offset, keeps: item.kind === 'heading', tail: item.kind === 'heading' ? [offset] : [] })
      offset += 1
      continue
    }
    // A section keeps with its next sibling when its last flow leaf is a heading: the headings that end it chain on.
    const flowAt = item.items.flatMap((leaf, at) => leaf.kind === 'float' ? [] : [{ leaf, index: offset + at }])
    const tail: number[] = []
    for (let at = flowAt.length - 1; at >= 0 && flowAt[at]!.leaf.kind === 'heading'; at -= 1) tail.push(flowAt[at]!.index)
    nodes.push({ item, first: offset, keeps: tail.length > 0, tail })
    offset += item.items.length
  }
  for (const [at, node] of nodes.entries()) {
    const after = nodes[at + 1]
    if (node.item.kind === 'heading' && after?.item.kind === 'section' && after.item.items.every(leaf => leaf.kind === 'float')) unchecked.add(node.first)
  }
  if (keepDropped) {
    for (let at = 0; at < nodes.length;) {
      let end = at
      while (end < nodes.length - 1 && nodes[end]!.keeps) end += 1
      const chain = nodes.slice(at, end)
      if (chain.some(node => node.item.kind === 'section')) for (const node of chain) node.tail.forEach(index => unchecked.add(index))
      at = end + 1
    }
  }
  for (const [at, { leaf, index }] of flow.entries()) {
    const next = flow[at + 1]
    if (leaf.kind !== 'heading' || next === undefined || unchecked.has(index)) continue
    const heading = word(`H${index}`)
    const start = word(tokensOf(next.leaf, next.index)[0]!)
    const area = areaOf(heading)
    // The chain's first heading in this area: the headings right before it keep with it.
    let first = at
    while (first > 0 && flow[first - 1]!.leaf.kind === 'heading' && areaOf(word(`H${flow[first - 1]!.index}`)) === area) first -= 1
    const chainTop = topOf(word(`H${flow[first]!.index}`))
    const above = flowBoxes.some(box => box.area === area && box.top < chainTop - TOLERANCE) || floats.some(float => float.area === area && float.top < chainTop - TOLERANCE)
    if (!above) continue
    if (area !== areaOf(start)) messages.push(`I28: heading H${index} with keepWithNext is on ${areaText(area)}, the next flow token ${start.text} on ${areaText(areaOf(start))}`)
  }
  return messages
}
