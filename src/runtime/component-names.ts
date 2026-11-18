// Every global `Pdf*` component name. Vue-free, so build code (generated
// authoring types) can read it.
import { PDF_PRIMITIVE_COMPONENT_NAMES } from './primitives'

/**
 * Table components: thin Vue components over `PdfView` and `PdfText`
 * (`components/table.ts`). They are not primitives, because the engine only
 * sees the views and texts they render.
 */
export const PDF_TABLE_COMPONENT_NAMES = ['PdfTable', 'PdfTableHeader', 'PdfTableRow', 'PdfTableCell'] as const

export type PdfTableComponentName = typeof PDF_TABLE_COMPONENT_NAMES[number]

const TABLE_COMPONENT_NAMES: ReadonlySet<unknown> = new Set(PDF_TABLE_COMPONENT_NAMES)

export const isPdfTableComponentName = (value: unknown): value is PdfTableComponentName =>
  TABLE_COMPONENT_NAMES.has(value)

export const PDF_COMPONENT_NAMES = [...PDF_PRIMITIVE_COMPONENT_NAMES, ...PDF_TABLE_COMPONENT_NAMES]

/**
 * Internal prop a table component sets on the primitive it renders. The
 * renderer stores it on the element, so errors about that element name the
 * component the author wrote.
 */
export const PDF_COMPONENT_PROP = '__nuxtPdfComponent' as const
