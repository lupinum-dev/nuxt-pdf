import { PDF_EM_LONGHAND_KEYS } from '../../../../authoring'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { PDF_EM_LENGTH } from '../../../../shared/style-values'
import { DEFAULT_FONT_SIZE } from '../../text'
import type { ResolvedStyle, StyledDocument, StyledLayoutNode, StyledNode } from '../types'
import { percentOf } from './percent'

type StyleKey = keyof ResolvedStyle

// CSS's inherited properties among the admitted style keys (PDF_STYLE_VALUES;
// `visibility` and `wordSpacing` are not admitted).
export const INHERITED: readonly StyleKey[] = [
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'fontVariantNumeric',
  'hyphens',
  'letterSpacing',
  'opacity',
  'textDecoration',
  'textTransform',
  'lineHeight',
  'textAlign',
  'textWrap',
]

// Inside a text, a span's background also comes from its text.
const INHERITED_IN_TEXT: readonly StyleKey[] = [...INHERITED, 'backgroundColor']

const emOf = (value: unknown): number | undefined =>
  typeof value === 'string' && PDF_EM_LENGTH.test(value) ? Number.parseFloat(value) : undefined

const copyKey = <Key extends StyleKey>(from: ResolvedStyle, to: Partial<ResolvedStyle>, key: Key): void => {
  to[key] = from[key]
}

const inheritedFrom = (node: Pick<StyledNode, 'type' | 'style'>): Partial<ResolvedStyle> => {
  const style = node.style ?? {}
  const inherited: Partial<ResolvedStyle> = {}
  for (const key of node.type === PDF_PRIMITIVES.Text ? INHERITED_IN_TEXT : INHERITED) {
    if (key in style) copyKey(style, inherited, key)
  }
  return inherited
}

/**
 * A node's own value wins; text decorations add up (`underline` on a text
 * and `line-through` on its span give both), and `none` adds nothing. A
 * percentage `fontSize` becomes points of the inherited font size (else
 * `DEFAULT_FONT_SIZE`), and a percentage `lineHeight` points of the node's
 * computed font size, so its children inherit the points, as in CSS. An
 * `em` length is points of the node's computed font size, as in CSS; it is
 * not admitted on `fontSize` itself.
 */
const merged = (inherited: Partial<ResolvedStyle>, own: ResolvedStyle): ResolvedStyle => {
  const style = { ...inherited, ...own }
  const size = percentOf(own.fontSize)
  if (size !== undefined) style.fontSize = size * (inherited.fontSize ?? DEFAULT_FONT_SIZE)
  const fraction = percentOf(own.lineHeight)
  if (fraction !== undefined) style.lineHeight = fraction * (style.fontSize ?? DEFAULT_FONT_SIZE)
  const fontSize = typeof style.fontSize === 'number' ? style.fontSize : DEFAULT_FONT_SIZE
  for (const key of PDF_EM_LONGHAND_KEYS) {
    const factor = emOf(style[key])
    if (factor !== undefined) style[key] = factor * fontSize
  }
  if ('textDecoration' in own) {
    style.textDecoration = [inherited.textDecoration, own.textDecoration].filter(part => part && part !== 'none').join(' ')
  }
  return style
}

const inherit = <Node extends StyledLayoutNode>(node: Node): Node => {
  // An SVG resolves its own inheritance (`resolveSvg`): its presentation
  // attributes, not CSS.
  if (node.type === PDF_PRIMITIVES.Svg || node.type === PDF_PRIMITIVES.TextInstance || !node.children) return node
  const inherited = inheritedFrom(node)
  const children = node.children.map(child => inherit({ ...child, style: merged(inherited, child.style ?? {}) }))
  return { ...node, children }
}

/**
 * Passes the inherited text style (CSS's inherited properties) from each node
 * to its children. The document admits no style (`PdfDocument`), so a page
 * inherits nothing; it still gets its style merged, which turns a `none` text
 * decoration into no decoration.
 */
export const resolveInheritance = (root: StyledDocument): StyledDocument =>
  ({ ...root, children: root.children.map(page => inherit({ ...page, style: merged({}, page.style ?? {}) })) })

/**
 * What a node's parent passes down, during relayout: `null` inside an SVG,
 * which resolves its own inheritance. Pagination styles only the nodes a
 * page callback returned (`resolvePageStyles`); every other node keeps the
 * style it inherited once, which merging again would change (text
 * decorations add up: `underline underline` is no underline,
 * text/fragments.ts).
 */
export type InheritedFrom = Pick<StyledNode, 'type' | 'style'> | null

/** A style resolved during relayout, with what its parent passes down. */
export const inheritInto = (parent: InheritedFrom, style: ResolvedStyle): ResolvedStyle =>
  parent === null ? style : merged(inheritedFrom(parent), style)

/** What a node passes to its children during relayout (`InheritedFrom`). */
export const passedDown = (node: Pick<StyledNode, 'type' | 'style'>, parent: InheritedFrom | undefined): InheritedFrom =>
  parent === null || node.type === PDF_PRIMITIVES.Svg ? null : node
