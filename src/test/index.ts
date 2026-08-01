// Public testing utilities for authoring assertions against your own PDF
// templates. Exposed as `@lupinum/nuxt-pdf/test`. Runner-agnostic: helpers throw
// `PdfAssertionError` rather than depending on vitest or jest.
//
// `pdfjs-dist` and `@napi-rs/canvas` are optional peer dependencies, loaded
// lazily by `parsePdf`/`rasterizePdf`; install them in the project under test.

export {
  parsePdf,
  rasterizePdf,
  toPdfBytes,
} from './pdf'
export type {
  ParsedPdf,
  ParsedPdfLink,
  ParsedPdfPage,
  ParsedPdfTextRun,
  PdfInput,
  PdfOutlineItem,
  PdfPageImage,
  RasterizePdfOptions,
} from './pdf'

export {
  expectPdf,
  PdfAssertionError,
} from './expect'
export type {
  LinkQuery,
  OutlineShape,
  PdfExpectation,
  ToContainTextOptions,
} from './expect'

export { renderPdfTemplate } from './render-template'
export type {
  RenderPdfTemplateOptions,
  RenderedPdfTemplate,
} from './render-template'

export { loadPdfSfc, renderPdfSfc } from './render-sfc'
export type { RenderPdfSfcOptions } from './render-sfc'

export { comparePdfSnapshot } from './snapshot'
export type {
  ComparePdfSnapshotOptions,
  PdfSnapshotResult,
} from './snapshot'
