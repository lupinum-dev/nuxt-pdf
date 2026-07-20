import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfPolylineProps } from './_props'

export const PdfPolyline: FunctionalComponent<PdfPolylineProps> = props =>
  h(PDF_PRIMITIVES.Polyline, compactSvgProps(props))

PdfPolyline.displayName = 'PdfPolyline'
PdfPolyline.inheritAttrs = false
