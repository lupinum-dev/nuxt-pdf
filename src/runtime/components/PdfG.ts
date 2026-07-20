import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfGProps } from './_props'

export const PdfG: FunctionalComponent<PdfGProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.G, compactSvgProps(props), slots.default?.())

PdfG.displayName = 'PdfG'
PdfG.inheritAttrs = false
