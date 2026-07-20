import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfRectProps } from './_props'

export const PdfRect: FunctionalComponent<PdfRectProps> = props =>
  h(PDF_PRIMITIVES.Rect, compactSvgProps(props))

PdfRect.displayName = 'PdfRect'
PdfRect.inheritAttrs = false
