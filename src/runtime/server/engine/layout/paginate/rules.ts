import { PDF_FIELD_TYPES, PDF_PRIMITIVES, PDF_ROW_SPAN_PROP } from '../../../../primitives'
import { COLUMN_ROW_PROP, isColumnSegment } from '../columns'
import { getPadding } from '../dimensions/edges'
import type { MeasuredNode } from '../types'
import type { Line } from '../../text'

// The facts pagination reads from a node. Each says what it reads, because
// upstream reads some props by presence (`'fixed' in props`) and some by
// value, and the two differ for `fixed: false`.

/** Splits below this many points are float noise, not overflow. */
export const SAFETY_THRESHOLD = 0.001

/** A node out of the flow of its parent: its box moves no sibling. */
export const isAbsolute = (node: MeasuredNode): boolean => node.style.position === 'absolute'

/**
 * On the carrier of a page-conditional node (plain-tree.ts): its `pages`, `'first'`, `'continuation'` or
 * `'not-last'`. The page builder shows the node on those parts itself and never calls the carrier's `render`.
 */
export const PAGES_PROP = '__nuxtPdfPages'

export type PageCondition = 'first' | 'continuation' | 'not-last'
/** The pages a fixed node shows on, when not all (a carrier from plain-tree.ts). */
export const pagesOf = (node: MeasuredNode): PageCondition | undefined => node.props[PAGES_PROP] as PageCondition | undefined

export const unset = (value: unknown): boolean => value === undefined || value === null

/** Leaves with a box of their own: placed whole. A form field never splits (plain-tree.ts gives it `wrap={false}`), nor a note (an icon). */
export const BOX_TYPES = new Set<string>([PDF_PRIMITIVES.Image, PDF_PRIMITIVES.Svg, PDF_PRIMITIVES.Note, ...PDF_FIELD_TYPES])

/** A row (a table row): its children side by side, each from the row's top. Not a column segment, nor the row of columns a balance made. */
export const isRow = (node: MeasuredNode): boolean => (node.style.flexDirection === 'row' || node.style.flexDirection === 'row-reverse') && !isColumnSegment(node) && node.props[COLUMN_ROW_PROP] !== true

/** A node that repeats on every page of its parent (`fixed: true`). */
export const isFixed = (node: MeasuredNode): boolean => node.props.fixed === true

export const isText = (node: MeasuredNode): boolean => node.type === PDF_PRIMITIVES.Text

const SIZABLE_TYPES = new Set<string>([PDF_PRIMITIVES.View, PDF_PRIMITIVES.Text, PDF_PRIMITIVES.Link])

/**
 * A view, text or link in the flow with a `height` or `maxHeight`: a box. The
 * page builder places it whole when it fits the content area; yoga lays its
 * content out inside it, and text lines past its height are not drawn
 * (`PDF_CONTENT_HIDDEN`). Not a column container, which fills its columns to
 * its height, and not a cell over several rows or an absolute node (the
 * layout gives such a cell the height of its rows, row-spans.ts).
 */
export const isSizedBox = (node: MeasuredNode): boolean => SIZABLE_TYPES.has(node.type) && !isAbsolute(node) && !isColumnSegment(node)
  && typeof node.props[PDF_ROW_SPAN_PROP] !== 'number'
  && ((node.style.height !== undefined && node.style.height !== null) || (node.style.maxHeight !== undefined && node.style.maxHeight !== null))

/** An SVG, a note and an image are never split; other nodes unless `wrap={false}`. */
export const canWrap = (node: MeasuredNode): boolean | undefined => {
  if (node.type === PDF_PRIMITIVES.Svg || node.type === PDF_PRIMITIVES.Note || node.type === PDF_PRIMITIVES.Image) return false
  return 'wrap' in node.props ? node.props.wrap : true
}

/** Where a forced break before a node continues: on the next page, or in the next column. */
export type BreakKind = 'page' | 'column'

/**
 * The break before a node: `break` (true) starts the next page,
 * `break="column"` the next column of its column container, and after the
 * last column the next page. Outside a column container a column break
 * starts the next page.
 */
export const breakKindOf = (node: MeasuredNode): BreakKind | undefined => {
  const value = node.props.break
  return value === 'column' ? 'column' : value ? 'page' : undefined
}

export const hasBreak = (node: MeasuredNode): boolean => breakKindOf(node) !== undefined

/**
 * The children of a row container sit side by side, not one below the other.
 * A column segment (layout/columns) is a row with its galley as its one
 * child: the galley is a column, so a segment is not split as a row.
 */
export const isRowContainer = (node: MeasuredNode): boolean =>
  typeof node.style?.flexDirection === 'string' && node.style.flexDirection.startsWith('row') && !isColumnSegment(node)

/** A page or a page part, which may have no box height. */
type Page = Pick<MeasuredNode, 'style'> & { box?: Partial<MeasuredNode['box']> }

/** Where flow content must end on a page: its height above the bottom padding. */
export const wrapAreaOf = (page: Page): number =>
  Number(page.style?.height) - getPadding(page).paddingBottom

/** The page's content height: its height without the vertical paddings. */
export const contentAreaOf = (page: Page): number => {
  const { paddingTop, paddingBottom } = getPadding(page)
  return Number(page.style?.height) - paddingBottom - paddingTop
}

/**
 * A text's lines. Text layout gave every text its lines before pagination,
 * and each relayout lays a dynamic text out again, so a text that pagination
 * splits always has them.
 */
export const linesOf = (text: MeasuredNode): Line[] => text.lines!
