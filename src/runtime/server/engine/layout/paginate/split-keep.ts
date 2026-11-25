import { PDF_ROW_SPAN_PROP } from '../../../../primitives'
import type { MeasuredNode } from '../types'
import { hasBreak, isRowContainer, isText } from './rules'
import { elementsOf, inFlow, paintsBox, showsContent } from './split-parts'

// What the keep rules read of the flow (layout/paginate/builder.ts): which
// nodes a page reaches, which keep with the next one, and which rows the
// cells over several rows hold together.

/**
 * The index of the last row that cells over several rows hold together with
 * `nodes[index]` (D39): a table row whose cells carry `PDF_ROW_SPAN_PROP`
 * covers the rows after it, and a span from a covered row extends the group.
 * `index` itself for a node that starts no group.
 */
export const spanGroupEnd = (nodes: readonly MeasuredNode[], index: number): number => {
  let end = index
  for (let row = index; row <= end && row < nodes.length; row += 1) {
    for (const cell of elementsOf(nodes[row]!)) {
      const count = cell.props[PDF_ROW_SPAN_PROP]
      if (typeof count === 'number') end = Math.max(end, row + count - 1)
    }
  }
  return Math.min(end, nodes.length - 1)
}

/**
 * A sibling that a keep reaches: in the flow, and showing content or
 * painting a box. An empty anchor view (`<PdfView id="…" />`) or an empty
 * spacer is skipped, so the keep reaches the content after it.
 */
export const reached = (node: MeasuredNode): boolean => inFlow(node) && (showsContent(node) || paintsBox(node))

/** The index of the first sibling after `index` that a keep reaches, or -1. */
export const nextReached = (nodes: readonly MeasuredNode[], index: number): number => {
  for (let at = index + 1; at < nodes.length; at += 1) {
    if (reached(nodes[at]!)) return at
  }
  return -1
}

/**
 * Whether a node keeps with the node after it: it has `keepWithNext`, or it
 * is a column container whose last flow child that shows or paints
 * something keeps (as CSS passes `break-after: avoid` of a last child to its
 * parent; an anchor after it does not end the keep).
 */
export const keepsWithNext = (node: MeasuredNode): boolean => {
  if (node.props.keepWithNext === true) return true
  if (isText(node) || isRowContainer(node) || !Array.isArray(node.children)) return false
  const children = elementsOf(node)
  for (let at = children.length - 1; at >= 0; at -= 1) {
    if (reached(children[at]!)) return keepsWithNext(children[at]!)
  }
  return false
}

/**
 * On a page: the keeps the page builder dropped there (`PDF_KEEP_IGNORED`), each as the type and source of the
 * first node of its chain.
 */
export const KEEP_IGNORED_PROP = '__nuxtPdfKeepIgnored'

/**
 * The first node of the keep chain that `nodes[index]` belongs to: back over the siblings that keep with the next
 * one, up to one that does not or a forced break. `chains` remembers it for every node of the chain, so a render
 * walks each chain once, and a chain that goes on over pages keeps its first node.
 */
export const chainStartOf = (nodes: readonly MeasuredNode[], index: number, chains: WeakMap<MeasuredNode, MeasuredNode>): MeasuredNode => {
  const known = chains.get(nodes[index]!)
  if (known !== undefined) return known
  let start = index
  for (let before = previousReached(nodes, start); before !== -1 && keepsWithNext(nodes[before]!) && !hasBreak(nodes[start]!); before = previousReached(nodes, start)) {
    start = before
    if (chains.has(nodes[start]!)) break
  }
  const first = chains.get(nodes[start]!) ?? nodes[start]!
  for (let at = start; ;) {
    chains.set(nodes[at]!, first)
    const next = nextReached(nodes, at)
    if (next === -1 || !keepsWithNext(nodes[at]!) || hasBreak(nodes[next]!)) return first
    at = next
  }
}

/** The index of the last sibling before `index` that a keep reaches, or -1. */
export const previousReached = (nodes: readonly MeasuredNode[], index: number): number => {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (reached(nodes[at]!)) return at
  }
  return -1
}
