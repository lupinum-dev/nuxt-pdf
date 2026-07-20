import { fileURLToPath } from 'node:url'
import type { DocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../src/runtime/renderer'
import {
  FontStore,
  renderDocument,
} from '../src/runtime/server/engine/render-document'
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

    const mounted = await mountPdfComponent(VueConformanceDocument, {
      imagePath,
      showConditional: true,
    })
    const fontStore = new FontStore()
    fontStore.register({ family: 'Roboto', src: fontPath })
    const vueResult = await renderDocument(
      mounted.document as unknown as DocumentNode,
      { fontStore },
    )
    mounted.unmount()

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
