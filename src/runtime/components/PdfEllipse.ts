import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfEllipseProps } from './_props'

export const PdfEllipse: FunctionalComponent<PdfEllipseProps> = props =>
  h(PDF_PRIMITIVES.Ellipse, compactSvgProps(props))

PdfEllipse.displayName = 'PdfEllipse'
PdfEllipse.inheritAttrs = false
