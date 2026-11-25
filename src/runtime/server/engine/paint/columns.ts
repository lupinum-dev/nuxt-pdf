import { PDF_PRIMITIVES } from '../../../primitives'
import { COLUMN_CONTAINER_PROP, COLUMN_ROW_PROP } from '../layout/columns'
import type { MeasuredNode } from '../layout/types'
import type { PdfWriter } from '../pdf/writer'
import { dashLine } from './box'
import { paintColor } from './color'

/** A column rule in its container's coordinates: a vertical line at `x` from `top` to `bottom`. */
interface ColumnRule {
  x: number
  top: number
  bottom: number
}

const elementsOf = (node: MeasuredNode): MeasuredNode[] =>
  node.children.filter((child): child is MeasuredNode => child.type !== PDF_PRIMITIVES.TextInstance)

/**
 * The rules of a column container's part on one page, as CSS's
 * `column-rule`: one in the middle of each gap between two columns of a row,
 * from the row's top to its bottom, the end of its highest column. A row
 * holds only the columns that got content (the fill never leaves one empty
 * before another), so a rule never stands beside an empty column. A spanning
 * child ends the rules of the row above it. The rules of the last row reach
 * the bottom of the container's content box on the page, as CSS's column
 * boxes fill a container with a `height`. Without one the part is as high as
 * its rows, so that is the row's bottom: a page with columns (an implicit
 * view, engine/plain-tree.ts, `pageColumns`) ends its rules at a short last
 * page's columns and above the note area.
 */
const columnRules = (container: MeasuredNode): ColumnRule[] => {
  const flow = elementsOf(container).filter(child => child.style.position !== 'absolute')
  const contentBottom = container.box.height - container.box.paddingBottom - container.box.borderBottomWidth
  return flow.flatMap((row, at) => {
    if (row.props[COLUMN_ROW_PROP] === undefined) return []
    const columns = elementsOf(row)
    const bottom = at === flow.length - 1 ? contentBottom : row.box.top + row.box.height
    return columns.slice(1).map((column, index) => {
      const before = columns[index]!
      return { x: row.box.left + (before.box.left + before.box.width + column.box.left) / 2, top: row.box.top, bottom }
    })
  })
}

/**
 * Paints the column rules of a column container, in its own coordinates,
 * with the stroke borders use (paint/box.ts) and their defaults: drawn when
 * it has a width, solid and black unless set. A view is never a tagged leaf (tagged.ts), so the rules are outside
 * every marked sequence, which a tagged document writes as an artifact
 * (pdf/marked-content.ts).
 */
export const renderColumnRules = (writer: PdfWriter, node: MeasuredNode): void => {
  if (node.props[COLUMN_CONTAINER_PROP] === undefined) return
  const { columnRuleWidth: width = 0, columnRuleStyle: style = 'solid', columnRuleColor, opacity = 1 } = node.style
  if (!(width > 0)) return
  const rules = columnRules(node)
  if (rules.length === 0) return
  const color = paintColor(columnRuleColor)
  writer.save()
  writer.strokeOpacity(color.alpha * opacity)
  writer.strokeColor(color.rgb)
  writer.lineWidth(width)
  dashLine(writer, style, width)
  for (const rule of rules) {
    writer.moveTo(rule.x, rule.top)
    writer.lineTo(rule.x, rule.bottom)
    writer.stroke()
  }
  writer.restore()
}
