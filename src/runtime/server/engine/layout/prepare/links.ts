import { PDF_PRIMITIVES } from '../../../../primitives'
import type { ElementNode, LayoutNode, PreparedDocument } from '../types'

const isString = (node: LayoutNode): boolean => node.type === PDF_PRIMITIVES.TextInstance
const isText = (node: LayoutNode): boolean => node.type === PDF_PRIMITIVES.Text

/**
 * A link around text is laid out as text, so its words flow and wrap with the
 * text style: a link with a page token (`render`) becomes a text itself, and a
 * link around strings, or strings and texts, gets one text inside. A link
 * around texts only, or around other elements, stays a box.
 */
const substitute = (link: ElementNode): ElementNode => {
  if ('render' in link.props) return { ...link, type: PDF_PRIMITIVES.Text }
  const children = link.children ?? []
  const wrap = children.every(isString)
    || (!children.every(isText) && children.every(child => isString(child) || isText(child)))
  if (!wrap) return link
  return { ...link, children: [{ type: PDF_PRIMITIVES.Text, props: {}, style: {}, box: {}, children: link.children }] }
}

const withLinks = <Node extends LayoutNode>(node: Node): Node => {
  if (!('children' in node) || !node.children) return node
  const children = node.children.map((child) => {
    const inner = withLinks(child)
    return inner.type === PDF_PRIMITIVES.Link ? substitute(inner) : inner
  })
  return { ...node, children }
}

export const resolveLinkSubstitution = (root: PreparedDocument): PreparedDocument =>
  ({ ...root, children: root.children.map(withLinks) })
