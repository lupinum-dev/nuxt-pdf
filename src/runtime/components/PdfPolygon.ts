import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfPolygonProps } from './_props'

export const PdfPolygon: FunctionalComponent<PdfPolygonProps> = props =>
  h(PDF_PRIMITIVES.Polygon, compactSvgProps(props))

PdfPolygon.displayName = 'PdfPolygon'
PdfPolygon.inheritAttrs = false
