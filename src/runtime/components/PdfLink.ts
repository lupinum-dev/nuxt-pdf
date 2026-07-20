import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfLinkProps } from './_props'

export const PdfLink: FunctionalComponent<PdfLinkProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Link, compactPdfProps(props), slots.default?.())

PdfLink.displayName = 'PdfLink'
PdfLink.inheritAttrs = false
