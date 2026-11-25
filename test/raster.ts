import { join } from 'node:path'
import { expect } from 'vitest'
import { comparePageImages, describePageComparison, type PdfInput, type PdfPageImage } from '../src/test/pdf'
import { comparePdfSnapshot, writeFailureArtifacts } from '../src/test/snapshot'

// The tolerance of every reviewed raster baseline. The baselines come from the
// pinned Linux image; renders on macOS and on the plain CI runners with the
// same glyph precision (see `COMPARES_REVIEWED_BASELINES`) differ from them by
// at most 2 of 255 in any channel, so no pixel passes the channel threshold
// there. The page ratio stays just above that: 0.01 % of
// an A4 page at scale 1 is 50 pixels, and a 1 pt shift of one short line of
// 11 pt text already changes 337 (`test/pdf-utils.test.ts`).
export const RASTER_THRESHOLDS = {
  channelThreshold: 8,
  maxChangedPixelRatio: 0.0001,
} as const

// pdf.js keeps glyph outlines in a Float16Array where the runtime has one
// (Node 24 and later, as in the pinned image) and in a Float32Array otherwise
// (Node 22). The glyph edges then differ by up to 60 of 255 in a channel on
// 0.01 to 0.02 % of a page, more than the tolerance allows. So the reviewed
// baselines are compared only on the Float16Array path; on Node 22 these tests
// still run every other assertion.
export const COMPARES_REVIEWED_BASELINES = 'Float16Array' in globalThis

/**
 * Asserts that a page matches its reviewed baseline, where the glyph precision
 * matches the baselines (`COMPARES_REVIEWED_BASELINES`). On a mismatch the message
 * gives the metrics, and `reports/pdf-snapshots/<name>/page-<n>` gets the
 * actual, expected and diff images (CI uploads that folder).
 */
export async function expectReviewedPage(actual: PdfPageImage, baseline: PdfPageImage, name: string): Promise<void> {
  if (!COMPARES_REVIEWED_BASELINES) return
  const comparison = comparePageImages(actual, baseline, RASTER_THRESHOLDS)
  if (!comparison.matches) {
    await writeFailureArtifacts(join(process.cwd(), 'reports', 'pdf-snapshots', name, `page-${actual.number}`), [{ actual, comparison, expected: baseline }], RASTER_THRESHOLDS)
  }
  expect(comparison.matches, `${name} page ${actual.number}: ${describePageComparison(comparison, RASTER_THRESHOLDS)}`).toBe(true)
}

/** `comparePdfSnapshot` with the same tolerance and glyph-precision rule. */
export async function expectReviewedSnapshot(input: PdfInput, baselineDir: string, scale: number): Promise<void> {
  if (!COMPARES_REVIEWED_BASELINES) return
  await comparePdfSnapshot(input, baselineDir, {
    channelThreshold: RASTER_THRESHOLDS.channelThreshold,
    scale,
    threshold: RASTER_THRESHOLDS.maxChangedPixelRatio,
  })
}
