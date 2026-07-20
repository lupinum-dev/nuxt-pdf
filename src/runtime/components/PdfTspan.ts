import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfTspanProps } from './_props'

export const PdfTspan: FunctionalComponent<PdfTspanProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Tspan, compactSvgProps(props), slots.default?.())

PdfTspan.displayName = 'PdfTspan'
PdfTspan.inheritAttrs = false
