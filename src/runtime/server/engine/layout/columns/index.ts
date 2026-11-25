import { PDF_PRIMITIVES } from '../../../../primitives'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../../shared/errors'
import type { MeasuredNode, ResolvedStyle, StyledLayoutNode, StyledNode } from '../types'

// Column containers. Before yoga lays a page
// out, each view with `columnCount` or `columnWidth` is rewritten: its
// children, between those with `columnSpan: 'all'`, go into segments. A
// segment is a row with one child, the galley: a column of the column width
// that holds the children in their order. Yoga lays the galley out as one tall column, so its lines
// break at the column width. Pagination fills the columns of a page from the
// galley (paginate/builder.ts, `columnFill`). Spanning children stay full
// width between the segments. An absolute child belongs to the container,
// not to a column: it stays a direct child, placed against the container's
// box, and does not end a segment. The engine paints in source order, so
// one written before the first child of its segment goes before the
// segment (a background or a watermark stays under the text), and one
// written after content of a segment goes after it, over its columns.
//
// A segment with `columnFill: 'balance'` (the default, as in CSS) that can
// end on its page is balanced before the page splits (paginate/builder.ts,
// `balanced`): its columns get about the same height. A container with a
// `height` or `maxHeight` fills its columns to that height.
//
// The galley gets the column width from yoga itself: the segment has a right
// padding of (n − 1) gaps and the galley a width of 100/n percent of the
// segment's content box, so w = (W − (n − 1)·gap) / n with no knowledge of
// W. The row of filled columns that pagination makes has the same padding
// and n columns of that width, with the gap between them, so each column is
// exactly as wide as the galley and keeps its lines.

/**
 * On a column container the hook rewrote: its children are segments and
 * spanning children. The value is the container's index among the
 * containers of its page whose count depends on their width (`columnWidth`),
 * or -1. The mark makes the hook leave the container alone when pagination
 * lays its parts out again.
 */
export const COLUMN_CONTAINER_PROP = '__nuxtPdfColumns'

/**
 * On a page with a node that has `columnCount` or `columnWidth`, set by the
 * style step (styles/resolve-styles.ts). Without it `layOutColumns` lays the
 * page out at once: a page without columns pays no walk.
 */
export const COLUMN_PAGE_PROP = '__nuxtPdfColumnPage'

/** On a segment: its number of columns. Its one child is the galley. */
export const COLUMN_SEGMENT_PROP = '__nuxtPdfColumnSegment'

/** On a segment of a container with `columnFill: 'auto'`: its columns fill in order, never balanced. */
export const COLUMN_AUTO_FILL_PROP = '__nuxtPdfColumnAutoFill'

/** On a row of filled columns that a segment became (paginate/builder.ts): the painter draws the column rules in it. */
export const COLUMN_ROW_PROP = '__nuxtPdfColumnRow'

export const isColumnSegment = (node: { props: Record<string, unknown> }): boolean => typeof node.props[COLUMN_SEGMENT_PROP] === 'number'

/** The number of columns of a segment. */
export const columnCountOf = (segment: MeasuredNode): number => segment.props[COLUMN_SEGMENT_PROP] as number

/**
 * A column container with a `height` or `maxHeight` whose content needs more
 * than its columns at that height. CSS would add columns beside the view;
 * the engine has no room for them on the page. A typed error, not content
 * drawn over what follows the view.
 */
export const columnHeightError = (content: number, height: number, count: number): NuxtPdfError => new NuxtPdfError(
  PDF_ERROR_CODES.LayoutError,
  `A view with columns and a height or maxHeight holds ${Math.round(content * 100) / 100} pt of content, more than its ${count} column${count === 1 ? '' : 's'} of ${Math.round(height * 100) / 100} pt hold. `
  + 'Remove height and maxHeight from the view, or make its content lower.',
)

/** The column gap in points: the style step gives every column container one (1em without its own), and inheritance makes it points. */
const gapOf = (style: ResolvedStyle): number => style.columnGap as number

/**
 * The number of columns, as CSS computes it: `columnCount`, or with
 * `columnWidth` as many columns of at least that width as the content box
 * `width` holds (at least one, at most `columnCount` when both are set).
 * Without the width, a width-based container has one column. A column width
 * under 1 pt counts as 1 pt.
 */
const countOf = (style: ResolvedStyle, width: number | undefined): number => {
  const count = style.columnCount
  if (typeof style.columnWidth !== 'number') return count ?? 1
  if (width === undefined) return 1
  const gap = gapOf(style)
  const fit = Math.max(1, Math.floor((width + gap) / (Math.max(style.columnWidth, 1) + gap)))
  return count === undefined ? fit : Math.min(count, fit)
}

const isColumnContainer = (node: StyledNode): boolean => node.type === PDF_PRIMITIVES.View
  && node.props[COLUMN_CONTAINER_PROP] === undefined
  && (node.style?.columnCount !== undefined || node.style?.columnWidth !== undefined)

/**
 * The style of a segment, and of the row of filled columns made from it. It
 * never shrinks: in a container with a `height` the galley keeps its height,
 * so the fill can see how much it holds.
 */
const segmentStyle = (count: number, gap: number): ResolvedStyle =>
  ({ flexDirection: 'row', alignSelf: 'stretch', flexShrink: 0, paddingRight: (count - 1) * gap, columnGap: gap })

/** The style of the galley, and of each filled column: the container's spacing of its children. */
const galleyStyle = (container: ResolvedStyle, count: number): ResolvedStyle =>
  ({ width: `${100 / count}%`, flexGrow: 0, flexShrink: 0, flexDirection: 'column', rowGap: container.rowGap, alignItems: container.alignItems })

const rewrite = (container: StyledNode, count: number, index: number): StyledNode => {
  const style = container.style!
  const gap = gapOf(style)
  const items: StyledLayoutNode[] = []
  let run: StyledLayoutNode[] = []
  let absolute: StyledLayoutNode[] = []
  const flush = () => {
    if (run.length > 0) {
      items.push({
        type: PDF_PRIMITIVES.View,
        props: { [COLUMN_SEGMENT_PROP]: count, ...(style.columnFill === 'auto' ? { [COLUMN_AUTO_FILL_PROP]: true } : {}) },
        style: segmentStyle(count, gap),
        children: [{ type: PDF_PRIMITIVES.View, props: {}, style: galleyStyle(style, count), children: run }],
      })
    }
    items.push(...absolute)
    run = []
    absolute = []
  }
  for (const child of container.children ?? []) {
    if (child.type !== PDF_PRIMITIVES.TextInstance && child.style?.position === 'absolute') {
      if (run.length === 0) items.push(child)
      else absolute.push(child)
    }
    else if (child.type !== PDF_PRIMITIVES.TextInstance && child.style?.columnSpan === 'all') {
      flush()
      // A spanning float never shrinks either: the builder places it whole, at
      // its own height, even when the galleys overflow a container's height.
      items.push(child.style.float === undefined || child.style.float === 'none' ? child : { ...child, style: { ...child.style, flexShrink: 0 } })
    }
    else {
      run.push(child)
    }
  }
  flush()
  return {
    ...container,
    props: { ...container.props, [COLUMN_CONTAINER_PROP]: index },
    style: { ...style, flexDirection: 'column' },
    children: items,
  }
}

/** The style of each width-based container of a rewritten page, by its index. */
type WidthBased = Map<number, ResolvedStyle>

/** What a rewrite found that the layout must check. */
interface Rewritten {
  widthBased: WidthBased
}

/**
 * A column container in a column of another: its rest would be laid out
 * again at the width of each outer column, which pagination does not do
 * yet. A typed error, not a layout that starts content above the page end.
 */
const nestedError = (): NuxtPdfError => new NuxtPdfError(
  PDF_ERROR_CODES.LayoutError,
  'A view with columnCount or columnWidth is inside a column of another one. Columns inside columns are not supported yet. '
  + 'Give the inner view columnSpan: \'all\' to place it across the outer columns, or remove its columns.',
)

/** Whether a child of a column container goes into a column: not a string, a spanning child or an absolute one. */
const inColumn = (child: StyledLayoutNode): boolean => child.type !== PDF_PRIMITIVES.TextInstance
  && child.style?.columnSpan !== 'all' && child.style?.position !== 'absolute'

/** Whether a node is or holds a column container that the hook rewrote (now or in an earlier layout). */
const holdsColumns = (node: StyledLayoutNode): boolean => node.type !== PDF_PRIMITIVES.TextInstance
  && (node.props[COLUMN_CONTAINER_PROP] !== undefined || (node.children ?? []).some(holdsColumns))

/** The page with its column containers rewritten, `widths` giving the content width of each width-based one. */
const rewritePage = (page: StyledNode, widths: ReadonlyMap<number, number>, found: Rewritten): StyledNode => {
  const visit = <Node extends StyledLayoutNode>(node: Node): Node => {
    if (node.type === PDF_PRIMITIVES.TextInstance || node.type === PDF_PRIMITIVES.Text || !node.children) return node
    const children = node.children.map(visit)
    const same = children.every((child, at) => child === node.children![at])
    const element = (same ? node : { ...node, children }) as StyledNode
    if (!isColumnContainer(element)) return element as Node
    if (element.children?.some(child => inColumn(child) && holdsColumns(child))) throw nestedError()
    const style = element.style!
    let index = -1
    if (typeof style.columnWidth === 'number') {
      index = found.widthBased.size
      found.widthBased.set(index, style)
    }
    return rewrite(element, countOf(style, widths.get(index)), index) as Node
  }
  return visit(page)
}

/** The content width of each width-based container of a laid-out page, by its index. */
const widthsOf = (page: MeasuredNode): Map<number, number> => {
  const widths = new Map<number, number>()
  const visit = (node: MeasuredNode) => {
    const index = node.props[COLUMN_CONTAINER_PROP]
    if (typeof index === 'number' && index >= 0) {
      const { box } = node
      widths.set(index, box.width - box.paddingLeft - box.paddingRight - box.borderLeftWidth - box.borderRightWidth)
    }
    for (const child of node.children) {
      if (child.type !== PDF_PRIMITIVES.TextInstance) visit(child)
    }
  }
  visit(page)
  return widths
}

/** Nested width-based containers settle one level per layout; past this many, the last layout stands. */
const MAX_WIDTH_LAYOUTS = 4

/**
 * A page laid out by `layOut` with its column containers rewritten. A
 * container with `columnWidth` needs its own width for its count: the page
 * is laid out with one column first, then again with the count its width
 * gives, until every count agrees with the width it was laid out in. A page
 * without the style step's mark (`COLUMN_PAGE_PROP`) is laid out at once,
 * with no walk.
 */
export const layOutColumns = (page: StyledNode, layOut: (page: StyledNode) => MeasuredNode): MeasuredNode => {
  if (page.props[COLUMN_PAGE_PROP] !== true) return layOut(page)
  let widths: ReadonlyMap<number, number> = new Map()
  for (let layouts = 1; ; layouts += 1) {
    const found: Rewritten = { widthBased: new Map() }
    const laidOut = layOut(rewritePage(page, widths, found))
    const { widthBased } = found
    const read = widthBased.size === 0 || layouts === MAX_WIDTH_LAYOUTS ? undefined : widthsOf(laidOut)
    if (read === undefined || [...widthBased].every(([index, style]) => countOf(style, read.get(index)) === countOf(style, widths.get(index)))) return laidOut
    widths = read
  }
}
