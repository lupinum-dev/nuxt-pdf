import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfClipPathProps } from './_props'

export const PdfClipPath: FunctionalComponent<PdfClipPathProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.ClipPath, compactSvgProps(props), slots.default?.())

PdfClipPath.displayName = 'PdfClipPath'
PdfClipPath.inheritAttrs = false
