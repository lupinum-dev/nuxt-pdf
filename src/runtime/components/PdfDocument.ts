import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfDocumentProps } from './_props'

export const PdfDocument: FunctionalComponent<PdfDocumentProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Document, compactPdfProps(props), slots.default?.())

PdfDocument.displayName = 'PdfDocument'
PdfDocument.inheritAttrs = false
