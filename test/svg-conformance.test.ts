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
import { defineComponent, h } from 'vue'
import {
  PdfDefs,
  PdfDocument,
  PdfLine,
  PdfLinearGradient,
  PdfPage,
  PdfRadialGradient,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
} from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { bundlePdfFonts } from '../src/build/fonts'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { createReactSvgDocument } from './fixtures/react-svg'
import { VueSvgDocument } from './fixtures/vue-svg'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  parsePdf,
  rasterizePdf,
} from '../src/test/pdf'

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

  it('renders numeric zero fill opacity as fully transparent', async () => {
    const ZeroOpacityDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [40, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 40 40',
            style: { height: 40, width: 40 },
          }, {
            default: () => h(PdfRect, {
              fill: '#ff0000',
              fillOpacity: 0,
              height: 40,
              width: 40,
            }),
          }),
        }),
      }))
    const mounted = await mountPdfComponent(ZeroOpacityDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      const center = ((20 * page!.width) + 20) * 4

      expect([...page!.pixels.slice(center, center + 4)]).toEqual([
        255,
        255,
        255,
        255,
      ])
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('renders direct SVG text fill instead of the default black', async () => {
    const ColoredTextDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [80, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 80 40',
            style: { height: 40, width: 80 },
          }, {
            default: () => h(PdfText, {
              fill: '#ff0000',
              style: { fontSize: 28 },
              x: 8,
              y: 30,
            }, () => 'PDF'),
          }),
        }),
      }))
    const mounted = await mountPdfComponent(ColoredTextDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      let redPixels = 0

      for (let index = 0; index < page!.pixels.length; index += 4) {
        const red = page!.pixels[index]!
        const green = page!.pixels[index + 1]!
        const blue = page!.pixels[index + 2]!
        if (red > 180 && green < 120 && blue < 120) redPixels += 1
      }

      expect(redPixels).toBeGreaterThan(20)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('renders numeric zero stroke width as no stroke', async () => {
    const ZeroStrokeDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [40, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 40 40',
            style: { height: 40, width: 40 },
          }, {
            default: () => h(PdfLine, {
              stroke: '#ff0000',
              strokeWidth: 0,
              x1: 0,
              x2: 40,
              y1: 20,
              y2: 20,
            }),
          }),
        }),
      }))
    const mounted = await mountPdfComponent(ZeroStrokeDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      const center = ((20 * page!.width) + 20) * 4

      expect([...page!.pixels.slice(center, center + 4)]).toEqual([
        255,
        255,
        255,
        255,
      ])
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('paints SVG strokes with their authored stroke opacity', async () => {
    const TranslucentStrokeDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [40, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 40 40',
            style: { height: 40, width: 40 },
          }, {
            default: () => h(PdfLine, {
              stroke: '#ff0000',
              strokeOpacity: 0.25,
              strokeWidth: 10,
              x1: 0,
              x2: 40,
              y1: 20,
              y2: 20,
            }),
          }),
        }),
      }))
    const mounted = await mountPdfComponent(TranslucentStrokeDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      const center = ((20 * page!.width) + 20) * 4
      const pixel = [...page!.pixels.slice(center, center + 4)]

      expect(pixel[0]).toBeGreaterThan(245)
      expect(pixel[1]).toBeGreaterThan(175)
      expect(pixel[1]).toBeLessThan(205)
      expect(pixel[2]).toBeGreaterThan(175)
      expect(pixel[2]).toBeLessThan(205)
      expect(pixel[3]).toBe(255)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('preserves explicit numeric zero gradient coordinates', async () => {
    const ZeroGradientDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [40, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 40 40',
            style: { height: 40, width: 40 },
          }, {
            default: () => [
              h(PdfDefs, null, {
                default: () => h(PdfLinearGradient, {
                  id: 'zero-axis',
                  x1: 0.5,
                  x2: 0,
                  y1: 0,
                  y2: 0,
                }, {
                  default: () => [
                    h(PdfStop, { offset: 0, stopColor: '#ff0000' }),
                    h(PdfStop, { offset: 1, stopColor: '#0000ff' }),
                  ],
                }),
              }),
              h(PdfRect, {
                fill: 'url(#zero-axis)',
                height: 40,
                width: 40,
              }),
            ],
          }),
        }),
      }))
    const mounted = await mountPdfComponent(ZeroGradientDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      const left = ((20 * page!.width) + 4) * 4
      const right = ((20 * page!.width) + 36) * 4
      const leftPixel = page!.pixels.slice(left, left + 4)
      const rightPixel = page!.pixels.slice(right, right + 4)

      expect(leftPixel[2]).toBeGreaterThan(leftPixel[0]!)
      expect(rightPixel[0]).toBeGreaterThan(rightPixel[2]!)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)

  it('preserves explicit numeric zero radial focus and radius', async () => {
    const ZeroRadialDocument = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: [80, 40],
          style: { padding: 0 },
        }, {
          default: () => h(PdfSvg, {
            viewBox: '0 0 80 40',
            style: { height: 40, width: 80 },
          }, {
            default: () => [
              h(PdfDefs, null, {
                default: () => [
                  h(PdfRadialGradient, {
                    id: 'zero-focus',
                    cx: 0,
                    cy: 0,
                    fx: 0,
                    fy: 0,
                    r: 0.8,
                  }, {
                    default: () => [
                      h(PdfStop, { offset: 0, stopColor: '#00ff00' }),
                      h(PdfStop, { offset: 1, stopColor: '#000000' }),
                    ],
                  }),
                  h(PdfRadialGradient, {
                    id: 'zero-radius',
                    cx: 0.5,
                    cy: 0.5,
                    r: 0,
                  }, {
                    default: () => [
                      h(PdfStop, { offset: 0, stopColor: '#ff0000' }),
                      h(PdfStop, { offset: 1, stopColor: '#0000ff' }),
                    ],
                  }),
                ],
              }),
              h(PdfRect, {
                fill: 'url(#zero-focus)',
                height: 40,
                width: 40,
              }),
              h(PdfRect, {
                fill: 'url(#zero-radius)',
                height: 40,
                width: 40,
                x: 40,
              }),
            ],
          }),
        }),
      }))
    const mounted = await mountPdfComponent(ZeroRadialDocument)

    try {
      const result = await renderDocument(
        mounted.document as unknown as DocumentNode,
      )
      const [page] = await rasterizePdf(result.bytes)
      const pixel = (x: number, y: number) => {
        const index = ((y * page!.width) + x) * 4
        return page!.pixels.slice(index, index + 4)
      }
      const focus = pixel(2, 2)
      const awayFromFocus = pixel(20, 20)
      const zeroRadiusCenter = pixel(60, 20)
      const zeroRadiusEdge = pixel(76, 20)

      expect(focus[1]).toBeGreaterThan(focus[0]!)
      expect(focus[1]).toBeGreaterThan(focus[2]!)
      expect(focus[1]).toBeGreaterThan(awayFromFocus[1]!)
      expect(zeroRadiusCenter[2]).toBeGreaterThan(zeroRadiusCenter[0]!)
      expect(zeroRadiusEdge[2]).toBeGreaterThan(zeroRadiusEdge[0]!)
    }
    finally {
      mounted.unmount()
    }
  }, 20_000)
})
