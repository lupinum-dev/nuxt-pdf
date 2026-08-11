import type {
  AllowedComponentProps,
  Component,
  ComponentCustomProps,
  FunctionalComponent,
  VNodeProps,
} from 'vue'

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
   * documents that read `usePdfPageNumbers()` — internal `#id` links alone
   * resolve in a single pass and never enter the loop.
   */
  maxPasses?: number
  sampleData?: Props
  scenarios?: Readonly<Record<string, Props>>
}

export interface ResolvedPdfMetadata {
  readonly title?: string
  readonly filename?: string
  readonly language?: string
}

export type PdfComponent<Props extends object = Record<string, unknown>>
  = Component & {
    readonly [PDF_DEFINITION_PROPERTY]?: PdfDefinition<Props>
  }

type VueFrameworkProps = VNodeProps & AllowedComponentProps & ComponentCustomProps

/** Props authored by a component, excluding Vue's renderer-level vnode props. */
export type PdfComponentProps<C extends Component>
  = C extends abstract new (...args: never[]) => { $props: infer Props extends object }
    ? Omit<Props, keyof VueFrameworkProps>
    : C extends FunctionalComponent<infer Props extends object>
      ? Props
      : Record<string, unknown>

export type PdfDisposition = 'attachment' | 'inline'

export interface PdfResponseInit extends Omit<ResponseInit, 'headers'> {
  disposition?: PdfDisposition
  filename?: string
  headers?: HeadersInit
}

/** Safe, content-free measurements from one completed PDF render. */
export interface PdfRenderDiagnostics {
  readonly durationMs: number
  readonly byteLength: number
  readonly pageCount: number
  readonly passes: number
  readonly registeredFontFaces: readonly PdfRegisteredFontFace[]
}

export interface PdfRegisteredFontFace {
  readonly family: string
  readonly fontStyle?: string
  readonly fontWeight?: number
}

export interface PdfRenderResult {
  readonly metadata: Readonly<ResolvedPdfMetadata>
  readonly diagnostics: PdfRenderDiagnostics
  toUint8Array(): Promise<Uint8Array>
  toBuffer(): Promise<Buffer>
  response(init?: PdfResponseInit): Promise<Response>
}

export interface PdfTemplate<Props extends object = Record<string, unknown>> {
  readonly key: string
  resolveMetadata(props: Props): ResolvedPdfMetadata
  render(props: Props): Promise<PdfRenderResult>
}
