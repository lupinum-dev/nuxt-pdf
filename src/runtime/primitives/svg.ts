// The SVG primitives.
import type { PdfStyleValue } from '../authoring'
import { boolean, primitive, required, string, svgNonNegative, svgNumber, svgUnitInterval, value } from './spec'

/** Numeric SVG values accepted by the pinned layout parser. */
export type PdfSvgNumber = number | `${number}`
export type PdfSvgLength = PdfSvgNumber | `${number}%`
export type PdfSvgTransformOperation
  = | `translate(${number})`
    | `translate(${number},${number})`
    | `translate(${number}, ${number})`
    | `translate(${number} ${number})`
    | `rotate(${number})`
export type PdfSvgTransform
  = | PdfSvgTransformOperation
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`

/**
 * Fixture-proven subset of the engine's SVG presentation attributes. On SVG
 * nodes these are camelCase props. `transform` is a prop here (unlike
 * `PdfView`, where it is a style key).
 */
export type PdfSvgPresentationProps = {
  fill?: string
  stroke?: string
  transform?: PdfSvgTransform
  strokeWidth?: PdfSvgNumber
  fillOpacity?: PdfSvgLength
  strokeOpacity?: PdfSvgLength
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  clipPath?: string
}

export type PdfSvgProps = {
  width?: PdfSvgLength
  height?: PdfSvgLength
  viewBox?: string
  /** Page-flow sizing and positioning for the SVG root. */
  style?: PdfStyleValue
  /** What the graphic shows, for assistive technology. A PDF/UA-1 document needs it or `decorative`. */
  alt?: string
  /** In a PDF/UA-1 document: the graphic is decoration (a PDF artifact). */
  decorative?: boolean
}

export type PdfGProps = PdfSvgPresentationProps

export type PdfPathProps = PdfSvgPresentationProps & {
  d: string
}

export type PdfRectProps = PdfSvgPresentationProps & {
  x?: PdfSvgLength
  y?: PdfSvgLength
  width: PdfSvgLength
  height: PdfSvgLength
  rx?: PdfSvgLength
  ry?: PdfSvgLength
}

export type PdfCircleProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r: PdfSvgLength
}

export type PdfEllipseProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  rx: PdfSvgLength
  ry: PdfSvgLength
}

export type PdfLineProps = PdfSvgPresentationProps & {
  x1: PdfSvgLength
  y1: PdfSvgLength
  x2: PdfSvgLength
  y2: PdfSvgLength
}

export type PdfPolylineProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfPolygonProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfDefsProps = Record<never, never>

export type PdfClipPathProps = {
  id: string
}

type PdfGradientProps = {
  id: string
}

export type PdfLinearGradientProps = PdfGradientProps & {
  x1?: PdfSvgLength
  y1?: PdfSvgLength
  x2?: PdfSvgLength
  y2?: PdfSvgLength
}

export type PdfRadialGradientProps = PdfGradientProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r?: PdfSvgLength
  fx?: PdfSvgLength
  fy?: PdfSvgLength
}

export type PdfStopProps = {
  offset: PdfSvgLength
  stopColor: string
  stopOpacity?: PdfSvgLength
}

export type PdfTspanProps = {
  x?: PdfSvgLength
  y?: PdfSvgLength
  fill?: string
}

const SVG_PRESENTATION_PROPS = {
  clipPath: value,
  fill: { check: 'svgFill' },
  fillOpacity: svgUnitInterval,
  stroke: { check: 'svgStroke' },
  strokeLinecap: { check: 'strokeLinecap' },
  strokeLinejoin: { check: 'strokeLinejoin' },
  strokeOpacity: svgUnitInterval,
  strokeWidth: { check: 'svgStrokeWidth' },
  transform: { check: 'svgTransform' },
} as const

const SVG_SHAPES = ['PdfPath', 'PdfRect', 'PdfCircle', 'PdfEllipse', 'PdfLine', 'PdfPolyline', 'PdfPolygon'] as const
// PdfTspan is deliberately absent: upstream renderSvg only draws a Tspan
// inside Text, so a direct Tspan child would silently produce no output.
const SVG_GROUP = [...SVG_SHAPES, 'PdfG', 'PdfImage', 'PdfText'] as const

export const SVG_PRIMITIVES = {
  PdfTspan: primitive<PdfTspanProps>()({
    tag: 'TSPAN',
    props: { fill: { check: 'svgColor' }, x: svgNumber, y: svgNumber },
    children: [],
    text: true,
    context: 'svg',
  }),
  PdfSvg: primitive<PdfSvgProps>()({
    tag: 'SVG',
    props: {
      alt: { check: 'altText' },
      decorative: boolean,
      height: svgNonNegative,
      style: value,
      viewBox: { check: 'viewBox' },
      width: svgNonNegative,
    },
    children: [...SVG_GROUP, 'PdfDefs'],
  }),
  PdfG: primitive<PdfGProps>()({
    tag: 'G',
    props: SVG_PRESENTATION_PROPS,
    children: SVG_GROUP,
  }),
  PdfPath: primitive<PdfPathProps>()({
    tag: 'PATH',
    props: { ...SVG_PRESENTATION_PROPS, d: required(string) },
    children: [],
  }),
  PdfRect: primitive<PdfRectProps>()({
    tag: 'RECT',
    props: {
      ...SVG_PRESENTATION_PROPS,
      height: required(svgNonNegative),
      rx: svgNonNegative,
      ry: svgNonNegative,
      width: required(svgNonNegative),
      x: svgNumber,
      y: svgNumber,
    },
    children: [],
  }),
  PdfCircle: primitive<PdfCircleProps>()({
    tag: 'CIRCLE',
    props: { ...SVG_PRESENTATION_PROPS, cx: svgNumber, cy: svgNumber, r: required(svgNonNegative) },
    children: [],
  }),
  PdfEllipse: primitive<PdfEllipseProps>()({
    tag: 'ELLIPSE',
    props: {
      ...SVG_PRESENTATION_PROPS,
      cx: svgNumber,
      cy: svgNumber,
      rx: required(svgNonNegative),
      ry: required(svgNonNegative),
    },
    children: [],
  }),
  PdfLine: primitive<PdfLineProps>()({
    tag: 'LINE',
    props: {
      ...SVG_PRESENTATION_PROPS,
      x1: required(svgNumber),
      x2: required(svgNumber),
      y1: required(svgNumber),
      y2: required(svgNumber),
    },
    children: [],
  }),
  PdfPolyline: primitive<PdfPolylineProps>()({
    tag: 'POLYLINE',
    props: { ...SVG_PRESENTATION_PROPS, points: required(string) },
    children: [],
  }),
  PdfPolygon: primitive<PdfPolygonProps>()({
    tag: 'POLYGON',
    props: { ...SVG_PRESENTATION_PROPS, points: required(string) },
    children: [],
  }),
  PdfDefs: primitive<PdfDefsProps>()({
    tag: 'DEFS',
    props: {},
    children: ['PdfClipPath', 'PdfLinearGradient', 'PdfRadialGradient'],
  }),
  PdfClipPath: primitive<PdfClipPathProps>()({
    tag: 'CLIP_PATH',
    props: { id: required(value) },
    children: SVG_SHAPES,
  }),
  PdfLinearGradient: primitive<PdfLinearGradientProps>()({
    tag: 'LINEAR_GRADIENT',
    props: { id: required(value), x1: svgNumber, x2: svgNumber, y1: svgNumber, y2: svgNumber },
    children: ['PdfStop'],
  }),
  PdfRadialGradient: primitive<PdfRadialGradientProps>()({
    tag: 'RADIAL_GRADIENT',
    props: { cx: svgNumber, cy: svgNumber, fx: svgNumber, fy: svgNumber, id: required(value), r: svgNonNegative },
    children: ['PdfStop'],
  }),
  PdfStop: primitive<PdfStopProps>()({
    tag: 'STOP',
    props: { offset: required(svgUnitInterval), stopColor: required({ check: 'svgColor' }), stopOpacity: svgUnitInterval },
    children: [],
  }),
}
