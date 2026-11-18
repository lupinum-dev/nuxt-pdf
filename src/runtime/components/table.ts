import {
  Comment,
  defineComponent,
  Fragment,
  getCurrentInstance,
  h,
  inject,
  mergeProps,
  normalizeStyle,
  onMounted,
  onUpdated,
  provide,
  Text,
  type Component,
  type InjectionKey,
  type VNode,
} from 'vue'
import type { PdfLengthOrPercentage, PdfLengthUnit, PdfPercentage, PdfStyle, PdfStyleValue, PdfUnitLength } from '../authoring'
import { PDF_HEADER_CELL_PROP, PDF_PERCENTAGE, PDF_UNIT_LENGTH, type PdfViewProps } from '../primitives'
import { PDF_COMPONENT_PROP } from '../component-names'
import { NuxtPdfError, PDF_ERROR_CODES, parsePdfSourcePosition } from '../shared/errors'
import { PDF_SOURCE_PROP } from '../shared/template'
import type { PdfPrimitiveComponents } from './index'

/**
 * One table column: a number is a share of the free width (like `flex-grow`),
 * a string is a width such as `'30%'` or `'80pt'`.
 */
export type PdfTableColumn = number | Exclude<PdfLengthOrPercentage, number>

export type PdfTableProps = PdfViewProps & {
  /** One entry per column, in cell order. */
  columns: readonly PdfTableColumn[]
}

/** A header row is `fixed`: it repeats at the top of every page of the table. */
export type PdfTableHeaderProps = PdfViewProps

/** A row does not split across pages unless it sets `wrap`. */
export type PdfTableRowProps = PdfViewProps

export type PdfTableCellProps = {
  /** Horizontal alignment of the cell content. Default `'left'`. */
  align?: 'left' | 'center' | 'right'
  /** Number of columns the cell takes, a whole number from 1. Default 1. */
  colspan?: number
  /**
   * In a PDF/UA-1 or PDF/A-3a document: in a `PdfTableRow`, the cell is the
   * header of its row (`TH` with scope row). Cells of a `PdfTableHeader` are
   * column headers anyway. No effect otherwise. Default `false`.
   */
  header?: boolean
  style?: PdfStyleValue
}

/** Fails with the source position of the component, when the build recorded one. */
const treeInvalid = (message: string, attrs?: Record<string, unknown>): never => {
  const source = attrs?.[PDF_SOURCE_PROP]
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message, {
    source: typeof source === 'string' ? parsePdfSourcePosition(source) : undefined,
  })
}

/** The cells of one row take their columns from it in render order. */
type PdfTableRowScope = {
  /**
   * The `span` columns of this cell, from the next free column on; shorter
   * than `span` when the row runs out of columns (`checkCount` then fails).
   */
  claim: (cell: object, span: number) => readonly PdfTableColumn[]
  /** The columns no cell claimed so far: after the last cell, the empty ones. */
  rest: () => readonly PdfTableColumn[]
  /** Fails when the cells of the row cover more columns than the table declares. */
  checkCount: () => void
}

// A cell provides `null` for both keys: a row or cell inside a cell belongs to
// no table unless an inner PdfTable provides one.
const COLUMNS: InjectionKey<(() => readonly PdfTableColumn[]) | null> = Symbol('nuxt-pdf.table.columns')
const ROW: InjectionKey<PdfTableRowScope | null> = Symbol('nuxt-pdf.table.row')

const isColumn = (value: unknown): value is PdfTableColumn =>
  typeof value === 'number'
    ? Number.isFinite(value) && value > 0
    : typeof value === 'string'
      && (PDF_UNIT_LENGTH.test(value) || PDF_PERCENTAGE.test(value))
      && Number.parseFloat(value) > 0

const checkedColumns = (value: unknown, attrs: Record<string, unknown>): readonly PdfTableColumn[] =>
  Array.isArray(value) && value.length > 0 && value.every(isColumn)
    ? value
    : treeInvalid('<PdfTable> requires "columns": a non-empty list of shares (numbers) or widths (\'30%\', \'80pt\').', attrs)

// Lengths the engine converts to points with a fixed factor. `px` depends on
// the page dpi, `rem` on the root font size, `vw`/`vh` on the page.
const POINTS_PER_UNIT: Partial<Record<PdfLengthUnit, number>> = { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }

const LENGTH_UNITS: readonly PdfLengthUnit[] = ['pt', 'px', 'in', 'mm', 'cm', 'rem', 'vh', 'vw']

type Length = { value: number, unit: PdfLengthUnit }

/** A width column such as `'80pt'`; `checkedColumns` already matched its form. */
const parseLength = (column: PdfUnitLength): Length => ({
  value: Number.parseFloat(column),
  unit: LENGTH_UNITS.find(unit => column.endsWith(unit))!,
})

const isPercentage = (column: PdfUnitLength | PdfPercentage): column is PdfPercentage => column.endsWith('%')

const formatLength = ({ value, unit }: Length): PdfUnitLength => `${value}${unit}`

/** One length from lengths that add up: one unit, or absolute units in `pt`. */
const addLengths = (lengths: readonly Length[], attrs: Record<string, unknown>): Length => {
  const units = [...new Set(lengths.map(length => length.unit))]
  const sum = (toNumber: (length: Length) => number) =>
    lengths.reduce((total, length) => total + toNumber(length), 0)
  if (units.length === 1) return { value: sum(length => length.value), unit: units[0]! }
  if (units.every(unit => POINTS_PER_UNIT[unit] !== undefined)) {
    return { value: sum(length => length.value * POINTS_PER_UNIT[length.unit]!), unit: 'pt' }
  }
  return treeInvalid(`<PdfTableCell> spans columns in ${units.map(unit => `"${unit}"`).join(' and ')}; their widths cannot be added. Use one unit for the columns it spans.`, attrs)
}

// `minWidth`, not `flexShrink: 0`: the engine reads a zero shrink as 1.
const fixedWidth = (width: PdfUnitLength | PdfPercentage): PdfStyle => ({ width, minWidth: width })

/**
 * Style of a cell over its columns: a share is a flex grow, a width a fixed
 * basis. A row gives each cell its basis plus `free width × grow / Σgrow`, so
 * a cell with the summed basis and the summed shares of the columns it spans
 * gets exactly their width.
 *
 * Two cases need a wrapper that takes the columns, with the visible cell
 * growing inside it:
 * - Only shares: the engine keeps a cell's padding as its smallest basis, so a
 *   padded cell with basis 0 would take its padding on top of its share. The
 *   wrapper has no padding.
 * - Percentages and lengths, which do not add up in one value: the wrapper
 *   takes the percentages, the shares and, as a right margin, the lengths, and
 *   a negative right margin widens the cell over that margin (`spansUnits`).
 */
const columnStyles = (columns: readonly PdfTableColumn[], attrs: Record<string, unknown>): { wrapper?: PdfStyle, cell: PdfStyle, spansUnits?: true } => {
  let shares = 0
  let percent = 0
  const lengths: Length[] = []
  for (const column of columns) {
    if (typeof column === 'number') shares += column
    else if (isPercentage(column)) percent += Number.parseFloat(column)
    else lengths.push(parseLength(column))
  }
  const length = lengths.length > 0 ? addLengths(lengths, attrs) : undefined
  const percentage: PdfPercentage | undefined = percent > 0 ? `${percent}%` : undefined
  if (percentage !== undefined && length !== undefined) {
    return {
      wrapper: { ...fixedWidth(percentage), flexGrow: shares, marginRight: formatLength(length) },
      cell: { flexGrow: 1, marginRight: formatLength({ ...length, value: -length.value }) },
      spansUnits: true,
    }
  }
  const fixed = percentage ?? (length && formatLength(length))
  return fixed === undefined
    ? { wrapper: { flexGrow: shares, flexShrink: 1, flexBasis: 0 }, cell: { flexGrow: 1 } }
    : { cell: { ...fixedWidth(fixed), flexGrow: shares } }
}

const checkedSpan = (value: unknown, attrs: Record<string, unknown>): number => {
  if (value === undefined) return 1
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
  // A static attribute `colspan="2"` passes the text "2".
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return treeInvalid(`<PdfTableCell> colspan="${value}" passes the text "${value}", not a number. Bind it: :colspan="${value.trim()}".`, attrs)
  }
  return treeInvalid('<PdfTableCell> requires "colspan" to be a whole number from 1.', attrs)
}

// Style keys that set the right margin; the engine applies them in key order.
const RIGHT_MARGIN_KEYS = new Set(['margin', 'marginHorizontal', 'marginRight'])

/**
 * A span over percentage and length columns widens its cell over the wrapper's
 * right margin with a negative right margin of its own (`columnStyles`). An
 * author right margin would replace that margin and narrow the cell by the
 * spanned lengths. Adding the two needs the engine's resolved style (shorthand
 * order, units), so such a margin is rejected instead. Classes reach the cell
 * as `style` too (the SFC compiler rewrites them).
 */
const checkSpanMargin = (attrs: Record<string, unknown>): void => {
  // normalizeStyle merges a style array into one object.
  const style = normalizeStyle(attrs.style)
  if (typeof style === 'object' && Object.keys(style).some(key => RIGHT_MARGIN_KEYS.has(key))) {
    treeInvalid('<PdfTableCell> spans percentage and length columns, so it cannot take a right margin (margin, marginHorizontal or marginRight). Use paddingRight for space inside the cell, or give the spanned columns one kind of width.', attrs)
  }
}

const ALIGN_ITEMS = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

const ROW_STYLE: PdfStyle = { flexDirection: 'row' }

/** Slot content without fragments (`v-for`) and comments (`v-if`). */
const flatten = (nodes: VNode[]): VNode[] => nodes.flatMap((node) => {
  if (node.type === Fragment) return flatten(node.children as VNode[])
  return node.type === Comment ? [] : [node]
})

/** Table components over the primitive components they render. */
export const createTableComponents = (primitiveComponents: PdfPrimitiveComponents) => {
  const { PdfText, PdfView, PdfPageNumber, PdfPageCount, PdfPageRef } = primitiveComponents
  const primitives = new Set<unknown>(Object.values(primitiveComponents))
  // Text and page tokens make a text-only cell: they print inside one PdfText.
  const inlineContent = new Set<unknown>([Text, PdfPageNumber, PdfPageCount, PdfPageRef])

  const PdfTable = defineComponent(
    (props: PdfTableProps, { attrs, slots }) => {
      provide(COLUMNS, () => checkedColumns(props.columns, attrs))
      return () => {
        checkedColumns(props.columns, attrs)
        return h(PdfView, { [PDF_COMPONENT_PROP]: 'PdfTable' }, slots.default)
      }
    },
    { name: 'PdfTable', props: ['columns'] },
  )

  // Rendered after the cells of its row (children mount in order), so it sees
  // the columns no cell claimed: a row may have fewer cells than columns, and
  // those columns stay empty at their width instead of widening the shares.
  const PdfTableRowRest = defineComponent(
    () => {
      const row = inject(ROW, null)
      // One empty view per column: columns of different units need not add up.
      return () => (row?.rest() ?? []).map((column) => {
        const { wrapper, cell } = columnStyles([column], {})
        return h(PdfView, { style: wrapper ?? cell })
      })
    },
    { name: 'PdfTableRowRest' },
  )

  // Header and row: a row-direction view whose cells get their columns in order.
  const createRow = (name: 'PdfTableHeader' | 'PdfTableRow', rowProps: PdfViewProps) => defineComponent(
    (_props: PdfViewProps, { attrs, slots }) => {
      const columns = inject(COLUMNS, null)
      // Cell instance → first column, in the order the cells render. A local
      // component may render several cells, so the row cannot count its slot
      // content. Rebuilt on every render of the row, so no index survives a
      // change of the cells; a cell that does not render again keeps the
      // columns of its last render. A document renders once (`take` stops the
      // app), so this is exact for every tree that reaches layout.
      let claimed = new Map<object, number>()
      // Columns covered by the cells claimed so far, counting colspan.
      let used = 0
      const declared = (): readonly PdfTableColumn[] =>
        columns === null ? treeInvalid(`<${name}> must be inside <PdfTable>.`, attrs) : columns()
      provide(ROW, {
        claim(cell, span) {
          let start = claimed.get(cell)
          if (start === undefined) {
            start = used
            used += span
            claimed.set(cell, start)
          }
          return declared().slice(start, start + span)
        },
        rest() {
          return declared().slice(used)
        },
        checkCount() {
          const count = declared().length
          if (used > count) {
            treeInvalid(`<${name}> needs ${used} columns (counting colspan), but its <PdfTable> declares ${count}.`, attrs)
          }
        },
      })
      // A row directly inside a row belongs to no table.
      provide(COLUMNS, null)
      return () => {
        declared()
        claimed = new Map()
        used = 0
        const cells = flatten(slots.default?.() ?? [])
        for (const cell of cells) {
          // A local component that renders PdfTableCell elements is fine; text
          // and primitives would get no column.
          if (cell.type === Text || typeof cell.type === 'string' || primitives.has(cell.type)) {
            treeInvalid(`<${name}> holds <PdfTableCell> elements only.`, attrs)
          }
        }
        return h(PdfView, { ...rowProps, [PDF_COMPONENT_PROP]: name }, () => [...cells, h(PdfTableRowRest)])
      }
    },
    { name },
  )

  const PdfTableHeader = createRow('PdfTableHeader', { fixed: true, style: ROW_STYLE })
  const PdfTableRow = createRow('PdfTableRow', { wrap: false, style: ROW_STYLE })

  // Text-only content becomes one PdfText (one node per cell); anything else
  // sits in a PdfView, which passes text styles on to the texts inside it.
  const PdfTableCell = defineComponent(
    (props: PdfTableCellProps, { attrs, slots }) => {
      const row = inject(ROW, null)
      const instance = getCurrentInstance()
      provide(ROW, null)
      provide(COLUMNS, null)
      // Mounted and updated hooks run after the whole row rendered, so the
      // row sees all of its cells.
      onMounted(() => row?.checkCount())
      onUpdated(() => row?.checkCount())
      return () => {
        if (row === null || instance === null) return treeInvalid('<PdfTableCell> must be inside <PdfTableRow> or <PdfTableHeader>.', attrs)
        const span = checkedSpan(props.colspan, attrs)
        // Runtime input: the template shorthand `<PdfTableCell header>` passes ''.
        const headerValue: unknown = props.header ?? false
        if (typeof headerValue !== 'boolean' && headerValue !== '') treeInvalid('<PdfTableCell> requires "header" to be true or false.', attrs)
        // Only a header cell carries the mark, so other cells keep their props.
        const header = headerValue === false ? {} : { [PDF_HEADER_CELL_PROP]: true }
        const columns = row.claim(instance, span)
        // Too few columns left: checkCount fails once the row has rendered.
        const { wrapper, cell, spansUnits } = columns.length < span ? { cell: {} } : columnStyles(columns, attrs)
        if (spansUnits) checkSpanMargin(attrs)
        const content = slots.default?.() ?? []
        const textOnly = flatten(content).every(node => inlineContent.has(node.type))
        const align = props.align ?? 'left'
        const alignStyle: PdfStyle = textOnly
          ? { textAlign: align }
          : { textAlign: align, alignItems: ALIGN_ITEMS[align] }
        const root: Component = textOnly ? PdfText : PdfView
        // `attrs` (class, style, source position) go on the visible cell; the
        // author's style still wins over the column style, as on any element.
        const visible = h(root, mergeProps({
          [PDF_COMPONENT_PROP]: 'PdfTableCell',
          ...header,
          style: { ...cell, ...alignStyle },
        }, attrs), () => content)
        return wrapper === undefined
          ? visible
          : h(PdfView, { [PDF_COMPONENT_PROP]: 'PdfTableCell', ...header, style: wrapper }, () => [visible])
      }
    },
    { name: 'PdfTableCell', props: ['align', 'colspan', 'header'], inheritAttrs: false },
  )

  return { PdfTable, PdfTableHeader, PdfTableRow, PdfTableCell }
}
