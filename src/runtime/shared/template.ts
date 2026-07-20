import type { Component } from 'vue'

export const PDF_DEFINITION_PROPERTY = '__nuxtPdf' as const

export type PdfMetadataValue<Props extends object>
  = | string
    | ((props: Readonly<Props>) => string)

export interface PdfDefinition<Props extends object = Record<string, unknown>> {
  title?: PdfMetadataValue<Props>
  filename?: PdfMetadataValue<Props>
  language?: string
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
