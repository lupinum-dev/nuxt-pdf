import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfTextProps } from './_props'

export const PdfText: FunctionalComponent<PdfTextProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Text, compactPdfProps(props), slots.default?.())

PdfText.displayName = 'PdfText'
PdfText.inheritAttrs = false
