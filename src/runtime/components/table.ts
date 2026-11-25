import {
  Comment,
  defineComponent,
  Fragment,
  getCurrentInstance,
  h,
  inject,
  isVNode,
  mergeProps,
  normalizeStyle,
  onMounted,
  onUpdated,
  provide,
  Text,
  type ComponentInternalInstance,
  type InjectionKey,
  type VNode,
} from 'vue'
import { PDF_STYLE_VALUES, type PdfStyle, type PdfStyleValue } from '../authoring'
import {
  isPdfTableColumnWidth,
  PDF_ELEMENTS,
  PDF_FIELD_TYPES,
  PDF_HEADER_CELL_PROP,
  PDF_PRIMITIVES,
  PDF_ROW_SPAN_PROP,
  PDF_RUNNING_ROW_PROP,
  PDF_TABLE_CELL_PROP,
  PDF_TABLE_COLUMNS_PROP,
  type PdfElementType,
  type PdfTableColumnWidth,
  type PdfViewProps,
} from '../primitives'
import { PDF_COMPONENT_PROP } from '../component-names'
import { describePdfValue } from '../shared/describe-value'
import { treeInvalid } from '../shared/errors'
import { PDF_UNIT_LENGTH, pdfStyleValueProblem } from '../shared/style-values'
import { placeCell, tableColumnStyles } from '../shared/table-columns'
import { pdfSourceOf } from '../shared/template'
import type { PdfPrimitiveComponents } from './index'

export type { PdfTableColumnWidth }

/** A column with defaults for the cells that start in it, header cells included. */
export type PdfTableColumnOptions = {
  width: PdfTableColumnWidth
  /** The `align` of each cell that starts in this column, unless the cell sets its own. */
  align?: 'left' | 'center' | 'right'
  /** Applies to each cell that starts in this column, under the cell's own class and style. */
  style?: PdfStyle
}

/** One table column: its width alone, or the width with defaults for its cells. */
export type PdfTableColumn = PdfTableColumnWidth | PdfTableColumnOptions

export type PdfTableProps = PdfViewProps & {
  /** One entry per column, in cell order. */
  columns: readonly PdfTableColumn[]
}

/** A header row is `fixed`: it repeats at the top of every page of the table. */
export type PdfTableHeaderProps = PdfViewProps

/** A row does not split across pages unless it sets `wrap`. */
export type PdfTableRowProps = PdfViewProps & {
  /**
   * Sets a running value from this row, such as a carried subtotal:
   * `PdfRunningText` with this name prints `text` on the pages from here on.
   * Only the object form: a row has no text of its own.
   */
  running?: { name: string, text: string }
}

export type PdfTableCellProps = {
  /** Horizontal alignment of the cell content. Default: the `align` of its first column, else `'left'`. */
  align?: 'left' | 'center' | 'right'
  /** Number of columns the cell takes, a whole number from 1. Default 1. */
  colspan?: number
  /**
   * Number of rows the cell takes, a whole number from 1. Default 1. The rows
   * below leave out the columns it covers. Not in a `PdfTableHeader`.
   */
  rowspan?: number
  /**
   * In a PDF/UA-1 or PDF/A-3a document: in a `PdfTableRow`, the cell is the
   * header of its row (`TH` with scope row). Cells of a `PdfTableHeader` are
   * column headers anyway. No effect otherwise. Default `false`.
   */
  header?: boolean
  style?: PdfStyleValue
}

/** The columns a cell claimed in its row. */
type PdfTableClaim = {
  /** Its first column. */
  start: number
  /**
   * The `span` columns of the cell, from `start` on; shorter than `span` when
   * the row runs out of columns (`checkCount` then fails).
   */
  columns: readonly PdfTableColumnWidth[]
  /** The `align` of its first column, if the table sets one. */
  align: PdfTableAlign | undefined
  /** The `style` of its first column, if the table sets one. */
  style: PdfStyle | undefined
  /** The indices of the columns before `start` that cells of rows above span into: the cell renders their holes. */
  holes: readonly number[]
  /** All columns of the table. */
  declared: readonly PdfTableColumnWidth[]
}

/** The cells of one row take their columns from it in render order. */
type PdfTableRowScope = {
  /** The columns of this cell: from the next column that no cell of this row and no row span above takes. */
  claim: (cell: object, span: number, attrs: Record<string, unknown>) => PdfTableClaim
  /**
   * Records how many rows the cell spans from this row (1 removes a span).
   * Null in a header row, which repeats as one row.
   */
  spanRows: ((cell: object, span: Omit<PdfTableRowSpan, 'row'>) => void) | null
  /** The indices of the columns no cell claimed so far: after the last cell, the empty ones and the holes. */
  rest: () => readonly number[]
  /** All columns of the table. */
  declared: () => readonly PdfTableColumnWidth[]
  /** Fails when the cells of the row cover more columns than the table declares. */
  checkCount: () => void
}

/** A cell that spans rows: the body row it starts in and the columns and rows it covers. */
type PdfTableRowSpan = {
  row: number
  start: number
  columns: number
  rows: number
  attrs: Record<string, unknown>
}

/** A body row as its table sees it. */
type PdfTableBodyRow = {
  attrs: Record<string, unknown>
  instance: ComponentInternalInstance
}

/**
 * The body rows of a table in render order, and the cells that span them.
 * Vue renders depth-first, so every cell of a row has claimed its columns (and
 * recorded its span) before the next row renders and asks what is covered.
 */
type PdfTableBodyScope = {
  /** The place of a body row among the body rows of its table, claimed on its first render. */
  index: (row: object, info: PdfTableBodyRow) => number
  /** The columns that cells of the rows above span into body row `index`. */
  covered: (index: number) => ReadonlySet<number>
  span: (cell: object, span: PdfTableRowSpan) => void
}

// A cell provides `null` for both keys: a row or cell inside a cell belongs to
// no table unless an inner PdfTable provides one.
const COLUMNS: InjectionKey<(() => PdfTableColumns) | null> = Symbol('nuxt-pdf.table.columns')
const ROW: InjectionKey<PdfTableRowScope | null> = Symbol('nuxt-pdf.table.row')
const BODY: InjectionKey<PdfTableBodyScope | null> = Symbol('nuxt-pdf.table.body')

type PdfTableAlign = NonNullable<PdfTableCellProps['align']>
const ALIGNS: readonly unknown[] = ['left', 'center', 'right'] satisfies PdfTableAlign[]
const isAlign = (value: unknown): value is PdfTableAlign => ALIGNS.includes(value)

/** The columns of a table: the widths the layout reads, and the cell defaults by column. */
type PdfTableColumns = {
  widths: readonly PdfTableColumnWidth[]
  aligns: ReadonlyArray<PdfTableAlign | undefined>
  styles: ReadonlyArray<PdfStyle | undefined>
}

const COLUMNS_FORMS = 'shares (numbers), widths (\'30%\', \'80pt\'), \'auto\', or { width, align, style }'

const isStyleObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The checks of a cell's style (`validateStyle`), with messages that name the column. */
const checkedColumnStyle = (style: unknown, column: string, attrs: Record<string, unknown>): PdfStyle => {
  if (!isStyleObject(style)) return treeInvalid(`${column} requires "style" to be a style object.`, pdfSourceOf(attrs))
  for (const [key, value] of Object.entries(style)) {
    if (!Object.hasOwn(PDF_STYLE_VALUES, key)) treeInvalid(`Unsupported PDF style "${key}" in the style of ${column}.`, pdfSourceOf(attrs))
    if (value === undefined || value === null) continue
    const problem = pdfStyleValueProblem(key, value)
    if (problem !== undefined) treeInvalid(`${column} style value ${describePdfValue(value)} for "${key}" is invalid: expected ${problem}.`, pdfSourceOf(attrs))
  }
  return style
}

const checkedColumn = (entry: unknown, index: number, attrs: Record<string, unknown>): { width: PdfTableColumnWidth, align?: PdfTableAlign, style?: PdfStyle } => {
  if (isPdfTableColumnWidth(entry)) return { width: entry }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return treeInvalid(`<PdfTable> requires "columns": a non-empty list of ${COLUMNS_FORMS}.`, pdfSourceOf(attrs))
  }
  const column = `<PdfTable> column ${index + 1}`
  for (const key of Object.keys(entry)) {
    if (key === 'class') treeInvalid(`${column} has the key "class": a column takes width, align and style. Use style here, or class on the cell.`, pdfSourceOf(attrs))
    if (key !== 'width' && key !== 'align' && key !== 'style') treeInvalid(`${column} has the key "${key}": a column takes width, align and style.`, pdfSourceOf(attrs))
  }
  const { width, align, style }: { width?: unknown, align?: unknown, style?: unknown } = entry
  if (!isPdfTableColumnWidth(width)) return treeInvalid(`${column} requires "width": a share (number), a width ('30%', '80pt') or 'auto'.`, pdfSourceOf(attrs))
  if (align !== undefined && !isAlign(align)) return treeInvalid(`${column} requires "align" to be 'left', 'center' or 'right'.`, pdfSourceOf(attrs))
  return { width, align, style: style === undefined ? undefined : checkedColumnStyle(style, column, attrs) }
}

const checkedColumns = (value: unknown, attrs: Record<string, unknown>): PdfTableColumns => {
  if (!Array.isArray(value) || value.length === 0) return treeInvalid(`<PdfTable> requires "columns": a non-empty list of ${COLUMNS_FORMS}.`, pdfSourceOf(attrs))
  const columns = value.map((entry: unknown, index) => checkedColumn(entry, index, attrs))
  return { widths: columns.map(column => column.width), aligns: columns.map(column => column.align), styles: columns.map(column => column.style) }
}

const checkedSpan = (prop: 'colspan' | 'rowspan', value: unknown, attrs: Record<string, unknown>): number => {
  if (value === undefined) return 1
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
  // A static attribute `colspan="2"` passes the text "2".
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return treeInvalid(`<PdfTableCell> ${prop}="${value}" passes the text "${value}", not a number. Bind it: :${prop}="${value.trim()}".`, pdfSourceOf(attrs))
  }
  return treeInvalid(`<PdfTableCell> requires "${prop}" to be a whole number from 1.`, pdfSourceOf(attrs))
}

/** A prop such as `wrap` or `break` that is set: `true`, or `''` from the template shorthand. */
const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== false

/**
 * Whether a row is a row of the table itself: between the two, the only
 * component that renders an element is the table's own view. The elements'
 * `children` arrays are filled in only when the renderer flushes, after the
 * mounted hooks, so the instances tell it; a primitive is a functional
 * component whose render result is its element.
 */
const isTableRow = (row: ComponentInternalInstance, table: ComponentInternalInstance): boolean => {
  let elements = 0
  for (let parent = row.parent; parent !== null && parent !== table; parent = parent.parent) {
    if (typeof parent.subTree.type === 'string') elements += 1
  }
  return elements === 1
}

// Style keys that set the right margin; the engine applies them in key order.
const RIGHT_MARGIN_KEYS = new Set(['margin', 'marginHorizontal', 'marginRight'])

/**
 * A cell's style as the engine reads it: its column's `style`, then the
 * cell's own (classes reach it as `style`, rewritten by the SFC compiler).
 */
type CellStyle = Record<string, unknown>
const cellStyleOf = (column: PdfStyle | undefined, attrs: Record<string, unknown>): CellStyle => {
  // normalizeStyle merges a style array into one object.
  const style = normalizeStyle([column, attrs.style])
  return typeof style === 'object' ? style : {}
}

/**
 * A span over percentage and length columns widens its cell over the wrapper's
 * right margin with a negative right margin of its own (`columnStyles`). An
 * author right margin would replace that margin and narrow the cell by the
 * spanned lengths. Adding the two needs the engine's resolved style (shorthand
 * order, units), so such a margin is rejected instead. Classes reach the cell
 * as `style` too (the SFC compiler rewrites them).
 */
const checkSpanMargin = (style: CellStyle, attrs: Record<string, unknown>): void => {
  if (Object.keys(style).some(key => RIGHT_MARGIN_KEYS.has(key))) {
    treeInvalid('<PdfTableCell> spans percentage and length columns, so it cannot take a right margin (margin, marginHorizontal or marginRight). Use paddingRight for space inside the cell, or give the spanned columns one kind of width.', pdfSourceOf(attrs))
  }
}

/** The parts of a box value, split at CSS whitespace, as the engine reads them (styles/expand.ts). */
const boxParts = (value: unknown): unknown[] =>
  typeof value === 'string' ? value.trim().split(/[ \t\n\r\f]+/) : [value]

/**
 * The left and right margin a cell's style gives, each with the key that set
 * it: the engine applies the keys in order, `margin` as CSS sides and
 * `marginHorizontal` as right, then left.
 */
const horizontalMargins = (style: Record<string, unknown>): Record<'left' | 'right', { key: string, value: unknown } | undefined> => {
  const sides: Record<'left' | 'right', { key: string, value: unknown } | undefined> = { left: undefined, right: undefined }
  for (const [key, value] of Object.entries(style)) {
    const parts = boxParts(value)
    if (key === 'margin') Object.assign(sides, { right: { key, value: parts[1] ?? parts[0] }, left: { key, value: parts[3] ?? parts[1] ?? parts[0] } })
    else if (key === 'marginHorizontal') Object.assign(sides, { right: { key, value: parts[0] }, left: { key, value: parts[1] ?? parts[0] } })
    else if (key === 'marginLeft') sides.left = { key, value: parts[0] }
    else if (key === 'marginRight') sides.right = { key, value: parts[0] }
  }
  return sides
}

/**
 * The column decides a cell's box. An 'auto' horizontal margin would move
 * the box inside its columns (or out of them, beside a width column), and in
 * a table with 'auto' columns, where the measure step writes the cell's flex
 * styles, a percentage margin has no width in points: both fail.
 */
const checkCellMargins = (style: CellStyle, attrs: Record<string, unknown>): void => {
  for (const side of Object.values(horizontalMargins(style))) {
    if (side === undefined) continue
    if (side.value === 'auto') {
      treeInvalid(`<PdfTableCell> has an 'auto' horizontal margin (${side.key} ${JSON.stringify(style[side.key])}): a cell is as wide as its columns, so the margin cannot place it. Use textAlign to place its text, align on the cell or its column to place its content, or a <PdfView> inside the cell to place a box.`, pdfSourceOf(attrs))
    }
    if (isPercentage(side.value)) {
      treeInvalid(`<PdfTableCell> has a horizontal margin in percent (${side.key} ${JSON.stringify(style[side.key])}): the margin sits inside the cell's columns, and a percentage cannot be taken off a column width. Use a length, such as '4pt'.`, pdfSourceOf(attrs))
    }
  }
}

const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' } as const
/** The style keys that only a text reads; a cell with only text gives them to its text. */
const TEXT_ONLY_KEYS = ['maxLines', 'textOverflow', 'textDecorationColor', 'textDecorationStyle'] as const

/**
 * The style of the text that a cell with only text renders: as wide as the
 * cell, so the inherited textAlign places its lines, also one that a column
 * or cell style sets without align, with the cell's text-only keys.
 */
const textCellStyle = (style: CellStyle): CellStyle => Object.fromEntries([
  ['alignSelf', 'stretch'],
  ...TEXT_ONLY_KEYS.filter(key => style[key] !== undefined).map(key => [key, style[key]]),
])

const ROW_STYLE: PdfStyle = { flexDirection: 'row' }

// The visible cell of a cell over several rows, inside the view that takes its columns.
const SPAN_CELL_STYLE: PdfStyle = { position: 'absolute', top: 0, left: 0, right: 0 }

const WIDTH_KEYS = ['width', 'minWidth', 'maxWidth'] as const
const FLEX_KEYS = ['flex', 'flexBasis', 'flexGrow', 'flexShrink'] as const

/**
 * The column decides a cell's width. Only a cell over `'auto'` columns alone
 * may set its own: the measure takes it as the cell's request for the column.
 * The flex keys would size the cell in its row, so no cell sets them, and a
 * cell stays in its row.
 */
const checkCellWidths = (style: CellStyle, attrs: Record<string, unknown>, columns: readonly PdfTableColumnWidth[]): void => {
  const keys = columns.every(column => column === 'auto') ? FLEX_KEYS : [...WIDTH_KEYS, ...FLEX_KEYS]
  const key = keys.find(name => isSet(style[name]))
  if (key !== undefined) {
    treeInvalid(`<PdfTableCell> sets ${key} ${JSON.stringify(style[key])}: a cell is as wide as its columns. Set the width in columns, such as '80pt' or 'auto'.`, pdfSourceOf(attrs))
  }
  if (style.position === 'absolute') {
    treeInvalid('<PdfTableCell> sets position "absolute": a cell stays in its row. Put an absolute <PdfView> inside the cell.', pdfSourceOf(attrs))
  }
}

/** Whether the cell has a horizontal margin other than 0. */
const hasSideMargin = (style: CellStyle): boolean =>
  Object.values(horizontalMargins(style)).some(side => side !== undefined && Number.parseFloat(String(side.value)) !== 0)

/** Slot content without fragments (`v-for`) and comments (`v-if`). */
const flatten = (nodes: VNode[]): VNode[] => nodes.flatMap((node) => {
  if (node.type === Fragment) return flatten(node.children as VNode[])
  return node.type === Comment ? [] : [node]
})

// Content whose width only a width of its own tells: an 'auto' column cannot
// measure it (D39, review decision 6).
const UNMEASURABLE: ReadonlySet<PdfElementType> = new Set([PDF_PRIMITIVES.Image, PDF_PRIMITIVES.Svg, ...PDF_FIELD_TYPES])

const isElementType = (type: string): type is PdfElementType => Object.hasOwn(PDF_ELEMENTS, type)

/** A width that layout knows before measuring: a number or a length, not a percentage or 'auto'. */
const isOwnWidth = (width: unknown): boolean =>
  (typeof width === 'number' && Number.isFinite(width)) || (typeof width === 'string' && PDF_UNIT_LENGTH.test(width))

/** A percentage: a share of a width that is not known before layout. */
const isPercentage = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().endsWith('%')

/** A percentage or 'auto': a length that has no value before layout. */
const isUnmeasuredLength = (value: unknown): boolean =>
  isPercentage(value) || (typeof value === 'string' && value.trim() === 'auto')

// Style keys with a horizontal edge (a style object takes one value per key):
// margins, outside an element's own width, and paddings and borders, inside it.
const MARGIN_KEYS = ['margin', 'marginHorizontal', 'marginLeft', 'marginRight'] as const
const INSIDE_KEYS = ['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight', 'borderWidth', 'borderLeftWidth', 'borderRightWidth'] as const

/**
 * Fails when the content of a cell in an 'auto' column holds an element whose
 * width cannot be measured from text: an image, an SVG, a form field or a
 * row-direction view without a width of its own, an element with a
 * percentage width, minimum or maximum width, a horizontal padding or
 * border of a percentage or 'auto', or a horizontal margin of a percentage
 * (an 'auto' margin only takes free space, so it counts 0). Walks the mounted vnodes
 * (component subtrees included), as the elements get their children only
 * when the renderer flushes. An element with its own width counts as that
 * width plus its margins; its content is not walked. Absolute elements take
 * no width.
 */
const checkMeasurable = (node: VNode): void => {
  if (node.component !== null) return checkMeasurable(node.component.subTree)
  if (typeof node.type === 'string' && isElementType(node.type)) {
    const props: Record<string, unknown> = node.props ?? {}
    const style = normalizeStyle(props.style)
    const styleOf = (key: string): unknown => typeof style === 'object' ? style[key] : undefined
    const name = PDF_ELEMENTS[node.type].name
    // The visible cell is named as the author wrote it.
    const component = props[PDF_COMPONENT_PROP]
    const label = typeof component === 'string' ? component : name
    // Absolute content takes no width; the visible cell of a cell over several
    // rows is absolute inside the view that takes its columns, and counts.
    if (styleOf('position') === 'absolute' && component !== 'PdfTableCell') return
    const edge = (keys: readonly string[]) => keys.find(key => isUnmeasuredLength(styleOf(key)))
    const failEdge = (key: string): never => treeInvalid(`<${label}> in an 'auto' table column has ${key} ${JSON.stringify(styleOf(key))}: the column is as wide as its content in points, and a percentage or 'auto' padding or border, or a percentage margin, has no width before layout. Use a length, such as '4pt'.`, pdfSourceOf(props))
    const margin = MARGIN_KEYS.find(key => isPercentage(styleOf(key)))
    if (margin !== undefined) failEdge(margin)
    const percentage = (['width', 'minWidth', 'maxWidth'] as const).find(key => isUnmeasuredLength(styleOf(key)) && styleOf(key) !== 'auto')
    if (percentage !== undefined) {
      treeInvalid(`<${label}> with ${percentage} ${JSON.stringify(styleOf(percentage))} in an 'auto' table column needs a width of its own in points, such as style width: '80pt': the column is as wide as its content, and a percentage of it is not known before layout.`, pdfSourceOf(props))
    }
    if (isOwnWidth(styleOf('width')) || (name === 'PdfSvg' && isOwnWidth(props.width))) return
    const inside = edge(INSIDE_KEYS)
    if (inside !== undefined) failEdge(inside)
    if (UNMEASURABLE.has(node.type)) {
      treeInvalid(`<${name}> in an 'auto' table column needs a width of its own, such as style width: '80pt': the column is as wide as its content, and text is the only content it measures.`, pdfSourceOf(props))
    }
    const direction = styleOf('flexDirection')
    if (name === 'PdfView' && (direction === 'row' || direction === 'row-reverse')) {
      treeInvalid('<PdfView> with flexDirection \'row\' in an \'auto\' table column needs a width of its own, such as style width: \'80pt\': the column is as wide as its content, and it measures a column of texts, not a row.', pdfSourceOf(props))
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (isVNode(child)) checkMeasurable(child)
    }
  }
}

/** Table components over the primitive components they render. */
export const createTableComponents = (primitiveComponents: PdfPrimitiveComponents) => {
  const { PdfText, PdfView, PdfPageNumber, PdfPageCount, PdfPageRef, PdfRunningText, PdfFootnote } = primitiveComponents
  const primitives = new Set<unknown>(Object.values(primitiveComponents))
  // Text, page tokens and footnotes make a text-only cell: they print inside one PdfText.
  const inlineContent = new Set<unknown>([Text, PdfPageNumber, PdfPageCount, PdfPageRef, PdfRunningText, PdfFootnote])

  const PdfTable = defineComponent(
    (props: PdfTableProps, { attrs, slots }) => {
      provide(COLUMNS, () => checkedColumns(props.columns, attrs))
      const instance = getCurrentInstance()
      // Row instance → its index; a document renders once, so render order is
      // document order for every tree that reaches layout (see the row claims).
      const indices = new Map<object, number>()
      const bodyRows: PdfTableBodyRow[] = []
      const spans = new Map<object, PdfTableRowSpan>()
      provide(BODY, {
        index(row, info) {
          let index = indices.get(row)
          if (index === undefined) {
            index = bodyRows.length
            indices.set(row, index)
          }
          bodyRows[index] = info
          return index
        },
        covered(index) {
          const covered = new Set<number>()
          for (const span of spans.values()) {
            if (span.row < index && index < span.row + span.rows) {
              for (let column = span.start; column < span.start + span.columns; column += 1) covered.add(column)
            }
          }
          return covered
        },
        span(cell, span) {
          if (span.rows === 1) spans.delete(cell)
          else spans.set(cell, span)
        },
      })
      // The rows of a span go to the layout as one group: they must exist,
      // be rows of this table itself, and stay whole on one page.
      const checkSpans = () => {
        for (const span of spans.values()) {
          const left = bodyRows.length - span.row
          if (span.rows > left) {
            treeInvalid(`<PdfTableCell> spans ${span.rows} rows, but its <PdfTable> has ${left === 1 ? 'only its own row' : `only ${left} rows from its row`} to the end.`, pdfSourceOf(span.attrs))
          }
          bodyRows.slice(span.row, span.row + span.rows).forEach((row, offset) => {
            if (instance !== null && !isTableRow(row.instance, instance)) {
              treeInvalid('<PdfTableRow> is covered by a rowspan, so it must be a row of its <PdfTable> itself, not inside another element.', pdfSourceOf(row.attrs))
            }
            if (isSet(row.attrs.wrap)) {
              treeInvalid('<PdfTableRow> sets wrap, but a rowspan covers it: the rows of a span stay together on one page. Remove wrap.', pdfSourceOf(row.attrs))
            }
            if (offset > 0 && isSet(row.attrs.break)) {
              treeInvalid('<PdfTableRow> sets break, but a rowspan from a row above covers it: the rows of a span stay together on one page. Remove break.', pdfSourceOf(row.attrs))
            }
          })
        }
      }
      onMounted(checkSpans)
      onUpdated(checkSpans)
      return () => {
        const { widths } = checkedColumns(props.columns, attrs)
        const measure = widths.includes('auto') ? { [PDF_TABLE_COLUMNS_PROP]: widths } : {}
        return h(PdfView, { [PDF_COMPONENT_PROP]: 'PdfTable', ...measure }, slots.default)
      }
    },
    { name: 'PdfTable', props: ['columns'] },
  )

  /**
   * An empty column at its width: a column no cell takes, or the hole a row
   * span leaves. In a table with `'auto'` columns the measure step sets the
   * width of a measured one, as of a cell.
   */
  const emptyColumn = (declared: readonly PdfTableColumnWidth[], index: number) => {
    const { wrapper, cell, measured } = tableColumnStyles([declared[index]!], declared, {})
    return h(PdfView, { ...(measured ? { [PDF_TABLE_CELL_PROP]: [index] } : {}), style: wrapper ?? cell })
  }

  // Rendered after the cells of its row (children mount in order), so it sees
  // the columns no cell claimed: a row may have fewer cells than columns, and
  // those columns stay empty at their width instead of widening the shares.
  const PdfTableRowRest = defineComponent(
    () => {
      const row = inject(ROW, null)
      // One empty view per column: columns of different units need not add up.
      return () => row === null ? [] : row.rest().map(index => emptyColumn(row.declared(), index))
    },
    { name: 'PdfTableRowRest' },
  )

  // Header and row: a row-direction view whose cells get their columns in order.
  const createRow = (name: 'PdfTableHeader' | 'PdfTableRow', rowProps: PdfViewProps) => defineComponent(
    (props: Pick<PdfTableRowProps, 'running'>, { attrs, slots }) => {
      const columns = inject(COLUMNS, null)
      const body = name === 'PdfTableRow' ? inject(BODY, null) : null
      const instance = getCurrentInstance()
      // This row's place among the body rows, and the columns spans from the rows above take.
      let index: number | undefined
      let covered: ReadonlySet<number> = new Set()
      // Cell instance → first column, in the order the cells render. A local
      // component may render several cells, so the row cannot count its slot
      // content. Rebuilt on every render of the row, so no index survives a
      // change of the cells; a cell that does not render again keeps the
      // columns of its last render. A document renders once (`take` stops the
      // app), so this is exact for every tree that reaches layout.
      let claimed = new Map<object, { from: number, start: number }>()
      // Columns covered by the cells claimed so far, counting colspan and the
      // holes of row spans before them.
      let used = 0
      const table = (): PdfTableColumns =>
        columns === null ? treeInvalid(`<${name}> must be inside <PdfTable>.`, pdfSourceOf(attrs)) : columns()
      const declared = (): readonly PdfTableColumnWidth[] => table().widths
      provide(ROW, {
        claim(cell, span, cellAttrs) {
          let claim = claimed.get(cell)
          if (claim === undefined) {
            const { start, fits } = placeCell(used, span, column => covered.has(column))
            if (fits < span) {
              treeInvalid(`<PdfTableCell> spans ${span} columns up to column ${start + span}, but a rowspan from a row above takes column ${start + fits + 1}.`, pdfSourceOf(cellAttrs))
            }
            claim = { from: used, start }
            used = start + span
            claimed.set(cell, claim)
          }
          const { widths, aligns, styles } = table()
          const holes = Array.from({ length: claim.start - claim.from }, (_, offset) => claim.from + offset)
          return { start: claim.start, columns: widths.slice(claim.start, claim.start + span), align: aligns[claim.start], style: styles[claim.start], holes, declared: widths }
        },
        spanRows: body === null
          ? null
          : (cell, span) => {
              if (index !== undefined) body.span(cell, { ...span, row: index })
            },
        rest() {
          return Array.from({ length: Math.max(declared().length - used, 0) }, (_, offset) => used + offset)
        },
        declared,
        checkCount() {
          const count = declared().length
          if (used > count) {
            treeInvalid(`<${name}> needs ${used} columns (counting colspan${covered.size > 0 ? ' and the columns of row spans above' : ''}), but its <PdfTable> declares ${count}.`, pdfSourceOf(attrs))
          }
        },
      })
      // A row directly inside a row belongs to no table.
      provide(COLUMNS, null)
      return () => {
        declared()
        claimed = new Map()
        used = 0
        if (body !== null && instance !== null) {
          index = body.index(instance, { attrs, instance })
          covered = body.covered(index)
        }
        const cells = flatten(slots.default?.() ?? [])
        for (const cell of cells) {
          // A local component that renders PdfTableCell elements is fine; text
          // and primitives would get no column.
          if (cell.type === Text || typeof cell.type === 'string' || primitives.has(cell.type)) {
            treeInvalid(`<${name}> holds <PdfTableCell> elements only.`, pdfSourceOf(attrs))
          }
        }
        // The tree check reads `running` (validate-props.ts, `runningRow`).
        const running = props.running === undefined ? {} : { [PDF_RUNNING_ROW_PROP]: props.running }
        return h(PdfView, { ...rowProps, ...running, [PDF_COMPONENT_PROP]: name }, () => [...cells, h(PdfTableRowRest)])
      }
    },
    { name, props: ['running'] },
  )

  const PdfTableHeader = createRow('PdfTableHeader', { fixed: true, style: ROW_STYLE })
  const PdfTableRow = createRow('PdfTableRow', { wrap: false, style: ROW_STYLE })

  // A cell is always a PdfView, which passes text styles on to the texts
  // inside it. Text-only content becomes its one PdfText child.
  const PdfTableCell = defineComponent(
    (props: PdfTableCellProps, { attrs, slots }) => {
      const row = inject(ROW, null)
      const instance = getCurrentInstance()
      provide(ROW, null)
      provide(COLUMNS, null)
      // Set on each render: the cell takes one 'auto' column and its content
      // must be measurable (`checkMeasurable`).
      let measuredAlone = false
      // Mounted and updated hooks run after the whole row rendered, so the
      // row sees all of its cells, and after the content mounted, so the
      // subtree is complete.
      const check = () => {
        row?.checkCount()
        if (measuredAlone && instance !== null) checkMeasurable(instance.subTree)
      }
      onMounted(check)
      onUpdated(check)
      return () => {
        if (row === null || instance === null) return treeInvalid('<PdfTableCell> must be inside <PdfTableRow> or <PdfTableHeader>.', pdfSourceOf(attrs))
        const span = checkedSpan('colspan', props.colspan, attrs)
        const rows = checkedSpan('rowspan', props.rowspan, attrs)
        // Runtime input: the template shorthand `<PdfTableCell header>` passes ''.
        const headerValue: unknown = props.header ?? false
        if (typeof headerValue !== 'boolean' && headerValue !== '') treeInvalid('<PdfTableCell> requires "header" to be true or false.', pdfSourceOf(attrs))
        // Only a header cell carries the mark, so other cells keep their props.
        const header = headerValue === false ? {} : { [PDF_HEADER_CELL_PROP]: true }
        const { start, columns, align: columnAlign, style: columnStyle, holes, declared } = row.claim(instance, span, attrs)
        if (row.spanRows === null) {
          if (rows > 1) treeInvalid('<PdfTableCell> in <PdfTableHeader> cannot span rows: a header repeats as one row.', pdfSourceOf(attrs))
        }
        else row.spanRows(instance, { start, columns: span, rows, attrs })
        measuredAlone = span === 1 && columns[0] === 'auto'
        // Too few columns left: checkCount fails once the row has rendered.
        const columnStyles = columns.length < span
          ? { cell: {}, measured: false }
          : tableColumnStyles(columns, declared, attrs)
        const { spansUnits, measured } = columnStyles
        const style = cellStyleOf(columnStyle, attrs)
        checkCellMargins(style, attrs)
        checkCellWidths(style, attrs, columns)
        // A side margin sits inside the cell's columns: a view takes the
        // width of a width or percentage column, and the cell fills it less
        // its margins, so the later cells of the row stay in their columns.
        const { wrapper, cell } = columnStyles.wrapper === undefined && !measured && hasSideMargin(style)
          ? { wrapper: columnStyles.cell, cell: { flexGrow: 1 } }
          : columnStyles
        if (spansUnits) checkSpanMargin(style, attrs)
        const measure = measured ? { [PDF_TABLE_CELL_PROP]: columns.map((_, offset) => start + offset) } : {}
        const content = slots.default?.() ?? []
        const textOnly = flatten(content).every(node => inlineContent.has(node.type))
        // The text carries the cell's name, so its messages name the cell and a
        // tagged document writes its text as the cell's own (tagged.ts).
        const children = textOnly ? () => [h(PdfText, { [PDF_COMPONENT_PROP]: 'PdfTableCell', style: textCellStyle(style) }, () => content)] : () => content
        const alignStyle = (align: PdfTableAlign): PdfStyle => ({ textAlign: align, alignItems: ALIGN_ITEMS[align] })
        // A cell over several rows: a view takes its columns in its first row,
        // and the visible cell inside it is absolute, as high as the rows it
        // covers (the layout sets the height, D39).
        const spansRows = rows > 1 && row.spanRows !== null
        const visibleColumns = spansRows ? { ...(wrapper === undefined ? {} : cell), ...SPAN_CELL_STYLE } : cell
        // `attrs` (class, style, source position) go on the visible cell; the
        // author's style still wins over the column style, as on any element.
        // What wins, lowest first: the column's align, the column's style, the
        // cell's own align, its class and style.
        // In a measured table the visible cell takes its columns itself, unless
        // it spans rows, and the measure step replaces its flex styles and
        // widths: there the column wins.
        const visible = h(PdfView, mergeProps({
          [PDF_COMPONENT_PROP]: 'PdfTableCell',
          ...header,
          ...(spansRows ? {} : measure),
          style: {
            ...visibleColumns,
            ...alignStyle(columnAlign ?? 'left'),
            ...columnStyle,
            ...(props.align === undefined ? {} : alignStyle(props.align)),
          },
        }, attrs), children)
        const rowSpan = spansRows ? { [PDF_ROW_SPAN_PROP]: rows, ...measure } : {}
        const placed = wrapper === undefined && !spansRows
          ? visible
          : h(PdfView, { [PDF_COMPONENT_PROP]: 'PdfTableCell', ...header, ...rowSpan, style: wrapper ?? cell }, () => [visible])
        // The holes of row spans before the cell keep the later cells in their columns.
        return holes.length === 0 ? placed : [...holes.map(index => emptyColumn(declared, index)), placed]
      }
    },
    { name: 'PdfTableCell', props: ['align', 'colspan', 'header', 'rowspan'], inheritAttrs: false },
  )

  return { PdfTable, PdfTableHeader, PdfTableRow, PdfTableCell }
}
