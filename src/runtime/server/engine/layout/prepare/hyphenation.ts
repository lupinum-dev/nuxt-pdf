import { PDF_PRIMITIVES } from '../../../../primitives'
import type { PatternKey } from '../../text'
import { HYPHENATION_PROP } from '../text/layout'
import type { LayoutNode, PreparedDocument } from '../types'

const withPatterns = <Node extends LayoutNode>(node: Node, patterns: PatternKey): Node => {
  // SVG text does not wrap, so it needs no patterns.
  if (!('children' in node) || !node.children || node.type === PDF_PRIMITIVES.Svg) return node
  const children = node.children.map(child => withPatterns(child, patterns))
  return node.type === PDF_PRIMITIVES.Text
    ? { ...node, props: { ...node.props, [HYPHENATION_PROP]: patterns }, children }
    : { ...node, children }
}

/**
 * Every text of the document names the patterns of the document's language
 * (D41), loaded before: after the notes are lifted onto their pages and links
 * around strings became texts, so those texts get them too.
 */
export const resolveHyphenation = (root: PreparedDocument, patterns: PatternKey | undefined): PreparedDocument =>
  patterns === undefined ? root : { ...root, children: root.children.map(child => withPatterns(child, patterns)) }
