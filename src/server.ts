/** Node-only production runtime. No source compiler or Nuxt virtual imports. */
export { createPdfRegistry, createPdfTemplate } from './runtime/server/registry'
export { NuxtPdfError, PDF_ERROR_CODES } from './runtime/shared/errors'
export { usePdfPageNumbers } from './runtime/composables'
export type { PdfErrorCode } from './runtime/shared/errors'
export type { PdfRegistry, PdfRegistryEntries } from './runtime/server/registry'
export type {
  PdfComponentProps,
  PdfDefinition,
  PdfRenderResult,
  PdfTemplate,
} from './runtime/shared/template'
