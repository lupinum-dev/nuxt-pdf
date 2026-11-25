import {
  Align,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  PositionType,
  Wrap,
  type Node as YogaNode,
} from 'yoga-layout/load'
import { percentNumberOf } from '../styles/percent'
import type { ResolvedStyle } from '../types'

/** How one length style reaches yoga. */
type Length = {
  points: (yoga: YogaNode, value: number) => void
  /** None for borders and flex factors: admission gives them numbers only. */
  percent?: (yoga: YogaNode, value: number) => void
  auto?: (yoga: YogaNode) => void
}

/**
 * Sets one length: a percentage through the percent setter, `auto` through
 * the auto setter (nothing when yoga has none), anything else as points,
 * a string read with `parseFloat` as yoga's JS wrapper reads it. A missing
 * value leaves yoga's default.
 */
const setLength = (yoga: YogaNode, length: Length, value: unknown): void => {
  if (value === undefined || value === null) return
  // Yoga gets the number before the `%`.
  const percent = percentNumberOf(value)
  if (percent !== undefined) {
    length.percent?.(yoga, percent)
    return
  }
  if (value === 'auto') {
    length.auto?.(yoga)
    return
  }
  length.points(yoga, typeof value === 'number' ? value : Number.parseFloat(String(value)))
}

const box = (name: 'width' | 'height' | 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight'): Length => {
  switch (name) {
    case 'width': return { points: (y, v) => y.setWidth(v), percent: (y, v) => y.setWidthPercent(v), auto: y => y.setWidthAuto() }
    case 'height': return { points: (y, v) => y.setHeight(v), percent: (y, v) => y.setHeightPercent(v), auto: y => y.setHeightAuto() }
    case 'minWidth': return { points: (y, v) => y.setMinWidth(v), percent: (y, v) => y.setMinWidthPercent(v) }
    case 'minHeight': return { points: (y, v) => y.setMinHeight(v), percent: (y, v) => y.setMinHeightPercent(v) }
    case 'maxWidth': return { points: (y, v) => y.setMaxWidth(v), percent: (y, v) => y.setMaxWidthPercent(v) }
    case 'maxHeight': return { points: (y, v) => y.setMaxHeight(v), percent: (y, v) => y.setMaxHeightPercent(v) }
  }
}

const margin = (edge: Edge): Length =>
  ({ points: (y, v) => y.setMargin(edge, v), percent: (y, v) => y.setMarginPercent(edge, v), auto: y => y.setMarginAuto(edge) })
const padding = (edge: Edge): Length =>
  ({ points: (y, v) => y.setPadding(edge, v), percent: (y, v) => y.setPaddingPercent(edge, v) })
const border = (edge: Edge): Length =>
  ({ points: (y, v) => y.setBorder(edge, v) })
const position = (edge: Edge): Length =>
  ({ points: (y, v) => y.setPosition(edge, v), percent: (y, v) => y.setPositionPercent(edge, v), auto: y => y.setPositionAuto(edge) })
// Admission takes a gap in points only (shared/style-values.ts, `gapValue`).
const gap = (gutter: Gutter): Length =>
  ({ points: (y, v) => y.setGap(gutter, v) })

const FLEX_BASIS: Length = { points: (y, v) => y.setFlexBasis(v), percent: (y, v) => y.setFlexBasisPercent(v), auto: y => y.setFlexBasisAuto() }
const FLEX_GROW: Length = { points: (y, v) => y.setFlexGrow(v) }
const FLEX_SHRINK: Length = { points: (y, v) => y.setFlexShrink(v) }

const EDGES = [
  { side: 'Left', inset: 'left', edge: Edge.Left },
  { side: 'Bottom', inset: 'bottom', edge: Edge.Bottom },
  { side: 'Right', inset: 'right', edge: Edge.Right },
  { side: 'Top', inset: 'top', edge: Edge.Top },
] as const

const ALIGN: Record<string, Align> = {
  'flex-start': Align.FlexStart,
  'center': Align.Center,
  'flex-end': Align.FlexEnd,
  'stretch': Align.Stretch,
  'baseline': Align.Baseline,
  'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround,
  'space-evenly': Align.SpaceEvenly,
}
const JUSTIFY: Record<string, Justify> = {
  'center': Justify.Center,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
}
const FLEX_DIRECTION: Record<string, FlexDirection> = {
  'row': FlexDirection.Row,
  'row-reverse': FlexDirection.RowReverse,
  'column-reverse': FlexDirection.ColumnReverse,
}
const WRAP: Record<string, Wrap> = { 'wrap': Wrap.Wrap, 'wrap-reverse': Wrap.WrapReverse }

const keyword = <Value>(table: Record<string, Value>, value: unknown): Value | undefined =>
  typeof value === 'string' && Object.hasOwn(table, value) ? table[value] : undefined

/**
 * Writes a node's style into its yoga node, before yoga lays the page out.
 * `height` is the page box height for a page and the style height otherwise.
 * Direction, wrap and the three alignments are always set, so a missing
 * value gets the default named here; the others only when the style has
 * them. Admission decides which keys and values arrive (authoring.ts).
 */
export const setYogaValues = (yoga: YogaNode, style: ResolvedStyle, height: unknown): void => {
  setLength(yoga, gap(Gutter.Column), style.columnGap)
  setLength(yoga, gap(Gutter.Row), style.rowGap)
  // A missing shrink is 1 and a missing grow 0; a written 0 is 0
  // (`flex: 'none'` writes both).
  setLength(yoga, FLEX_SHRINK, style.flexShrink ?? 1)
  setLength(yoga, FLEX_GROW, style.flexGrow ?? 0)
  setLength(yoga, FLEX_BASIS, style.flexBasis)
  yoga.setFlexWrap(keyword(WRAP, style.flexWrap) ?? Wrap.NoWrap)
  if (style.justifyContent !== undefined && style.justifyContent !== null) {
    yoga.setJustifyContent(keyword(JUSTIFY, style.justifyContent) ?? Justify.FlexStart)
  }
  yoga.setAlignItems(keyword(ALIGN, style.alignItems) ?? Align.Stretch)
  yoga.setAlignContent(keyword(ALIGN, style.alignContent) ?? Align.Auto)
  yoga.setAlignSelf(keyword(ALIGN, style.alignSelf) ?? Align.Auto)
  yoga.setFlexDirection(keyword(FLEX_DIRECTION, style.flexDirection) ?? FlexDirection.Column)
  for (const { side, edge } of EDGES) setLength(yoga, border(edge), style[`border${side}Width`])
  for (const { inset, edge } of EDGES) setLength(yoga, position(edge), style[inset])
  // Admission allows `absolute`, `relative` and `static`; relative is yoga's
  // default. A static node ignores its insets.
  if (style.position === 'absolute') yoga.setPositionType(PositionType.Absolute)
  else if (style.position === 'static') yoga.setPositionType(PositionType.Static)
  for (const { side, edge } of EDGES) setLength(yoga, padding(edge), style[`padding${side}`])
  for (const { side, edge } of EDGES) setLength(yoga, margin(edge), style[`margin${side}`])
  setLength(yoga, box('maxHeight'), style.maxHeight)
  setLength(yoga, box('minHeight'), style.minHeight)
  setLength(yoga, box('maxWidth'), style.maxWidth)
  setLength(yoga, box('minWidth'), style.minWidth)
  setLength(yoga, box('width'), style.width)
  setLength(yoga, box('height'), height)
}
