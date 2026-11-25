// Every global `Pdf*` component name. Vue-free, so build code (generated
// authoring types) can read it.
import { PDF_PRIMITIVE_COMPONENT_NAMES } from './primitives'

/**
 * Table components: thin Vue components over `PdfView` and `PdfText`
 * (`components/table.ts`). They are not primitives, because the engine only
 * sees the views and texts they render.
 */
export const PDF_TABLE_COMPONENT_NAMES = ['PdfTable', 'PdfTableHeader', 'PdfTableRow', 'PdfTableCell'] as const

/** `PdfRichText` (`components/rich-text.ts`): renders a rich text model with views, texts and links. */
export const PDF_RICH_TEXT_COMPONENT_NAMES = ['PdfRichText'] as const

/** A component of this library that renders primitives, not a primitive itself. */
export type PdfLibraryComponentName = typeof PDF_TABLE_COMPONENT_NAMES[number] | typeof PDF_RICH_TEXT_COMPONENT_NAMES[number]

const LIBRARY_COMPONENT_NAMES: ReadonlySet<unknown> = new Set([...PDF_TABLE_COMPONENT_NAMES, ...PDF_RICH_TEXT_COMPONENT_NAMES])

export const isPdfLibraryComponentName = (value: unknown): value is PdfLibraryComponentName =>
  LIBRARY_COMPONENT_NAMES.has(value)

export const PDF_COMPONENT_NAMES = [...PDF_PRIMITIVE_COMPONENT_NAMES, ...PDF_TABLE_COMPONENT_NAMES, ...PDF_RICH_TEXT_COMPONENT_NAMES]

/**
 * Internal prop a library component sets on the primitive it renders. The
 * renderer stores it on the element, so errors about that element name the
 * component the author wrote.
 */
export const PDF_COMPONENT_PROP = '__nuxtPdfComponent' as const

/**
 * Internal prop `PdfRichText` sets on the `PdfImage` of an image block and on
 * its placeholder (`PdfRichImageMark`). The renderer stores it on the
 * element; image resolution reads it to keep the image or the placeholder.
 */
export const PDF_RICH_IMAGE_PROP = '__nuxtPdfRichImage' as const

/**
 * Internal prop `PdfRichText` sets on its view: the warnings of its input
 * (`RichTextWarnings.entries`). The renderer stores it on the element; the
 * render collects it into `diagnostics.richTextWarnings`.
 */
export const PDF_RICH_TEXT_WARNINGS_PROP = '__nuxtPdfRichTextWarnings' as const

/** What a refused rich text image source does: print the placeholder (and warn), or fail the render. */
export type PdfBrokenImages = 'placeholder' | 'error'

/**
 * A rich text image (`image`), the figure around a captioned one (`figure`) or
 * its placeholder (`placeholder`): `path` names the image block in the rich
 * text model (`content[3]`); `brokenImages` is the `PdfRichText` prop.
 */
export interface PdfRichImageMark {
  readonly role: 'image' | 'figure' | 'placeholder'
  readonly path: string
  readonly brokenImages: PdfBrokenImages
}

/** The mark, when `value` is one; anything else is no mark. */
export const pdfRichImageMark = (value: unknown): PdfRichImageMark | undefined => {
  if (typeof value !== 'object' || value === null || !('role' in value) || !('path' in value) || !('brokenImages' in value)) return undefined
  const { role, path, brokenImages } = value
  if ((role !== 'image' && role !== 'figure' && role !== 'placeholder') || typeof path !== 'string' || (brokenImages !== 'placeholder' && brokenImages !== 'error')) return undefined
  return Object.freeze({ role, path, brokenImages })
}
