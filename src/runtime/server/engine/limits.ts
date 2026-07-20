import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'

// Generous enough that no legitimate document hits them; documented as
// overridable through `pdf.limits`. They are the single source of truth for the
// default budget on both the build side (module setup) and the render side
// (registry fallback when a project configures nothing).
export const DEFAULT_PDF_TIMEOUT_MS = 30_000
export const DEFAULT_PDF_MAX_PAGES = 2_000

/** Operator-facing `pdf.limits` module option. */
export interface PdfLimitsOptions {
  timeoutMs?: number
  maxPages?: number
}

/** Fully resolved render limits threaded through the registry runtime options. */
export interface PdfRenderLimits {
  timeoutMs: number
  maxPages: number
}

/**
 * A monotonic render deadline. `check()` throws `PDF_LIMIT_EXCEEDED` once the
 * elapsed time passes the budget. Upstream layout is not abortable mid-step, so
 * the deadline is polled at engine seams (before and after each layout pass and
 * before serialization); worst-case overshoot is one engine stage.
 */
export interface RenderDeadline {
  check(): void
}

export const createRenderDeadline = (timeoutMs: number): RenderDeadline => {
  const start = performance.now()
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
  }
}

export const enforceMaxPages = (pageCount: number, maxPages: number): void => {
  if (pageCount > maxPages) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.LimitExceeded,
      `PDF laid out ${pageCount} pages, exceeding the ${maxPages}-page limit. `
      + `Raise pdf.limits.maxPages if this document is legitimately this long.`,
    )
  }
}

/** Everything the engine needs to enforce render limits across one whole render. */
export interface RenderLimits {
  maxPages: number
  deadline: RenderDeadline
}

/**
 * Build the per-render enforcement state. The deadline starts here, so the whole
 * render — mount, asset resolution, every layout pass, and serialization — is
 * bounded by the same budget.
 */
export const createRenderLimits = (limits: PdfRenderLimits): RenderLimits => ({
  maxPages: limits.maxPages,
  deadline: createRenderDeadline(limits.timeoutMs),
})

/** Apply per-field defaults for a render that carries no configured limits. */
export const resolvePdfRenderLimits = (
  limits: PdfRenderLimits | undefined,
): PdfRenderLimits => ({
  timeoutMs: limits?.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS,
  maxPages: limits?.maxPages ?? DEFAULT_PDF_MAX_PAGES,
})

const validatePositiveInteger = (value: unknown, key: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`pdf.limits.${key} must be a positive integer.`)
  }
  return value
}

/**
 * Validate the operator `pdf.limits` option at module setup and fill per-field
 * defaults. `undefined` (no `pdf.limits`) stays `undefined` so the generated
 * registry emits nothing and the render-side default applies — keeping the
 * zero-config generated output identical to a project that never touched limits.
 */
export const normalizePdfLimits = (
  options: PdfLimitsOptions | undefined,
): PdfRenderLimits | undefined => {
  if (options === undefined) return undefined
  return {
    timeoutMs: options.timeoutMs === undefined
      ? DEFAULT_PDF_TIMEOUT_MS
      : validatePositiveInteger(options.timeoutMs, 'timeoutMs'),
    maxPages: options.maxPages === undefined
      ? DEFAULT_PDF_MAX_PAGES
      : validatePositiveInteger(options.maxPages, 'maxPages'),
  }
}
