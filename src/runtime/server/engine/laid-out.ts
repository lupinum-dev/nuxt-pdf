// Reading the laid-out tree: its pages, a walk over the elements of one page,
// and the key that names a node on every page it reaches. The layout pass,
// the diagnostics, the destinations and the write read the tree through it.
//
// A string node never holds an id, a bookmark or a layout key (inside an SVG
// text it inherits only paint props, svg/index.ts), so the walks visit
// elements only.

import type { SafeDocumentNode } from './layout/index'
import type { LaidOutNode, ResolvedStyle, StringNode } from './layout/types'
import { PDF_PRIMITIVES } from '../../primitives'

/**
 * The engine-tree prop that names a node in a laid-out tree: views the
 * multi-pass loop may move to a new page, unbreakable blocks and pages for the
 * oversized-block check. Only the adapter writes it (`toEngineDocument`);
 * authors cannot, because the renderer accepts only the props of the primitive
 * table. Every split fragment and every page a `PdfPage` breaks into keeps its
 * node's props, so the key is found on every page the node reaches.
 */
export const LAYOUT_KEY_PROP = '__nuxtPdfKey'

export const layoutKey = (node: { props: Readonly<Record<string, unknown>> }): string | undefined => {
  const key = node.props[LAYOUT_KEY_PROP]
  return typeof key === 'string' ? key : undefined
}

export const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** The elements among a laid-out node's children. */
export const elementChildren = (node: LaidOutNode): LaidOutNode[] =>
  (Array.isArray(node.children) ? node.children : []).filter((child): child is LaidOutNode => child.type !== PDF_PRIMITIVES.TextInstance)

/** The laid-out pages in order: `layout.children`, the final page list of `resolvePagination`. */
export const documentPages = (layout: SafeDocumentNode): LaidOutNode[] => layout.children

/** The number of laid-out pages in a serialized document. */
export const countPages = (layout: SafeDocumentNode): number =>
  documentPages(layout).length

// Depth-first walk over the elements of one final page tree. Recurse only
// into an actual array of children, and not below a node for which `visit`
// returns false.
export const visitPageNodes = (
  page: LaidOutNode | StringNode<ResolvedStyle>,
  visit: (node: LaidOutNode) => unknown,
): void => {
  if (page.type === PDF_PRIMITIVES.TextInstance) return
  if (visit(page) === false) return
  const children = page.children
  if (Array.isArray(children)) {
    for (const child of children) visitPageNodes(child, visit)
  }
}
