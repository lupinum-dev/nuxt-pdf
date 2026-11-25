import { expandStyle } from './expand'
import { flattenStyle } from './flatten'
import { inheritInto, passedDown, type InheritedFrom } from './inheritance'
import type { StyleContainer } from './units'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { DEFAULT_FONT_SIZE } from '../../text'
import { COLUMN_PAGE_PROP } from '../columns'
import type { ElementNode, InputStyle, LayoutNode, NumberedProps, PreparedDocument, ResolvedStyle, Style, StyledDocument, StyledNode } from '../types'

const LINK_STYLE: Style = { color: 'blue', textDecoration: 'underline' }

/**
 * A raw style (an entry or a list of them) through the style step; a link
 * starts from blue and underlined. A column container without a column gap
 * (or with `'normal'`) gets CSS's `normal`, 1em: inheritance makes it points
 * of the container's computed font size (styles/inheritance.ts).
 */
const resolve = (container: StyleContainer, type: string, style: InputStyle | undefined): ResolvedStyle => {
  const own = Array.isArray(style) ? style : [style]
  const input = type === PDF_PRIMITIVES.Link ? [LINK_STYLE, ...own] : own
  // The style keys are closed by admission (shared/style-values.ts), and each
  // rule of expand.ts writes the value type the layout reads for its key.
  const resolved = expandStyle(container, flattenStyle(input)) as ResolvedStyle
  const columns = resolved.columnCount !== undefined || resolved.columnWidth !== undefined
  return columns && resolved.columnGap === undefined ? { ...resolved, columnGap: '1em' } : resolved
}

/** The style of a node; `parent` is what its parent passes down (`InheritedFrom`), undefined for a page. */
type StyleOf<NodeStyle> = (container: StyleContainer, node: LayoutNode<NodeStyle, NumberedProps>, parent: InheritedFrom | undefined) => ResolvedStyle

const styled = <NodeStyle>(container: StyleContainer, node: ElementNode<NodeStyle, NumberedProps>, styleOf: StyleOf<NodeStyle>, parent?: InheritedFrom): StyledNode => {
  const { children, ...element } = node
  const style = styleOf(container, node, parent)
  // A `children` key holding undefined stays (SVG leaves have one, and
  // relayout styles them again).
  if (!children) return 'children' in node ? { ...element, children: undefined, style } : { ...element, style }
  const down = passedDown({ type: node.type, style }, parent)
  return {
    ...element,
    style,
    children: children.map(child => child.type === PDF_PRIMITIVES.TextInstance
      ? { ...child, style: styleOf(container, child, down) }
      : styled(container, child, styleOf, down)),
  }
}

/**
 * A page styled, marked (`COLUMN_PAGE_PROP`) when a node on it has
 * `columnCount` or `columnWidth`. The style step visits every node anyway,
 * so a page without columns skips the column hook (layout/columns) with no
 * walk of its own. It is decided once, here: the parts pagination lays out
 * again keep their page's props, and the nodes of page callbacks are in the
 * page already (as the children of their carrier).
 */
const styledPage = <NodeStyle>(container: StyleContainer, page: ElementNode<NodeStyle, NumberedProps>, styleOf: StyleOf<NodeStyle>): StyledNode => {
  let columns = false
  const result = styled(container, page, (at, node, parent) => {
    const style = styleOf(at, node, parent)
    if (style.columnCount !== undefined || style.columnWidth !== undefined) columns = true
    return style
  })
  return columns ? { ...result, props: { ...result.props, [COLUMN_PAGE_PROP]: true } } : result
}

const containerOf = (page: ElementNode<unknown>, style: Style | ResolvedStyle): StyleContainer => ({
  width: page.box?.width || style.width,
  height: page.box?.height || style.height,
  dpi: page.props.dpi || 72,
  remBase: style.fontSize || DEFAULT_FONT_SIZE,
})

/**
 * Resolves every style, strings included, to one flat object of final values:
 * units to points, shorthands to their sides, colours as written. A link
 * starts from blue and underlined. Each page is the container of the units
 * and percentages inside it.
 */
export const resolveStyles = (root: PreparedDocument): StyledDocument => ({
  ...root,
  children: root.children.map(page => styledPage(containerOf(page, page.style), page, (container, node) => resolve(container, node.type, node.style))),
})

/**
 * Resolves raw styles in a page's container: SVG resolution resolves the
 * props it copies into a style (svg/index.ts).
 */
export const pageStyleResolver = (page: StyledNode) => {
  const container = containerOf(page, page.style ?? {})
  return (style: Style): ResolvedStyle => resolve(container, page.type, style)
}

/**
 * One page styled again, for relayout during pagination. A resolved style
 * (one object) stays as it is: resolving it again is not a no-op (a
 * `lineHeight` of 14 at 10 pt would become 140), and neither is inheriting
 * into it again (`InheritedFrom`). A list is the raw style of a node a page
 * callback returned (paginate/dynamic.ts), and a text it returned has no
 * style yet; those go through the style step and take what their parent
 * passes down, as `resolveInheritance` gives every node in the first layout.
 */
export const resolvePageStyles = (page: ElementNode<Style[] | ResolvedStyle, NumberedProps> & { style?: ResolvedStyle }): StyledNode =>
  styled<Style[] | ResolvedStyle>(containerOf(page, page.style ?? {}), page, (container, node, parent) =>
    node.style === undefined || Array.isArray(node.style) ? inheritInto(parent ?? null, resolve(container, node.type, node.style)) : node.style)
