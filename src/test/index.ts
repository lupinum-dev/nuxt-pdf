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
} from '../test-utils/pdf'
export type {
  ParsedPdf,
  ParsedPdfLink,
  ParsedPdfPage,
  PdfInput,
  PdfOutlineItem,
  PdfPageImage,
  RasterizePdfOptions,
} from '../test-utils/pdf'

export {
  expectPdf,
  PdfAssertionError,
} from '../test-utils/expect'
export type {
  LinkQuery,
  OutlineShape,
  PdfExpectation,
  ToContainTextOptions,
} from '../test-utils/expect'

export { renderPdfTemplate } from '../test-utils/render-template'
export type {
  RenderPdfTemplateOptions,
  RenderedPdfTemplate,
} from '../test-utils/render-template'

export { comparePdfSnapshot } from '../test-utils/snapshot'
export type {
  ComparePdfSnapshotOptions,
  PdfSnapshotResult,
} from '../test-utils/snapshot'
