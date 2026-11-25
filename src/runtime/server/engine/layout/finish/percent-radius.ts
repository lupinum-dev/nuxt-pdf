import { PDF_PRIMITIVES } from '../../../../primitives'
import { percentOf } from '../styles/percent'
import type { Box, MeasuredDocument, ResolvedStyle, StyledLayoutNode } from '../types'

const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const

/**
 * A corner radius in points: a percentage of the shorter box side (CSS takes
 * each axis apart; a PDF corner is round, so one radius serves both). A radius
 * of 0 becomes undefined, which the painter draws as square, as before.
 */
const radiusOf = (value: unknown, box: Partial<Box> | undefined): unknown => {
  if (!value) return undefined
  const fraction = percentOf(value)
  return fraction === undefined ? value : fraction * Math.min(Number(box?.width), Number(box?.height))
}

/** The style with its corner radii resolved; a new object without a prototype, as before. */
const withRadii = (style: object, box: Partial<Box> | undefined): ResolvedStyle => {
  const resolved: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(style)) {
    resolved[key] = (CORNERS as readonly string[]).includes(key) ? radiusOf(value, box) : value
  }
  return resolved
}

const withPercentRadius = <Node extends StyledLayoutNode>(node: Node): Node => {
  const box = node.type === PDF_PRIMITIVES.TextInstance ? undefined : node.box
  const styled = { ...node, style: withRadii(node.style ?? {}, box) }
  return styled.type === PDF_PRIMITIVES.TextInstance || !styled.children ? styled : { ...styled, children: styled.children.map(withPercentRadius) }
}

/**
 * Percentage corner radii to points, once every box is known. The document
 * gets a copy of its style (an empty one when it had none), as before; a
 * document has no style prop and no box, so there is no radius to resolve.
 */
export const resolvePercentRadius = (root: MeasuredDocument): MeasuredDocument =>
  ({ ...root, style: { ...root.style }, children: root.children.map(withPercentRadius) })
