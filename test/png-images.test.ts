import { Buffer } from 'node:buffer'
import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { comparePageImages, rasterizePdf } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'

// PNG transparency and interlacing, where pdfkit and png-js were wrong. Each
// case pairs a PNG with a second encoding of the same picture that has no
// such feature; both must paint the same pixels.

const { PdfDocument, PdfImage, PdfPage, PdfView } = PDF_COMPONENTS

interface PngSpec {
  colorType: 0 | 2 | 3
  bits: 1 | 2 | 8
  sample: (x: number, y: number, channel: number) => number
  palette?: readonly number[]
  transparency?: readonly number[]
  interlaced?: boolean
}

const CHANNELS = { 0: 1, 2: 3, 3: 1 } as const
const WIDTH = 24
const HEIGHT = 16
/** The seven Adam7 passes: first column and row, column and row step. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const

const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/** A 24 × 16 PNG, rows unfiltered, Adam7-interlaced when asked. */
const png = ({ colorType, bits, sample, palette, transparency, interlaced = false }: PngSpec): Uint8Array => {
  const channels = CHANNELS[colorType]
  const rows: Buffer[] = []
  for (const [x0, y0, dx, dy] of interlaced ? ADAM7 : [[0, 0, 1, 1] as const]) {
    const columns = Math.ceil((WIDTH - x0) / dx)
    const rowBytes = Math.ceil(columns * channels * bits / 8)
    for (let y = y0; y < HEIGHT; y += dy) {
      const line = Buffer.alloc(rowBytes + 1)
      for (let column = 0; column < columns; column += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const value = sample(x0 + column * dx, y, channel)
          const index = column * channels + channel
          if (bits === 8) line[1 + index] = value
          else line[1 + ((index * bits) >> 3)] = line[1 + ((index * bits) >> 3)]! | (value << (8 - bits - ((index * bits) & 7)))
        }
      }
      rows.push(line)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(WIDTH, 0)
  header.writeUInt32BE(HEIGHT, 4)
  header.set([bits, colorType, 0, 0, interlaced ? 1 : 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    ...(palette ? [chunk('PLTE', Uint8Array.from(palette))] : []),
    ...(transparency ? [chunk('tRNS', Uint8Array.from(transparency))] : []),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', new Uint8Array()),
  ])
}

const PALETTE = [16, 243, 53, 32, 231, 106, 200, 40, 90]
/** Grey levels 40 to 160; the transparent pixels sit on every fifth diagonal. */
const grey = (x: number, y: number) => 40 + ((x * 5 + y * 3) % 121)
const hole = (x: number, y: number) => (x + y) % 5 === 0

/**
 * pdfkit masked a grey tRNS by its high byte (at 8 bits always black), wrote
 * a 12-number RGB colour key from the 6 bytes of tRNS, and png-js unpacked
 * palette transparency and interlacing below 8 bits a byte per pixel.
 */
const CASES: ReadonlyArray<readonly [name: string, image: Uint8Array, reference: Uint8Array]> = [
  ['a grey colour key',
    png({ colorType: 0, bits: 8, sample: (x, y) => hole(x, y) ? 200 : grey(x, y), transparency: [0, 200] }),
    png({ colorType: 0, bits: 8, sample: (x, y) => hole(x, y) ? 0 : grey(x, y), transparency: [0, 0] })],
  ['an RGB colour key',
    png({ colorType: 2, bits: 8, sample: (x, y, c) => hole(x, y) ? [200, 10, 30][c]! : (x * 10 + c * 70) & 255, transparency: [0, 200, 0, 10, 0, 30] }),
    png({ colorType: 2, bits: 8, sample: (x, y, c) => hole(x, y) ? 0 : (x * 10 + c * 70) & 255, transparency: [0, 0, 0, 0, 0, 0] })],
  ['palette transparency at 1 bit',
    png({ colorType: 3, bits: 1, sample: x => (x >> 1) % 2, palette: PALETTE.slice(0, 6), transparency: [60] }),
    png({ colorType: 3, bits: 8, sample: x => (x >> 1) % 2, palette: PALETTE.slice(0, 6), transparency: [60] })],
  ['interlacing at 2 bits',
    png({ colorType: 0, bits: 2, sample: (x, y) => (x + y) % 4, interlaced: true }),
    png({ colorType: 0, bits: 2, sample: (x, y) => (x + y) % 4 })],
]

/** The image at four times its size on a dark-blue ground, so transparency shows. */
const picture = async (src: Uint8Array) => {
  const { bytes } = await renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
    h(PdfPage, { size: [112, 80], style: { padding: 8 } }, () =>
      h(PdfView, { style: { backgroundColor: '#24364f' } }, () => h(PdfImage, { src, style: { width: WIDTH * 4, height: HEIGHT * 4 } }))))), {})
  return (await rasterizePdf(bytes))[0]!
}

describe('PNG images', () => {
  it.each(CASES)('paints %s like the same picture without it', async (_name, image, reference) => {
    const [actual, expected] = [await picture(image), await picture(reference)]
    expect(comparePageImages(actual, expected, { channelThreshold: 0, maxChangedPixelRatio: 0 })).toMatchObject({ matches: true })
  })
})
