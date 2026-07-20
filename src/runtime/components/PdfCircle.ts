import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfCircleProps } from './_props'

export const PdfCircle: FunctionalComponent<PdfCircleProps> = props =>
  h(PDF_PRIMITIVES.Circle, compactSvgProps(props))

PdfCircle.displayName = 'PdfCircle'
PdfCircle.inheritAttrs = false
