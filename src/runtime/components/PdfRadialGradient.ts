import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfRadialGradientProps } from './_props'

export const PdfRadialGradient: FunctionalComponent<PdfRadialGradientProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.RadialGradient, compactSvgProps(props), slots.default?.())

PdfRadialGradient.displayName = 'PdfRadialGradient'
PdfRadialGradient.inheritAttrs = false
