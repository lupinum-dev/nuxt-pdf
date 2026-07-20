import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfSvgProps } from './_props'

export const PdfSvg: FunctionalComponent<PdfSvgProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Svg, compactSvgProps(props), slots.default?.())

PdfSvg.displayName = 'PdfSvg'
PdfSvg.inheritAttrs = false
