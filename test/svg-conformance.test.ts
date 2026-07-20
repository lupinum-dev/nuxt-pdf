import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
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
import { createPdfFontStore } from '../src/runtime/server/fonts'
import { createReactSvgDocument } from './fixtures/react-svg'
import { VueSvgDocument } from './fixtures/vue-svg'
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
const baselineDirectory = fileURLToPath(new URL(
  './fixtures/baselines/svg',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

describe('React PDF SVG compatibility', () => {
  it('produces semantically and visually equivalent SVG output from React and Vue', async () => {
    ReactFont.register({ family: 'Roboto', src: fontPath })

    const reactBytes = new Uint8Array(await renderReactDocument(
      createReactSvgDocument(),
    ))

    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-svg-font-'))
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
      const mounted = await mountPdfComponent(VueSvgDocument)
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

    expect(reactPdf.pageCount).toBe(1)
    expect(vuePdf.pageCount).toBe(1)
    expect(vuePdf.pages.map(page => page.text)).toEqual(
      reactPdf.pages.map(page => page.text),
    )
    // The svg <Text>/<Tspan> content survives layout as extracted page text.
    expect(vuePdf.pages[0]?.text).toContain('Hello world')

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactBytes),
      rasterizePdf(vueResult.bytes),
    ])

    expect(vuePages).toHaveLength(reactPages.length)
    expect(vuePages).toHaveLength(1)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
    }

    const vuePage = vuePages[0]!
    const reactPage = reactPages[0]!

    const parity = comparePageImages(vuePage, reactPage, rasterThresholds)
    expect(parity, 'SVG React/Vue raster mismatch').toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })

    const baselinePath = join(baselineDirectory, 'vue-svg-page-1.png')
    if (updatePdfBaselines) {
      await writeFile(baselinePath, vuePage.png)
    }

    const baseline = await decodePngPage(
      await readFile(baselinePath),
      vuePage.number,
    )
    const regression = comparePageImages(vuePage, baseline, rasterThresholds)
    expect(regression, 'SVG reviewed baseline mismatch').toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 20_000)
})
