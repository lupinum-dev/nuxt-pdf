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
import type { Component } from 'vue'
import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import {
  Font as ReactFont,
  renderToBuffer as renderReactDocument,
} from '@react-pdf/renderer'
import { beforeAll, describe, expect, it } from 'vitest'
import { mountPdfComponent } from '../../src/runtime/renderer'
import { bundlePdfFonts } from '../../src/build/fonts'
import { renderDocument } from '../../src/runtime/server/engine/render-document'
import { createPdfFontStore, type PdfFontStore } from '../../src/runtime/server/engine/fonts'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from '../utils/pdf'
import {
  createReactFixedHeaderDocument,
  createReactObjectFitDocument,
  createReactSourcesDocument,
} from '../fixtures/corpus/images-react'
import {
  VueFixedHeaderDocument,
  VueObjectFitDocument,
  VueSourcesDocument,
} from '../fixtures/corpus/images-vue'
import {
  headerLabelText,
  imageDims,
  objectFitBoxSize,
  sizing,
} from '../fixtures/corpus/images-data'

const fontPath = fileURLToPath(new URL(
  '../fixtures/assets/Roboto-Regular.ttf',
  import.meta.url,
))
const jpegPath = fileURLToPath(new URL(
  '../fixtures/corpus/images-sample.jpg',
  import.meta.url,
))
const baselineDirectory = fileURLToPath(new URL(
  '../fixtures/corpus',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const
// Explicit-dimension boxes must land on their exact points; percent/aspect boxes
// carry rounding from the container resolution, so allow a sub-point tolerance.
const BOX_TOLERANCE = 0.75

// Minimal read-only view of the laid-out tree. The engine returns a
// SafeDocumentNode whose element nodes carry a resolved `box`; IMAGE leaves keep
// no `children` array. Walking it is how the sizing/repetition claims become
// assertions on geometry rather than on pixels.
interface LayoutBox {
  width?: number
  height?: number
  left?: number
  top?: number
}
interface LayoutNode {
  type?: string
  box?: LayoutBox
  children?: LayoutNode[]
}

const asLayout = (layout: SafeDocumentNode): LayoutNode =>
  layout as unknown as LayoutNode

const pagesOf = (layout: SafeDocumentNode): LayoutNode[] =>
  asLayout(layout).children ?? []

const collectImageBoxes = (node: LayoutNode): LayoutBox[] => {
  const boxes: LayoutBox[] = []
  const visit = (current: LayoutNode): void => {
    if (current.type === 'IMAGE' && current.box) boxes.push(current.box)
    for (const child of current.children ?? []) visit(child)
  }
  visit(node)
  return boxes
}

let fonts: Awaited<ReturnType<typeof bundlePdfFonts>>

const renderVue = async (
  component: Component,
): Promise<{ bytes: Uint8Array, layout: SafeDocumentNode }> => {
  const mounted = await mountPdfComponent(component, { jpegPath })
  try {
    const fontStore: PdfFontStore = createPdfFontStore(fonts)
    return await renderDocument(
      mounted.document as unknown as DocumentNode,
      { fontStore },
    )
  }
  finally {
    mounted.unmount()
  }
}

const renderReact = async (
  element: Parameters<typeof renderReactDocument>[0],
): Promise<Uint8Array> => new Uint8Array(await renderReactDocument(element))

const expectRasterParity = (
  actual: Awaited<ReturnType<typeof rasterizePdf>>,
  expected: Awaited<ReturnType<typeof rasterizePdf>>,
  label: string,
): void => {
  expect(actual).toHaveLength(expected.length)
  for (const [index, expectedPage] of expected.entries()) {
    const parity = comparePageImages(actual[index]!, expectedPage, rasterThresholds)
    expect(parity, `${label} page ${index + 1} React/Vue raster mismatch`).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }
}

const assertReviewedBaseline = async (
  page: Awaited<ReturnType<typeof rasterizePdf>>[number],
  baselineName: string,
): Promise<void> => {
  const baselinePath = join(baselineDirectory, baselineName)
  if (updatePdfBaselines) {
    await mkdir(baselineDirectory, { recursive: true })
    await writeFile(baselinePath, page.png)
  }
  const baseline = await decodePngPage(await readFile(baselinePath), page.number)
  const regression = comparePageImages(page, baseline, rasterThresholds)
  expect(regression, `${baselineName} reviewed baseline mismatch`).toMatchObject({
    dimensionsMatch: true,
    matches: true,
    pageNumbersMatch: true,
  })
}

const near = (actual: number | undefined, expected: number, label: string): void => {
  expect(actual, label).toBeTypeOf('number')
  expect(Math.abs((actual ?? Number.NaN) - expected), `${label}: ${actual} vs ${expected}`)
    .toBeLessThanOrEqual(BOX_TOLERANCE)
}

describe('React PDF image conformance', () => {
  beforeAll(async () => {
    ReactFont.register({ family: 'Roboto', src: fontPath })
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-images-font-'))
    const bundledFontPath = join(temporaryRoot, 'pdfs/fonts/Roboto-Regular.ttf')
    await mkdir(dirname(bundledFontPath), { recursive: true })
    await copyFile(fontPath, bundledFontPath)
    fonts = await bundlePdfFonts(
      [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }],
      { fontRoots: [join(temporaryRoot, 'pdfs/fonts')] },
    )
    await rm(temporaryRoot, { force: true, recursive: true })
  })

  it('renders JPEG, data-URL and buffer sources with correct sizing geometry', async () => {
    const reactBytes = await renderReact(createReactSourcesDocument({ jpegPath }))
    const vue = await renderVue(VueSourcesDocument)

    expect(hasPdfHeader(reactBytes)).toBe(true)
    expect(hasPdfHeader(vue.bytes)).toBe(true)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(reactBytes),
      parsePdf(vue.bytes),
    ])
    expect(vuePdf.pageCount).toBe(1)
    expect(reactPdf.pageCount).toBe(1)
    expect(vuePdf.pages.map(page => page.text)).toEqual(
      reactPdf.pages.map(page => page.text),
    )

    // Geometry oracle: read the three laid-out image boxes and check each sizing
    // mode against a value computed from the intrinsic ratios and the page box.
    const page = pagesOf(vue.layout)[0]!
    const boxes = collectImageBoxes(page)
    expect(boxes).toHaveLength(3)

    const [jpegBox, pngAspectBox, pngPercentBox] = boxes as [LayoutBox, LayoutBox, LayoutBox]

    // (4a) explicit width + height wins regardless of the 3:2 intrinsic ratio.
    near(jpegBox.width, sizing.jpegExplicit.width, 'jpeg explicit width')
    near(jpegBox.height, sizing.jpegExplicit.height, 'jpeg explicit height')

    // (4b) single-dimension width → height derived from the PNG's 2:1 ratio.
    near(pngAspectBox.width, sizing.pngWidth, 'png aspect width')
    near(pngAspectBox.height, sizing.pngWidth / imageDims.png.ratio, 'png aspect height')

    // (4c) percent width resolves against the page content box; height follows ratio.
    const pageBox = page.box!
    const contentWidth = (pageBox.width ?? 0)
      - ((pageBox as Record<string, number>).paddingLeft ?? 0)
      - ((pageBox as Record<string, number>).paddingRight ?? 0)
    const expectedPercentWidth = contentWidth * sizing.pngPercentFraction
    expect(expectedPercentWidth).toBeGreaterThan(0)
    near(pngPercentBox.width, expectedPercentWidth, 'png percent width')
    near(pngPercentBox.height, expectedPercentWidth / imageDims.png.ratio, 'png percent height')

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactBytes),
      rasterizePdf(vue.bytes),
    ])
    expectRasterParity(vuePages, reactPages, 'sources')
    await assertReviewedBaseline(vuePages[0]!, 'images-sources-baseline-page-1.png')
  }, 20_000)

  it('crops with objectFit cover and letterboxes with contain', async () => {
    const reactBytes = await renderReact(createReactObjectFitDocument({ jpegPath }))
    const vue = await renderVue(VueObjectFitDocument)

    expect(hasPdfHeader(vue.bytes)).toBe(true)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(reactBytes),
      parsePdf(vue.bytes),
    ])
    expect(vuePdf.pageCount).toBe(1)
    expect(vuePdf.pages.map(page => page.text)).toEqual(
      reactPdf.pages.map(page => page.text),
    )

    // objectFit changes pixels, not layout: both boxes stay the fixed square.
    const boxes = collectImageBoxes(pagesOf(vue.layout)[0]!)
    expect(boxes).toHaveLength(2)
    for (const [index, box] of boxes.entries()) {
      near(box.width, objectFitBoxSize, `objectFit box ${index} width`)
      near(box.height, objectFitBoxSize, `objectFit box ${index} height`)
    }

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactBytes),
      rasterizePdf(vue.bytes),
    ])
    expectRasterParity(vuePages, reactPages, 'objectFit')
    // Cropping vs letterboxing is the actual claim, so it gets a reviewed baseline.
    await assertReviewedBaseline(vuePages[0]!, 'images-objectfit-baseline-page-1.png')
  }, 20_000)

  it('repeats a fixed-header image on every page', async () => {
    const reactBytes = await renderReact(createReactFixedHeaderDocument({ jpegPath }))
    const vue = await renderVue(VueFixedHeaderDocument)

    expect(hasPdfHeader(vue.bytes)).toBe(true)

    const [reactPdf, vuePdf] = await Promise.all([
      parsePdf(reactBytes),
      parsePdf(vue.bytes),
    ])
    expect(reactPdf.pageCount).toBe(2)
    expect(vuePdf.pageCount).toBe(2)
    expect(vuePdf.pages.map(page => page.text)).toEqual(
      reactPdf.pages.map(page => page.text),
    )

    // The fixed header label repeats on both pages; the unique body text does not.
    expect(vuePdf.pages[0]?.text).toContain(headerLabelText)
    expect(vuePdf.pages[1]?.text).toContain(headerLabelText)
    expect(vuePdf.pages[0]?.text).not.toContain('Second page body')
    expect(vuePdf.pages[1]?.text).not.toContain('First page body')

    // Geometry claim: exactly one image node laid out on each page.
    const imagesPerPage = pagesOf(vue.layout).map(page => collectImageBoxes(page).length)
    expect(imagesPerPage).toEqual([1, 1])

    const [reactPages, vuePages] = await Promise.all([
      rasterizePdf(reactBytes),
      rasterizePdf(vue.bytes),
    ])
    expect(vuePages).toHaveLength(2)
    expectRasterParity(vuePages, reactPages, 'fixed-header')
  }, 20_000)
})
