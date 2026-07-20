import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PdfAssertionError } from './expect'
import {
  comparePageImages,
  decodePngPage,
  rasterizePdf,
  type PageImageComparison,
  type PdfInput,
} from './pdf'

export interface ComparePdfSnapshotOptions {
  /** Maximum ratio of changed pixels allowed per page (default 0.005). */
  threshold?: number
  /** Maximum per-channel RGBA difference for a matching pixel (default 25). */
  channelThreshold?: number
  /** Raster scale (default 1). */
  scale?: number
  /**
   * Write the current render as the reviewed baseline instead of comparing.
   * Defaults to `process.env.UPDATE_PDF_BASELINES === '1'`.
   */
  update?: boolean
}

export interface PdfSnapshotResult {
  /** Whether the render matched the reviewed baseline. */
  matches: boolean
  /** Whether the baseline was (re)written this run. */
  updated: boolean
  /** Per-page comparison detail (empty when the baseline was written). */
  pages: PageImageComparison[]
}

const pageFileName = (pageNumber: number): string => `page-${pageNumber}.png`

const isPageBaseline = (name: string): boolean => /^page-\d+\.png$/.test(name)

/**
 * Compare a rendered PDF against a directory of reviewed per-page PNG baselines,
 * following the `UPDATE_PDF_BASELINES` review policy. With `update` (or the env
 * flag) set, it (re)writes the baselines and returns; otherwise it rasterizes the
 * document, checks every page against `baselineDir/page-N.png`, and throws a
 * `PdfAssertionError` on any mismatch.
 */
export async function comparePdfSnapshot(
  input: PdfInput,
  baselineDir: string,
  options: ComparePdfSnapshotOptions = {},
): Promise<PdfSnapshotResult> {
  const update = options.update ?? process.env.UPDATE_PDF_BASELINES === '1'
  const thresholds = {
    channelThreshold: options.channelThreshold ?? 25,
    maxChangedPixelRatio: options.threshold ?? 0.005,
  } as const

  const pages = await rasterizePdf(input, { scale: options.scale ?? 1 })

  if (update) {
    await mkdir(baselineDir, { recursive: true })
    const stale = (await readdir(baselineDir).catch(() => []))
      .filter(name => isPageBaseline(name))
    const kept = new Set(pages.map(page => pageFileName(page.number)))
    await Promise.all([
      ...pages.map(page => writeFile(join(baselineDir, pageFileName(page.number)), page.png)),
      ...stale
        .filter(name => !kept.has(name))
        .map(name => rm(join(baselineDir, name))),
    ])
    return { matches: true, updated: true, pages: [] }
  }

  const baselineNames = (await readdir(baselineDir).catch(() => {
    throw new PdfAssertionError(
      `No reviewed PDF baseline found at ${JSON.stringify(baselineDir)}. `
      + `Create it by running with UPDATE_PDF_BASELINES=1.`,
    )
  })).filter(isPageBaseline).sort()

  if (baselineNames.length !== pages.length) {
    throw new PdfAssertionError(
      `Rendered ${pages.length} page(s) but the baseline in ${JSON.stringify(baselineDir)} `
      + `has ${baselineNames.length}. Re-run with UPDATE_PDF_BASELINES=1 if this change is intended.`,
    )
  }

  const comparisons: PageImageComparison[] = []

  for (const page of pages) {
    const baselinePath = join(baselineDir, pageFileName(page.number))
    const baseline = await decodePngPage(await readFile(baselinePath), page.number)
    const comparison = comparePageImages(page, baseline, thresholds)
    comparisons.push(comparison)

    if (!comparison.matches) {
      throw new PdfAssertionError(
        `Page ${page.number} does not match its reviewed baseline (${baselinePath}): `
        + `${comparison.changedPixels}/${comparison.totalPixels} pixels changed `
        + `(ratio ${comparison.changedPixelRatio.toFixed(4)}, max channel diff `
        + `${comparison.maxChannelDifference}, dimensions match: ${comparison.dimensionsMatch}). `
        + `Re-run with UPDATE_PDF_BASELINES=1 if this change is intended.`,
      )
    }
  }

  return { matches: true, updated: false, pages: comparisons }
}
