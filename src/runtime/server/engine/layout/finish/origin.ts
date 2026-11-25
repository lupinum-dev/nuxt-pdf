import { PDF_PRIMITIVES } from '../../../../primitives'
import type { LaidOutDocument, LaidOutNode, MeasuredDocument, MeasuredNode } from '../types'

const center = (start: number, size: number): number => start + size * 0.5

/**
 * The origin of a node's transforms: the center of its box. `transformOrigin`
 * is not an admitted style key (PDF_STYLE_VALUES), so it is always the default
 * 50 % 50 %. Every element has its full box by now; strings get no origin.
 */
const withOrigin = (node: MeasuredNode): LaidOutNode => {
  const { box } = node
  const origin = { left: center(box.left, box.width), top: center(box.top, box.height) }
  return { ...node, origin, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : withOrigin(child)) }
}

export const resolveOrigin = (root: MeasuredDocument): LaidOutDocument =>
  ({ ...root, children: root.children.map(withOrigin) })
