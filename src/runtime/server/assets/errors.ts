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

const fail = (
  code: PdfAssetErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new PdfAssetError(code, message, { cause })
}

export const blocked = (message: string): never =>
  fail(PDF_ASSET_ERROR_CODES.Blocked, message)

export const invalid = (message: string, cause?: unknown): never =>
  fail(PDF_ASSET_ERROR_CODES.Invalid, message, cause)

export const limitExceeded = (maxBytes: number): never =>
  fail(
    PDF_ASSET_ERROR_CODES.LimitExceeded,
    `The PDF image exceeds the ${maxBytes}-byte source limit.`,
  )

export const imageLimitExceeded = (message: string): never =>
  fail(PDF_ASSET_ERROR_CODES.LimitExceeded, message)
