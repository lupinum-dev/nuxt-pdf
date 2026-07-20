import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfViewProps } from './_props'

export const PdfView: FunctionalComponent<PdfViewProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.View, compactPdfProps(props), slots.default?.())

PdfView.displayName = 'PdfView'
PdfView.inheritAttrs = false
