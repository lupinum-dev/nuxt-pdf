import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import { PDF_PRIMITIVES } from '../authoring'
import type {
  PdfDocumentNode,
  PdfElementNode,
  PdfNode,
} from '../renderer/types'

export const DEFAULT_PDF_TIMEOUT_MS = 30_000
export const DEFAULT_PDF_MAX_PAGES = 2_000
export const DEFAULT_PDF_MAX_NODES = 50_000
export const DEFAULT_PDF_MAX_TREE_DEPTH = 128
export const DEFAULT_PDF_MAX_TEXT_CHARACTERS = 2_000_000
export const DEFAULT_PDF_MAX_IMAGES = 256
export const DEFAULT_PDF_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const DEFAULT_PDF_MAX_TOTAL_IMAGE_BYTES = 32 * 1024 * 1024
export const DEFAULT_PDF_MAX_IMAGE_PIXELS = 25_000_000
export const DEFAULT_PDF_MAX_TOTAL_IMAGE_PIXELS = 100_000_000
export const DEFAULT_PDF_MAX_REMOTE_REQUESTS = 32
export const DEFAULT_PDF_MAX_REMOTE_CONCURRENCY = 4
export const DEFAULT_PDF_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/** Operator-facing `pdf.limits` module option. */
export interface PdfLimitsOptions {
  timeoutMs?: number
  maxPages?: number
  maxNodes?: number
  maxTreeDepth?: number
  maxTextCharacters?: number
  maxImages?: number
  maxImageBytes?: number
  maxTotalImageBytes?: number
  maxImagePixels?: number
  maxTotalImagePixels?: number
  maxRemoteRequests?: number
  maxRemoteConcurrency?: number
  maxOutputBytes?: number
}

/** Fully resolved render limits threaded through the registry runtime options. */
export type PdfRenderLimits = Required<PdfLimitsOptions>

export const DEFAULT_PDF_RENDER_LIMITS: Readonly<PdfRenderLimits> = Object.freeze({
  timeoutMs: DEFAULT_PDF_TIMEOUT_MS,
  maxPages: DEFAULT_PDF_MAX_PAGES,
  maxNodes: DEFAULT_PDF_MAX_NODES,
  maxTreeDepth: DEFAULT_PDF_MAX_TREE_DEPTH,
  maxTextCharacters: DEFAULT_PDF_MAX_TEXT_CHARACTERS,
  maxImages: DEFAULT_PDF_MAX_IMAGES,
  maxImageBytes: DEFAULT_PDF_MAX_IMAGE_BYTES,
  maxTotalImageBytes: DEFAULT_PDF_MAX_TOTAL_IMAGE_BYTES,
  maxImagePixels: DEFAULT_PDF_MAX_IMAGE_PIXELS,
  maxTotalImagePixels: DEFAULT_PDF_MAX_TOTAL_IMAGE_PIXELS,
  maxRemoteRequests: DEFAULT_PDF_MAX_REMOTE_REQUESTS,
  maxRemoteConcurrency: DEFAULT_PDF_MAX_REMOTE_CONCURRENCY,
  maxOutputBytes: DEFAULT_PDF_MAX_OUTPUT_BYTES,
})

/** A monotonic checked deadline shared by the whole render. */
export interface RenderDeadline {
  check(): void
  remainingMs(): number
}

export const createRenderDeadline = (timeoutMs: number): RenderDeadline => {
  const start = performance.now()
  const remainingMs = (): number => Math.max(0, timeoutMs - (performance.now() - start))

  return {
    check(): void {
      const elapsed = performance.now() - start
      if (elapsed > timeoutMs) {
        throw new NuxtPdfError(
          PDF_ERROR_CODES.LimitExceeded,
          `PDF render exceeded its ${timeoutMs}ms time budget (elapsed ${Math.round(elapsed)}ms). `
          + `Raise pdf.limits.timeoutMs if this document is legitimately this slow. The budget is `
          + `checked between engine stages and passes, not mid-step, so a single layout stage can `
          + `overshoot it.`,
        )
      }
    },
    remainingMs,
  }
}

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

export const createRenderLimits = (limits: PdfRenderLimits): RenderLimits => ({
  ...limits,
  abortController: new AbortController(),
  deadline: createRenderDeadline(limits.timeoutMs),
})

const textLength = (value: string): number => {
  let count = 0
  for (const _character of value) count += 1
  return count
}

/** Fail before layout when the mounted canonical tree exceeds admission limits. */
export const enforceTreeLimits = (
  document: PdfDocumentNode,
  limits: RenderLimits,
): void => {
  const pending: Array<{ depth: number, node: PdfNode }> = [{
    depth: 1,
    node: document,
  }]
  const seen = new Set<PdfElementNode>()
  let images = 0
  let nodes = 0
  let textCharacters = 0

  while (pending.length > 0) {
    const { depth, node } = pending.pop()!
    nodes += 1
    if (nodes > limits.maxNodes) {
      limitExceeded(
        `PDF mounted more than ${limits.maxNodes} nodes. Raise pdf.limits.maxNodes only for a legitimately larger document.`,
      )
    }
    if (depth > limits.maxTreeDepth) {
      limitExceeded(
        `PDF tree depth exceeded ${limits.maxTreeDepth}. Raise pdf.limits.maxTreeDepth only for a legitimately deeper document.`,
      )
    }

    if (node.type === PDF_PRIMITIVES.TextInstance) {
      textCharacters += textLength(node.value)
      if (textCharacters > limits.maxTextCharacters) {
        limitExceeded(
          `PDF text exceeded ${limits.maxTextCharacters} characters. Raise pdf.limits.maxTextCharacters only for legitimate content.`,
        )
      }
      continue
    }

    if (seen.has(node)) {
      throw new NuxtPdfError(
        PDF_ERROR_CODES.TreeInvalid,
        'PDF tree contains a repeated or circular element node.',
      )
    }
    seen.add(node)

    if (node.type === PDF_PRIMITIVES.Image) {
      images += 1
      if (images > limits.maxImages) {
        limitExceeded(
          `PDF mounted more than ${limits.maxImages} images. Raise pdf.limits.maxImages only for a legitimate document.`,
        )
      }
    }

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]
      if (child) pending.push({ depth: depth + 1, node: child })
    }
  }

  limits.deadline.check()
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
  if (unknownKey) throw new TypeError(`pdf.limits.${unknownKey} is not supported.`)
  for (const key of Object.keys(result) as Array<keyof PdfRenderLimits>) {
    const value = options[key]
    if (value !== undefined) result[key] = validatePositiveSafeInteger(value, key)
  }
  return result
}
