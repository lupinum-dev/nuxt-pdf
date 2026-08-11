import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../authoring'
import {
  compactProps,
  type PdfCircleProps,
  type PdfClipPathProps,
  type PdfDefsProps,
  type PdfEllipseProps,
  type PdfGProps,
  type PdfLinearGradientProps,
  type PdfLineProps,
  type PdfPathProps,
  type PdfPolygonProps,
  type PdfPolylineProps,
  type PdfRadialGradientProps,
  type PdfRectProps,
  type PdfStopProps,
  type PdfSvgProps,
  type PdfTspanProps,
} from './_props'

export const PdfSvg: FunctionalComponent<PdfSvgProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Svg, compactProps(props), slots.default?.())

PdfSvg.displayName = 'PdfSvg'
PdfSvg.inheritAttrs = false

export const PdfG: FunctionalComponent<PdfGProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.G, compactProps(props), slots.default?.())

PdfG.displayName = 'PdfG'
PdfG.inheritAttrs = false

export const PdfPath: FunctionalComponent<PdfPathProps> = props =>
  h(PDF_PRIMITIVES.Path, compactProps(props))

PdfPath.displayName = 'PdfPath'
PdfPath.inheritAttrs = false

export const PdfRect: FunctionalComponent<PdfRectProps> = props =>
  h(PDF_PRIMITIVES.Rect, compactProps(props))

PdfRect.displayName = 'PdfRect'
PdfRect.inheritAttrs = false

export const PdfCircle: FunctionalComponent<PdfCircleProps> = props =>
  h(PDF_PRIMITIVES.Circle, compactProps(props))

PdfCircle.displayName = 'PdfCircle'
PdfCircle.inheritAttrs = false

export const PdfEllipse: FunctionalComponent<PdfEllipseProps> = props =>
  h(PDF_PRIMITIVES.Ellipse, compactProps(props))

PdfEllipse.displayName = 'PdfEllipse'
PdfEllipse.inheritAttrs = false

export const PdfLine: FunctionalComponent<PdfLineProps> = props =>
  h(PDF_PRIMITIVES.Line, compactProps(props))

PdfLine.displayName = 'PdfLine'
PdfLine.inheritAttrs = false

export const PdfPolyline: FunctionalComponent<PdfPolylineProps> = props =>
  h(PDF_PRIMITIVES.Polyline, compactProps(props))

PdfPolyline.displayName = 'PdfPolyline'
PdfPolyline.inheritAttrs = false

export const PdfPolygon: FunctionalComponent<PdfPolygonProps> = props =>
  h(PDF_PRIMITIVES.Polygon, compactProps(props))

PdfPolygon.displayName = 'PdfPolygon'
PdfPolygon.inheritAttrs = false

export const PdfDefs: FunctionalComponent<PdfDefsProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Defs, compactProps(props), slots.default?.())

PdfDefs.displayName = 'PdfDefs'
PdfDefs.inheritAttrs = false

export const PdfClipPath: FunctionalComponent<PdfClipPathProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.ClipPath, compactProps(props), slots.default?.())

PdfClipPath.displayName = 'PdfClipPath'
PdfClipPath.inheritAttrs = false

export const PdfLinearGradient: FunctionalComponent<PdfLinearGradientProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.LinearGradient, compactProps(props), slots.default?.())

PdfLinearGradient.displayName = 'PdfLinearGradient'
PdfLinearGradient.inheritAttrs = false

export const PdfRadialGradient: FunctionalComponent<PdfRadialGradientProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.RadialGradient, compactProps(props), slots.default?.())

PdfRadialGradient.displayName = 'PdfRadialGradient'
PdfRadialGradient.inheritAttrs = false

export const PdfStop: FunctionalComponent<PdfStopProps> = props =>
  h(PDF_PRIMITIVES.Stop, compactProps(props))

PdfStop.displayName = 'PdfStop'
PdfStop.inheritAttrs = false

export const PdfTspan: FunctionalComponent<PdfTspanProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Tspan, compactProps(props), slots.default?.())

PdfTspan.displayName = 'PdfTspan'
PdfTspan.inheritAttrs = false
