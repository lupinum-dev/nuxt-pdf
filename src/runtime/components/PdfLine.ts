import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfLineProps } from './_props'

export const PdfLine: FunctionalComponent<PdfLineProps> = props =>
  h(PDF_PRIMITIVES.Line, compactSvgProps(props))

PdfLine.displayName = 'PdfLine'
PdfLine.inheritAttrs = false
