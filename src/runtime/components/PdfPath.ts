import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfPathProps } from './_props'

export const PdfPath: FunctionalComponent<PdfPathProps> = props =>
  h(PDF_PRIMITIVES.Path, compactSvgProps(props))

PdfPath.displayName = 'PdfPath'
PdfPath.inheritAttrs = false
