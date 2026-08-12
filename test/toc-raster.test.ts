import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderTocDocument } from './fixtures/toc-document'
import {
  comparePageImages,
  decodePngPage,
  rasterizePdf,
} from '../src/test/pdf'

const baselineDirectory = fileURLToPath(
  new URL('./fixtures/baselines/toc', import.meta.url),
)
const baselineName = 'toc-page-1.png'
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  // Native renderers can vary slightly in text and dotted-line antialiasing.
  // Keep enough tolerance for that paint-only variance while the TOC
  // geometry and page-number assertions remain exact.
  maxChangedPixelRatio: 0.007,
} as const

describe('pinned Linux table-of-contents raster', () => {
  it('matches the reviewed TOC page baseline', async () => {
    const result = await renderTocDocument()
    const [tocPage] = await rasterizePdf(result.bytes)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
      await writeFile(`${baselineDirectory}/${baselineName}`, tocPage!.png)
    }

    const baselinePng = await readFile(`${baselineDirectory}/${baselineName}`)
    const baseline = await decodePngPage(baselinePng, 1)
    const regression = comparePageImages(tocPage!, baseline, rasterThresholds)

    if (!regression.matches) {
      const artifactDirectory = resolve('reports/pdf-snapshots/toc')
      await mkdir(artifactDirectory, { recursive: true })
      await Promise.all([
        writeFile(`${artifactDirectory}/actual.png`, tocPage!.png),
        writeFile(`${artifactDirectory}/expected.png`, baselinePng),
        writeFile(
          `${artifactDirectory}/metrics.json`,
          `${JSON.stringify(regression, null, 2)}\n`,
        ),
      ])
    }

    expect(regression, 'TOC page reviewed baseline mismatch').toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 30_000)
})
