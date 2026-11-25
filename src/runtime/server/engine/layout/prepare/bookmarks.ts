import { PDF_PRIMITIVES } from '../../../../primitives'
import type { Bookmark, ElementNode, LayoutNode, NumberedProps, PreparedDocument, PreparedNode, SizedDocument, StringNode } from '../types'

/**
 * Numbers the bookmarks in source order (depth first) and gives each the
 * number of its nearest bookmarked ancestor, which nests them in the outline;
 * the outline orders siblings by number (`pdf/outline.ts`). A title alone
 * becomes a bookmark that is neither fitted nor expanded. The tree is
 * rebuilt; the input is not changed.
 */
export const resolveBookmarks = (root: SizedDocument): PreparedDocument => {
  const numbered = new Map<ElementNode, Bookmark>()
  // The stack holds the nodes still to visit, the next one last.
  const stack: { node: LayoutNode, parent: Bookmark | undefined }[]
    = root.children.map(node => ({ node, parent: undefined })).reverse()
  let refs = 0
  while (stack.length > 0) {
    const { node, parent: above } = stack.pop()!
    if (node.type === PDF_PRIMITIVES.TextInstance) continue
    let parent = above
    const { bookmark } = node.props
    if (bookmark) {
      const value = typeof bookmark === 'string' ? { title: bookmark, fit: false, expanded: false } : bookmark
      parent = { ref: refs++, parent: parent?.ref, ...value }
      numbered.set(node, parent)
    }
    for (const child of [...(node.children ?? [])].reverse()) stack.push({ node: child, parent })
  }

  const propsOf = (node: ElementNode): NumberedProps => {
    const bookmark = numbered.get(node)
    if (bookmark) return { ...node.props, bookmark }
    // A bookmark that is not numbered is empty ('' or null): no outline entry.
    const { bookmark: _empty, ...props } = node.props
    return props
  }
  const rebuilt = (node: LayoutNode): StringNode | PreparedNode => node.type === PDF_PRIMITIVES.TextInstance
    ? node
    : { ...node, props: propsOf(node), children: node.children?.map(rebuilt) }
  return { ...root, children: root.children.map(page => ({ ...page, props: propsOf(page), children: page.children?.map(rebuilt) })) }
}
