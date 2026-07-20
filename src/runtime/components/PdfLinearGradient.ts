import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfLinearGradientProps } from './_props'

export const PdfLinearGradient: FunctionalComponent<PdfLinearGradientProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.LinearGradient, compactSvgProps(props), slots.default?.())

PdfLinearGradient.displayName = 'PdfLinearGradient'
PdfLinearGradient.inheritAttrs = false
