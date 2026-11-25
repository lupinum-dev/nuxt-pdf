import { NuxtPdfError, PDF_ERROR_CODES, treeInvalid } from '../shared/errors'
import { checkLimitValue, MAX_TIME_LIMIT_MS } from '../shared/limit-range'
import { resolvedPosition } from '../authoring'
import { PDF_PRIMITIVES } from '../primitives'
import type {
  PdfDocumentNode,
  PdfElementNode,
  PdfNode,
} from '../renderer'

/**
 * Operator-facing `pdf.limits` module option. Each option bounds one case
 * that the render deadline and the worker heap limit do not cover alone.
 */
export interface PdfLimitsOptions {
  /** Whole render time, including the wait for a render worker. Hard stop in the worker. */
  timeoutMs?: number
  /** Whole time of one `parseRichTextMarkdown` call, including the wait for a render worker. Hard stop in the worker. */
  markdownTimeoutMs?: number
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
  timeoutMs: 30_000,
  markdownTimeoutMs: 5_000,
  maxPages: 2_000,
  maxNodes: 50_000,
  maxTotalImageBytes: 32 * 1024 * 1024,
  maxTotalImagePixels: 100_000_000,
  maxRemoteRequests: 32,
  maxTotalAttachmentBytes: 32 * 1024 * 1024,
})

/** A monotonic checked deadline shared by the whole render. */
interface RenderDeadline {
  check(): void
  remainingMs(): number
}

/**
 * `elapsedMs` continues a deadline that started in another thread: a worker's
 * clock has its own origin, so the main thread passes the time already spent.
 */
const createRenderDeadline = (
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

/**
 * Whether a plain tree holds in-flow `fixed` content: the one cause of a
 * pagination that never ends that a deadline error can name. Read by the
 * in-worker diagnosis (`plain-tree.ts`) and the worker's timer
 * (`worker-render.ts`), which loads no engine code.
 */
export const holdsFlowFixed = (node: PdfElementNode): boolean =>
  node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance
    && resolvedPosition(child.style) !== 'absolute'
    && (child.props.fixed === true || holdsFlowFixed(child)))

/** The error of a Markdown parse that ran out of time; it names the option to raise. */
export const markdownDeadlineError = (timeoutMs: number, elapsedMs: number): NuxtPdfError =>
  new NuxtPdfError(
    PDF_ERROR_CODES.LimitExceeded,
    `parseRichTextMarkdown exceeded its ${timeoutMs}ms time budget (elapsed ${Math.round(elapsedMs)}ms). `
    + `Raise pdf.limits.markdownTimeoutMs if this Markdown is legitimately this slow.`,
  )

/** Fail the render with `PDF_LIMIT_EXCEEDED`; the message names the limit to raise. */
export const limitExceeded = (message: string): never => {
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
export const plainRenderLimits = ({ abortController: _abort, deadline: _deadline, ...limits }: RenderLimits): PdfRenderLimits => limits

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
      treeInvalid('PDF tree contains a repeated or circular element node.')
    }
    seen.add(node)
    for (const child of node.children) pending.push(child)
  }

  limits.deadline.check()
}

export const resolvePdfRenderLimits = (
  limits: PdfRenderLimits | undefined,
): PdfRenderLimits => ({
  ...DEFAULT_PDF_RENDER_LIMITS,
  ...limits,
})

/**
 * The largest value of each limit. A time limit becomes a Node timer, which
 * cannot wait longer than `MAX_TIME_LIMIT_MS`. The counts and byte totals are
 * only compared with what a render uses, so any safe integer works.
 */
const LIMIT_MAXIMUMS: Readonly<Record<keyof PdfRenderLimits, readonly [max: number, unit: string]>> = {
  timeoutMs: [MAX_TIME_LIMIT_MS, ' ms'],
  markdownTimeoutMs: [MAX_TIME_LIMIT_MS, ' ms'],
  maxPages: [Number.MAX_SAFE_INTEGER, ''],
  maxNodes: [Number.MAX_SAFE_INTEGER, ''],
  maxTotalImageBytes: [Number.MAX_SAFE_INTEGER, ''],
  maxTotalImagePixels: [Number.MAX_SAFE_INTEGER, ''],
  maxRemoteRequests: [Number.MAX_SAFE_INTEGER, ''],
  maxTotalAttachmentBytes: [Number.MAX_SAFE_INTEGER, ''],
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
  const unknownKey = Object.keys(options).find(key => !Object.hasOwn(result, key))
  if (unknownKey) {
    const removed = Object.hasOwn(REMOVED_LIMITS, unknownKey) ? REMOVED_LIMITS[unknownKey] : undefined
    throw new TypeError(removed
      ? `pdf.limits.${unknownKey} was removed: ${removed}`
      : `pdf.limits.${unknownKey} is not supported.`)
  }
  for (const key of Object.keys(result) as Array<keyof PdfRenderLimits>) {
    const value = options[key]
    const [max, unit] = LIMIT_MAXIMUMS[key]
    if (value !== undefined) result[key] = checkLimitValue(value, `pdf.limits.${key}`, max, unit)
  }
  return result
}
