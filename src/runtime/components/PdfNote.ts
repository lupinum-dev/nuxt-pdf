import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../renderer/types'
import { compactPdfProps, type PdfNoteProps } from './_props'

export const PdfNote: FunctionalComponent<PdfNoteProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Note, compactPdfProps(props), slots.default?.())

PdfNote.displayName = 'PdfNote'
PdfNote.inheritAttrs = false
