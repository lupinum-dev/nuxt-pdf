// Shared, renderer-agnostic fixture data for the annotations / metadata / page
// setup conformance corpus. React and Vue both import these exact values, so any
// difference the corpus test observes belongs to the renderer boundary rather
// than to divergent test inputs.

import type { PdfPageDimension } from '../../../src/runtime/components'

/** External link targets exercised as PDF Link annotation URIs. */
export const linkTargets = {
  external: 'https://example.com/docs?tab=annotations',
  mailto: 'mailto:reports@example.com',
} as const

/** Fixed geometry keeps the hitSlop annotation expansion independently testable. */
export const linkStyle = {
  width: 120,
  height: 20,
} as const

export const linkHitSlop = {
  top: 3,
  right: 5,
  bottom: 7,
  left: 11,
} as const

/** Sticky-note (Text annotation) contents. */
export const noteContent = 'Reviewer note: confirm totals before dispatch.'

/**
 * Document metadata written into the PDF info dictionary and catalog. `creator`
 * and `producer` are set explicitly because React PDF defaults them to
 * `react-pdf` and the Vue engine defaults them to `nuxt-pdf`; pinning both keeps
 * the info-dictionary round-trip an apples-to-apples renderer comparison.
 */
export const documentMeta = {
  title: 'Nuxt PDF metadata proof',
  author: 'Nuxt PDF Team',
  subject: 'Metadata round-trip conformance',
  keywords: 'nuxt, pdf, metadata, conformance',
  creator: 'nuxt-pdf-conformance',
  producer: 'nuxt-pdf-conformance',
  language: 'en-US',
  creationDate: new Date('2026-07-20T00:00:00.000Z'),
  pdfVersion: '1.5',
  pageLayout: 'twoColumnLeft',
} as const

// Only the standard page names this corpus exercises are admitted, so the union
// stays assignable to React PDF's narrow `PageSize` literal type (and to the
// Vue renderer's broader `size` prop) without a cast.
export type PageSetupSize
  = | 'A4'
    | 'LETTER'
    | [PdfPageDimension, PdfPageDimension]
    | { width: PdfPageDimension, height: PdfPageDimension }

export interface PageSetupCase {
  /** Stable id, also drawn on the page for a text sanity check. */
  id: string
  size: PageSetupSize
  orientation?: 'portrait' | 'landscape'
  dpi?: number
  /**
   * Independently computed MediaBox `[width, height]` in points, rounded to 2dp.
   * This is the oracle: derived by hand from React PDF's documented 72dpi page
   * table and unit rules, NOT read back from either renderer, so it also catches
   * a bug that happens to be shared by both sides.
   */
  expected: [number, number]
}

/**
 * Per-page size / orientation / dpi cases. Rendered as one multi-page document
 * so the corpus also proves per-page independent sizing.
 *
 * Oracle derivation:
 * - A4 / Letter: React PDF's 72dpi PAGE_SIZES table (A4 = 595.28 x 841.89,
 *   Letter = 612 x 792).
 * - custom array / object: passed straight through as points.
 * - landscape: portrait size with width/height swapped.
 * - dpi + px: `round(px * 72 / dpi)` per React PDF's transformUnit; here
 *   round(600 * 72 / 300) = 144, round(900 * 72 / 300) = 216.
 */
export const pageSetupCases: PageSetupCase[] = [
  { id: 'a4', size: 'A4', expected: [595.28, 841.89] },
  { id: 'letter', size: 'LETTER', expected: [612, 792] },
  { id: 'custom-array', size: [300, 400], expected: [300, 400] },
  { id: 'custom-object', size: { width: 250, height: 350 }, expected: [250, 350] },
  { id: 'landscape', size: 'A4', orientation: 'landscape', expected: [841.89, 595.28] },
  { id: 'dpi-px', size: { width: '600px', height: '900px' }, dpi: 300, expected: [144, 216] },
]
