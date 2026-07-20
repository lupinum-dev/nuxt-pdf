import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
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
import { createReactConformanceDocument } from './fixtures/react-conformance'
import { VueConformanceDocument } from './fixtures/vue-conformance'
import {
  comparePageImages,
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
    expect(vuePdf.pages[0]?.text).toContain('Conditional approval included')
    expect(vuePdf.pages[0]?.text).toContain('Page 1 of 2')
    expect(vuePdf.pages[0]?.text).not.toContain('Explicit second page')
    expect(vuePdf.pages[1]?.text).toContain('Explicit second page')
    expect(vuePdf.pages[1]?.text).toContain('Page 2 of 2')

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

    for (const [index, reactPage] of reactPages.entries()) {
      const comparison = comparePageImages(vuePages[index]!, reactPage)
      expect(comparison, `page ${index + 1} raster mismatch`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })
    }
  }, 20_000)
})
