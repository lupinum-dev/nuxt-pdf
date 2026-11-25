import { PDF_PRIMITIVES } from '../../../../primitives'
import type { MeasuredNode, ResolvedStyle } from '../types'
import { isAbsolute, isFixed, SAFETY_THRESHOLD } from './rules'

/**
 * A row with `flexWrap` breaks between its flex lines, as CSS fragments a multi-line flex container: the
 * builder fills it as a column of its lines, each a row of its own (`inFlexLines`), and `fromFlexLines` gives
 * every part its children and its own style back. yoga lays the lines out the same in both shapes: each line
 * is as high as its highest item, its items share its width, and `rowGap` and `alignContent` place the lines
 * as `rowGap` and `justifyContent` place a column's children.
 */

/** On the column a wrapping row became: the row's own flex keys. */
const LINES_PROP = '__nuxtPdfFlexLines'
/** On a line: a row the builder made, flattened again by `fromFlexLines`. */
const LINE_PROP = '__nuxtPdfFlexLine'
/** On an absolute child without insets: the insets set to where yoga placed it (a column places it otherwise). */
const PLACED_PROP = '__nuxtPdfPlaced'

const EPS = SAFETY_THRESHOLD
type RowKeys = Pick<ResolvedStyle, 'flexDirection' | 'flexWrap' | 'justifyContent' | 'alignItems' | 'alignContent' | 'columnGap'>
type Line = { top: number, bottom: number, row: MeasuredNode }

const isElement = (node: MeasuredNode['children'][number]): node is MeasuredNode => node.type !== PDF_PRIMITIVES.TextInstance

export const wrapsRow = (node: MeasuredNode): boolean =>
  (node.style.flexDirection === 'row' || node.style.flexDirection === 'row-reverse') && (node.style.flexWrap === 'wrap' || node.style.flexWrap === 'wrap-reverse')

/** A relative offset moves the box, not the line it stands in. */
const staticTop = (node: MeasuredNode): number => {
  if (node.style.position === 'static') return node.box.top
  const shift = typeof node.style.top === 'number' ? node.style.top : typeof node.style.bottom === 'number' ? -node.style.bottom : 0
  return node.box.top - shift
}

const moved = (node: MeasuredNode, down: number, right: number): MeasuredNode => ({ ...node, box: { ...node.box, top: node.box.top + down, left: node.box.left + right } })

const NO_EDGES = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0 }

/** `alignContent` places the lines in the row's height, as `justifyContent` places a column's children; `stretch` grows each line alike. */
const JUSTIFIED = new Set(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'])

/** An absolute child keeps its place: in a column yoga would place one without insets by the column's alignment. */
const placed = (node: MeasuredNode, row: MeasuredNode): MeasuredNode => {
  const keys: ('top' | 'left')[] = []
  const style = { ...node.style }
  if (node.style.top === undefined && node.style.bottom === undefined) {
    style.top = node.box.top - (row.box.borderTopWidth ?? 0) - (node.box.marginTop ?? 0)
    keys.push('top')
  }
  if (node.style.left === undefined && node.style.right === undefined) {
    style.left = node.box.left - (row.box.borderLeftWidth ?? 0) - (node.box.marginLeft ?? 0)
    keys.push('left')
  }
  return keys.length === 0 ? node : { ...node, style, props: { ...node.props, [PLACED_PROP]: keys } }
}

const unplaced = (node: MeasuredNode): MeasuredNode => {
  if (!(PLACED_PROP in node.props)) return node
  const { [PLACED_PROP]: placedKeys, ...props } = node.props
  const keys = placedKeys as ('top' | 'left')[]
  const { top, left, ...style } = node.style
  return { ...node, style: { ...style, ...(keys.includes('top') ? {} : { top }), ...(keys.includes('left') ? {} : { left }) }, props }
}

/** A wrapping row as a column of its flex lines, top to bottom (an absolute child after the line it is written in). */
export const inFlexLines = (row: MeasuredNode): MeasuredNode => {
  const left = (row.box.borderLeftWidth ?? 0) + (row.box.paddingLeft ?? 0)
  const width = row.box.width - left - (row.box.borderRightWidth ?? 0) - (row.box.paddingRight ?? 0)
  const stretch = row.style.alignContent === 'stretch'
  const lines: Line[] = []
  const children: MeasuredNode[] = []
  for (const child of row.children.filter(isElement)) {
    if (isAbsolute(child)) {
      children.push(placed(child, row))
      continue
    }
    // Items of one line share its height: their margin boxes overlap, or one holds the other.
    const top = staticTop(child) - (child.box.marginTop ?? 0)
    const bottom = top + (child.box.marginTop ?? 0) + child.box.height + (child.box.marginBottom ?? 0)
    const line = lines.at(-1)
    if (line && ((top < line.bottom - EPS && bottom > line.top + EPS) || (top > line.top - EPS && bottom < line.bottom + EPS))) {
      line.top = Math.min(line.top, top)
      line.bottom = Math.max(line.bottom, bottom)
      line.row.children.push(child)
      continue
    }
    const lineRow: MeasuredNode = {
      type: PDF_PRIMITIVES.View,
      props: { [LINE_PROP]: true },
      style: { flexDirection: row.style.flexDirection, justifyContent: row.style.justifyContent, alignItems: row.style.alignItems, columnGap: row.style.columnGap, ...(stretch ? { flexGrow: 1 } : {}) },
      box: { ...NO_EDGES, top, left, width, height: 0, right: 0, bottom: 0 },
      children: [child],
    }
    lines.push({ top, bottom, row: lineRow })
    children.push(lineRow)
  }
  for (const { top, bottom, row: lineRow } of lines) {
    lineRow.box = { ...lineRow.box, top, height: bottom - top }
    lineRow.children = lineRow.children.filter(isElement).map(item => moved(item, -top, -left))
  }
  const keys: RowKeys = { flexDirection: row.style.flexDirection, flexWrap: row.style.flexWrap, justifyContent: row.style.justifyContent, alignItems: row.style.alignItems, alignContent: row.style.alignContent, columnGap: row.style.columnGap }
  const justifyContent = JUSTIFIED.has(String(row.style.alignContent)) ? row.style.alignContent as ResolvedStyle['justifyContent'] : undefined
  // `wrap-reverse` stacks the lines from the bottom: the column holds them in drawing order.
  const ordered = row.style.flexWrap === 'wrap-reverse' ? children.reverse() : children
  return {
    ...row,
    props: { ...row.props, [LINES_PROP]: keys },
    style: { ...row.style, flexDirection: 'column', flexWrap: 'nowrap', justifyContent, alignItems: 'stretch', alignContent: undefined, columnGap: undefined },
    children: ordered,
  }
}

/** The first `fixed` item of a wrapping row laid out as its lines. */
export const fixedItemOf = (node: MeasuredNode): MeasuredNode | undefined => LINES_PROP in node.props
  ? node.children.filter(isElement).flatMap(line => LINE_PROP in line.props ? line.children.filter(isElement) : []).find(isFixed)
  : undefined

/** A part of a wrapping row from its lines: its children where its lines put them, and the row's own style. */
export const fromFlexLines = (node: MeasuredNode): MeasuredNode => {
  if (!(LINES_PROP in node.props)) return node
  const { [LINES_PROP]: keys, ...props } = node.props
  const row = keys as RowKeys
  const elements = node.children.filter(isElement)
  const ordered = row.flexWrap === 'wrap-reverse' ? [...elements].reverse() : elements
  const children = ordered.flatMap(child => LINE_PROP in child.props
    ? child.children.filter(isElement).map(item => moved(item, child.box.top, child.box.left))
    : [unplaced(child)])
  return { ...node, props, style: { ...node.style, ...row }, children }
}
