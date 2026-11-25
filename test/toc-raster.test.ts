import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderTocDocument } from './fixtures/toc-document'
import {
  decodePngPage,
  rasterizePdf,
} from '../src/test/pdf'
import { COMPARES_REVIEWED_BASELINES, expectReviewedPage } from './raster'

const baselineDirectory = fileURLToPath(
  new URL('./fixtures/baselines/toc', import.meta.url),
)
const baselineName = 'toc-page-1.png'
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

describe('pinned Linux table-of-contents raster', () => {
  it('matches the reviewed TOC page baseline', async () => {
    // The pinned image made the baselines, so it must compare them.
    expect(COMPARES_REVIEWED_BASELINES).toBe(true)
    const result = await renderTocDocument()
    const [tocPage] = await rasterizePdf(result.bytes)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
      await writeFile(`${baselineDirectory}/${baselineName}`, tocPage!.png)
    }

    const baselinePng = await readFile(`${baselineDirectory}/${baselineName}`)
    const baseline = await decodePngPage(baselinePng, 1)
    await expectReviewedPage(tocPage!, baseline, 'toc')
  }, 30_000)
})
