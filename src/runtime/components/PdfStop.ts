import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactSvgProps, type PdfStopProps } from './_props'

export const PdfStop: FunctionalComponent<PdfStopProps> = props =>
  h(PDF_PRIMITIVES.Stop, compactSvgProps(props))

PdfStop.displayName = 'PdfStop'
PdfStop.inheritAttrs = false
