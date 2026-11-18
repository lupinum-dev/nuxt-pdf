import { renderEInvoiceXml } from '../einvoice/cii'
import type { EInvoice, EInvoiceProfile } from '../einvoice/types'
import { NuxtPdfError, PDF_ERROR_CODES, withPdfSource } from '../shared/errors'
import { PDF_PRIMITIVES } from '../primitives'
import type {
  PdfDocumentNode,
  PdfElementNode,
  PdfNode,
} from '../renderer'

export const DEFAULT_PDF_TIMEOUT_MS = 30_000
export const DEFAULT_PDF_MAX_PAGES = 2_000
export const DEFAULT_PDF_MAX_NODES = 50_000
export const DEFAULT_PDF_MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024
export const DEFAULT_PDF_MAX_TOTAL_IMAGE_PIXELS = 100_000_000
export const DEFAULT_PDF_MAX_REMOTE_REQUESTS = 32
export const DEFAULT_PDF_MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024

/**
 * Operator-facing `pdf.limits` module option. Each option bounds one case
 * that the render deadline and the worker heap limit do not cover alone.
 */
export interface PdfLimitsOptions {
  /** Whole render time, including the wait for a render worker. Hard stop in the worker. */
  timeoutMs?: number
  /** Laid-out pages: runaway pagination from data before the PDF is written. */
  maxPages?: number
  /** Mounted tree nodes: the copy sent to the worker and in-process layout. */
  maxNodes?: number
  /** Encoded image bytes of one render, summed over all images. */
  maxTotalImageBytes?: number
  /** Decoded image pixels of one render, summed over all images. */
  maxTotalImagePixels?: number
  /** Outbound requests of one render to allowlisted remote hosts. */
  maxRemoteRequests?: number
  /** Bytes of the files embedded with `PdfAttachment` and `PdfFacturX` in one render, summed over all of them. */
  maxTotalAttachmentBytes?: number
}

/** Fully resolved render limits threaded through the registry runtime options. */
export type PdfRenderLimits = Required<PdfLimitsOptions>

export const DEFAULT_PDF_RENDER_LIMITS: Readonly<PdfRenderLimits> = Object.freeze({
  timeoutMs: DEFAULT_PDF_TIMEOUT_MS,
  maxPages: DEFAULT_PDF_MAX_PAGES,
  maxNodes: DEFAULT_PDF_MAX_NODES,
  maxTotalImageBytes: DEFAULT_PDF_MAX_TOTAL_IMAGE_BYTES,
  maxTotalImagePixels: DEFAULT_PDF_MAX_TOTAL_IMAGE_PIXELS,
  maxRemoteRequests: DEFAULT_PDF_MAX_REMOTE_REQUESTS,
  maxTotalAttachmentBytes: DEFAULT_PDF_MAX_TOTAL_ATTACHMENT_BYTES,
})

/** A monotonic checked deadline shared by the whole render. */
export interface RenderDeadline {
  check(): void
  remainingMs(): number
}

/**
 * `elapsedMs` continues a deadline that started in another thread: a worker's
 * clock has its own origin, so the main thread passes the time already spent.
 */
export const createRenderDeadline = (
  timeoutMs: number,
  elapsedMs = 0,
): RenderDeadline => {
  const start = performance.now() - elapsedMs
  const remainingMs = (): number => Math.max(0, timeoutMs - (performance.now() - start))

  return {
    check(): void {
      const elapsed = performance.now() - start
      if (elapsed > timeoutMs) throw renderDeadlineError(timeoutMs, elapsed)
    },
    remainingMs,
  }
}

/** The one error of a render that ran out of time; it names the option to raise. */
export const renderDeadlineError = (timeoutMs: number, elapsedMs: number): NuxtPdfError =>
  new NuxtPdfError(
    PDF_ERROR_CODES.LimitExceeded,
    `PDF render exceeded its ${timeoutMs}ms time budget (elapsed ${Math.round(elapsedMs)}ms). `
    + `Raise pdf.limits.timeoutMs if this document is legitimately this slow.`,
  )

const limitExceeded = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.LimitExceeded, message)
}

export const enforceMaxPages = (pageCount: number, maxPages: number): void => {
  if (pageCount > maxPages) {
    limitExceeded(
      `PDF laid out ${pageCount} pages, exceeding the ${maxPages}-page limit. `
      + `Raise pdf.limits.maxPages if this document is legitimately this long.`,
    )
  }
}

/** Everything needed to enforce one render's resolved budgets. */
export interface RenderLimits extends PdfRenderLimits {
  readonly abortController: AbortController
  readonly deadline: RenderDeadline
}

export const createRenderLimits = (
  limits: PdfRenderLimits,
  elapsedMs = 0,
): RenderLimits => ({
  ...limits,
  abortController: new AbortController(),
  deadline: createRenderDeadline(limits.timeoutMs, elapsedMs),
})

/** The plain budget values of a render, without its deadline and abort state. */
export const plainRenderLimits = (limits: RenderLimits): PdfRenderLimits => ({
  timeoutMs: limits.timeoutMs,
  maxPages: limits.maxPages,
  maxNodes: limits.maxNodes,
  maxTotalImageBytes: limits.maxTotalImageBytes,
  maxTotalImagePixels: limits.maxTotalImagePixels,
  maxRemoteRequests: limits.maxRemoteRequests,
  maxTotalAttachmentBytes: limits.maxTotalAttachmentBytes,
})

/** Fail before layout when the mounted tree has more nodes than allowed. */
export const enforceTreeLimits = (
  document: PdfDocumentNode,
  limits: RenderLimits,
): void => {
  const pending: PdfNode[] = [document]
  const seen = new Set<PdfElementNode>()
  let nodes = 0

  while (pending.length > 0) {
    const node = pending.pop()!
    nodes += 1
    if (nodes > limits.maxNodes) {
      limitExceeded(
        `PDF mounted more than ${limits.maxNodes} nodes. Raise pdf.limits.maxNodes only for a legitimately larger document.`,
      )
    }
    if (node.type === PDF_PRIMITIVES.TextInstance) continue

    if (seen.has(node)) {
      throw new NuxtPdfError(
        PDF_ERROR_CODES.TreeInvalid,
        'PDF tree contains a repeated or circular element node.',
      )
    }
    seen.add(node)
    for (const child of node.children) pending.push(child)
  }

  limits.deadline.check()
}

const utf8 = new TextEncoder()

/**
 * Write the CII XML of a `PdfFacturX` that has `invoice` (tree validation
 * has checked the profile and that `xml` is absent). It runs on the main
 * thread, before the attachment total is checked, so the XML counts toward
 * `maxTotalAttachmentBytes` and the worker sees only bytes. Invalid data fails
 * with `PDF_INVOICE_INVALID` and its issues.
 */
const writeFacturXInvoice = (node: PdfElementNode): void => {
  const { invoice, profile } = node.props
  try {
    // validateFacturXProfile rejects EXTENDED with an invoice, and the
    // facturXInvoice check an invoice that is not an object.
    node.props.xml = renderEInvoiceXml(invoice as EInvoice, { profile: profile as EInvoiceProfile })
  }
  catch (error) {
    throw withPdfSource(error, node.source)
  }
  delete node.props.invoice
}

/**
 * Admit the attachments (`PdfAttachment`, `PdfFacturX`) of a mounted document: string content becomes its
 * UTF-8 bytes, so the engine (and the worker it may run in) sees only bytes,
 * and the total is checked before the tree leaves the main thread.
 */
export const admitPdfAttachments = (
  document: PdfDocumentNode,
  limits: RenderLimits,
): void => {
  let total = 0
  for (const child of document.children) {
    // The Factur-X invoice XML is an attachment too.
    if (child.type !== PDF_PRIMITIVES.Attachment && child.type !== PDF_PRIMITIVES.FacturX) continue
    if (child.type === PDF_PRIMITIVES.FacturX && child.props.invoice !== undefined) writeFacturXInvoice(child)
    const key = child.type === PDF_PRIMITIVES.FacturX ? 'xml' : 'data'
    const data = child.props[key]
    if (typeof data === 'string') child.props[key] = utf8.encode(data)
    const bytes = child.props[key]
    if (bytes instanceof Uint8Array) total += bytes.byteLength
    if (total > limits.maxTotalAttachmentBytes) {
      limitExceeded(
        `PDF attachments of this render exceed pdf.limits.maxTotalAttachmentBytes (${limits.maxTotalAttachmentBytes} bytes in total).`,
      )
    }
  }
}

export const resolvePdfRenderLimits = (
  limits: PdfRenderLimits | undefined,
): PdfRenderLimits => ({
  ...DEFAULT_PDF_RENDER_LIMITS,
  ...limits,
})

const validatePositiveSafeInteger = (value: unknown, key: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`pdf.limits.${key} must be a positive safe integer.`)
  }
  return value
}

/**
 * Former `pdf.limits` keys and what to do instead. Temporary migration text,
 * listed in `internals/migrations.md`; remove it with the 1.0 release.
 */
const REMOVED_LIMITS: Readonly<Record<string, string>> = {
  maxImageBytes: 'there is no per-image cap any more. Set pdf.limits.maxTotalImageBytes, the budget for all images of one render (default 32 MiB).',
  maxImagePixels: 'there is no per-image cap any more. Set pdf.limits.maxTotalImagePixels, the budget of decoded pixels for all images of one render (default 100,000,000).',
  maxAttachmentBytes: 'rename it to pdf.limits.maxTotalAttachmentBytes.',
  maxTreeDepth: 'remove it. pdf.limits.maxNodes bounds the tree.',
  maxTextCharacters: 'remove it. pdf.limits.maxNodes and pdf.limits.maxPages bound the text.',
  maxImages: 'remove it. pdf.limits.maxTotalImageBytes and pdf.limits.maxTotalImagePixels bound all images of one render.',
  maxRemoteConcurrency: 'remove it. A render runs at most four remote requests at a time; pdf.limits.maxRemoteRequests bounds the total.',
  maxOutputBytes: 'remove it. The image budgets and pdf.limits.maxPages bound the output.',
}

/** Validate operator limits once and fill every omitted field from one default. */
export const normalizePdfLimits = (
  options: PdfLimitsOptions | undefined,
): PdfRenderLimits | undefined => {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('pdf.limits must be an object.')
  }

  const result = { ...DEFAULT_PDF_RENDER_LIMITS }
  const unknownKey = Object.keys(options).find(key => !(key in result))
  if (unknownKey) {
    const removed = Object.hasOwn(REMOVED_LIMITS, unknownKey) ? REMOVED_LIMITS[unknownKey] : undefined
    throw new TypeError(removed
      ? `pdf.limits.${unknownKey} was removed: ${removed}`
      : `pdf.limits.${unknownKey} is not supported.`)
  }
  for (const key of Object.keys(result) as Array<keyof PdfRenderLimits>) {
    const value = options[key]
    if (value !== undefined) result[key] = validatePositiveSafeInteger(value, key)
  }
  return result
}
