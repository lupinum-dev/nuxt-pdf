import type { Line, Run } from '../text'
import { paintedGlyphs } from '../text/shape'
import type { GradientStop, PdfWriter } from '../pdf/writer'
import { applyTransformations, clipNode, contentBox, edge, ellipse, KAPPA, translate } from './box'
import { readPdfColor } from '../../../shared/color'
import { PDF_PRIMITIVES } from '../../../primitives'
import type { MeasuredNode } from '../layout/types'
import type { PaintChild } from './node'
import { drawPath, parsePathData, pathBounds } from './svg-path'

// The SVG walk of `@react-pdf/render` 4.5.1, for the props our primitives
// admit (primitives.ts, a closed prop surface): no `fillRule`,
// `strokeDasharray`, `gradientUnits`, `gradientTransform`,
// `preserveAspectRatio`, `textAnchor`, `dominantBaseline` or markers reach
// the painter, so their upstream branches are not ported. A gradient fills
// the bounding box of its shape (`objectBoundingBox`), untransformed.

type Bounds = [number, number, number, number]

/**
 * A number prop. Drawn elements arrive with numbers (layout/svg/props.ts);
 * the shapes of a clip path keep admitted strings such as `'10'`, which the
 * old painter joined as strings (`'10' + '20'`); here they are numbers.
 */
const numberProp = (node: PaintChild, key: string): number | undefined => {
  const value = node.props?.[key]
  if (typeof value === 'number') return value
  return typeof value === 'string' ? Number.parseFloat(value) : undefined
}

const stringProp = (node: PaintChild, key: string): string | undefined => {
  const value = node.props?.[key]
  return typeof value === 'string' ? value : undefined
}

/** A definition the layout put in place of a `url(#id)` reference. */
const definition = (value: unknown): PaintChild | undefined =>
  typeof value === 'object' && value !== null && 'type' in value ? value as PaintChild : undefined

/** `'20,30 50,60'` (or `'20 30-50 60'`) as points; an odd last number is dropped. */
const parsePoints = (points: string): [number, number][] => {
  const values = points.trim().replace(/,/g, ' ').replace(/(\d)-(\d)/g, '$1 -$2').split(/\s+/)
  const pairs: [number, number][] = []
  for (let index = 0; index + 1 < values.length; index += 2) {
    pairs.push([Number.parseFloat(values[index]!), Number.parseFloat(values[index + 1]!)])
  }
  return pairs
}

const drawRect = (writer: PdfWriter, node: PaintChild): void => {
  const x = numberProp(node, 'x') || 0
  const y = numberProp(node, 'y') || 0
  const rx = numberProp(node, 'rx') || 0
  const ry = numberProp(node, 'ry') || 0
  const width = numberProp(node, 'width') || 0
  const height = numberProp(node, 'height') || 0
  if (!width || !height) return
  if (rx && ry) {
    const krx = rx * KAPPA
    const kry = ry * KAPPA
    writer.moveTo(x + rx, y)
    writer.lineTo(x - rx + width, y)
    writer.bezierCurveTo(x - rx + width + krx, y, x + width, y + ry - kry, x + width, y + ry)
    writer.lineTo(x + width, y + height - ry)
    writer.bezierCurveTo(x + width, y + height - ry + kry, x - rx + width + krx, y + height, x - rx + width, y + height)
    writer.lineTo(x + rx, y + height)
    writer.bezierCurveTo(x + rx - krx, y + height, x, y + height - ry + kry, x, y + height - ry)
    writer.lineTo(x, y + ry)
    writer.bezierCurveTo(x, y + ry - kry, x + rx - krx, y, x + rx, y)
  }
  else {
    writer.moveTo(x, y)
    writer.lineTo(x + width, y)
    writer.lineTo(x + width, y + height)
    writer.lineTo(x, y + height)
  }
  writer.closePath()
}

const drawPolyline = (writer: PdfWriter, node: PaintChild): void => {
  const [first, ...rest] = parsePoints(stringProp(node, 'points') || '')
  if (!first) return
  writer.moveTo(...first)
  for (const point of rest) writer.lineTo(...point)
}

/** An image inside the SVG, at its `x` and `y` and the size of its style. */
const drawImage = (writer: PdfWriter, node: PaintChild): void => {
  if (node.type === PDF_PRIMITIVES.TextInstance || !node.image?.data) return
  const { width, height, opacity } = node.style
  // A size of 0 or a percentage draws nothing.
  if (width === 0 || height === 0 || typeof width === 'string' || typeof height === 'string') return
  // The left padding also moves the image down, as the ported walk did.
  const padding = edge(node.box.paddingLeft)
  writer.save()
  writer.fillOpacity(opacity || 1)
  writer.image({ data: node.image.data }, (numberProp(node, 'x') ?? 0) + padding, (numberProp(node, 'y') ?? 0) + padding, width, height)
  writer.restore()
}

const drawRun = (writer: PdfWriter, run: Run): void => {
  if (!run.glyphs || !run.positions) return
  const font = run.attributes.font?.[0]
  const { fontSize, color, opacity } = run.attributes
  const fill = color ? readPdfColor(color) : undefined
  if (color) writer.fillColor(fill?.rgb ?? null)
  // The colour's alpha multiplies the opacity.
  const alpha = fill?.alpha ?? 1
  if (opacity != null || alpha < 1) writer.fillOpacity((opacity ?? 1) * alpha)
  if (font) writer.glyphs({ font, size: fontSize, ...paintedGlyphs(font, run.glyphs, run.positions) })
  translate(writer, run.xAdvance ?? 0, 0)
}

const drawSpan = (writer: PdfWriter, line: Line): void => {
  writer.save()
  // A span without a font leaves its `q` open, as the ported walk did (removing it changes the bytes).
  if (!line.runs[0]?.attributes.font?.[0]) return
  translate(writer, line.box?.x || 0, line.box?.y || 0)
  for (const run of line.runs) drawRun(writer, run)
  writer.restore()
}

/** An SVG text: each span's first line, at the position the layout gave it. */
const drawText = (writer: PdfWriter, node: PaintChild): void => {
  for (const span of node.children ?? []) {
    const line = span.lines?.[0]
    if (line) drawSpan(writer, line)
  }
}

/** The geometry of each drawn element; groups and spans have none. */
const SHAPES: Readonly<Record<string, (writer: PdfWriter, node: PaintChild) => void>> = {
  PATH: (writer, node) => {
    const d = stringProp(node, 'd')
    if (d) drawPath(writer, parsePathData(d))
  },
  RECT: drawRect,
  LINE: (writer, node) => {
    writer.moveTo(numberProp(node, 'x1') ?? 0, numberProp(node, 'y1') ?? 0)
    writer.lineTo(numberProp(node, 'x2') ?? 0, numberProp(node, 'y2') ?? 0)
  },
  CIRCLE: (writer, node) => {
    const r = numberProp(node, 'r') ?? 0
    ellipse(writer, r, r, numberProp(node, 'cx'), numberProp(node, 'cy'))
  },
  ELLIPSE: (writer, node) =>
    ellipse(writer, numberProp(node, 'rx') ?? 0, numberProp(node, 'ry') ?? 0, numberProp(node, 'cx'), numberProp(node, 'cy')),
  POLYLINE: drawPolyline,
  POLYGON: (writer, node) => {
    drawPolyline(writer, node)
    writer.closePath()
  },
  IMAGE: drawImage,
  TEXT: drawText,
}

/** The box a gradient fills, in the shape's own coordinates. */
const boundsOf = (node: PaintChild): Bounds => {
  const prop = (key: string) => numberProp(node, key) || 0
  switch (node.type) {
    case 'RECT': return [prop('x'), prop('y'), prop('x') + prop('width'), prop('y') + prop('height')]
    case 'LINE': return [Math.min(prop('x1'), prop('x2')), Math.min(prop('y1'), prop('y2')), Math.max(prop('x1'), prop('x2')), Math.max(prop('y1'), prop('y2'))]
    case 'PATH': return pathBounds(parsePathData(stringProp(node, 'd') || ''))
    case 'CIRCLE': return [prop('cx') - prop('r'), prop('cy') - prop('r'), prop('cx') + prop('r'), prop('cy') + prop('r')]
    case 'ELLIPSE': return [prop('cx') - prop('rx'), prop('cy') - prop('ry'), prop('cx') + prop('rx'), prop('cy') + prop('ry')]
    case 'POLYGON':
    case 'POLYLINE': {
      const points = parsePoints(stringProp(node, 'points') || '')
      const xs = points.map(point => point[0])
      const ys = points.map(point => point[1])
      return [Math.min(Infinity, ...xs), Math.min(Infinity, ...ys), Math.max(-Infinity, ...xs), Math.max(-Infinity, ...ys)]
    }
    default: return [0, 0, 0, 0]
  }
}

const stopsOf = (gradient: PaintChild): GradientStop[] => (gradient.children ?? []).map((stop) => {
  const color = readPdfColor(stringProp(stop, 'stopColor') ?? '')
  if (!color) throw new Error(`A gradient stop has a colour the PDF writer cannot read: ${String(stop.props?.stopColor)}`)
  return { offset: numberProp(stop, 'offset') ?? 0, color: color.rgb, opacity: (numberProp(stop, 'stopOpacity') ?? 1) * color.alpha }
})

/** A gradient fill, its coordinates fractions of the shape's box. */
const setGradientFill = (writer: PdfWriter, node: PaintChild, gradient: PaintChild): void => {
  const [left, top, right, bottom] = boundsOf(node)
  const width = right - left
  const height = bottom - top
  // An explicit 0 counts; a missing coordinate takes the SVG default.
  const fraction = (key: string, fallback: number) => numberProp(gradient, key) ?? fallback
  if (gradient.type === 'LINEAR_GRADIENT') {
    writer.fillGradient({
      kind: 'linear',
      x1: width * fraction('x1', 0) + left,
      y1: height * fraction('y1', 0) + top,
      x2: width * fraction('x2', 1) + left,
      y2: height * fraction('y2', 0) + top,
      stops: stopsOf(gradient),
    })
  }
  else {
    const cx = fraction('cx', 0.5)
    const cy = fraction('cy', 0.5)
    writer.fillGradient({
      kind: 'radial',
      r: fraction('r', 0.5) * width,
      cx: width * cx + left,
      cy: height * cy + top,
      fx: width * fraction('fx', cx) + left,
      fy: height * fraction('fy', cy) + top,
      stops: stopsOf(gradient),
    })
  }
}

/** Stroke and fill state from the props, then the transform, the geometry and the paint. */
const drawNode = (writer: PdfWriter, node: PaintChild): void => {
  const props = node.props ?? {}
  if (typeof props.strokeLinecap === 'string' && props.strokeLinecap) writer.lineCap(props.strokeLinecap)
  if (typeof props.strokeLinejoin === 'string' && props.strokeLinejoin) writer.lineJoin(props.strokeLinejoin)
  const strokeWidth = numberProp(node, 'strokeWidth')
  if (strokeWidth) writer.lineWidth(strokeWidth)
  // SVG paints no stroke of width zero; PDF would draw a hairline.
  const stroke = strokeWidth === 0 ? undefined : props.stroke
  const strokeColor = typeof stroke === 'string' && stroke ? readPdfColor(stroke) : undefined
  if (typeof stroke === 'string' && stroke) writer.strokeColor(strokeColor?.rgb ?? null)
  const gradient = definition(props.fill)
  let fillColor
  if (gradient?.type === 'LINEAR_GRADIENT' || gradient?.type === 'RADIAL_GRADIENT') setGradientFill(writer, node, gradient)
  else if (typeof props.fill === 'string' && props.fill) {
    fillColor = readPdfColor(props.fill)
    writer.fillColor(fillColor?.rgb ?? null)
  }
  // A colour's alpha multiplies its opacity; an opaque colour writes what the props say.
  const strokeAlpha = strokeColor?.alpha ?? 1
  const fillAlpha = fillColor?.alpha ?? 1
  const strokeOpacity = numberProp(node, 'strokeOpacity')
  if (strokeOpacity != null || strokeAlpha < 1) writer.strokeOpacity((strokeOpacity ?? 1) * strokeAlpha)
  const fillOpacity = numberProp(node, 'fillOpacity')
  if (fillOpacity != null || fillAlpha < 1) writer.fillOpacity((fillOpacity ?? 1) * fillAlpha)
  // No SVG element takes `opacity` (primitives.ts), so none is read here.
  applyTransformations(writer, node)
  SHAPES[node.type]?.(writer, node)
  if (props.fill && stroke) writer.fillAndStroke()
  else if (props.fill) writer.fill()
  else if (stroke) writer.stroke()
  else {
    // An unpainted shape still ends its path, invisibly.
    writer.save()
    writer.opacity(0)
    writer.fill()
    writer.restore()
  }
}

/** Clips to the shapes of the node's clip path, if it has one. */
const clipTo = (writer: PdfWriter, node: PaintChild): void => {
  const clipPath = node.props?.clipPath
  if (!clipPath) return
  for (const shape of definition(clipPath)?.children ?? []) SHAPES[shape.type]?.(writer, shape)
  writer.clip()
}

const drawChildren = (writer: PdfWriter, node: PaintChild): void => {
  for (const child of node.children ?? []) {
    writer.save()
    clipTo(writer, child)
    drawNode(writer, child)
    drawChildren(writer, child)
    writer.restore()
  }
}

/** The view box scaled into the content box, centred and whole (`xMidYMid meet`). */
const fitViewBox = (writer: PdfWriter, node: PaintChild, { width, height }: { width: number, height: number }): void => {
  const viewBox = node.props?.viewBox
  if (viewBox == null || typeof viewBox !== 'object') return
  const read = (key: string): number | undefined => {
    const value: unknown = Reflect.get(viewBox, key)
    return typeof value === 'number' ? value : undefined
  }
  const x = read('minX') || 0
  const y = read('minY') || 0
  const logicalWidth = read('maxX') || width
  const logicalHeight = read('maxY') || height
  if (logicalWidth / logicalHeight < width / height) {
    const scale = height / logicalHeight
    writer.transform(scale, 0, 0, scale, 0, 0)
    translate(writer, -x - (logicalWidth - (width * logicalHeight) / height) / 2, -y)
  }
  else {
    const scale = width / logicalWidth
    writer.transform(scale, 0, 0, scale, 0, 0)
    translate(writer, -x, -y - (logicalHeight - (height * logicalWidth) / width) / 2)
  }
}

export const renderSvg = (writer: PdfWriter, node: MeasuredNode): void => {
  writer.save()
  clipNode(writer, node)
  const content = contentBox(node.box)
  translate(writer, content.left, content.top)
  fitViewBox(writer, node, content)
  drawChildren(writer, node)
  writer.restore()
}
