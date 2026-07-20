import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfDefsProps } from './_props'

export const PdfDefs: FunctionalComponent<PdfDefsProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Defs, compactSvgProps(props), slots.default?.())

PdfDefs.displayName = 'PdfDefs'
PdfDefs.inheritAttrs = false
