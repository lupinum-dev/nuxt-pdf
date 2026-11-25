import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../src/runtime/renderer'
import { bundlePdfFonts } from '../src/build/fonts'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { VueConformanceDocument } from './fixtures/vue-conformance'
import {
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from '../src/test/pdf'
import { expectReviewedPage } from './raster'

const fontPath = fileURLToPath(new URL(
  './fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const imagePath = fileURLToPath(new URL(
  './fixtures/assets/sample.png',
  import.meta.url,
))
const baselineDirectory = fileURLToPath(new URL(
  './fixtures/baselines',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const pageSemantics = [
  {
    includes: [
      'Renderer conformance',
      'Conditional approval included',
      'Page 1 of 2',
    ],
    excludes: ['Explicit second page'],
  },
  {
    includes: [
      'Explicit second page',
      'Nuxt documentation',
      'Page 2 of 2',
    ],
    excludes: ['Conditional approval included'],
  },
] as const

describe('renderer conformance', () => {
  it('renders the mixed document with its text, links and reviewed pages', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-font-'))
    const fontRoot = join(temporaryRoot, 'pdfs/fonts')
    const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
    await mkdir(dirname(bundledFontPath), { recursive: true })
    await copyFile(fontPath, bundledFontPath)

    let vueResult: Awaited<ReturnType<typeof renderPlainDocument>>
    try {
      const fonts = await bundlePdfFonts(
        [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
        { fontRoots: [fontRoot] },
      )
      const mounted = await mountPdfComponent(VueConformanceDocument, {
        image: await readFile(imagePath),
        showConditional: true,
      })
      try {
        vueResult = await renderPlainDocument(mounted.document,
          { fontStore: createPdfFontStore(fonts) },
        )
      }
      finally {
        mounted.unmount()
      }
    }
    finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }

    expect(hasPdfHeader(vueResult.bytes)).toBe(true)

    const vuePdf = await parsePdf(vueResult.bytes)
    expect(vuePdf.pageCount).toBe(2)
    // Page 1 keeps "readable" whole: ragged lines stretch at their ends (D42).
    expect(vuePdf.pages[0]!.text).toContain('while keeping the fixture readable.')
    expect(vuePdf.pages[1]!.text).toBe('NUXT PDF / COMPATIBILITY KERNEL Explicit second page This marker must begin on page two. It proves explicit breaking and fixed-element repetition. Nuxt documentation Page 2 of 2')
    const vueLinks = vuePdf.pages.flatMap(page => page.annotations)
      .filter(annotation => annotation.subtype === 'Link')
    expect(vueLinks).toEqual([
      { annotationType: 2, rect: [42, 692.471, 553.28, 705.362], subtype: 'Link', unsafeUrl: 'https://nuxt.com', url: 'https://nuxt.com/' },
    ])

    const vuePages = await rasterizePdf(vueResult.bytes)
    expect(vuePages).toHaveLength(pageSemantics.length)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
    }

    for (const [index, vuePage] of vuePages.entries()) {
      const semantics = pageSemantics[index]!

      for (const text of semantics.includes) {
        expect(vuePdf.pages[index]?.text).toContain(text)
      }
      for (const text of semantics.excludes) {
        expect(vuePdf.pages[index]?.text).not.toContain(text)
      }

      const baselineName = `vue-conformance-page-${index + 1}.png`
      const baselinePath = join(baselineDirectory, baselineName)
      if (updatePdfBaselines) {
        await writeFile(baselinePath, vuePage.png)
      }

      const baseline = await decodePngPage(
        await readFile(baselinePath),
        vuePage.number,
      )
      await expectReviewedPage(vuePage, baseline, 'conformance')
    }

    const expectedBaselineNames = vuePages.map(
      (_, index) => `vue-conformance-page-${index + 1}.png`,
    )
    const actualBaselineNames = (await readdir(baselineDirectory))
      .filter(name => name.endsWith('.png'))
      .sort()
    expect(actualBaselineNames).toEqual(expectedBaselineNames)
  }, 20_000)
})
