import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfPageProps } from './_props'

export const PdfPage: FunctionalComponent<PdfPageProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Page, compactPdfProps(props), slots.default?.())

PdfPage.displayName = 'PdfPage'
PdfPage.inheritAttrs = false
