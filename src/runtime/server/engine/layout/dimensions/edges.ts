import { Edge, type Node as YogaNode } from 'yoga-layout/load'
import type { Box, ResolvedStyle } from '../types'

/** What the edge readers look at: a node during or after measuring. */
export type EdgeSource = { style?: ResolvedStyle, box?: Partial<Box>, yogaNode?: YogaNode }

// Each edge is what yoga computed while the node has a yoga node, else the
// box a layout gave it, else the style, else 0. A style value yoga resolves
// (`'0%'`, a margin of `'auto'`) counts as 0 there: an edge is a number.
const edge = (computed: number | undefined, box: number | undefined, style: unknown): number =>
  computed ?? box ?? (typeof style === 'number' ? style : 0)

/** A node's paddings (see above). */
export const getPadding = ({ style, box, yogaNode }: EdgeSource) => ({
  paddingTop: edge(yogaNode?.getComputedPadding(Edge.Top), box?.paddingTop, style?.paddingTop),
  paddingRight: edge(yogaNode?.getComputedPadding(Edge.Right), box?.paddingRight, style?.paddingRight),
  paddingBottom: edge(yogaNode?.getComputedPadding(Edge.Bottom), box?.paddingBottom, style?.paddingBottom),
  paddingLeft: edge(yogaNode?.getComputedPadding(Edge.Left), box?.paddingLeft, style?.paddingLeft),
})

/** A node's margins (see above). */
export const getMargin = ({ style, box, yogaNode }: EdgeSource) => ({
  marginTop: edge(yogaNode?.getComputedMargin(Edge.Top), box?.marginTop, style?.marginTop),
  marginRight: edge(yogaNode?.getComputedMargin(Edge.Right), box?.marginRight, style?.marginRight),
  marginBottom: edge(yogaNode?.getComputedMargin(Edge.Bottom), box?.marginBottom, style?.marginBottom),
  marginLeft: edge(yogaNode?.getComputedMargin(Edge.Left), box?.marginLeft, style?.marginLeft),
})
