import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../../shared/errors'

export const PDF_ASSET_ERROR_CODES = {
  Blocked: PDF_ERROR_CODES.AssetBlocked,
  Invalid: PDF_ERROR_CODES.AssetInvalid,
  LimitExceeded: PDF_ERROR_CODES.LimitExceeded,
} as const

export type PdfAssetErrorCode = (
  typeof PDF_ASSET_ERROR_CODES
)[keyof typeof PDF_ASSET_ERROR_CODES]

export class PdfAssetError extends NuxtPdfError {
  constructor(
    code: PdfAssetErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(code, message, options)
    this.name = 'PdfAssetError'
  }
}
