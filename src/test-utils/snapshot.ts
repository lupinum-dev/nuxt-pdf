import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PdfAssertionError } from './expect'
import {
  comparePageImages,
  decodePngPage,
  encodePngPage,
  rasterizePdf,
  type PageImageComparison,
  type PdfInput,
  type PdfPageImage,
} from './pdf'

export interface ComparePdfSnapshotOptions {
  /** Directory for expected, actual, diff, and JSON failure artifacts. */
  artifactDir?: string
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

const differenceImage = (
  actual: PdfPageImage,
  expected: PdfPageImage,
): PdfPageImage => {
  const width = Math.max(actual.width, expected.width)
  const height = Math.max(actual.height, expected.height)
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const output = (y * width + x) * 4
      const actualOffset = (y * actual.width + x) * 4
      const expectedOffset = (y * expected.width + x) * 4
      const inActual = x < actual.width && y < actual.height
      const inExpected = x < expected.width && y < expected.height

      if (!inActual || !inExpected) {
        pixels.set([255, 0, 0, 255], output)
        continue
      }

      const difference = Math.max(
        ...[0, 1, 2, 3].map(channel => Math.abs(
          actual.pixels[actualOffset + channel]!
          - expected.pixels[expectedOffset + channel]!,
        )),
      )
      const intensity = Math.min(255, difference * 4)
      pixels.set([255, 255 - intensity, 255 - intensity, 255], output)
    }
  }

  return { height, number: actual.number, pixels, png: new Uint8Array(), width }
}

const writeFailureArtifacts = async (
  artifactDir: string,
  failures: readonly {
    actual: PdfPageImage
    comparison: PageImageComparison
    expected: PdfPageImage
  }[],
  thresholds: { channelThreshold: number, maxChangedPixelRatio: number },
): Promise<void> => {
  await rm(artifactDir, { force: true, recursive: true })
  await mkdir(artifactDir, { recursive: true })
  await Promise.all(failures.flatMap(({ actual, expected }) => {
    const page = `page-${actual.number}`
    return [
      writeFile(join(artifactDir, `${page}-actual.png`), actual.png),
      writeFile(join(artifactDir, `${page}-expected.png`), expected.png),
      writeFile(
        join(artifactDir, `${page}-diff.png`),
        encodePngPage(differenceImage(actual, expected)),
      ),
    ]
  }))
  await writeFile(join(artifactDir, 'metrics.json'), `${JSON.stringify({
    pages: failures.map(({ actual, comparison }) => ({
      page: actual.number,
      ...comparison,
    })),
    thresholds,
  }, null, 2)}\n`)
}

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
  const artifactDir = options.artifactDir
    ?? join(process.cwd(), 'reports', 'pdf-snapshots', basename(baselineDir))

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
  const failures: Array<{
    actual: PdfPageImage
    comparison: PageImageComparison
    expected: PdfPageImage
  }> = []

  for (const page of pages) {
    const baselinePath = join(baselineDir, pageFileName(page.number))
    const baseline = await decodePngPage(await readFile(baselinePath), page.number)
    const comparison = comparePageImages(page, baseline, thresholds)
    comparisons.push(comparison)

    if (!comparison.matches) {
      failures.push({ actual: page, comparison, expected: baseline })
    }
  }

  if (failures.length > 0) {
    await writeFailureArtifacts(artifactDir, failures, thresholds)
    throw new PdfAssertionError(
      `${failures.length} page(s) do not match their reviewed baselines. `
      + `Expected, actual, diff, and metrics artifacts were written to ${JSON.stringify(artifactDir)}. `
      + `Re-run with UPDATE_PDF_BASELINES=1 if this change is intended.`,
    )
  }

  return { matches: true, updated: false, pages: comparisons }
}
