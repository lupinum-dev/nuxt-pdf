// Cells over several rows (D39): `PdfTableCell` renders such a cell as a view that takes its
// columns in its first row (`PDF_ROW_SPAN_PROP` = the rows it spans) and,
// inside it, the visible cell, absolute. After yoga has laid the page out,
// and on the same yoga tree, the visible cell gets the height of the rows it
// covers; when its content is higher, the last of those rows grows. The
// results go into the node styles, so each page layout of pagination
// reproduces them without growing again.
import type { Node as YogaNode } from 'yoga-layout/load'
import { PDF_PRIMITIVES, PDF_ROW_SPAN_PROP } from '../../../../primitives'
import type { ResolvedStyle, StyledNode } from '../types'
import { countWork } from '../../work'

type WithYoga = StyledNode & { yogaNode: YogaNode }

/** A cell over `rows.length` rows, as yoga laid it out first. */
export type RowSpan = {
  /** The view that takes the cell's columns in its first row. */
  column: WithYoga
  /** The visible cell inside it. */
  cell: WithYoga
  /** The rows it covers, the first one holding `column`. */
  rows: readonly WithYoga[]
  /** The index of its last row among the rows of its table. */
  end: number
}

const elementsOf = (node: StyledNode): StyledNode[] =>
  (node.children ?? []).filter(child => child.type !== PDF_PRIMITIVES.TextInstance)

const hasYoga = (node: StyledNode): node is WithYoga => 'yogaNode' in node

/**
 * The cells over several rows among the grandchildren of `table`: for each
 * row, the views in it that carry `PDF_ROW_SPAN_PROP`. The table components
 * place the rows a cell covers right after its own row (`checkSpans`), and
 * the visible cell as the view's only child.
 */
export const rowSpansOf = (table: StyledNode): RowSpan[] => {
  const rows = elementsOf(table)
  const spans: RowSpan[] = []
  for (const [index, row] of rows.entries()) {
    for (const column of elementsOf(row)) {
      const count = column.props[PDF_ROW_SPAN_PROP]
      if (typeof count !== 'number' || count < 2) continue
      const [cell] = elementsOf(column)
      const covered = rows.slice(index, index + count)
      // A page part may hold only some of the rows (a span group cut at the
      // page end). Growing the last row it kept would write a wrong height
      // into that row's style; the layout of a later part resolves the span.
      if (covered.length < count) continue
      if (cell === undefined || !hasYoga(column) || !hasYoga(cell) || !covered.every(hasYoga)) continue
      spans.push({ column, cell, rows: covered, end: index + count - 1 })
    }
  }
  return spans
}

/** Below this, two heights in points are the same (yoga rounds to layout pixels). */
const HEIGHT_EPSILON = 0.01

const bottomOf = (node: YogaNode): number => node.getComputedTop() + node.getComputedHeight()

/** The height from the top of the column view to the bottom of the last row it covers. */
const coveredHeight = ({ column, rows }: RowSpan): number =>
  bottomOf(rows.at(-1)!.yogaNode) - rows[0]!.yogaNode.getComputedTop() - column.yogaNode.getComputedTop()

const withStyle = (node: WithYoga, style: ResolvedStyle): void => {
  node.style = { ...node.style, ...style }
}

/**
 * Gives each cell over several rows the height of the rows it covers, on the
 * yoga tree of a page that `calculate` lays out again. The last row of a
 * span grows by what the cell's content needs beyond its rows. Spans go in
 * the order of their last row, and each counts what the rows above grew
 * before it, so a row grows only by what is still missing, whatever the
 * order of the cells. Then the cells get their heights. Yoga lays out the
 * page once more when a row grew, and once more when a cell's height
 * changed; a page whose styles hold the results already (each relayout of
 * pagination) is not laid out again.
 */
export const resolveRowSpans = (spans: readonly RowSpan[], calculate: () => void): void => {
  if (spans.length === 0) return
  const grown = new Map<WithYoga, number>()
  const growthOf = (rows: readonly WithYoga[]): number => rows.reduce((sum, row) => sum + (grown.get(row) ?? 0), 0)
  for (const span of [...spans].sort((a, b) => a.end - b.end)) {
    // The content height of the cell: yoga laid it out without a height.
    const missing = span.cell.yogaNode.getComputedHeight() - coveredHeight(span) - growthOf(span.rows)
    if (missing < HEIGHT_EPSILON) continue
    const last = span.rows.at(-1)!
    grown.set(last, (grown.get(last) ?? 0) + missing)
  }
  if (grown.size > 0) {
    for (const [row, growth] of grown) {
      const minHeight = row.yogaNode.getComputedHeight() + growth
      row.yogaNode.setMinHeight(minHeight)
      withStyle(row, { minHeight })
    }
    countWork('rowSpanLayouts')
    calculate()
  }
  let changed = false
  for (const span of spans) {
    const height = coveredHeight(span)
    // A page that pagination lays out again carries the heights in its
    // styles already: yoga gave each cell its height, and nothing changes.
    if (Math.abs(span.cell.yogaNode.getComputedHeight() - height) < HEIGHT_EPSILON) continue
    span.cell.yogaNode.setHeight(height)
    withStyle(span.cell, { height })
    changed = true
  }
  if (!changed) return
  countWork('rowSpanLayouts')
  calculate()
}
