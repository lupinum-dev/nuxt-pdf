import { isMarkedAsUntransferable } from 'node:worker_threads'
import type { BundledPdfFontDescriptor } from '../../fonts'
import type { PdfElementNode } from '../../renderer'
import type { PdfRichBlock } from '../../rich-text/types'
import type { NuxtPdfError, PdfErrorCode, PdfSourcePosition } from '../../shared/errors'
import type { PdfLayoutWarning } from '../../shared/template'
import type { PdfRenderLimits } from '../render-limits'

// Messages between the main thread and the render worker. Everything here must
// survive a structured clone: the document is the admitted plain-data tree.
// Two request kinds share the pool, its deadline and its failure path: a
// render, and a Markdown parse (comark runs in the worker, so hostile Markdown
// never blocks the server's event loop).

export interface WorkerRenderRequest {
  document: PdfElementNode
  fonts: readonly BundledPdfFontDescriptor[]
  limits: PdfRenderLimits
  /** Time the render already spent on the main thread, for the shared deadline. */
  elapsedMs: number
  maxPasses?: number
}

/** Markdown to parse with comark and map to the rich text model. */
interface WorkerMarkdownRequest {
  markdown: string
}

/** One message to a pool worker. */
export type WorkerRequest
  = | { kind: 'render', request: WorkerRenderRequest }
    | { kind: 'markdown', request: WorkerMarkdownRequest }

/** What one layout and serialization produce, in the worker or in-process. */
export interface PlainRenderOutput {
  bytes: Uint8Array<ArrayBuffer>
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
  /** The issues of a `PDF_INVOICE_INVALID` or `PDF_RICH_TEXT_INVALID` error. */
  issues?: NuxtPdfError['issues']
  name: string
  message: string
  stack?: string
  cause?: { name: string, message: string, stack?: string }
}

/** The answer to one request: its output, or the failure as plain data. */
export type WorkerResponse<Output>
  = | { ok: true, output: Output }
    | WorkerRenderFailure

export type WorkerMarkdownResponse = WorkerResponse<PdfRichBlock[]>

/**
 * The buffer to move to the other thread instead of copying it: only when
 * `bytes` owns the whole of it. Node marks its Buffer pool memory
 * untransferable, and the structured clone copies that case.
 */
export const transferableBuffer = (bytes: unknown): ArrayBuffer | undefined =>
  bytes instanceof Uint8Array
  && bytes.buffer instanceof ArrayBuffer
  && bytes.byteOffset === 0
  && bytes.byteLength === bytes.buffer.byteLength
  && !isMarkedAsUntransferable(bytes.buffer)
    ? bytes.buffer
    : undefined
