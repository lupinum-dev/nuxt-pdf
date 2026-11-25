import type { FontStore } from '../../fonts'
import { countWork } from '../../work'
import { Edge, MeasureMode, type MeasureFunction, type Node as YogaNode } from 'yoga-layout/load'
import { PDF_PRIMITIVES, PDF_ROW_SPAN_PROP } from '../../../../primitives'
import type { MeasuredDocument, MeasuredNode, ResolvedStyle, StyledDocument, StyledNode, YogaInstance } from '../types'
import { getMargin, getPadding } from './edges'
import { measureImage, measureSvg, measureText, type SettleText } from './measure'
import { setYogaValues } from './setters'
import { resolveRowSpans, rowSpansOf } from './row-spans'
import { withMeasuredColumns } from './table-columns'
import { layOutColumns } from '../columns'

type Node = StyledNode
type WithYoga = Node & { yogaNode: YogaNode }

/**
 * A text, a note and an SVG are leaves for yoga: a text measures its lines,
 * an SVG its view box, and a note has no size of its own. Their children get
 * no yoga node. Strings only occur inside texts (admission,
 * renderer/validate-tree.ts), so a laid-out element has element children.
 */
const laysOutChildren = (node: Node): boolean =>
  node.type !== PDF_PRIMITIVES.Text && node.type !== PDF_PRIMITIVES.Note && node.type !== PDF_PRIMITIVES.Svg

// Every element of an admitted tree has children (plain-tree.ts builds each
// with an array) and, after `resolveStyles`, a style; the measured tree's
// type says so from here on.
const styleOf = (node: Node): ResolvedStyle => node.style!
const childrenOf = (node: Pick<Node, 'children'>): NonNullable<Node['children']> => node.children!

/**
 * A measured node (text, image, SVG) that is absolute in a row and has no
 * width of its own. yoga offers an absolute child the width of its parent
 * only in a column; in a row it measures it with no width at all. Such a node
 * gets the size it would get in a column: the width its parent offers, once
 * the first layout has computed it (an absolute child never changes the size
 * of its parent).
 */
type RowAbsolute = { yogaNode: YogaNode, parent: YogaNode, width?: number }

const isRow = (style: ResolvedStyle): boolean => style.flexDirection === 'row' || style.flexDirection === 'row-reverse'

/**
 * The measure function of a row-absolute node: no size in the first layout,
 * then the function itself with the width the parent offers, at most.
 */
const measuredInRow = (entry: RowAbsolute, measure: MeasureFunction): MeasureFunction => (width, widthMode, height, heightMode) =>
  entry.width === undefined ? { width: 0, height: 0 } : measure(entry.width, MeasureMode.AtMost, height, heightMode)

const horizontalEdges = (yogaNode: YogaNode): number =>
  [Edge.Left, Edge.Right].reduce((sum, edge) =>
    sum + yogaNode.getComputedMargin(edge) + yogaNode.getComputedPadding(edge) + yogaNode.getComputedBorder(edge), 0)

/** A text's yoga node, and what gives the text the lines of its final box (`measureText`). */
type TextEntry = { yogaNode: YogaNode, settle: SettleText }

/** The width inside the paddings and borders: the width yoga offers a measure function. */
const contentWidth = (yogaNode: YogaNode): number =>
  [Edge.Left, Edge.Right].reduce((width, edge) => width - yogaNode.getComputedPadding(edge) - yogaNode.getComputedBorder(edge), yogaNode.getComputedWidth())

const contentHeight = (yogaNode: YogaNode): number =>
  [Edge.Top, Edge.Bottom].reduce((height, edge) => height - yogaNode.getComputedPadding(edge) - yogaNode.getComputedBorder(edge), yogaNode.getComputedHeight())

/** Below this, two heights in points are the same: yoga holds them in float32. */
const HEIGHT_EPSILON = 0.01

/**
 * Gives each text the lines of its final box (`measureText`) and returns the
 * texts whose new lines are not as high as their box.
 */
const settleTexts = (texts: TextEntry[]): TextEntry[] => texts.filter(({ yogaNode, settle }) => {
  const height = settle(contentWidth(yogaNode))
  return height !== undefined && Math.abs(height - contentHeight(yogaNode)) >= HEIGHT_EPSILON
})

/** A parent while its children get yoga nodes, and its own parent. */
type Parent = { node: WithYoga, style: ResolvedStyle, parent: Parent | undefined }

/**
 * The node and its subtree with yoga nodes that hold their styles and measure
 * functions. A table with a cell over several rows (the grandparent of a view
 * with `PDF_ROW_SPAN_PROP`) goes into `spanTables`.
 */
const withYogaNodes = (page: Node, fontStore: FontStore, yoga: YogaInstance, rowAbsolutes: RowAbsolute[], spanTables: Set<WithYoga>, texts: TextEntry[]) => {
  const create = (node: Node, parent?: Parent): WithYoga => {
    const yogaNode = yoga.node.create()
    countWork('nodesLaidOut')
    const created: WithYoga = { ...node, yogaNode }
    const table = parent?.parent?.node
    if (table !== undefined && node.props[PDF_ROW_SPAN_PROP] !== undefined) spanTables.add(table)
    // A page's height is its box height (page-size.ts); auto-height pages have none.
    setYogaValues(yogaNode, styleOf(node), node.type === PDF_PRIMITIVES.Page ? node.box?.height : node.style?.height)
    if (laysOutChildren(node)) {
      // Strings only occur inside texts (admission, and the link step wraps
      // a link's strings in a text), so these children are elements.
      created.children = (childrenOf(node) as Node[]).map((child) => {
        const childWithYoga = create(child, { node: created, style: styleOf(node), parent })
        yogaNode.insertChild(childWithYoga.yogaNode, yogaNode.getChildCount())
        return childWithYoga
      })
    }
    const text = node.type === PDF_PRIMITIVES.Text ? measureText(created, fontStore) : undefined
    if (text) texts.push({ yogaNode, settle: text.settle })
    const measure = text
      ? text.measure
      : node.type === PDF_PRIMITIVES.Image
        ? measureImage(page, created)
        : node.type === PDF_PRIMITIVES.Svg ? measureSvg(created) : undefined
    if (measure) {
      const style = styleOf(node)
      const inRow = parent && isRow(parent.style) && style.position === 'absolute' && (style.width === undefined || style.width === null)
      if (inRow) {
        const entry: RowAbsolute = { yogaNode, parent: parent.node.yogaNode }
        rowAbsolutes.push(entry)
        yogaNode.setMeasureFunc(measuredInRow(entry, measure))
      }
      else {
        yogaNode.setMeasureFunc(measure)
      }
    }
    return created
  }
  return create
}

/**
 * The node and its subtree with the boxes yoga computed, and without yoga
 * nodes. A node without one (inside a text, a note or an SVG) gets a box of
 * zero size at zero position, with the paddings and margins of its style.
 */
const withBoxes = (node: Node): MeasuredNode => {
  const { yogaNode, children, ...rest } = node
  const box = {
    ...getPadding(node),
    ...getMargin(node),
    borderTopWidth: yogaNode ? yogaNode.getComputedBorder(Edge.Top) : 0,
    borderRightWidth: yogaNode ? yogaNode.getComputedBorder(Edge.Right) : 0,
    borderBottomWidth: yogaNode ? yogaNode.getComputedBorder(Edge.Bottom) : 0,
    borderLeftWidth: yogaNode ? yogaNode.getComputedBorder(Edge.Left) : 0,
    top: yogaNode?.getComputedTop() || 0,
    right: yogaNode?.getComputedRight() || 0,
    bottom: yogaNode?.getComputedBottom() || 0,
    left: yogaNode?.getComputedLeft() || 0,
    width: yogaNode ? yogaNode.getComputedWidth() : 0,
    height: yogaNode ? yogaNode.getComputedHeight() : 0,
  }
  return {
    ...rest,
    style: styleOf(node),
    box,
    children: childrenOf({ children }).map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : withBoxes(child)),
  }
}

/**
 * Lays one page out with yoga: every node gets the box yoga computed from its
 * style (and, for texts, images and SVGs, from its measure function). A table
 * with 'auto' columns first gets its column widths (`withMeasuredColumns`); a
 * cell over several rows then gets the height of its rows (`resolveRowSpans`).
 * Each text keeps the lines it measured for its final box. A text laid out
 * again in a box no measure had (a `minWidth` wider than its lines) can need
 * another height; yoga then lays the page out once more with those lines,
 * as a page that does not wrap gets no relayout from pagination. The yoga
 * nodes are freed.
 */
const layOutPage = (styled: Node, fontStore: FontStore, yoga: YogaInstance): MeasuredNode => {
  const page = withMeasuredColumns(styled, fontStore)
  const rowAbsolutes: RowAbsolute[] = []
  const spanTables = new Set<WithYoga>()
  const texts: TextEntry[] = []
  const withYoga = withYogaNodes(page, fontStore, yoga, rowAbsolutes, spanTables, texts)(page)
  withYoga.yogaNode.calculateLayout(undefined, undefined)
  if (rowAbsolutes.length > 0) {
    // The parent's padding box, less the node's own margins, paddings and
    // borders: what yoga offers an absolute child in a column.
    for (const entry of rowAbsolutes) {
      const parentWidth = entry.parent.getComputedWidth() - entry.parent.getComputedBorder(Edge.Left) - entry.parent.getComputedBorder(Edge.Right)
      entry.width = Math.max(0, parentWidth - horizontalEdges(entry.yogaNode))
      entry.yogaNode.markDirty()
    }
    withYoga.yogaNode.calculateLayout(undefined, undefined)
  }
  resolveRowSpans([...spanTables].flatMap(rowSpansOf), () => withYoga.yogaNode.calculateLayout(undefined, undefined))
  const resized = settleTexts(texts)
  if (resized.length > 0) {
    for (const { yogaNode } of resized) yogaNode.markDirty()
    countWork('settleLayouts')
    withYoga.yogaNode.calculateLayout(undefined, undefined)
    settleTexts(texts)
  }
  const measured = withBoxes(withYoga)
  withYoga.yogaNode.freeRecursive()
  return measured
}

/**
 * One page laid out, its column containers rewritten first (layout/columns):
 * the one way a page reaches yoga, in the first layout and in each relayout
 * of pagination.
 */
export const resolvePageDimensions = (styled: Node, fontStore: FontStore, yoga: YogaInstance): MeasuredNode =>
  layOutColumns(styled, page => layOutPage(page, fontStore, yoga))

/** Every page laid out with the yoga instance of this layout (`resolvePageSizes`). */
export const resolveDimensions = (root: StyledDocument, fontStore: FontStore, yoga: YogaInstance): MeasuredDocument =>
  ({ ...root, children: root.children.map(page => resolvePageDimensions(page, fontStore, yoga)) })
