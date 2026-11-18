import type { BundledPdfFontDescriptor } from '../../fonts'
import type { PdfElementNode } from '../../renderer'
import type { PdfErrorCode, PdfInvoiceIssue, PdfSourcePosition } from '../../shared/errors'
import type { PdfLayoutWarning } from '../../shared/template'
import type { PdfRenderLimits } from '../render-limits'

// Messages between the main thread and the render worker. Everything here must
// survive a structured clone: the document is the admitted plain-data tree.

export interface WorkerRenderRequest {
  document: PdfElementNode
  fonts: readonly BundledPdfFontDescriptor[]
  limits: PdfRenderLimits
  /** Time the render already spent on the main thread, for the shared deadline. */
  elapsedMs: number
  maxPasses?: number
}

/** What one layout and serialization produce, in the worker or in-process. */
export interface PlainRenderOutput {
  bytes: Uint8Array
  layoutWarnings: PdfLayoutWarning[]
  pageCount: number
  passes: number
}

/** An error as plain data. A structured clone keeps neither its class nor `code`. */
export interface WorkerRenderFailure {
  ok: false
  /** Present for a typed `NuxtPdfError`; absent for an unexpected failure. */
  code?: PdfErrorCode
  /** The template position of the node a typed error is about. */
  source?: PdfSourcePosition
  /** The issues of a `PDF_INVOICE_INVALID` error. */
  issues?: readonly PdfInvoiceIssue[]
  name: string
  message: string
  stack?: string
  cause?: { name: string, message: string, stack?: string }
}

export type WorkerRenderResponse
  = | { ok: true, output: PlainRenderOutput }
    | WorkerRenderFailure
