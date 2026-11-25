import type { MeasuredNode } from '../types'
import { dynamicTextCut } from './dynamic'
import { linesOf, SAFETY_THRESHOLD } from './rules'

export const lineHeights = (node: MeasuredNode): number[] => linesOf(node).map(line => Number(line.box?.height))

/** The number of whole lines that fit in `height`; a float residual past it still fits (SAFETY_THRESHOLD, as for the keep). */
const lineIndexAtHeight = (node: MeasuredNode, height: number): number => {
  let y = 0
  const heights = lineHeights(node)
  for (const [index, lineHeight] of heights.entries()) {
    if (y + lineHeight > height + SAFETY_THRESHOLD) return index
    y += lineHeight
  }
  return heights.length
}

/** The height of the first `index` lines. */
export const heightAtLineIndex = (node: MeasuredNode, index: number): number =>
  lineHeights(node).slice(0, index).reduce((sum, lineHeight) => sum + lineHeight, 0)

/**
 * How many lines of a text stay on the page when it ends `height` below the
 * parent's top. Orphans (lines kept at the bottom, default 2) and widows
 * (lines carried to the top of the next page, default 2) move the break:
 *
 * - no line fits: none stay;
 * - every line fits: all stay; the box is only taller than its lines (a row
 *   stretched it) (T5);
 * - fewer lines fit than orphans, or the text is too short for both: none
 *   (a text with fewer lines than orphans moves whole);
 * - exactly orphans plus widows lines: the orphans stay;
 * - fewer lines left than widows: lines move so the widows go along (T4).
 */
const textTop = (node: MeasuredNode): number =>
  node.box.top + node.box.borderTopWidth + node.box.paddingTop

const lineBreakOf = (node: MeasuredNode, height: number): number => {
  const top = textTop(node)
  const widows = node.props.widows || 2
  const orphans = node.props.orphans || 2
  const lines = linesOf(node).length
  const fitting = lineIndexAtHeight(node, height - top)
  if (fitting === 0) return 0
  if (fitting >= lines) return lines
  if (fitting < orphans || lines < orphans + widows) return 0
  if (lines === orphans + widows) return orphans
  if (lines - fitting < widows) return lines - widows
  return fitting
}

/**
 * The lines a text needs to start a page: its orphans, or all of its lines
 * when it is too short for orphans and widows.
 */
export const startLines = (node: MeasuredNode): number => {
  const lines = linesOf(node).length
  const widows = node.props.widows || 2
  const orphans = node.props.orphans || 2
  return lines < orphans + widows ? lines : Math.min(orphans, lines)
}

/**
 * A text split at its line break: the lines above stay, the rest starts the
 * next part at its top. The current part loses its bottom edge (margin,
 * padding, border, rounded corners), the next part its top edge.
 *
 * A text whose start (`startLines`) is higher than the content area never
 * fits a page: moved, it would start every page the same way, forever. With
 * no flow content above it, it keeps the lines that fit, at least one, and
 * may cut its first line at the page end; when that is all of them, it has
 * no next part.
 */
export const splitText = (node: MeasuredNode, height: number, contentArea: number, pageHasContent: boolean): [MeasuredNode, MeasuredNode | null] => {
  const lines = linesOf(node)
  const neverFits = heightAtLineIndex(node, startLines(node)) > contentArea && !pageHasContent
  const index = neverFits ? Math.max(1, lineIndexAtHeight(node, height - textTop(node))) : lineBreakOf(node, height)
  if (neverFits && index >= lines.length) return [node, null]
  const currentHeight = heightAtLineIndex(node, index)
  // A dynamic text: each part renders only its own range of the parts.
  const [currentProps, nextProps] = dynamicTextCut(node, lines, index) ?? [node.props, node.props]
  const current: MeasuredNode = {
    ...node,
    props: currentProps,
    box: { ...node.box, height: currentHeight, borderBottomWidth: 0 },
    style: { ...node.style, marginBottom: 0, paddingBottom: 0, borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
    lines: lines.slice(0, index),
  }
  const next: MeasuredNode = {
    ...node,
    props: nextProps,
    box: { ...node.box, top: 0, height: node.box.height - currentHeight, borderTopWidth: 0 },
    style: { ...node.style, marginTop: 0, paddingTop: 0, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
    lines: lines.slice(index),
  }
  return [current, next]
}
