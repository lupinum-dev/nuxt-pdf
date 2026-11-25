import { NuxtPdfError, PDF_ERROR_CODES } from '../../../../shared/errors'
import { PDF_PRIMITIVES } from '../../../../primitives'
import type { Line } from '../../text'
import { relabelRange } from '../../text/lines'
import { logicalPlaces } from '../../text/reorder'
import { RESERVED_DIGITS_PROP, type ReservedDigits } from '../text/fragments'
import { transformText } from '../text/transform'
import type { ElementNode, ElementType, MeasuredNode, NumberedProps, PageInfo, ResolvedStyle, StringNode, Style } from '../types'

// A node with a `render` callback is dynamic: page tokens return the text of
// their page, page-conditional carriers the node they show or null
// (plain-tree.ts). Pagination calls it per page and lays the page out again.

/**
 * What a callback returned has its raw style as a list of entries; every
 * other node keeps its resolved style (one object), which relayout does not
 * resolve again (styles/resolve-styles.ts, `resolvePageStyles`).
 */
type AnyStyle = Style[] | ResolvedStyle

/** A node before relayout styles what callbacks returned. */
export type UnstyledNode = Omit<ElementNode<AnyStyle, NumberedProps>, 'children'> & { children: Node[] }
type Node = StringNode<AnyStyle> | UnstyledNode

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/**
 * The nodes a `render` result stands for. The callbacks of plain-tree.ts
 * return a string (a page token; empty before the total is known), an
 * element `{ type, props: { style, children, ...props } }` or null (a
 * page-conditional node not shown on this page); anything else is an error.
 */
const instancesOf = (result: unknown): Node[] => {
  if (!result) return []
  if (typeof result === 'string') return [{ type: PDF_PRIMITIVES.TextInstance, value: result }]
  if (!isRecord(result) || typeof result.type !== 'string' || !isRecord(result.props)) {
    throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, 'A render callback returned something other than text or an element.')
  }
  const { style, children, ...props } = result.props
  // The callbacks return the type, props and style of an admitted node
  // (plain-tree.ts, `toEngineElement`).
  return [{
    type: result.type as ElementType,
    style: [(style ?? []) as Style | Style[]].flat(),
    props: props as NumberedProps,
    children: [children].flat().flatMap(instancesOf),
  }]
}

const isDynamic = (node: UnstyledNode): boolean => 'render' in node.props

/**
 * What the callback of a dynamic text returns (plain-tree.ts, `dynamicText`):
 * its static strings and token values, in order; `page` marks a page number or
 * count, which takes reserved digits while the page builder pages (`reserve`).
 */
export type TextParts = readonly { readonly value: string, readonly token: boolean, readonly page?: boolean }[]

/** A place in the parts of a dynamic text: the part's index, the offset in its value. */
type PartPosition = { part: number, offset: number }

/**
 * On a part of a dynamic text split between pages or columns: where in the
 * parts it starts and ends (`to` undefined: at the end). Each rendering
 * shows only that range, so a page renders its own part with its own values,
 * and the rest starts exactly where the part before it ended.
 */
const RANGE_PROP = '__nuxtPdfTextRange'
type Range = { from: PartPosition, to?: PartPosition }

/**
 * On a rendered dynamic text: the range it was rendered for, the parts it
 * shows, and where in its laid-out string its first line starts (a part that
 * a split made keeps the string and the lines of the text it came from).
 */
const SHOWN_PROP = '__nuxtPdfTextShown'
type Shown = { range: Range, parts: TextParts, start: number }

const rangeOf = (node: { props: NumberedProps }): Range => (node.props[RANGE_PROP] as Range | undefined) ?? { from: { part: 0, offset: 0 } }

/** The parts in a range: those outside dropped, the ones at its ends cut. */
const partsIn = (parts: TextParts, { from, to }: Range): TextParts => parts
  .slice(from.part, to === undefined ? undefined : to.part + 1)
  .map((part, at) => ({ ...part, value: part.value.slice(at === 0 ? from.offset : 0, to !== undefined && from.part + at === to.part ? to.offset : undefined) }))

const sameParts = (one: TextParts, other: TextParts): boolean =>
  one.length === other.length && one.every((part, at) => part.value === other[at]!.value)

/** The text a dynamic text's callback returned, whole: the 'auto' column measure reads it. */
export const renderedText = (result: unknown): string =>
  typeof result === 'string' ? result : Array.isArray(result) ? (result as TextParts).map(part => part.value).join('') : ''

/** Laid-out characters that are not in any line: line breaks and soft hyphens (CONTRACTS.md, "Lines of a text"). */
const NOT_IN_LINES = new Set(['\n', '\r', '\u00AD'])

/**
 * The props of the two parts of a dynamic text split after its first
 * `count` lines, or undefined for a text that shows no parts. The kept lines
 * are walked against the laid-out string (each line is a slice of it, without
 * line breaks and soft hyphens, with a hyphen added where a word was split),
 * and the place where they end is mapped to the parts. A cut inside a token
 * value moves to its end: the token stays whole on the page of its first
 * glyph.
 */
export const dynamicTextCut = (node: MeasuredNode, lines: readonly Line[], count: number): [NumberedProps, NumberedProps] | undefined => {
  const shown = node.props[SHOWN_PROP] as Shown | undefined
  const string = node.children[0]
  if (shown === undefined || string?.type !== PDF_PRIMITIVES.TextInstance) return undefined
  const transform = string.style?.textTransform
  const laidOut = transformText(string.value, transform)
  let cursor = shown.start
  for (const line of lines.slice(0, count)) {
    for (const char of line.string) {
      while (laidOut[cursor] !== char && NOT_IN_LINES.has(laidOut[cursor] ?? '')) cursor += 1
      if (laidOut[cursor] === char) cursor += 1
    }
  }
  const { from } = shown.range
  let left = cursor
  let cut: PartPosition = { part: from.part + shown.parts.length, offset: 0 }
  for (const [at, part] of shown.parts.entries()) {
    const length = transformText(part.value, transform).length
    if (left < length) {
      // The offset in the value whose transformed prefix is `left` long.
      let offset = left
      if (length !== part.value.length) for (offset = 0; transformText(part.value.slice(0, offset), transform).length < left;) offset += 1
      const base = at === 0 ? from.offset : 0
      cut = part.token && left > 0 ? { part: from.part + at + 1, offset: 0 } : { part: from.part + at, offset: base + offset }
      break
    }
    left -= length
  }
  const { to } = rangeOf(node)
  return [
    { ...node.props, [RANGE_PROP]: { from: rangeOf(node).from, to: cut } },
    { ...node.props, [RANGE_PROP]: { from: cut, to }, [SHOWN_PROP]: { ...shown, start: cursor } },
  ]
}

/** Whether the node or a node inside it is dynamic. */
export const hasDynamicNodes = (node: UnstyledNode): boolean =>
  isDynamic(node) || node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance && hasDynamicNodes(child))

const resolveNode = (page: PageInfo, node: Node): Node =>
  node.type === PDF_PRIMITIVES.TextInstance
    ? { ...node, box: undefined, lines: undefined, children: [] } satisfies StringNode<AnyStyle>
    : resolveDynamicNodes(page, node)

/**
 * The node with every dynamic node's children replaced by what its callback
 * returns for `page`. A dynamic text gets no lines and a box of height 0, so
 * the relayout measures its new text. Every node is rebuilt with `box`,
 * `lines` and `children` keys, strings too, as upstream does.
 */
export const resolveDynamicNodes = <Node extends UnstyledNode>(page: PageInfo, node: Node): Node => {
  if (!isDynamic(node)) return { ...node, children: node.children.map(child => resolveNode(page, child)) }
  const result = node.props.render?.(page)
  const box = node.type === PDF_PRIMITIVES.Text ? { ...node.box, height: 0 } : node.box
  if (!Array.isArray(result)) return { ...node, box, lines: null, children: instancesOf(result).map(child => resolveNode(page, child)) }
  const range = rangeOf(node)
  const parts = partsIn(result as TextParts, range)
  // Unchanged parts: the text keeps its lines. Laid out again, a part cut
  // from a longer text could break its lines otherwise (the breaks are
  // chosen for the whole paragraph) and need more room than it has.
  const before = node.props[SHOWN_PROP] as Shown | undefined
  if (node.lines && before && sameParts(partsIn(result as TextParts, before.range), before.parts)) return node
  // Only the total changes a part's values on its own page: empty while the
  // pages are split, it can grow the part beyond the room the split gave it.
  if (node.lines && before && range.to !== undefined) {
    throw new NuxtPdfError(PDF_ERROR_CODES.LayoutError, 'A text with <PdfPageCount> cannot split over pages or columns yet. Put the page count in a text that fits where it starts, such as a footer.')
  }
  const shown: Shown = { range, parts, start: 0 }
  const string = { type: PDF_PRIMITIVES.TextInstance, value: parts.map(part => part.value).join(''), box: undefined, lines: undefined, children: [] } satisfies StringNode<AnyStyle>
  const { [RESERVED_DIGITS_PROP]: _reserved, ...props } = node.props
  const reserved = page.reserve === undefined ? [] : reservedRanges(parts)
  return { ...node, box, lines: null, props: { ...props, [SHOWN_PROP]: shown, ...(reserved.length > 0 ? { [RESERVED_DIGITS_PROP]: reserved } : {}) }, children: [string] }
}

/** Where the page tokens of `parts` stand in their joined string. */
const reservedRanges = (parts: TextParts): ReservedDigits => {
  const ranges: [number, number][] = []
  let at = 0
  for (const part of parts) {
    if (part.page) ranges.push([at, at + part.value.length])
    at += part.value.length
  }
  return ranges
}

/**
 * The node with every page number and count that took reserved digits
 * (`reserve`) showing its value for `page`, inside the width its line kept,
 * placed by the text's alignment; the lines and their breaks stay
 * (`relabelRange`). Each token's characters in the laid-out string are found
 * in the lines as `dynamicTextCut` walks them, in logical order: a line with
 * right-to-left text holds its characters in visual order, where a number
 * stays one left-to-right range (or one range in reverse, in a right-to-left
 * override). Instead of the node: why a number cannot be painted, when its
 * digits are not one range of one line (a bug), or when it is
 * wider than its room (more digits than the reserve, or a font that moves
 * these digits apart).
 */
export const relabelPageTokens = <Node extends MeasuredNode>(page: PageInfo, node: Node): Node | 'reordered' | 'wider' => {
  const shown = node.props[SHOWN_PROP] as Shown | undefined
  const reserved = node.props[RESERVED_DIGITS_PROP] as ReservedDigits | undefined
  if (shown === undefined || reserved === undefined || !node.lines) {
    if (!node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance)) return node
    const children: Node['children'] = []
    for (const child of node.children) {
      const relabelled = child.type === PDF_PRIMITIVES.TextInstance ? child : relabelPageTokens(page, child)
      if (typeof relabelled === 'string') return relabelled
      children.push(relabelled)
    }
    return { ...node, children }
  }
  const string = node.children[0]
  if (string?.type !== PDF_PRIMITIVES.TextInstance) return node
  const values = partsIn(node.props.render?.(page) as TextParts, shown.range)
  const transform = string.style?.textTransform
  const laidOut = transformText(string.value, transform)
  // The places of the page tokens in the laid-out string: the lines hold the font's widest digit there (fragments.ts).
  const digits = new Set<number>()
  let end = 0
  for (const part of shown.parts) {
    const length = transformText(part.value, transform).length
    if (part.page) for (let at = end; at < end + length; at += 1) digits.add(at)
    end += length
  }
  const same = (at: number, char: string | undefined) => laidOut[at] === char || (digits.has(at) && char !== undefined && char >= '0' && char <= '9')
  // Each laid-out character's line and place in it.
  const places = new Map<number, [number, number]>()
  let cursor = shown.start
  for (const [index, line] of node.lines.entries()) {
    for (const at of logicalPlaces(line)) {
      const char = line.string[at]
      while (!same(cursor, char) && NOT_IN_LINES.has(laidOut[cursor] ?? '')) cursor += 1
      if (same(cursor, char)) places.set(cursor++, [index, at])
    }
  }
  let offset = 0
  const tokens: { line: number, at: number, length: number, label: string }[] = []
  for (const [index, part] of shown.parts.entries()) {
    const start = offset
    offset += transformText(part.value, transform).length
    // A part of a split text: its lines hold the characters from `shown.start` to `cursor`; the tokens
    // before or after are another part's.
    if (!part.page || start < shown.start || start >= cursor) continue
    const first = places.get(start)
    if (first === undefined) return 'reordered'
    const length = offset - start
    // A right-to-left override (U+202E) shows the digits from right to left: one range of the line, reversed.
    const step = places.get(start + 1)?.[1] === first[1] - 1 ? -1 : 1
    for (let char = start; char < offset; char += 1) {
      const place = places.get(char)
      if (place?.[0] !== first[0] || place[1] !== first[1] + step * (char - start)) return 'reordered'
    }
    const label = values[index]?.value ?? ''
    tokens.push(step === 1
      ? { line: first[0], at: first[1], length, label }
      : { line: first[0], at: first[1] - length + 1, length, label: [...label].reverse().join('') })
  }
  const lines = [...node.lines]
  // From the last place in each line back, so a relabel leaves the places before it as they were.
  for (const { line, at, length, label } of tokens.sort((a, b) => b.line - a.line || b.at - a.at)) {
    const relabelled = relabelRange(lines[line]!, at, at + length, label)
    if (relabelled === undefined) return 'wider'
    lines[line] = relabelled
  }
  return { ...node, lines }
}
