export const PDF_ERROR_CODES = {
  AssetBlocked: 'PDF_ASSET_BLOCKED',
  AssetInvalid: 'PDF_ASSET_INVALID',
  FontError: 'PDF_FONT_ERROR',
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

export interface NuxtPdfErrorOptions {
  cause?: unknown
  templateKey?: string
}

export class NuxtPdfError extends Error {
  readonly code: PdfErrorCode
  readonly templateKey?: string

  constructor(
    code: PdfErrorCode,
    message: string,
    options: NuxtPdfErrorOptions = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'NuxtPdfError'
    this.code = code
    this.templateKey = options.templateKey
  }
}
