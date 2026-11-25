import type { PdfWriter, Rgb } from '../pdf/writer'
import { paintColor } from './color'
import { PDF_PRIMITIVES } from '../../../primitives'
import type { Box, MeasuredNode, ResolvedStyle, Transform } from '../layout/types'
import type { PaintChild } from './node'

// The box of a node: its clip, transforms, background and borders. Ported from
// `@react-pdf/render` 4.5.1 with the same arithmetic.

/** A quarter circle as a cubic curve: the control points sit KAPPA × radius from the ends. */
export const KAPPA = 4.0 * ((Math.sqrt(2) - 1.0) / 3.0)

/** pdfkit's `ellipse`: four quarter curves around (cx, cy), starting at the left. */
export const ellipse = (writer: PdfWriter, rx: number, ry: number, cx = 0, cy = 0): void => {
  const x = cx - rx
  const y = cy - ry
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  const xe = x + rx * 2
  const ye = y + ry * 2
  const xm = x + rx
  const ym = y + ry
  writer.moveTo(x, ym)
  writer.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y)
  writer.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym)
  writer.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye)
  writer.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym)
  writer.closePath()
}

/** How far a corner's control point sits from the corner: radius × (1 − KAPPA). */
const inset = (radius: number): number => radius * (1.0 - KAPPA)

interface Radii {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

/**
 * A margin or padding as a number. The layout keeps the style value of one
 * yoga computed as 0 (`'0%'`, `'auto'`; layout/types.ts, `Box`), which is 0.
 */
export const edge = (value: number | string | undefined): number => typeof value === 'number' ? value : 0

/** Where a node's content goes: inside its border and its padding, as layout keeps room for both. */
export const contentBox = (box: Box): { left: number, top: number, width: number, height: number } => {
  const left = edge(box.borderLeftWidth) + edge(box.paddingLeft)
  const top = edge(box.borderTopWidth) + edge(box.paddingTop)
  return {
    left: box.left + left,
    top: box.top + top,
    width: box.width - left - edge(box.paddingRight) - edge(box.borderRightWidth),
    height: box.height - top - edge(box.paddingBottom) - edge(box.borderBottomWidth),
  }
}

/** Each corner's radius, at most half the box's width and height (`resolvePercentRadius` made percentages numbers). */
const radii = (box: Box, style: ResolvedStyle): Radii => {
  const limit = (radius: number | string | undefined) => Math.min(typeof radius === 'number' ? radius : 0, 0.5 * box.width, 0.5 * box.height)
  return {
    topLeft: limit(style.borderTopLeftRadius),
    topRight: limit(style.borderTopRightRadius),
    bottomRight: limit(style.borderBottomRightRadius),
    bottomLeft: limit(style.borderBottomLeftRadius),
  }
}

/** Clip to the node's border box with its rounded corners. */
export const clipNode = (writer: PdfWriter, node: MeasuredNode): void => {
  const { top, left, width, height } = node.box
  const { topLeft: rtl, topRight: rtr, bottomRight: rbr, bottomLeft: rbl } = radii(node.box, node.style)
  const ctr = inset(rtr)
  writer.moveTo(left + rtr, top)
  writer.lineTo(left + width - rtr, top)
  writer.bezierCurveTo(left + width - ctr, top, left + width, top + ctr, left + width, top + rtr)
  const cbr = inset(rbr)
  writer.lineTo(left + width, top + height - rbr)
  writer.bezierCurveTo(left + width, top + height - cbr, left + width - cbr, top + height, left + width - rbr, top + height)
  const cbl = inset(rbl)
  writer.lineTo(left + rbl, top + height)
  writer.bezierCurveTo(left + cbl, top + height, left, top + height - cbl, left, top + height - rbl)
  const ctl = inset(rtl)
  writer.lineTo(left, top + rtl)
  writer.bezierCurveTo(left, top + ctl, left + ctl, top, left + rtl, top)
  writer.closePath()
  writer.clip()
}

/** pdfkit's `rotate` and `scale` around an origin, as matrices. */
const rotate = (writer: PdfWriter, angle: number, origin: readonly [number, number]): void => {
  const rad = angle * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const [x, y] = origin
  writer.transform(cos, sin, -sin, cos, x - (x * cos - y * sin), y - (x * sin + y * cos))
}

const scale = (writer: PdfWriter, scaleX: number, scaleY: number, origin: readonly [number, number]): void => {
  const [x, y] = origin
  writer.transform(scaleX, 0, 0, scaleY, x - scaleX * x, y - scaleY * y)
}

export const translate = (writer: PdfWriter, x: number, y: number): void => {
  writer.transform(1, 0, 0, 1, x, y)
}

const applyTransform = (writer: PdfWriter, transform: Transform, origin: readonly [number, number]): void => {
  switch (transform.operation) {
    case 'scale':
      scale(writer, transform.value[0], transform.value[1], origin)
      return
    case 'rotate': {
      const [angle, cx, cy] = transform.value
      translate(writer, cx, cy)
      rotate(writer, angle, origin)
      translate(writer, -cx, -cy)
      return
    }
    case 'translate': {
      const [x, y = 0] = transform.value
      translate(writer, x, y)
      return
    }
    case 'skew': {
      const [angleX = 0, angleY = 0] = transform.value
      const tanX = Math.tan((angleX * Math.PI) / 180)
      const tanY = Math.tan((angleY * Math.PI) / 180)
      const [x, y] = origin
      writer.transform(1, tanY, tanX, 1, x - (x + tanX * y), y - (y + tanY * x))
      return
    }
  }
}

/** The node's CSS transforms (or an SVG node's `transform`), around its origin. */
export const applyTransformations = (writer: PdfWriter, node: PaintChild): void => {
  if (node.type === PDF_PRIMITIVES.TextInstance || !node.origin) return
  const origin = [node.origin.left, node.origin.top] as const
  // An SVG element's `transform` prop, parsed by the layout (svg/props.ts).
  const svgTransform = node.props.transform
  const operations: readonly Transform[] = node.style.transform || (Array.isArray(svgTransform) ? svgTransform : [])
  for (const operation of operations) applyTransform(writer, operation, origin)
}

export const renderBackground = (writer: PdfWriter, node: MeasuredNode): void => {
  if (!node.style.backgroundColor) return
  writer.save()
  clipNode(writer, node)
  const { top, left, width, height } = node.box
  const color = paintColor(node.style.backgroundColor)
  // As in CSS, the colour's alpha and the opacity multiply.
  writer.fillOpacity(color.alpha * (node.style.opacity ?? 1))
  writer.fillColor(color.rgb)
  writer.rect(left, top, width, height)
  writer.fill()
  writer.restore()
}

// Borders. Each side is clipped to its own band of the box (the outer edge,
// the inner edge with the inner radii, and the diagonal joins to its
// neighbours), then stroked along its outer edge at twice its width, so half
// of the stroke falls inside the clip.

interface Border {
  top: number
  right: number
  bottom: number
  left: number
}

/** The dash of a `dashed` or `dotted` line `width` wide, as borders and column rules (paint/columns.ts) draw it. */
/** The dash lengths of a line of `style` and `width`; none for a solid line. */
export const dashLengths = (style: string, width: number): number[] | undefined => {
  if (style === 'dashed') return [width * 2, width * 1.2]
  if (style === 'dotted') return [width, width * 1.2]
  return undefined
}

export const dashLine = (writer: PdfWriter, style: string, width: number): void => {
  const lengths = dashLengths(style, width)
  if (lengths) writer.dash(lengths)
}

const strokeSide = (writer: PdfWriter, color: Rgb, width: number, style: string, lineWidth: number): void => {
  writer.strokeColor(color)
  writer.lineWidth(lineWidth * 2)
  dashLine(writer, style, width)
  writer.stroke()
  writer.undash()
}

/** Clip with a closed polygon. */
const clipPolygon = (writer: PdfWriter, points: readonly (readonly [number, number])[]): void => {
  const [first, ...rest] = points
  writer.moveTo(first![0], first![1])
  for (const [x, y] of rest) writer.lineTo(x, y)
  writer.closePath()
  writer.clip()
}

const borderTop = (writer: PdfWriter, box: Box, border: Border, r: Radii, color: Rgb, style: string): void => {
  const { top, left, width, height } = box
  const { topRight: rtr, topLeft: rtl } = r
  writer.moveTo(left + rtl, top)
  writer.lineTo(left + width - rtr, top)
  const c0 = inset(rtr)
  writer.bezierCurveTo(left + width - c0, top, left + width, top + c0, left + width, top + rtr)
  const topRightY = top + Math.max(border.top, rtr)
  writer.lineTo(left + width, topRightY)
  writer.lineTo(left + width - border.right, topRightY)
  const innerTopRightX = Math.max(rtr - border.right, 0)
  const c1 = inset(innerTopRightX)
  const c2 = inset(Math.max(rtr - border.top, 0))
  writer.bezierCurveTo(left + width - border.right, top + border.top + c2, left + width - border.right - c1, top + border.top, left + width - border.right - innerTopRightX, top + border.top)
  writer.lineTo(left + Math.max(rtl, border.left), top + border.top)
  const c3 = inset(Math.max(rtl - border.left, 0))
  const c4 = inset(Math.max(rtl - border.top, 0))
  const topLeftY = top + Math.max(border.top, rtl)
  writer.bezierCurveTo(left + border.left + c3, top + border.top, left + border.left, top + border.top + c4, left + border.left, topLeftY)
  writer.lineTo(left, topLeftY)
  writer.lineTo(left, top + rtl)
  const c5 = inset(rtl)
  writer.bezierCurveTo(left, top + c5, left + c5, top, left + rtl, top)
  writer.closePath()
  writer.clip()
  if (border.right) clipPolygon(writer, [[left + width / 2, -border.top / border.right * (-width / 2) + top], [left + width, top], [left, top], [left, top + height]])
  if (border.left) clipPolygon(writer, [[left + width / 2, -border.top / border.left * (-width / 2) + top], [left, top], [left + width, top], [left + width, top + height]])

  const s0 = inset(rtl)
  const s1 = inset(rtr)
  writer.moveTo(left, top + Math.max(rtl, border.top))
  writer.bezierCurveTo(left, top + s0, left + s0, top, left + rtl, top)
  writer.lineTo(left + width - rtr, top)
  writer.bezierCurveTo(left + width - s1, top, left + width, top + s1, left + width, top + rtr)
  strokeSide(writer, color, border.top, style, Math.max(border.right, border.top, border.left))
}

const borderRight = (writer: PdfWriter, box: Box, border: Border, r: Radii, color: Rgb, style: string): void => {
  const { top, left, width, height } = box
  const { topRight: rtr, bottomRight: rbr } = r
  writer.moveTo(left + width, top + rtr)
  writer.lineTo(left + width, top + height - rbr)
  const c0 = inset(rbr)
  writer.bezierCurveTo(left + width, top + height - c0, left + width - c0, top + height, left + width - rbr, top + height)
  const bottomX = left + width - Math.max(border.right, rbr)
  writer.lineTo(bottomX, top + height)
  writer.lineTo(bottomX, top + height - border.bottom)
  const c1 = inset(Math.max(rbr - border.right, 0))
  const c2 = inset(Math.max(rbr - border.bottom, 0))
  writer.bezierCurveTo(left + width - border.right - c1, top + height - border.bottom, left + width - border.right, top + height - border.bottom - c2, left + width - border.right, top + height - Math.max(rbr, border.bottom))
  writer.lineTo(left + width - border.right, top + Math.max(rtr, border.top))
  const c3 = inset(Math.max(rtr - border.right, 0))
  const c4 = inset(Math.max(rtr - border.top, 0))
  const topX = left + width - Math.max(rtr, border.right)
  writer.bezierCurveTo(left + width - border.right, top + border.top + c4, left + width - border.right - c3, top + border.top, topX, top + border.top)
  writer.lineTo(topX, top)
  writer.lineTo(left + width - rtr, top)
  const c5 = inset(rtr)
  writer.bezierCurveTo(left + width - c5, top, left + width, top + c5, left + width, top + rtr)
  writer.closePath()
  writer.clip()
  if (border.top) clipPolygon(writer, [[left + width / 2, -border.top / border.right * (-width / 2) + top], [left + width, top], [left + width, top + height], [left, top + height]])
  if (border.bottom) clipPolygon(writer, [[left + width / 2, border.bottom / border.right * (-width / 2) + top + height], [left + width, top + height], [left + width, top], [left, top]])

  const s0 = inset(rbr)
  const s1 = inset(rtr)
  writer.moveTo(left + width - rtr, top)
  writer.bezierCurveTo(left + width - s1, top, left + width, top + s1, left + width, top + rtr)
  writer.lineTo(left + width, top + height - rbr)
  writer.bezierCurveTo(left + width, top + height - s0, left + width - s0, top + height, left + width - rbr, top + height)
  strokeSide(writer, color, border.right, style, Math.max(border.right, border.top, border.bottom))
}

const borderBottom = (writer: PdfWriter, box: Box, border: Border, r: Radii, color: Rgb, style: string): void => {
  const { top, left, width, height } = box
  const { bottomLeft: rbl, bottomRight: rbr } = r
  writer.moveTo(left + width - rbr, top + height)
  writer.lineTo(left + rbl, top + height)
  const c0 = inset(rbl)
  writer.bezierCurveTo(left + c0, top + height, left, top + height - c0, left, top + height - rbl)
  const bottomLeftY = top + height - Math.max(border.bottom, rbl)
  writer.lineTo(left, bottomLeftY)
  writer.lineTo(left + border.left, bottomLeftY)
  const innerBottomLeftX = Math.max(rbl - border.left, 0)
  const c1 = inset(innerBottomLeftX)
  const c2 = inset(Math.max(rbl - border.bottom, 0))
  writer.bezierCurveTo(left + border.left, top + height - border.bottom - c2, left + border.left + c1, top + height - border.bottom, left + border.left + innerBottomLeftX, top + height - border.bottom)
  writer.lineTo(left + width - Math.max(rbr, border.right), top + height - border.bottom)
  const c3 = inset(Math.max(rbr - border.right, 0))
  const c4 = inset(Math.max(rbr - border.bottom, 0))
  const bottomRightY = top + height - Math.max(border.bottom, rbr)
  writer.bezierCurveTo(left + width - border.right - c3, top + height - border.bottom, left + width - border.right, top + height - border.bottom - c4, left + width - border.right, bottomRightY)
  writer.lineTo(left + width, bottomRightY)
  writer.lineTo(left + width, top + height - rbr)
  const c5 = inset(rbr)
  writer.bezierCurveTo(left + width, top + height - c5, left + width - c5, top + height, left + width - rbr, top + height)
  writer.closePath()
  writer.clip()
  if (border.right) clipPolygon(writer, [[left + width / 2, border.bottom / border.right * (-width / 2) + top + height], [left + width, top + height], [left, top + height], [left, top]])
  if (border.left) clipPolygon(writer, [[left + width / 2, -border.bottom / border.left * (width / 2) + top + height], [left, top + height], [left + width, top + height], [left + width, top]])

  const s0 = inset(rbl)
  const s1 = inset(rbr)
  writer.moveTo(left + width, top + height - rbr)
  writer.bezierCurveTo(left + width, top + height - s1, left + width - s1, top + height, left + width - rbr, top + height)
  writer.lineTo(left + rbl, top + height)
  writer.bezierCurveTo(left + s0, top + height, left, top + height - s0, left, top + height - rbl)
  strokeSide(writer, color, border.bottom, style, Math.max(border.bottom, border.right, border.left))
}

const borderLeft = (writer: PdfWriter, box: Box, border: Border, r: Radii, color: Rgb, style: string): void => {
  const { top, left, width, height } = box
  const { bottomLeft: rbl, topLeft: rtl } = r
  writer.moveTo(left, top + height - rbl)
  writer.lineTo(left, top + rtl)
  const c0 = inset(rtl)
  writer.bezierCurveTo(left, top + c0, left + c0, top, left + rtl, top)
  const topLeftX = left + Math.max(border.left, rtl)
  writer.lineTo(topLeftX, top)
  writer.lineTo(topLeftX, top + border.top)
  const c1 = inset(Math.max(rtl - border.left, 0))
  const c2 = inset(Math.max(rtl - border.top, 0))
  writer.bezierCurveTo(left + border.left + c1, top + border.top, left + border.left, top + border.top + c2, left + border.left, top + Math.max(rtl, border.top))
  writer.lineTo(left + border.left, top + height - Math.max(rbl, border.bottom))
  const c3 = inset(Math.max(rbl - border.left, 0))
  const c4 = inset(Math.max(rbl - border.bottom, 0))
  const bottomLeftX = left + Math.max(rbl, border.left)
  writer.bezierCurveTo(left + border.left, top + height - border.bottom - c4, left + border.left + c3, top + height - border.bottom, bottomLeftX, top + height - border.bottom)
  writer.lineTo(bottomLeftX, top + height)
  writer.lineTo(left + rbl, top + height)
  const c5 = inset(rbl)
  writer.bezierCurveTo(left + c5, top + height, left, top + height - c5, left, top + height - rbl)
  writer.closePath()
  writer.clip()
  if (border.bottom) clipPolygon(writer, [[left + width / 2, -border.bottom / border.left * (width / 2) + top + height], [left, top + height], [left, top], [left + width, top]])
  if (border.top) clipPolygon(writer, [[left + width / 2, -border.top / border.left * (-width / 2) + top], [left, top], [left, top + height], [left + width, top + height]])

  const s0 = inset(rbl)
  const s1 = inset(rtl)
  writer.moveTo(left + rbl, top + height)
  writer.bezierCurveTo(left + s0, top + height, left, top + height - s0, left, top + height - rbl)
  writer.lineTo(left, top + rtl)
  writer.bezierCurveTo(left, top + s1, left + s1, top, left + rtl, top)
  strokeSide(writer, color, border.left, style, Math.max(border.left, border.top, border.bottom))
}

export const renderBorders = (writer: PdfWriter, node: MeasuredNode): void => {
  const { box, style } = node
  if (!(box.borderTopWidth || box.borderRightWidth || box.borderBottomWidth || box.borderLeftWidth)) return
  const border: Border = {
    top: box.borderTopWidth,
    right: box.borderRightWidth,
    bottom: box.borderBottomWidth,
    left: box.borderLeftWidth,
  }
  const r = radii(box, style)
  const { opacity = 1 } = style
  writer.save()
  writer.strokeOpacity(opacity)
  const sides = [
    [border.top, borderTop, style.borderTopColor, style.borderTopStyle],
    [border.right, borderRight, style.borderRightColor, style.borderRightStyle],
    [border.bottom, borderBottom, style.borderBottomColor, style.borderBottomStyle],
    [border.left, borderLeft, style.borderLeftColor, style.borderLeftStyle],
  ] as const
  for (const [width, paint, color = 'black', lineStyle = 'solid'] of sides) {
    if (!width) continue
    const side = paintColor(color)
    writer.save()
    // A colour with alpha multiplies the box opacity, for its side only.
    if (side.alpha < 1) writer.strokeOpacity(side.alpha * opacity)
    paint(writer, box, border, r, side.rgb, lineStyle)
    writer.restore()
  }
  writer.restore()
}
