import { PDF_PRIMITIVES } from '../primitives'
import type { BundledPdfFontDescriptor } from '../fonts'
import type { PdfElementNode, PdfNode } from '../renderer'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type { PdfRichBlock } from '../rich-text/types'
import {
  transferableBuffer,
  type PlainRenderOutput,
  type WorkerRenderRequest,
} from './engine/worker-protocol'
import { markdownDeadlineError, plainRenderLimits, renderDeadlineError, type RenderLimits } from './render-limits'
import { pdfRenderPlacement, runInWorker } from './worker-pool'

// Where layout and serialization run. One engine adapter, two places:
//
// - A worker thread from a small pool, by default. At the render deadline the
//   worker is terminated, which stops layout even inside one engine step; the
//   pool starts a fresh worker for the next render.
// - In-process, when the build has no worker chunk (`PDF_WORKER_URL` is
//   undefined: a production preset that inlines dynamic imports). The deadline
//   is then checked between engine stages and once per page during pagination.
//
// The decision is recorded in internals/decisions.md ("Render worker").

const loadWorkerEntry = () => import('./engine/worker-entry')

// Resolved image bytes are copies made for this render, so their memory can
// move to the worker (`transferableBuffer` says when).
const transferableImageBuffers = (document: PdfElementNode): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  const visit = (node: PdfNode): void => {
    if (node.type === PDF_PRIMITIVES.TextInstance) return
    const buffer = node.type === PDF_PRIMITIVES.Image ? transferableBuffer(node.props.src) : undefined
    if (buffer) buffers.add(buffer)
    for (const child of node.children) visit(child)
  }
  visit(document)
  return [...buffers]
}

interface PlainTreeRenderOptions {
  fonts?: readonly BundledPdfFontDescriptor[]
  limits: RenderLimits
  maxPasses?: number
}

export const deadlineError = (limits: Pick<RenderLimits, 'timeoutMs' | 'deadline'>): unknown => {
  try {
    limits.deadline.check()
  }
  catch (error) {
    return error
  }
  // The timer fired a fraction of a millisecond before the deadline clock:
  // the same error, so the author still reads which option to raise.
  return renderDeadlineError(limits.timeoutMs, limits.timeoutMs - limits.deadline.remainingMs())
}

const renderInWorker = (
  request: WorkerRenderRequest,
  limits: RenderLimits,
  url: string,
  marker: string,
): Promise<PlainRenderOutput> => runInWorker<PlainRenderOutput>({
  message: () => ({
    kind: 'render',
    request: { ...request, elapsedMs: limits.timeoutMs - limits.deadline.remainingMs() },
  }),
  transfer: transferableImageBuffers(request.document),
  remainingMs: () => limits.deadline.remainingMs(),
  deadlineError: () => {
    const error = deadlineError(limits)
    limits.abortController.abort(error)
    return error
  },
  sendError: error => new NuxtPdfError(
    PDF_ERROR_CODES.TreeInvalid,
    `The PDF tree could not be sent to the render worker: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  ),
}, url, marker)

/**
 * Lay out and serialize an admitted plain-data tree: in a pool worker, or
 * in-process when the build has no worker chunk. In the worker case the image
 * buffers are transferred, so the caller must not read them afterwards.
 */
export const renderPlainTree = async (
  document: PdfElementNode,
  options: PlainTreeRenderOptions,
): Promise<PlainRenderOutput> => {
  const { limits } = options
  limits.deadline.check()
  const entry = await loadWorkerEntry()
  const request: WorkerRenderRequest = {
    document,
    fonts: options.fonts ?? [],
    limits: plainRenderLimits(limits),
    elapsedMs: 0,
    maxPasses: options.maxPasses,
  }

  if (pdfRenderPlacement.inProcess || entry.PDF_WORKER_URL === undefined) {
    return entry.renderPlainRequest(request, limits)
  }
  return renderInWorker(request, limits, entry.PDF_WORKER_URL, entry.PDF_WORKER_MARKER)
}

/**
 * Parse checked Markdown with comark in a pool worker and map it to the rich
 * text model, within `timeoutMs` (the wait for a worker included). Over the
 * limit the worker is ended and the call fails with `PDF_LIMIT_EXCEEDED`.
 * There is no in-process path: a build without a worker chunk fails with
 * `PDF_RENDER_ERROR`, because comark on the main thread could block the
 * server for seconds.
 */
export const parseMarkdownInWorker = async (markdown: string, timeoutMs: number): Promise<PdfRichBlock[]> => {
  const started = performance.now()
  const remainingMs = () => Math.max(0, timeoutMs - (performance.now() - started))
  const entry = await loadWorkerEntry()
  if (pdfRenderPlacement.inProcess || entry.PDF_WORKER_URL === undefined) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      'parseRichTextMarkdown parses in the PDF render worker, and this build has none: the Nitro preset bundles the server into one file. '
      + 'Use a Node server preset, or parse the Markdown where a Node server or script runs.',
    )
  }
  return runInWorker<PdfRichBlock[]>({
    message: () => ({ kind: 'markdown', request: { markdown } }),
    transfer: [],
    remainingMs,
    deadlineError: () => markdownDeadlineError(timeoutMs, performance.now() - started),
    sendError: error => error,
  }, entry.PDF_WORKER_URL, entry.PDF_WORKER_MARKER)
}
