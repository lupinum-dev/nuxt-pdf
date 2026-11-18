export const PDF_ERROR_CODES = {
  AssetBlocked: 'PDF_ASSET_BLOCKED',
  AssetInvalid: 'PDF_ASSET_INVALID',
  InvoiceInvalid: 'PDF_INVOICE_INVALID',
  LayoutError: 'PDF_LAYOUT_ERROR',
  LimitExceeded: 'PDF_LIMIT_EXCEEDED',
  TreeInvalid: 'PDF_TREE_INVALID',
  TemplateNotFound: 'PDF_TEMPLATE_NOT_FOUND',
  TemplateInvalid: 'PDF_TEMPLATE_INVALID',
  RenderError: 'PDF_RENDER_ERROR',
} as const

export type PdfErrorCode = (
  typeof PDF_ERROR_CODES
)[keyof typeof PDF_ERROR_CODES]

/**
 * Where a PDF element starts in its `.vue` file: the path relative to the
 * project root with forward slashes, and the 1-based line and column of the
 * opening tag. Only development builds record it.
 */
export interface PdfSourcePosition {
  readonly file: string
  readonly line: number
  readonly column: number
}

/**
 * A problem in e-invoice data, as `validateEInvoice` reports it: the rule of
 * EN 16931 or XRechnung (`BR-16`, `BR-DE-15`) or of this library (`PDF-…`),
 * the field path (`invoice.lines[0].netPrice`) and what to do.
 */
export interface PdfInvoiceIssue {
  readonly rule: string
  readonly path: string
  readonly message: string
}

export interface NuxtPdfErrorOptions {
  cause?: unknown
  templateKey?: string
  templateFile?: string
  source?: PdfSourcePosition
  /** With `PDF_INVOICE_INVALID`: every problem found in the invoice data. */
  issues?: readonly PdfInvoiceIssue[]
}

export class NuxtPdfError extends Error {
  readonly code: PdfErrorCode
  readonly templateKey?: string
  readonly templateFile?: string
  /** The template element the error is about, in development builds. */
  // `declare`: no own property unless a position exists.
  declare readonly source?: PdfSourcePosition
  /** With `PDF_INVOICE_INVALID`: every problem found in the invoice data. */
  declare readonly issues?: readonly PdfInvoiceIssue[]

  constructor(
    code: PdfErrorCode,
    message: string,
    options: NuxtPdfErrorOptions = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'NuxtPdfError'
    this.code = code
    this.templateKey = options.templateKey
    this.templateFile = options.templateFile
    if (options.source) this.source = options.source
    if (options.issues) this.issues = options.issues
  }
}

/**
 * Parse the `"<file>:<line>:<column>"` string the SFC compiler writes in
 * development. The file part may itself contain colons.
 */
export const parsePdfSourcePosition = (value: string | undefined): PdfSourcePosition | undefined => {
  if (value === undefined) return undefined
  const columnStart = value.lastIndexOf(':')
  const lineStart = value.lastIndexOf(':', columnStart - 1)
  if (lineStart <= 0) return undefined
  const line = Number(value.slice(lineStart + 1, columnStart))
  const column = Number(value.slice(columnStart + 1))
  if (!Number.isInteger(line) || !Number.isInteger(column)) return undefined
  return { file: value.slice(0, lineStart), line, column }
}

/**
 * Give a node-level `NuxtPdfError` the source position of its node. The
 * message and code stay; an error that already has a position keeps it.
 */
export const withPdfSource = (error: unknown, source: string | undefined): unknown => {
  if (!(error instanceof NuxtPdfError) || error.source || source === undefined) return error
  const position = parsePdfSourcePosition(source)
  if (!position) return error
  const located = new NuxtPdfError(error.code, error.message, {
    cause: error.cause,
    templateKey: error.templateKey,
    templateFile: error.templateFile,
    source: position,
    issues: error.issues,
  })
  located.stack = error.stack
  return located
}
