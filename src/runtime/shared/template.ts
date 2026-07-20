import type { Component } from 'vue'

export const PDF_DEFINITION_PROPERTY = '__nuxtPdf' as const

export type PdfMetadataValue<Props extends object>
  = | string
    | ((props: Readonly<Props>) => string)

export interface PdfDefinition<Props extends object = Record<string, unknown>> {
  title?: PdfMetadataValue<Props>
  filename?: PdfMetadataValue<Props>
  language?: string
  /**
   * Maximum number of layout passes the multi-pass (table-of-contents) loop runs
   * before it declares the page numbers non-convergent and throws
   * `PDF_LIMIT_EXCEEDED`. A positive integer; defaults to 5. Only relevant to
   * documents that read `usePdfPageNumbers()` or link to an internal `#id`.
   */
  maxPasses?: number
  sampleData?: Props
  scenarios?: Readonly<Record<string, Props>>
}

export interface ResolvedPdfMetadata {
  title?: string
  filename?: string
  language?: string
}

export type PdfComponent<Props extends object = Record<string, unknown>>
  = Component & {
    readonly [PDF_DEFINITION_PROPERTY]?: PdfDefinition<Props>
  }

export type PdfDisposition = 'attachment' | 'inline'

export interface PdfResponseInit extends Omit<ResponseInit, 'headers'> {
  disposition?: PdfDisposition
  filename?: string
  headers?: HeadersInit
}

export interface PdfRenderResult {
  toUint8Array(): Promise<Uint8Array>
  toBuffer(): Promise<Buffer>
  toStream(): Promise<NodeJS.ReadableStream>
  response(init?: PdfResponseInit): Promise<Response>
}

/**
 * Measured facts about one dev-preview render. Dev-only and never part of the
 * public render contract; declared here (engine-free) so the dev preview route
 * can reference it without dragging the server engine into type resolution.
 */
export interface PdfPreviewDiagnostics {
  durationMs: number
  byteLength: number
  pageCount: number
  passes: number
  warnings: readonly string[]
}

/** The bytes plus diagnostics the dev preview needs. Dev-only; never public API. */
export interface PdfPreviewRender {
  bytes: Uint8Array
  title?: string
  filename?: string
  diagnostics: PdfPreviewDiagnostics
}

export interface PdfTemplate<Props extends object = Record<string, unknown>> {
  readonly key: string
  readonly definition: Readonly<PdfDefinition<Props>>
  readonly sampleData: Props | undefined
  readonly scenarios: Readonly<Record<string, Props>>
  readonly scenarioNames: readonly string[]
  getPreviewProps(scenario?: string): Props | undefined
  resolveMetadata(props: Props): ResolvedPdfMetadata
  render(props: Props): Promise<PdfRenderResult>
}
