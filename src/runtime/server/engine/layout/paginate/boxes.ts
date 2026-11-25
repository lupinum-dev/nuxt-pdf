import type { MeasuredNode } from '../types'
import { isAbsolute } from './rules'

// Heights and the pieces a split makes. A piece is a node; its box height is
// its height on any page (stage 1, or the sum of what it still holds).

export const edgesTop = (node: MeasuredNode) => (node.box.borderTopWidth ?? 0) + (node.box.paddingTop ?? 0)
export const edgesBottom = (node: MeasuredNode) => (node.box.borderBottomWidth ?? 0) + (node.box.paddingBottom ?? 0)
export const gapOf = (node: MeasuredNode) => Number(node.style.rowGap ?? 0)
export const marginTop = (node: MeasuredNode) => node.box.marginTop ?? 0
export const marginBottom = (node: MeasuredNode) => node.box.marginBottom ?? 0
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** The height of nodes stacked with `gap` between them; an absolute node takes none. */
export const stackHeight = (all: MeasuredNode[], gap: number) => {
  const nodes = all.filter(node => !isAbsolute(node))
  return sum(nodes.map(node => marginTop(node) + node.box.height + marginBottom(node))) + gap * Math.max(0, nodes.length - 1)
}

export const withoutTop = (node: MeasuredNode) => ({
  style: { ...node.style, marginTop: 0, paddingTop: 0, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  box: { ...node.box, marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
})
export const withoutBottom = (node: MeasuredNode) => ({
  style: { ...node.style, marginBottom: 0, paddingBottom: 0, borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  box: { ...node.box, marginBottom: 0, paddingBottom: 0, borderBottomWidth: 0 },
})
