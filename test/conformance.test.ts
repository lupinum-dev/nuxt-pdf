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
import type { DocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../src/runtime/renderer'
import { bundlePdfFonts } from '../src/build/fonts'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { createReactConformanceDocument } from './fixtures/react-conformance'
import { VueConformanceDocument } from './fixtures/vue-conformance'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from './utils/pdf'

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
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const
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

describe('React PDF compatibility', () => {
  it('produces semantically and visually equivalent output from React and Vue', async () => {
    ReactFont.register({ family: 'Roboto', src: fontPath })

    const reactBytes = new Uint8Array(await renderReactDocument(
      createReactConformanceDocument({ imagePath }),
    ))

    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-font-'))
    const fontRoot = join(temporaryRoot, 'pdfs/fonts')
    const bundledFontPath = join(fontRoot, 'Roboto-Regular.ttf')
    await mkdir(dirname(bundledFontPath), { recursive: true })
    await copyFile(fontPath, bundledFontPath)

    let vueResult: Awaited<ReturnType<typeof renderDocument>>
    try {
      const fonts = await bundlePdfFonts(
        [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
        { fontRoots: [fontRoot] },
      )
      const mounted = await mountPdfComponent(VueConformanceDocument, {
        imagePath,
        showConditional: true,
      })
      try {
        vueResult = await renderDocument(
          mounted.document as unknown as DocumentNode,
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

    expect(hasPdfHeader(reactBytes)).toBe(true)
    expect(hasPdfHeader(vueResult.bytes)).toBe(true)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(reactBytes),
      parsePdf(vueResult.bytes),
    ])

    expect(reactPdf.pageCount).toBe(2)
    expect(vuePdf.pageCount).toBe(2)
    expect(vuePdf.pages.map(page => page.text)).toEqual(
      reactPdf.pages.map(page => page.text),
    )

    const reactLinks = reactPdf.pages.flatMap(page => page.annotations)
      .filter(annotation => annotation.subtype === 'Link')
    const vueLinks = vuePdf.pages.flatMap(page => page.annotations)
      .filter(annotation => annotation.subtype === 'Link')

    expect(vueLinks).toEqual(reactLinks)
    expect(vueLinks).toContainEqual(expect.objectContaining({
      unsafeUrl: 'https://nuxt.com',
      url: 'https://nuxt.com/',
    }))

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactBytes),
      rasterizePdf(vueResult.bytes),
    ])

    expect(vuePages).toHaveLength(reactPages.length)
    expect(vuePages).toHaveLength(pageSemantics.length)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
    }

    for (const [index, reactPage] of reactPages.entries()) {
      const vuePage = vuePages[index]!
      const semantics = pageSemantics[index]!

      for (const text of semantics.includes) {
        expect(vuePdf.pages[index]?.text).toContain(text)
      }
      for (const text of semantics.excludes) {
        expect(vuePdf.pages[index]?.text).not.toContain(text)
      }

      const parity = comparePageImages(vuePage, reactPage, rasterThresholds)
      expect(parity, `page ${index + 1} React/Vue raster mismatch`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })

      const baselineName = `vue-conformance-page-${index + 1}.png`
      const baselinePath = join(baselineDirectory, baselineName)
      if (updatePdfBaselines) {
        await writeFile(baselinePath, vuePage.png)
      }

      const baseline = await decodePngPage(
        await readFile(baselinePath),
        vuePage.number,
      )
      const regression = comparePageImages(vuePage, baseline, rasterThresholds)
      expect(regression, `page ${index + 1} reviewed baseline mismatch`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })
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
