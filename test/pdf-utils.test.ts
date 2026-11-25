import { Buffer } from 'node:buffer'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  normalizePdfText,
  parsePdf,
  rasterizePdf,
  type PdfPageImage,
} from '../src/test/pdf'
import { renderPdfTemplate } from '../src/test/render-template'
import { COMPARES_REVIEWED_BASELINES, RASTER_THRESHOLDS } from './raster'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

describe('PDF verification utilities', () => {
  it('parses page text and link annotations from PDF bytes', async () => {
    const bytes = createFixturePdf()

    expect(hasPdfHeader(bytes)).toBe(true)
    expect(hasPdfHeader(new Uint8Array([0x50, 0x44, 0x46]))).toBe(false)

    const parsed = await parsePdf(bytes)

    expect(parsed.pageCount).toBe(1)
    expect(parsed.pages[0]).toMatchObject({
      height: 200,
      number: 1,
      text: 'Hello PDF',
      textItems: ['Hello PDF'],
      textRuns: [{
        direction: 'ltr',
        fontSize: 12,
        height: 12,
        text: 'Hello PDF',
        x: 20,
        y: 100,
      }],
      width: 200,
    })
    expect(parsed.pages[0]?.annotations).toContainEqual(expect.objectContaining({
      subtype: 'Link',
      unsafeUrl: 'https://example.com/',
      url: 'https://example.com/',
    }))
  })

  it('rasterizes pages and reports explicit pixel differences', async () => {
    const [page] = await rasterizePdf(createFixturePdf())

    expect(page).toBeDefined()
    expect(page?.width).toBe(200)
    expect(page?.height).toBe(200)
    expect(Array.from(page?.png.subarray(0, 8) ?? [])).toEqual([
      0x89,
      0x50,
      0x4E,
      0x47,
      0x0D,
      0x0A,
      0x1A,
      0x0A,
    ])

    const decodedPage = await decodePngPage(page!.png, page!.number)
    expect(comparePageImages(decodedPage, page!)).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })

    const identical = comparePageImages(page!, page!)

    expect(identical).toMatchObject({
      changedPixelRatio: 0,
      changedPixels: 0,
      dimensionsMatch: true,
      matches: true,
      maxChannelDifference: 0,
      pageNumbersMatch: true,
      totalPixels: 40_000,
    })

    const changedPixels = new Uint8ClampedArray(page!.pixels)
    changedPixels[0] = changedPixels[0] === 0 ? 255 : 0
    const changed: PdfPageImage = {
      ...page!,
      pixels: changedPixels,
    }
    const comparison = comparePageImages(changed, page!, {
      channelThreshold: 0,
      maxChangedPixelRatio: 0,
    })

    expect(comparison.changedPixels).toBe(1)
    expect(comparison.changedPixelRatio).toBe(1 / 40_000)
    expect(comparison.matches).toBe(false)
    expect(comparison.maxChannelDifference).toBe(255)
  })

  // Catches a gate that turns the reviewed baselines off everywhere: every
  // runtime with Float16Array (Node 24 and later) must compare them.
  it('compares reviewed baselines on Node 24 and later', () => {
    expect(COMPARES_REVIEWED_BASELINES).toBe(Number(process.versions.node.split('.')[0]) >= 24)
  })

  // An A4 page whose last line moves down 1 pt. The reviewed baselines
  // allowed 0.5 % of a page to change, and this move changes 0.07 %. Catches
  // a raster tolerance that lets a moved line pass.
  it('fails the reviewed raster tolerance when one line moves 1 pt', async () => {
    const page = (shift: number) => defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
      h(PdfPage, { size: 'A4', style: { padding: 56, fontSize: 11 } }, () => [
        h(PdfText, () => 'Peat moss holds water and carbon for centuries when the bog stays wet.'),
        h(PdfText, { style: { marginTop: shift } }, () => 'The last line moves.'),
      ])))
    const [before] = await rasterizePdf((await renderPdfTemplate(page(0), {})).bytes)
    const [after] = await rasterizePdf((await renderPdfTemplate(page(1), {})).bytes)

    expect(comparePageImages(after!, before!, { channelThreshold: 25, maxChangedPixelRatio: 0.005 }).matches).toBe(true)
    expect(comparePageImages(after!, before!, RASTER_THRESHOLDS).matches).toBe(false)
  })

  // Catches pdf.js drawing the standard fonts without their font files: it
  // then draws another face, a serif on Linux and the system Helvetica on
  // macOS. The Helvetica of pdf.js (Foxit Sans) inks 6807 pixels for a 200 pt
  // "G"; the macOS Helvetica inks 7849.
  it('rasterizes Helvetica with the glyphs of pdf.js on every platform', async () => {
    const page = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
      h(PdfPage, { size: [240, 300], style: { padding: 20 } }, () =>
        h(PdfText, { style: { fontFamily: 'Helvetica', fontSize: 200 } }, () => 'G'))))
    const [image] = await rasterizePdf((await renderPdfTemplate(page, {})).bytes)
    let inked = 0
    for (let index = 0; index < image!.pixels.length; index += 4) {
      if (image!.pixels[index]! < 128) inked++
    }
    expect(inked).toBeGreaterThan(6807 * 0.95)
    expect(inked).toBeLessThan(6807 * 1.05)
  })

  it('normalizes semantic whitespace and validates comparison inputs', async () => {
    expect(normalizePdfText('  Hello\n\t PDF  ')).toBe('Hello PDF')

    const page = createPageImage()

    expect(comparePageImages({ ...page, number: 2 }, page)).toMatchObject({
      dimensionsMatch: true,
      matches: false,
      pageNumbersMatch: false,
    })
    expect(() => comparePageImages(page, page, { channelThreshold: 256 }))
      .toThrow('channelThreshold must be between 0 and 255')
    expect(() => comparePageImages(page, page, { maxChangedPixelRatio: -0.1 }))
      .toThrow('maxChangedPixelRatio must be between 0 and 1')
    await expect(decodePngPage(page.png, 0))
      .rejects.toThrow('PNG page number must be a positive integer')
  })
})

function createPageImage(): PdfPageImage {
  return {
    height: 1,
    number: 1,
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
    png: new Uint8Array(),
    width: 1,
  }
}

function createFixturePdf(): Uint8Array {
  const content = [
    'q',
    '0.2 0.4 0.8 rg',
    '20 20 50 50 re',
    'f',
    'Q',
    'BT',
    '/F1 12 Tf',
    '20 100 Td',
    '(Hello PDF) Tj',
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    [
      '<< /Type /Page /Parent 2 0 R',
      '/MediaBox [0 0 200 200]',
      '/Resources << /Font << /F1 5 0 R >> >>',
      '/Contents 4 0 R /Annots [6 0 R] >>',
    ].join(' '),
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    [
      '<< /Type /Annot /Subtype /Link /Rect [10 10 120 30]',
      '/Border [0 0 0]',
      '/A << /S /URI /URI (https://example.com/) >> >>',
    ].join(' '),
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  pdf += offsets
    .slice(1)
    .map(offset => `${offset.toString().padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return new TextEncoder().encode(pdf)
}
