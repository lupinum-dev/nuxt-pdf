import type { FontStore } from '../../fonts'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { pageStyleResolver } from '../styles/resolve-styles'
import type { NumberedProps, ResolvedStyle, Style, StyledDocument, StyledLayoutNode, StyledNode } from '../types'
import { parseDefsProps, parseElementProps, parseNumber, parseSvgRootProps, parseViewBox, STYLE_PROPS, type SvgContainer } from './props'
import { layoutSvgText } from './text'

type SvgNode = StyledLayoutNode
type SvgElement = StyledNode
/** The style step in the page's container, for the props copied into a style. */
type StyleOf = (style: Style) => ResolvedStyle

/** The keys of `keys` that `object` has, with their values. */
const pick = (keys: readonly string[], object: object): NumberedProps =>
  Object.fromEntries(keys.filter(key => key in object).map(key => [key, (object as NumberedProps)[key]]))

// Props an SVG element passes to its children. Not `clipRule`, `textAnchor`,
// `dominantBaseline`, `visibility` or `wordSpacing`: no SVG prop or style key
// of that name is admitted (primitives.ts), so no node has one.
const INHERITED = ['x', 'y', 'clipPath', 'opacity', 'fill', 'fillOpacity', 'fillRule', 'stroke', 'strokeLinecap', 'strokeLinejoin', 'strokeOpacity', 'strokeWidth', 'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'letterSpacing', 'textDecoration', 'lineHeight', 'textAlign']
// A span starts where the one before it ended, not at the `x` of its text.
const INHERITED_BY_SPANS = INHERITED.filter(key => key !== 'x')

/** What percentages inside the SVG resolve against: its view box, else its size. */
const containerOf = (svg: SvgElement): SvgContainer => {
  const viewBox = parseViewBox(svg.props.viewBox)
  if (viewBox) return { width: viewBox.maxX, height: viewBox.maxY }
  const { width, height } = svg.props
  if (width && height) return { width: Number(parseNumber(width)), height: Number(parseNumber(height)) }
  return { width: 0, height: 0 }
}

/** A copy of the tree in which every node has a `children` key, as the painter's SVG walk expects. */
const withChildrenKeys = <Node extends SvgNode>(node: Node): Node => ({ ...node, children: node.children?.map(withChildrenKeys) })

/** A string directly in an SVG text is drawn as a span of its own. */
const withSpans = (node: SvgNode): SvgNode => {
  if (node.type !== PDF_PRIMITIVES.Text || !node.children) return node
  return {
    ...node,
    children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance
      ? { type: PDF_PRIMITIVES.Tspan, props: {}, style: {}, children: [child] }
      : child),
  }
}

/** SVG rounds a rect with `rx` alone (or `ry` alone) by that radius on both axes. */
const withRectRadii = (node: SvgNode): SvgNode => {
  if (node.type !== PDF_PRIMITIVES.Rect || !node.props) return node
  const { rx, ry } = node.props
  if (Boolean(rx) === Boolean(ry)) return node
  return { ...node, props: { ...node.props, rx: rx ?? ry, ry: ry ?? rx } }
}

/**
 * One drawn element: its style becomes props (an attribute wins), `none`
 * becomes null, the props the painter reads from the style are copied there
 * through the style step, and numbers, colors and transforms are parsed.
 */
const resolveElement = (container: SvgContainer, node: SvgNode, styleOf: StyleOf): SvgNode => {
  const merged = { ...node.style, ...node.props }
  const props = Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, value === 'none' ? null : value]))
  const spanned = withSpans({ ...node, props })
  const styled = { ...spanned, style: { ...styleOf(pick(STYLE_PROPS, props)), ...spanned.style } }
  const rounded = withRectRadii(styled)
  return { ...rounded, props: parseElementProps(container, rounded.props ?? {}) }
}

/**
 * Gradients and stops keep their coordinates as fractions; nested ones too.
 * The shapes of a clip path are drawn shapes: they resolve like the elements
 * outside `<defs>` (their lengths stayed strings, and `'50%'` failed at the
 * painter).
 */
const resolveDefinitions = (container: SvgContainer, node: SvgNode, styleOf: StyleOf): SvgNode => {
  if (node.type === PDF_PRIMITIVES.TextInstance || !node.children) return node
  if (node.type === PDF_PRIMITIVES.ClipPath) return resolveChildren(container, node, styleOf)
  return { ...node, children: node.children.map(child => resolveDefinitions(container, { ...child, props: parseDefsProps(child.props ?? {}) }, styleOf)) }
}

const resolveChildren = <Node extends SvgNode>(container: SvgContainer, node: Node, styleOf: StyleOf): Node => {
  if (!node.children) return node
  return {
    ...node,
    children: node.children.map(child => child.type === PDF_PRIMITIVES.Defs
      ? resolveDefinitions(container, child, styleOf)
      : resolveChildren(container, resolveElement(container, child, styleOf), styleOf)),
  }
}

const inheritProps = <Node extends SvgNode>(node: Node): Node => {
  if (!node.children) return node
  const inherited = pick(node.type === PDF_PRIMITIVES.Text ? INHERITED_BY_SPANS : INHERITED, node.props ?? {})
  return { ...node, children: node.children.map(child => inheritProps({ ...child, props: { ...inherited, ...child.props } })) }
}

const layoutTexts = (fontStore: FontStore, node: SvgNode): SvgNode => {
  if (node.type === PDF_PRIMITIVES.Text) return layoutSvgText(fontStore, node)
  return node.type !== PDF_PRIMITIVES.TextInstance && node.children ? { ...node, children: node.children.map(child => layoutTexts(fontStore, child)) } : node
}

const REFERENCE = /url\(['"]?#([^'"]+)['"]?\)/

/**
 * `fill` and `clipPath` references (`url(#id)`) become the definitions they
 * name, and `<defs>` leaves the tree. Every node below the SVG gets both keys:
 * the painter asks `'fill' in props` and reads an undefined fill as none.
 */
const replaceDefinitions = (svg: SvgElement): SvgElement => {
  if (!svg.children) return svg
  const definitions = new Map<string, SvgNode>()
  for (const definition of svg.children.find(child => child.type === PDF_PRIMITIVES.Defs)?.children ?? []) {
    const id = definition.props?.id
    if (id) definitions.set(id, definition)
  }
  const replace = (value: NumberedProps['fill']): NumberedProps['fill'] => {
    if (!value) return undefined
    const match = typeof value === 'string' ? REFERENCE.exec(value) : null
    return match ? definitions.get(match[1]!) : value
  }
  const withDefinitions = (node: SvgNode): SvgNode => {
    const own = node.props ?? {}
    const props = { ...own, fill: 'fill' in own ? replace(own.fill) : undefined, clipPath: 'clipPath' in own ? replace(own.clipPath) : undefined }
    return node.type === PDF_PRIMITIVES.TextInstance
      ? { ...node, props, children: undefined }
      : { ...node, props, children: node.children?.map(withDefinitions) }
  }
  return { ...svg, children: svg.children.map(withDefinitions).filter(child => child.type !== PDF_PRIMITIVES.Defs) }
}

/** An `<svg>` element and everything in it, ready to paint. */
const resolveSvgElement = (svg: SvgElement, fontStore: FontStore, styleOf: StyleOf): SvgElement => {
  const container = containerOf(svg)
  const resolved = inheritProps(resolveChildren(container, withChildrenKeys(svg), styleOf))
  const root = { ...resolved, style: { ...styleOf(pick(STYLE_PROPS, resolved.props)), ...resolved.style }, props: parseSvgRootProps(resolved.props) }
  return replaceDefinitions({ ...root, children: root.children?.map(child => layoutTexts(fontStore, child)) })
}

/**
 * Every `<svg>` of the document resolved; other nodes with a `children` key
 * are rebuilt unchanged. Strings need nothing: outside an SVG they have no
 * children, inside one they are resolved with it.
 */
const resolveNode = (node: SvgElement, fontStore: FontStore, styleOf: StyleOf): SvgElement => {
  if (!('children' in node)) return node
  const resolved = node.type === PDF_PRIMITIVES.Svg ? resolveSvgElement(node, fontStore, styleOf) : node
  return { ...resolved, children: resolved.children?.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : resolveNode(child, fontStore, styleOf)) }
}

export const resolveSvg = (root: StyledDocument, fontStore: FontStore): StyledDocument =>
  ({ ...root, children: root.children.map(page => resolveNode(page, fontStore, pageStyleResolver(page))) })
