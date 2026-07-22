import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  comparePageImages,
  decodePngPage,
  hasPdfHeader,
  normalizePdfText,
  parsePdf,
  rasterizePdf,
  type PdfPageImage,
} from './utils/pdf'

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
