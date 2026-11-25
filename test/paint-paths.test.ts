import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { rasterizePdf } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { readPdf, type Paint } from './invariants/document'

// Paint paths that no other test reaches.
// Each document checks where its paint lands; while the old painter exists,
// `NUXT_PDF_PAINT_ORACLE=1` also compares its bytes with the old painter's.

const { PdfClipPath, PdfDefs, PdfDocument, PdfImage, PdfLinearGradient, PdfLink, PdfPage, PdfPath, PdfRadialGradient, PdfRect, PdfStop, PdfSvg, PdfText, PdfView } = PDF_COMPONENTS

/** 48 × 32 pixels, so 48 × 32 points. */
const JPEG = new Uint8Array(readFileSync('test/fixtures/corpus/images-sample.jpg'))
const PAGE = 200

const render = async (content: () => VNode[]): Promise<Uint8Array> => (await renderPreparedPdfTemplate(
  defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: [PAGE, PAGE] }, content))),
  {},
)).bytes

/** A box from the page's top left, y down, as PDF space reports it. */
const fromTop = (left: number, top: number, width: number, height: number): Paint['rect'] =>
  [left, PAGE - top - height, left + width, PAGE - top]

describe('paint paths', () => {
  it.each([
    ['none', 100, fromTop(26, 34, 48, 32)],
    ['scale-down', 100, fromTop(26, 34, 48, 32)],
    ['scale-down', 24, fromTop(0, 4, 24, 16)],
  ] as const)('places an image with objectFit %s in a %d pt box', async (objectFit, size, expected) => {
    const bytes = await render(() => [h(PdfImage, { src: JPEG, style: { width: size, height: size, objectFit } })])
    const { details } = await readPdf(bytes, undefined, { details: true })
    expect(details!.images).toHaveLength(1)
    details!.images[0]!.rect.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 3))
  })

  // Catches objectPosition that is dropped (the image stays centred), a
  // keyword on the wrong axis, keywords in CSS's other order, and a length
  // read as a share of the free space. The 48 × 32 image leaves 52 × 68
  // points free in the 100 pt box.
  it.each([
    ['left top', fromTop(0, 0, 48, 32)],
    ['top left', fromTop(0, 0, 48, 32)],
    ['bottom', fromTop(26, 68, 48, 32)],
    ['right 10pt', fromTop(52, 10, 48, 32)],
    ['25% 5mm', fromTop(13, 14.173, 48, 32)],
    [10, fromTop(10, 34, 48, 32)],
  ] as const)('places an image with objectPosition %j', async (objectPosition, expected) => {
    const bytes = await render(() => [h(PdfImage, { src: JPEG, style: { width: 100, height: 100, objectFit: 'none', objectPosition } })])
    const { details } = await readPdf(bytes, undefined, { details: true })
    details!.images[0]!.rect.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 3))
  })

  /** A 200 × 200 SVG at the page's top left, one unit per point. */
  const svg = (children: () => VNode[]) => render(() => [h(PdfSvg, { width: PAGE, height: PAGE, viewBox: `0 0 ${PAGE} ${PAGE}` }, children)])
  const fillsOf = async (bytes: Uint8Array) => (await readPdf(bytes, undefined, { details: true })).details!.fills

  it.each([
    ['M10 10 h50 v30 h-50 z'],
    ['M10 10 H60 V40 H10 Z'],
    ['m10 10 l50 0 l0 30 l-50 0 z'],
  ])('draws the straight path %s', async (d) => {
    const fills = await fillsOf(await svg(() => [h(PdfPath, { d, fill: '#000000' })]))
    expect(fills).toHaveLength(1)
    fills[0]!.rect.forEach((value, index) => expect(value).toBeCloseTo(fromTop(10, 10, 50, 30)[index]!, 3))
  })

  it.each([
    ['M10 40 C10 10 60 10 60 40 S110 70 110 40'],
    ['M10 40 c0 -30 50 -30 50 0 s50 30 50 0'],
    ['M10 40 Q35 10 60 40 T110 40'],
    ['M10 40 q25 -30 50 0 t50 0'],
  ])('draws the curved path %s from x 10 to 110', async (d) => {
    const fills = await fillsOf(await svg(() => [h(PdfPath, { d, fill: '#000000' })]))
    expect(fills).toHaveLength(1)
    expect(fills[0]!.rect[0]).toBeCloseTo(10, 3)
    expect(fills[0]!.rect[2]).toBeCloseTo(110, 3)
  })

  // Upstream bug kept for equal bytes in step 1 of the engine port:
  // pdfkit's arc leaves its own intermediate point as the last control point,
  // so an S after an arc reflects it and the curve bulges past x 110.
  it.fails('draws an S after an arc from its end point', async () => {
    const fills = await fillsOf(await svg(() => [h(PdfPath, { d: 'M10 40 A25 25 0 0 1 60 40 S110 70 110 40', fill: '#000000' })]))
    expect(fills[0]!.rect[2]).toBeCloseTo(110, 3)
  })

  it('fills an arc path with a gradient over the path', async () => {
    const fills = await fillsOf(await svg(() => [
      h(PdfDefs, null, () => [h(PdfLinearGradient, { id: 'fade' }, () => [
        h(PdfStop, { offset: 0, stopColor: '#ff0000' }),
        h(PdfStop, { offset: 1, stopColor: '#0000ff' }),
      ])]),
      h(PdfPath, { d: 'M10 40 A25 25 0 0 1 60 40 Z', fill: 'url(#fade)' }),
    ]))
    const shape = fills.find(fill => fill.rect[2] - fill.rect[0] > 1)
    expect(shape!.rect[0]).toBeCloseTo(10, 3)
    expect(shape!.rect[2]).toBeCloseTo(60, 3)
  })

  it('sets a gradient fill without an empty fill of its own', async () => {
    const bytes = Buffer.from(await svg(() => [
      h(PdfDefs, null, () => [h(PdfLinearGradient, { id: 'fade' }, () => [
        h(PdfStop, { offset: 0, stopColor: '#ff0000' }),
        h(PdfStop, { offset: 1, stopColor: '#0000ff' }),
      ])]),
      h(PdfRect, { x: 10, y: 10, width: 50, height: 30, fill: 'url(#fade)' }),
    ]))
    // Each stream's data runs from `stream` to `endstream`.
    const streams = bytes.toString('latin1').split('\nendstream').slice(0, -1).map(part => part.slice(part.lastIndexOf('stream\n') + 'stream\n'.length))
    const content = streams.flatMap((data) => {
      try {
        return [inflateSync(Buffer.from(data, 'latin1')).toString('latin1')]
      }
      catch {
        return []
      }
    }).find(text => text.includes(' scn'))
    // The shape's own `re` follows the colour; an `f` there filled no path.
    expect(content).toMatch(/ scn\n(?!f\n)/)
    expect(content).not.toMatch(/ scn\nf\n/)
  })

  // SVG starts a radial gradient at its focus; it used to start at the centre.
  it('starts a radial gradient at its focus', async () => {
    const bytes = await svg(() => [
      h(PdfDefs, null, () => [h(PdfRadialGradient, { id: 'glow', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.2, fy: 0.5 }, () => [
        h(PdfStop, { offset: 0, stopColor: '#ff0000' }),
        h(PdfStop, { offset: 1, stopColor: '#0000ff' }),
      ])]),
      h(PdfRect, { x: 0, y: 0, width: PAGE, height: PAGE, fill: 'url(#glow)' }),
    ])
    const [page] = await rasterizePdf(bytes)
    const red = (x: number, y: number) => {
      const at = (y * page!.width + x) * 4
      return page!.pixels[at]! > 230 && page!.pixels[at + 2]! < 25
    }
    expect([red(40, 100), red(100, 100)]).toEqual([true, false])
  })

  /** The colour of one pixel of the page's first picture. */
  const pixelAt = async (bytes: Uint8Array, x: number, y: number): Promise<number[]> => {
    const [page] = await rasterizePdf(bytes)
    const at = (y * page!.width + x) * 4
    return [...page!.pixels.subarray(at, at + 3)]
  }
  const expectColour = (actual: number[], expected: readonly number[]) =>
    actual.forEach((value, index) => expect(Math.abs(value - expected[index]!), `channel ${index} of ${actual.join(', ')}`).toBeLessThanOrEqual(3))

  // pdfkit blended from 0 to 1 whatever the first and last offsets: at 20 %
  // it painted a mix where SVG pads the first colour up to 25 %.
  it('pads a gradient\'s first and last colours beyond their stops', async () => {
    const bytes = await svg(() => [
      h(PdfDefs, null, () => [h(PdfLinearGradient, { id: 'inner', x1: 0, x2: 1, y1: 0, y2: 0 }, () => [
        h(PdfStop, { offset: 0.25, stopColor: '#cc3333' }),
        h(PdfStop, { offset: 0.75, stopColor: '#2a6fdb' }),
      ])]),
      h(PdfRect, { x: 0, y: 0, width: PAGE, height: PAGE, fill: 'url(#inner)' }),
    ])
    expectColour(await pixelAt(bytes, 40, 100), [204, 51, 51])
    expectColour(await pixelAt(bytes, 160, 100), [42, 111, 219])
    expectColour(await pixelAt(bytes, 100, 100), [123, 81, 135])
  })

  // pdfkit wrote a gradient of one stop without a function.
  it('fills with the colour of a gradient\'s only stop', async () => {
    const bytes = await svg(() => [
      h(PdfDefs, null, () => [h(PdfLinearGradient, { id: 'one', x1: 0, x2: 1, y1: 0, y2: 0 }, () => [h(PdfStop, { offset: 0.5, stopColor: '#2a6fdb' })])]),
      h(PdfRect, { x: 10, y: 10, width: 100, height: 60, fill: 'url(#one)' }),
    ])
    expectColour(await pixelAt(bytes, 60, 40), [42, 111, 219])
  })

  it('draws an image inside an SVG', async () => {
    const bytes = await svg(() => [h(PdfImage, { src: JPEG, style: { width: 48, height: 32 } })])
    const { details } = await readPdf(bytes, undefined, { details: true })
    expect(details!.images.map(image => image.rect)).toEqual([fromTop(0, 0, 48, 32)])
  })

  // The old painter joined these strings as text: the clip ran from x 10 to
  // 1030 ('10' + '20') and the whole square showed.
  it('clips to a clip-path rect given as numeric strings', async () => {
    const bytes = await svg(() => [
      h(PdfDefs, null, () => [h(PdfClipPath, { id: 'window' }, () => [h(PdfRect, { x: '10', y: '10', width: '20', height: '20' })])]),
      h(PdfRect, { x: 0, y: 0, width: 100, height: 100, fill: '#000000', clipPath: 'url(#window)' }),
    ])
    const [page] = await rasterizePdf(bytes)
    const dark = (x: number, y: number) => page!.pixels[(y * page!.width + x) * 4]! < 128
    expect([dark(20, 20), dark(50, 20), dark(20, 50)]).toEqual([true, false, false])
  })

  // The first label comes before any text, so it is set in pdfkit's default
  // Helvetica; the link's label in the font of the link's text.
  it('draws the debug overlay with a link\'s hit slop and both size labels', async () => {
    const bytes = await render(() => [
      h(PdfView, { debug: true, style: { width: 60, height: 40 } }),
      h(PdfLink, { href: 'https://example.com', debug: true, hitSlop: { top: 4, right: 6, bottom: 4, left: 6 }, style: { margin: 20, width: 60, height: 20 } }, () => [h(PdfText, null, () => 'Go')]),
    ])
    const { words, details } = await readPdf(bytes, undefined, { details: true })
    expect(details!.fills.filter(fill => fill.color === '#d8b4fe').map(fill => fill.rect)).toEqual([
      fromTop(14, 56, 72, 4),
      fromTop(14, 80, 72, 4),
      fromTop(14, 60, 6, 20),
      fromTop(80, 60, 6, 20),
    ])
    expect(words.map(word => word.text).join(' ')).toContain('60 x 40')
    expect(words.map(word => word.text).join(' ')).toContain('100 x 60')
  })

  // pdfkit set the size label in its current font, so after a Times run the
  // label was Times. The view has a fixed size, so both labels read
  // "100 x 64"; the rows above the content box hold the label and the margin
  // band only.
  it('sets the debug size label in Helvetica after a text in another font', async () => {
    const page = async (fontFamily: string) => {
      const bytes = await render(() => [h(PdfView, { debug: true, style: { margin: 12, width: 76, height: 40 } }, () => [
        h(PdfText, { style: { fontFamily, fontSize: 10 } }, () => 'Type AV'),
      ])])
      const [image] = await rasterizePdf(bytes, { scale: 2 })
      return image!.pixels.subarray(0, image!.width * 4 * 2 * 12)
    }
    const [times, helvetica] = [await page('Times-Roman'), await page('Helvetica')]
    expect(times.some((value, index) => index % 4 === 0 && value < 128)).toBe(true)
    expect(Buffer.from(times).equals(Buffer.from(helvetica))).toBe(true)
  })

  // Regression: an earlier colour reader painted hwb() black; the old painter
  // read it through color-string. hwb(120 20% 30%) is 51, 179, 51.
  it('paints an hwb() background in its colour', async () => {
    const bytes = await render(() => [h(PdfView, { style: { width: 20, height: 20, backgroundColor: 'hwb(120 20% 30%)' } })])
    const { details } = await readPdf(bytes, undefined, { details: true })
    expect(details!.fills.map(fill => fill.color)).toEqual(['#33b333'])
  })

  // Helvetica 10 pt as the standard fonts measure it: ascent 9, descent -2,
  // so a glyph box of 11.
  // The line height puts half of what it adds above the glyphs (CSS
  // half-leading), and a run's background fills its glyph box only.
  it.each([
    ['no line height', undefined, 0],
    ['a line height of 2', 2, 4.5],
    ['a line height of 0.8, so the glyphs rise above the line', 0.8, -1.5],
  ])('paints a line with %s at its half-leading', async (_, lineHeight, half) => {
    const bytes = await render(() => [h(PdfView, { style: { padding: 20 } }, () => [
      h(PdfText, { style: { fontSize: 10, lineHeight } }, () => ['plain ', h(PdfText, { style: { backgroundColor: '#ff0000' } }, () => 'marked')]),
    ])])
    const { words, details } = await readPdf(bytes, undefined, { details: true })
    expect(words.map(word => [word.text, Number((PAGE - word.y).toFixed(3))])).toEqual([['plain', 20 + half + 9], ['marked', 20 + half + 9]])
    const fills = details!.fills.filter(fill => fill.color === '#ff0000')
    expect(fills).toHaveLength(1)
    fills[0]!.rect.forEach((value, index) => expect(value).toBeCloseTo(fromTop(43.9, 20 + half, 33.29, 11)[index]!, 3))
  })
})
