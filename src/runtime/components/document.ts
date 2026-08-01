import { h, type FunctionalComponent } from 'vue'
import { PDF_PRIMITIVES } from '../authoring'
import {
  compactProps,
  type PdfDocumentProps,
  type PdfImageProps,
  type PdfLinkProps,
  type PdfNoteProps,
  type PdfPageProps,
  type PdfTextProps,
  type PdfViewProps,
} from './_props'

export const PdfDocument: FunctionalComponent<PdfDocumentProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Document, compactProps(props), slots.default?.())

PdfDocument.displayName = 'PdfDocument'
PdfDocument.inheritAttrs = false

export const PdfPage: FunctionalComponent<PdfPageProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Page, compactProps(props), slots.default?.())

PdfPage.displayName = 'PdfPage'
PdfPage.inheritAttrs = false

export const PdfView: FunctionalComponent<PdfViewProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.View, compactProps(props), slots.default?.())

PdfView.displayName = 'PdfView'
PdfView.inheritAttrs = false

export const PdfText: FunctionalComponent<PdfTextProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Text, compactProps(props), slots.default?.())

PdfText.displayName = 'PdfText'
PdfText.inheritAttrs = false

export const PdfImage: FunctionalComponent<PdfImageProps> = props =>
  h(PDF_PRIMITIVES.Image, compactProps(props))

PdfImage.displayName = 'PdfImage'
PdfImage.inheritAttrs = false

export const PdfLink: FunctionalComponent<PdfLinkProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Link, compactProps(props), slots.default?.())

PdfLink.displayName = 'PdfLink'
PdfLink.inheritAttrs = false

export const PdfNote: FunctionalComponent<PdfNoteProps> = (
  props,
  { slots },
) => h(PDF_PRIMITIVES.Note, compactProps(props), slots.default?.())

PdfNote.displayName = 'PdfNote'
PdfNote.inheritAttrs = false
