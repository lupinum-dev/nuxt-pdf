import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfImageProps } from './_props'

export const PdfImage: FunctionalComponent<PdfImageProps> = props =>
  h(PDF_PRIMITIVES.Image, compactPdfProps(props))

PdfImage.displayName = 'PdfImage'
PdfImage.inheritAttrs = false
