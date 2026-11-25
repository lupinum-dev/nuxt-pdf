import type { FontStore } from '../../fonts'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { fitParagraphs, patternKeyOf, type Line, type TextOptions } from '../../text'
import type { MeasuredDocument, StyledLayoutNode, StyledNode } from '../types'
import { fragmentsOfText } from './fragments'

type TextElement = StyledNode

/**
 * The pattern file of the document's language on each text
 * (`prepare/hyphenation.ts`, D41), absent without one. A prop, not a
 * parameter, so it reaches every text the layout measures, as its fonts do.
 */
export const HYPHENATION_PROP = '__nuxtPdfHyphenation'

/**
 * The lines of a text in a box of `width` by `height` (no height: unbounded),
 * and how many lines that height cut off (`fitParagraphs`). `maxLines`,
 * `textOverflow` and `hyphens` come from its style, the patterns from its
 * props.
 */
export const layoutText = (text: TextElement, width: number, height: number, fontStore: FontStore): { lines: Line[], hiddenLines: number } =>
  fitParagraphs(
    fragmentsOfText(fontStore, text),
    { x: 0, y: 0, width, height: height || Infinity, maxLines: text.style?.maxLines, truncate: text.style?.textOverflow },
    textOptionsOf(text),
  )

/**
 * The options of a text: words split at their soft hyphens always, and at the
 * points of the pattern file its props name only with `hyphens: 'auto'`.
 */
export const textOptionsOf = (text: Pick<TextElement, 'props' | 'style'>): TextOptions => {
  const patterns = text.style?.hyphens === 'auto' ? text.props[HYPHENATION_PROP] : undefined
  const key = typeof patterns === 'string' ? patternKeyOf(patterns) : undefined
  return { hyphenate: true, ...(key === undefined ? {} : { patterns: key }) }
}

/**
 * Lays out every text that has a box but no lines yet: yoga measured most
 * texts already (`measureText`), not those with a fixed width and height.
 * Writes `lines` into the text node (the input is this pass's own tree).
 */
const withTextLayout = <Node extends StyledLayoutNode>(node: Node, fontStore: FontStore): Node => {
  if (node.type === PDF_PRIMITIVES.TextInstance) return node
  if (node.type === PDF_PRIMITIVES.Text) {
    if (!node.lines) {
      const box = node.box ?? {}
      const width = Number(box.width) - (Number(box.paddingRight) + Number(box.paddingLeft))
      const height = Number(box.height) - (Number(box.paddingTop) + Number(box.paddingBottom))
      const { lines, hiddenLines } = layoutText(node, width, height, fontStore)
      node.lines = lines
      node.hiddenLines = hiddenLines
    }
    return node
  }
  if (node.type === PDF_PRIMITIVES.Svg || !node.children) return node
  return { ...node, children: node.children.map(child => withTextLayout(child, fontStore)) }
}

export const resolveTextLayout = (root: MeasuredDocument, fontStore: FontStore): MeasuredDocument =>
  ({ ...root, children: root.children.map(page => withTextLayout(page, fontStore)) })

/** One page's texts laid out, for relayout during pagination. */
export const resolvePageTextLayout = <Node extends StyledLayoutNode>(page: Node, fontStore: FontStore): Node => withTextLayout(page, fontStore)
