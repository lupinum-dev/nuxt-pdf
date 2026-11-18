import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import PDFDocument from '@react-pdf/pdfkit'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import type { PdfDocumentProps } from '../src/runtime/primitives'
import { installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { renderTagged, structuredChildren, TAGGED_PROPS } from './fixtures/tagged-document'

// Same tree and same `creationDate` → same bytes, also with embedded fonts,
// attachments and transparent images (`engine/reproducible.ts`, CONTRACTS.md
// "Reproducible output").

installPdfCanvasGlobals()

const {
  PdfAttachment,
  PdfDocument,
  PdfImage,
  PdfPage,
  PdfTable,
  PdfTableCell,
  PdfTableHeader,
  PdfTableRow,
  PdfText,
  PdfView,
} = PDF_COMPONENTS

const dataUrl = (path: string) => `data:font/ttf;base64,${readFileSync(path).toString('base64')}` as PdfFontDataUrl
const ROBOTO = dataUrl('test/fixtures/assets/Roboto-Regular.ttf')
const FONTS = [
  { family: 'Roboto', src: ROBOTO, fontWeight: 400 },
  { family: 'Roboto', src: ROBOTO, fontWeight: 700 },
  { family: 'Noto Arabic', src: dataUrl('test/fixtures/fonts/international/NotoSansArabic-Subset.ttf') },
]
// 700 × 420 RGBA: inflated asynchronously, with a soft mask.
const SAMPLE_PNG = new Uint8Array(readFileSync('test/fixtures/assets/sample.png'))
const CREATED = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const frame = Buffer.alloc(body.length + 8)
  frame.writeUInt32BE(data.length, 0)
  body.copy(frame, 4)
  frame.writeUInt32BE(crc32(body), body.length + 4)
  return frame
}

/** A 2 × 2 RGBA PNG: its inflate ends long before the sample's. */
const tinyRgbaPng = (): Uint8Array => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2, 0)
  header.writeUInt32BE(2, 4)
  header.set([8, 6, 0, 0, 0], 8) // 8 bit, RGBA, deflate, no filter, no interlace
  const rows = Buffer.from([0, 255, 0, 0, 128, 0, 0, 255, 255, 0, 0, 0, 255, 64, 255, 255, 255, 255, 0])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

type DocumentProps = PdfDocumentProps & Record<string, unknown>

const render = async (props: DocumentProps, children: () => VNode[]) => (await renderPreparedPdfTemplate(
  defineComponent(() => () => h(PdfDocument, { creationDate: CREATED, ...props }, children)),
  {},
  { fonts: FONTS },
)).bytes

/** Two weights and a second family, an image, a table over two pages. */
const contentPage = (): VNode => h(PdfPage, { size: 'A6', style: { padding: 24, fontFamily: 'Roboto', fontSize: 9 } }, () => [
  h(PdfText, { style: { fontWeight: 700, fontSize: 14 } }, () => 'Field report'),
  h(PdfText, null, () => 'Regular text'),
  h(PdfText, { style: { fontFamily: 'Noto Arabic', textAlign: 'right' } }, () => 'العربية مرحبا'),
  h(PdfImage, { src: SAMPLE_PNG, style: { width: 60 } }),
  h(PdfTable, { columns: [1, '50pt'] }, () => [
    h(PdfTableHeader, { fixed: true }, () => [h(PdfTableCell, null, () => 'Item'), h(PdfTableCell, null, () => 'Amount')]),
    ...Array.from({ length: 40 }, (_, index) => h(PdfTableRow, { key: index }, () => [
      h(PdfTableCell, null, () => `Row ${index}`),
      h(PdfTableCell, null, () => `${index}.00`),
    ])),
  ]),
])

const FIXTURES = {
  'a registered font in two weights and a second family, an image, a table over two pages':
    () => render({ title: 'Fonts' }, () => [contentPage()]),
  'the same with two attachments and PDF/A-3b': () => render({ title: 'Archive', language: 'en', conformance: 'PDF/A-3b' }, () => [
    h(PdfAttachment, { name: 'notes.txt', type: 'text/plain', data: 'notes '.repeat(4000) }),
    h(PdfAttachment, { name: 'raw.bin', data: new Uint8Array(30_000).map((_, index) => (index * 7) % 251) }),
    contentPage(),
  ]),
  // Many pages with no embedded font, image or attachment (round 2 review R2-3).
  'twenty A4 pages of plain text in the standard font': () => render({ title: 'Plain' }, () => [
    h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 10 } }, () => Array.from({ length: 20 }, (_, page) =>
      h(PdfView, { key: page, wrap: false, style: { height: 759.89 } }, () => Array.from({ length: 30 }, (_, line) =>
        h(PdfText, { key: line }, () => `Page ${page} line ${line}`))))),
  ]),
  'a tagged PDF/A-3a and PDF/UA-1 document with links and three images':
    async () => (await renderTagged({ ...TAGGED_PROPS, conformance: ['PDF/A-3a', 'PDF/UA-1'] }, structuredChildren)).bytes,
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
const objectOffset = (pdf: string, pattern: RegExp): number => {
  const match = pattern.exec(pdf)
  if (match === null) throw new Error(`no object matches ${pattern}`)
  return match.index
}

describe('the same tree gives the same bytes', () => {
  // Catches the random font subset name and every write whose order follows
  // the zlib thread pool: before phase 17a each of these documents gave other
  // bytes on almost every render, most of all with renders in parallel.
  it.each(Object.entries(FIXTURES))('%s, in sequence and five in parallel', async (_, run) => {
    const first = await run()
    const parallel = await Promise.all(Array.from({ length: 5 }, run))
    for (const bytes of [await run(), ...parallel]) {
      expect(Buffer.from(bytes).equals(Buffer.from(first))).toBe(true)
    }
  }, 120_000)

  // Catches a random or reused subset tag, and the engine writing the tag
  // somewhere our seam does not see (it would show up as a third tag).
  it('names font subsets AAAAAA, AAAAAB, … in order of first appearance', async () => {
    const pdf = latin1(await render({ title: 'Fonts' }, () => [contentPage()]))
    const named = [...pdf.matchAll(/\/(FontName|BaseFont) \/([A-Z]{6})\+(\S+)/g)].map(match => `${match[2]}+${match[3]}`)
    const tags = new Set([...pdf.matchAll(/[A-Z]{6}\+/g)].map(match => match[0]))

    expect([...new Set(named)].sort()).toEqual(['AAAAAA+Roboto-Regular', 'AAAAAB+NotoSansArabic-Regular'])
    expect(named).toHaveLength(6) // FontName, CID font BaseFont, Type0 BaseFont per subset
    expect([...tags].sort()).toEqual(['AAAAAA+', 'AAAAAB+'])
  }, 60_000)

  // Catches the async writes in completion order. The first attachment and the
  // first image take far longer to deflate and inflate than the second, so
  // without the fix the second is written first (and the image's soft mask
  // gets the lower object number).
  it('writes streams in end() order and image callbacks in embed order', async () => {
    const largeText = Array.from({ length: 200_000 }, (_, index) => `line ${index * 7919 % 100_003}`).join('\n')
    const pdf = latin1(await render({ title: 'Order' }, () => [
      h(PdfAttachment, { name: 'large.txt', type: 'text/plain', data: largeText }),
      h(PdfAttachment, { name: 'small.txt', type: 'text/plain', data: 'small' }),
      h(PdfPage, { size: 'A6' }, () => [
        h(PdfImage, { src: SAMPLE_PNG, style: { width: 60 } }),
        h(PdfImage, { src: tinyRgbaPng(), style: { width: 10 } }),
      ]),
    ]))

    const embeddedFile = (size: number) => objectOffset(pdf, new RegExp(`\\d+ 0 obj\\n<<\\n/Type /EmbeddedFile\\n(?:(?!endobj)[\\s\\S])*?/Size ${size}\\n`))
    const large = embeddedFile(largeText.length)
    const small = embeddedFile('small'.length)
    expect(large).toBeLessThan(small)

    // Image objects in embed order (their numbers are taken at embed time),
    // with the soft mask numbers in the same order.
    const masks = [...pdf.matchAll(/(\d+) 0 obj\n<<\n\/Type \/XObject\n\/Subtype \/Image\n\/BitsPerComponent 8\n\/Width (\d+)\n\/Height \d+\n\/Filter \/FlateDecode\n\/ColorSpace \/DeviceRGB\n\/SMask (\d+) 0 R/g)]
      .map(match => ({ image: Number(match[1]), width: Number(match[2]), mask: Number(match[3]) }))
      .sort((left, right) => left.image - right.image)
    expect(masks.map(entry => entry.width)).toEqual([700, 2])
    expect(masks[0]!.mask).toBeLessThan(masks[1]!.mask)
  }, 60_000)
})

describe('the engine internals reproducible output relies on', () => {
  // Each assertion fails when a pdfkit update changes a contract of
  // CONTRACTS.md "Reproducible output"; the fix would then silently stop.
  it('gives every reference an own finalize and a deflate stream created by the first compressed write', () => {
    const document = new PDFDocument({ compress: true, autoFirstPage: false })
    const stream = document.ref({})
    const plain = document.ref({})

    expect(Object.hasOwn(stream, 'finalize')).toBe(true)
    expect(stream.deflate).toBeNull()
    stream.end(Buffer.from('stream content'))
    expect(stream.deflate).not.toBeNull()
    plain.end()
    expect(plain.deflate).toBeNull()
  })

  it('opens a PNG with a png-js decoder whose decodePixels reports asynchronously', async () => {
    const document = new PDFDocument({ autoFirstPage: false })
    const decoder = document.openImage(Buffer.from(SAMPLE_PNG)).image
    expect(typeof decoder?.decodePixels).toBe('function')

    let reported = false
    const pixels = new Promise<Uint8Array>((resolve) => {
      decoder!.decodePixels((data) => {
        reported = true
        resolve(data)
      })
    })
    expect(reported).toBe(false)
    expect((await pixels).length).toBe(700 * 420 * 4)
  })
})
