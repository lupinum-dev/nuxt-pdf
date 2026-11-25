import type { PdfWriter, Rgb } from '../pdf/writer'
import type { MeasuredNode } from '../layout/types'
import { edge, ellipse } from './box'
import { hitSlopOf } from './links'

// The `debug` overlay: a node's content, padding, margin and link hit slop as
// translucent rectangles, its size above it, and its transform origin. Ported
// from `@react-pdf/render` 4.5.1, which draws each band as an overlapping
// rectangle (no clipping).

const CONTENT: Rgb = [161, 198, 231]
const PADDING: Rgb = [196, 222, 185]
const MARGIN: Rgb = [248, 204, 161]
const HIT_SLOP: Rgb = [216, 180, 254]
const BLACK: Rgb = [0, 0, 0]
const RED: Rgb = [255, 0, 0]

const fillRect = (writer: PdfWriter, x: number, y: number, width: number, height: number): void => {
  writer.rect(x, y, width, height)
  writer.fill()
}

const margins = ({ box }: MeasuredNode) => ({
  marginLeft: edge(box.marginLeft),
  marginTop: edge(box.marginTop),
  marginRight: edge(box.marginRight),
  marginBottom: edge(box.marginBottom),
})

const debugBox = (writer: PdfWriter, node: MeasuredNode): void => {
  const { left, top, width, height, borderLeftWidth, borderTopWidth, borderRightWidth, borderBottomWidth } = node.box
  const paddingLeft = edge(node.box.paddingLeft)
  const paddingTop = edge(node.box.paddingTop)
  const paddingRight = edge(node.box.paddingRight)
  const paddingBottom = edge(node.box.paddingBottom)
  const { marginLeft, marginTop, marginRight, marginBottom } = margins(node)
  const innerLeft = left + borderLeftWidth
  const innerTop = top + borderTopWidth
  const innerHeight = height - borderTopWidth - borderBottomWidth
  const paddedWidth = width - paddingRight - paddingLeft - borderLeftWidth - borderRightWidth

  writer.fillColor(CONTENT)
  writer.opacity(0.5)
  fillRect(writer, left + paddingLeft + borderLeftWidth, top + paddingTop + borderTopWidth, width - paddingLeft - paddingRight - borderRightWidth - borderLeftWidth, height - paddingTop - paddingBottom - borderTopWidth - borderBottomWidth)

  writer.fillColor(PADDING)
  writer.opacity(0.5)
  fillRect(writer, left + paddingLeft + borderLeftWidth, innerTop, paddedWidth, paddingTop)
  fillRect(writer, innerLeft, innerTop, paddingLeft, innerHeight)
  fillRect(writer, left + width - paddingRight - borderRightWidth, innerTop, paddingRight, innerHeight)
  fillRect(writer, left + paddingLeft + borderLeftWidth, top + height - paddingBottom - borderBottomWidth, paddedWidth, paddingBottom)

  writer.fillColor(MARGIN)
  writer.opacity(0.5)
  fillRect(writer, left, top - marginTop, width, marginTop)
  fillRect(writer, left - marginLeft, top - marginTop, marginLeft, height + marginTop + marginBottom)
  fillRect(writer, left + width, top - marginTop, marginRight, height + marginTop + marginBottom)
  fillRect(writer, left, top + height, width, marginBottom)
}

/** A link's hit slop: each non-zero side as a band outside the box. */
const debugHitSlop = (writer: PdfWriter, node: MeasuredNode): void => {
  const slop = hitSlopOf(node.props.hitSlop)
  if (!slop.top && !slop.bottom && !slop.left && !slop.right) return
  const { left, top, width, height } = node.box
  writer.fillColor(HIT_SLOP)
  writer.opacity(0.35)
  if (slop.top) fillRect(writer, left - slop.left, top - slop.top, width + slop.left + slop.right, slop.top)
  if (slop.bottom) fillRect(writer, left - slop.left, top + height, width + slop.left + slop.right, slop.bottom)
  if (slop.left) fillRect(writer, left - slop.left, top, slop.left, height)
  if (slop.right) fillRect(writer, left + width, top, slop.right, height)
}

/** The margin box's size, rounded, 4 pt above it (at least 1 pt from the page top). */
const debugSize = (writer: PdfWriter, node: MeasuredNode): void => {
  const { left, top, width, height } = node.box
  const { marginLeft, marginTop, marginRight, marginBottom } = margins(node)
  writer.opacity(1)
  writer.fillColor(BLACK)
  writer.label(
    `${Math.round(width + marginLeft + marginRight)} x ${Math.round(height + marginTop + marginBottom)}`,
    left - marginLeft,
    Math.max(top - marginTop - 4, 1),
    6,
  )
}

const debugOrigin = (writer: PdfWriter, node: MeasuredNode): void => {
  if (!node.origin) return
  ellipse(writer, 3, 3, node.origin.left, node.origin.top)
  writer.fillColor(RED)
  writer.fill()
  ellipse(writer, 5, 5, node.origin.left, node.origin.top)
  writer.strokeColor(RED)
  writer.stroke()
}

export const renderDebug = (writer: PdfWriter, node: MeasuredNode): void => {
  if (!node.props.debug) return
  writer.save()
  debugBox(writer, node)
  debugHitSlop(writer, node)
  debugSize(writer, node)
  debugOrigin(writer, node)
  writer.restore()
}
