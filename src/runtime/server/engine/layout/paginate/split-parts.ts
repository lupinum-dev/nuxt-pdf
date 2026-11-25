import { PDF_PRIMITIVES } from '../../../../primitives'
import type { MeasuredNode } from '../types'
import { isAbsolute, isFixed, isText } from './rules'

// What the page builder reads of the parts it makes: the marks it sets on
// nodes and whether a part shows or places content.

/**
 * Set on the rows that cells over several rows hold together when they stay
 * cut at the page end: on the first row, the height of the rows and the room
 * a page had for them; on the others, `true`. `collectLayoutWarnings` reports
 * the rows once as `PDF_UNBREAKABLE_NODE_OVERFLOW`, as no single node of them
 * needs to be higher than the page. A single block that cannot split gets the
 * same mark when it stays cut because it is higher than the room below the
 * fixed nodes that repeat in its container, though not higher than the page.
 */
export const SPAN_GROUP_OVERFLOW_PROP = '__nuxtPdfSpanGroupOverflow'

/** A text with a line, a leaf other than a view, or a container with such a node inside. */
export const showsContent = (node: MeasuredNode): boolean => {
  if (isText(node)) return Array.isArray(node.lines) && node.lines.length > 0
  if (Array.isArray(node.children) && node.children.length > 0) return elementsOf(node).some(showsContent)
  return node.type !== PDF_PRIMITIVES.View
}

/**
 * On the part of a row child with nothing to show on a page (`emptyRowPart`).
 * The part keeps it when it is laid out again, so a later page still knows
 * the part for what it is (`placesFlow`), also when the row stretched it.
 */
export const EMPTY_ROW_PART_PROP = '__nuxtPdfEmptyRowPart'

/**
 * A part that keeps flow content on this page: a line, a leaf such as an
 * image, or the box of a view without children that has a height (a spacer,
 * a coloured block; the next part of it is lower). Fixed nodes repeat on
 * every page and empty row parts paint nothing, so a part with only those
 * leaves the next page as much as before.
 */
export const placesFlow = (node: MeasuredNode): boolean => {
  if (isFixed(node)) return false
  if (isText(node)) return Array.isArray(node.lines) && node.lines.length > 0
  if (Array.isArray(node.children) && node.children.length > 0) return elementsOf(node).some(placesFlow)
  return node.type !== PDF_PRIMITIVES.View || (node.props[EMPTY_ROW_PART_PROP] !== true && node.box.height > 0)
}

/** A view paints its own box: a background or a border. */
export const paintsBox = (node: MeasuredNode): boolean => Boolean(node.style?.backgroundColor)
  || (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const).some(key => (node.box[key] || 0) > 0)

/** The element children of a container (strings only occur inside texts). */
export const elementsOf = (node: MeasuredNode): MeasuredNode[] =>
  node.children.filter(child => child.type !== PDF_PRIMITIVES.TextInstance)

/**
 * A node in the flow of its container for a keep: neither repeated on every
 * page (`fixed`) nor absolute. A node with `fixed: false` is in the flow.
 */
export const inFlow = (node: MeasuredNode): boolean => !isFixed(node) && !isAbsolute(node)
