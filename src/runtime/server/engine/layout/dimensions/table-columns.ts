// Automatic table columns (D39), within the one yoga pass: before yoga lays a page out, each table with
// 'auto' columns gets its column widths as flex styles on the views that take
// its columns, so the one yoga pass gives every column its width. The table
// components mark those views (`PDF_TABLE_COLUMNS_PROP` on the table,
// `PDF_TABLE_CELL_PROP` on each view over its columns); `measureColumns`
// (shared/table-columns.ts) turns the measured widths into the styles.
import type { FontStore } from '../../fonts'
import { measureParagraphs } from '../../text'
import { NuxtPdfError, parsePdfSourcePosition, PDF_ERROR_CODES } from '../../../../shared/errors'
import { measureColumns, type TableCellMeasure, type TableCellStyle } from '../../../../shared/table-columns'
import { isPdfTableColumnWidth, PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES, PDF_ROW_SPAN_PROP, PDF_TABLE_CELL_PROP, PDF_TABLE_COLUMNS_PROP, type PdfTableColumnWidth } from '../../../../primitives'
import { renderedText } from '../paginate/dynamic'
import { SAFETY_THRESHOLD } from '../paginate/rules'
import { pageStyleResolver } from '../styles/resolve-styles'
import { fragmentsOfText } from '../text/fragments'
import type { ResolvedStyle, StyledLayoutNode, StyledNode } from '../types'

type Node = StyledNode

/**
 * Written on a table with 'auto' columns when it is measured: the table
 * width its columns need to keep their longest words whole. One object per
 * table, which every page part of it keeps in its props, so the layout
 * warning (layout-diagnostics.ts) names the table once.
 */
export const TABLE_COLUMNS_NEED_PROP = '__nuxtPdfTableColumnsNeed'

/**
 * Written on a measured table: the flex styles of its columns, one entry per
 * set of column indices its views take. A fixed row that pagination renders
 * again on each page (a page token, a carried value, `pages`) comes back
 * from its callback without them; each relayout gives such a row's views the
 * styles of their columns (`withMeasuredColumns`).
 */
const TABLE_COLUMN_STYLES_PROP = '__nuxtPdfTableColumnStyles'
type ColumnStyles = readonly { readonly columns: readonly number[], readonly style: TableCellStyle }[]

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isColumnStyles = (value: unknown): value is ColumnStyles => Array.isArray(value) && value.every((entry: unknown) => {
  if (!isRecord(entry)) return false
  const { columns, style } = entry
  return Array.isArray(columns) && columns.every(index => typeof index === 'number')
    && isRecord(style) && typeof style.flexBasis === 'number' && typeof style.flexGrow === 'number' && typeof style.flexShrink === 'number'
})

const columnStylesOf = (node: Node): ColumnStyles | undefined => {
  const value: unknown = node.props[TABLE_COLUMN_STYLES_PROP]
  return isColumnStyles(value) ? value : undefined
}

type Widths = { maxContent: number, minContent: number }

const NOTHING: Widths = { maxContent: 0, minContent: 0 }

const columnsOf = (node: Node): readonly PdfTableColumnWidth[] | undefined => {
  const columns: unknown = node.props[PDF_TABLE_COLUMNS_PROP]
  return Array.isArray(columns) && columns.every(isPdfTableColumnWidth) ? columns : undefined
}

const cellColumnsOf = (node: Node): readonly number[] | undefined => {
  const columns: unknown = node.props[PDF_TABLE_CELL_PROP]
  return Array.isArray(columns) && columns.every((index): index is number => typeof index === 'number') ? columns : undefined
}

const elements = (node: Node): Node[] =>
  (node.children ?? []).filter((child): child is Node => child.type !== PDF_PRIMITIVES.TextInstance)

const isRow = (style: ResolvedStyle): boolean => style.flexDirection === 'row' || style.flexDirection === 'row-reverse'

const nameOf = (node: Node): string => `<${PDF_PRIMITIVE_NAMES[node.type]}>`

type HorizontalEdge = 'paddingLeft' | 'paddingRight' | 'borderLeftWidth' | 'borderRightWidth' | 'marginLeft' | 'marginRight'

/**
 * A horizontal edge in points. An `'auto'` margin only takes free space, so it
 * counts 0. A percentage, or an `'auto'` padding or border, has no width
 * before yoga: in an 'auto' column it fails (the tree check at mount sees
 * most of them, components/table.ts), in a share column it counts as 0, as
 * content there only sets the least width.
 */
const edgeOf = (node: Node, key: HorizontalEdge, auto: boolean): number => {
  const value: unknown = node.style?.[key]
  if (typeof value === 'number') return value
  if (value === 'auto' && (key === 'marginLeft' || key === 'marginRight')) return 0
  if (value !== undefined && auto) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.LayoutError,
      `${nameOf(node)} in an 'auto' table column has ${key} ${JSON.stringify(value)}: the column is as wide as its content in points, and a percentage or 'auto' padding or border, or a percentage margin, has no width before layout. Use a length, such as '4pt'.`,
      { source: parsePdfSourcePosition(node.source) },
    )
  }
  return 0
}

/** Horizontal padding and border: inside the box, outside the content. */
const insideEdges = (node: Node, auto: boolean): number =>
  edgeOf(node, 'paddingLeft', auto) + edgeOf(node, 'paddingRight', auto) + edgeOf(node, 'borderLeftWidth', auto) + edgeOf(node, 'borderRightWidth', auto)

const outsideEdges = (node: Node, auto: boolean): number =>
  edgeOf(node, 'marginLeft', auto) + edgeOf(node, 'marginRight', auto)

const widest = (widths: readonly Widths[]): Widths => widths.reduce((most, next) => ({
  maxContent: Math.max(most.maxContent, next.maxContent),
  minContent: Math.max(most.minContent, next.minContent),
}), NOTHING)

/** A numeric `maxWidth` and `minWidth` limit the border box, as yoga does (`minWidth` wins). */
const limited = ({ maxContent, minContent }: Widths, style: ResolvedStyle): Widths => {
  const limit = (width: number) => Math.max(Math.min(width, typeof style.maxWidth === 'number' ? style.maxWidth : Infinity), typeof style.minWidth === 'number' ? style.minWidth : 0)
  return { maxContent: limit(maxContent), minContent: limit(minContent) }
}

const WIDTH_KEYS = ['width', 'minWidth', 'maxWidth'] as const

const widen = ({ maxContent, minContent }: Widths, by: number): Widths =>
  ({ maxContent: maxContent + by, minContent: minContent + by })

/** A page-number digit: the four digits a page token measures as. */
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * The widths of an element's border box in a measured column. An element
 * whose width only its own width could tell (a percentage width, a row, an
 * image) fails in an 'auto' column (`unmeasurableInAuto`) and adds nothing in
 * a share column, where content only sets the least width.
 */
const measure = (node: Node, fontStore: FontStore, auto: boolean): Widths => {
  const style = node.style ?? {}
  const percentage = WIDTH_KEYS.find(key => typeof style[key] === 'string' && style[key].endsWith('%'))
  if (percentage !== undefined) return auto ? unmeasurableInAuto(node, `${nameOf(node)} with ${percentage} ${JSON.stringify(style[percentage])}`) : NOTHING
  if (typeof style.width === 'number') return { maxContent: style.width, minContent: style.width }
  return limited(contentWidths(node, style, fontStore, auto), style)
}

const contentWidths = (node: Node, style: ResolvedStyle, fontStore: FontStore, auto: boolean): Widths => {
  if (node.type === PDF_PRIMITIVES.Text) {
    const render = node.props.render
    const texts = typeof render === 'function'
      // A dynamic text: four of the widest digit for each page token.
      ? DIGITS.map((digit) => {
          const page = Number(digit.repeat(4))
          const value = render({ pageNumber: page, totalPages: page })
          return { ...node, children: [{ type: PDF_PRIMITIVES.TextInstance, value: renderedText(value) }] }
        })
      : [node]
    return widen(widest(texts.map(text => measureParagraphs(fragmentsOfText(fontStore, text), { hyphenate: false }))), insideEdges(node, auto))
  }
  if (node.type === PDF_PRIMITIVES.Note) return NOTHING
  // A link around texts or elements stays a box (prepare/links.ts), laid out as a view.
  if (node.type !== PDF_PRIMITIVES.View && node.type !== PDF_PRIMITIVES.Link) return auto ? unmeasurableInAuto(node, nameOf(node)) : NOTHING
  if (isRow(style)) return auto ? unmeasurableInAuto(node, `${nameOf(node)} with flexDirection 'row'`) : NOTHING
  // An absolute child takes no width, except the visible cell of a cell over
  // several rows, which is absolute inside the view that takes its columns.
  const spansRows = node.props[PDF_ROW_SPAN_PROP] !== undefined
  return widen(widest(elements(node)
    .filter(child => spansRows || child.style?.position !== 'absolute')
    .map(child => widen(measure(child, fontStore, auto), outsideEdges(child, auto)))), insideEdges(node, auto))
}

/**
 * Content in an 'auto' column that the tree check at mount could not see
 * (components/table.ts, `checkMeasurable`), such as a tree built without the
 * table components. `name` is the element and what makes it unmeasurable.
 */
const unmeasurableInAuto = (node: Node, name: string): never => {
  throw new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `${name} in an 'auto' table column needs a width of its own, such as style width: '80pt': the column is as wide as its content, and it measures texts and columns of texts.`,
    { source: parsePdfSourcePosition(node.source) },
  )
}

/**
 * A view marked with columns its table does not have, or with a percentage
 * column: the table components never write such marks (a cell over a
 * percentage and a measured column fails at mount), an author who writes the
 * internal props can.
 */
const badColumn = (view: Node, index: number, columns: readonly PdfTableColumnWidth[]): never => {
  const column = columns[index]
  throw new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    column === undefined
      ? `<${PDF_PRIMITIVE_NAMES[view.type]}> takes column ${index + 1} of a table with ${columns.length} ${columns.length === 1 ? 'column' : 'columns'}.`
      : `<${PDF_PRIMITIVE_NAMES[view.type]}> takes column ${index + 1}, a percentage column, of a table with 'auto' columns: a percentage and a measured width cannot be added before layout.`,
    { source: parsePdfSourcePosition(view.source) },
  )
}

/** Each element below `node` that takes columns of its table, in tree order; a nested table keeps its own. */
const columnViews = (node: Node): Node[] => elements(node).flatMap((child) => {
  if (cellColumnsOf(child) !== undefined) return [child]
  return columnsOf(child) === undefined && columnStylesOf(child) === undefined ? columnViews(child) : []
})

/**
 * The style of a view over columns with the flex styles of its columns: the
 * column wins over its own widths. Its margins sit outside the flex basis, so
 * the basis is the column's less the margins, and the shrink factor grows to
 * match, so that shrink × basis, what yoga takes from it, stays the same in
 * every row. The table components reject a horizontal margin that is not a
 * length on a cell at mount (`checkCellMargins`); in a tree built without
 * them, such a margin counted 0 in the measure and would take free space in
 * the row, so it goes.
 */
const columnStyleOf = (own: ResolvedStyle, column: TableCellStyle): ResolvedStyle => {
  const { width: _width, minWidth: _minWidth, maxWidth: _maxWidth, marginLeft, marginRight, ...rest } = own
  const margins = {
    ...(typeof marginLeft === 'number' ? { marginLeft } : {}),
    ...(typeof marginRight === 'number' ? { marginRight } : {}),
  }
  const basis = Math.max(0, column.flexBasis - (margins.marginLeft ?? 0) - (margins.marginRight ?? 0))
  const flexShrink = basis > 0 ? column.flexShrink * column.flexBasis / basis : 0
  return { ...rest, ...margins, flexBasis: basis, flexGrow: column.flexGrow, flexShrink }
}

const sameColumns = (one: readonly number[], other: readonly number[]): boolean =>
  one.length === other.length && one.every((index, at) => index === other[at])

/**
 * A table's views over its columns with the flex styles of their columns
 * (`measureColumns`). The table loses `PDF_TABLE_COLUMNS_PROP`: a page part
 * that pagination lays out again keeps the widths of the whole table.
 */
const measuredTable = (table: Node, columns: readonly PdfTableColumnWidth[], fontStore: FontStore, points: (length: string) => number): Node => {
  const views = columnViews(table)
  const cells = views.map((view): TableCellMeasure => {
    const indices = cellColumnsOf(view)!
    for (const index of indices) {
      const taken = columns[index]
      if (taken === undefined || (taken !== 'auto' && typeof taken !== 'number' && taken.endsWith('%'))) {
        badColumn(view, index, columns)
      }
    }
    const [index] = indices
    const column = index === undefined ? undefined : columns[index]
    if (indices.length > 1) {
      // A span counts only its own edges: the columns give it at least those.
      const auto = indices.some(at => columns[at] === 'auto')
      return { columns: indices, maxContent: 0, minContent: 0, edges: insideEdges(view, auto) + outsideEdges(view, auto) }
    }
    if (column !== 'auto' && typeof column !== 'number') {
      return { columns: indices, maxContent: 0, minContent: 0 }
    }
    // The view is the visible cell itself (a cell over several rows keeps a
    // view around it, which has no margins): its margins take room in the column.
    const widths = widen(measure(view, fontStore, column === 'auto'), outsideEdges(view, column === 'auto'))
    // The text layout breaks a line at the box width less its edges, in
    // float64; yoga holds float32. Without the margin a one-word cell could
    // wrap at exactly its widest content.
    return { columns: indices, maxContent: widths.maxContent + SAFETY_THRESHOLD, minContent: widths.minContent + SAFETY_THRESHOLD }
  })
  const measured = measureColumns(columns, cells, points)
  // `minWidth` leaves out percentage columns, which take their share of the table.
  const percent = columns.reduce<number>((sum, column) => sum + (typeof column === 'string' && column.endsWith('%') ? Number.parseFloat(column) : 0), 0)
  const neededWidth = percent < 100 ? measured.minWidth / (1 - percent / 100) : measured.minWidth
  const styles = new Map(views.map((view, index) => [view, measured.cells[index]!]))
  const rewrite = (node: Node): Node => {
    const style = styles.get(node)
    if (style !== undefined) return { ...node, style: columnStyleOf(node.style ?? {}, style) }
    if (node !== table && columnsOf(node) !== undefined) return node
    return node.children === undefined ? node : { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : rewrite(child)) }
  }
  const { [PDF_TABLE_COLUMNS_PROP]: _columns, ...props } = table.props
  // One entry per set of columns: the style depends on the set alone (`measureColumns`).
  const columnStyles: { columns: readonly number[], style: TableCellStyle }[] = []
  views.forEach((view, index) => {
    const columns = cellColumnsOf(view)!
    if (!columnStyles.some(entry => sameColumns(entry.columns, columns))) columnStyles.push({ columns, style: measured.cells[index]! })
  })
  return { ...rewrite(table), props: { ...props, [TABLE_COLUMNS_NEED_PROP]: { neededWidth }, [TABLE_COLUMN_STYLES_PROP]: columnStyles } }
}

/**
 * A measured table whose views a page callback rendered again: those views
 * with the styles of their columns. A view that has them already stays the
 * same object (`columnStyleOf` gives the same flex values again).
 */
const restyledTable = (table: Node, columnStyles: ColumnStyles): Node => {
  const restyled = new Map<Node, ResolvedStyle>()
  for (const view of columnViews(table)) {
    const columns = cellColumnsOf(view)!
    const column = columnStyles.find(entry => sameColumns(entry.columns, columns))?.style
    if (column === undefined) continue
    const own = view.style ?? {}
    const style = columnStyleOf(own, column)
    const styled = WIDTH_KEYS.every(key => own[key] === undefined)
      && own.flexBasis === style.flexBasis && own.flexGrow === style.flexGrow && own.flexShrink === style.flexShrink
    if (!styled) restyled.set(view, style)
  }
  if (restyled.size === 0) return table
  const rewrite = (node: Node): Node => {
    const style = restyled.get(node)
    if (style !== undefined) return { ...node, style }
    if (node !== table && (columnsOf(node) !== undefined || columnStylesOf(node) !== undefined)) return node
    return node.children === undefined ? node : { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : rewrite(child)) }
  }
  return rewrite(table)
}

/**
 * The page with the column widths of each table that has 'auto' columns
 * (D39). The one hook of automatic columns in the layout: `resolvePageDimensions`
 * calls it before yoga. A table measured once (the whole document, before
 * pagination) is not measured again in its page parts, so every page shows
 * the same widths; a table that a page callback returns is measured on its page.
 */
export const withMeasuredColumns = (page: Node, fontStore: FontStore): Node => {
  let resolve: ((style: { width: string }) => ResolvedStyle) | undefined
  // A length column in points: relative units (px, rem, vw, vh) need the page.
  const points = (length: string): number => Number((resolve ??= pageStyleResolver(page))({ width: length }).width)
  const visit = (node: Node): Node => {
    const columns = columnsOf(node)
    const columnStyles = columns === undefined ? columnStylesOf(node) : undefined
    const current = columns !== undefined
      ? measuredTable(node, columns, fontStore, points)
      : columnStyles === undefined ? node : restyledTable(node, columnStyles)
    if (current.children === undefined || current.type === PDF_PRIMITIVES.Text || current.type === PDF_PRIMITIVES.Svg) return current
    // A new array only when a child changed: the hook runs on every page layout.
    let children: StyledLayoutNode[] | undefined
    for (const [index, child] of current.children.entries()) {
      if (child.type === PDF_PRIMITIVES.TextInstance) continue
      const next = visit(child)
      if (next !== child) (children ??= [...current.children])[index] = next
    }
    return children === undefined ? current : { ...current, children }
  }
  return visit(page)
}
