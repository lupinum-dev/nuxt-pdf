import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import type { PdfDocumentProps } from '../src/runtime/primitives'
import { installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { renderTagged, structuredChildren, TAGGED_PROPS } from './fixtures/tagged-document'

// Same tree and same `creationDate` → same bytes, also with embedded fonts,
// attachments and transparent images. Our writer needs no patch for it: it
// writes synchronously, in object order, and its file ID hashes the content
// (CONTRACTS.md "Reproducible output").

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
  // Many pages with no embedded font, image or attachment.
  'twenty A4 pages of plain text in the standard font': () => render({ title: 'Plain' }, () => [
    h(PdfPage, { size: 'A4', style: { padding: 40, fontSize: 10 } }, () => Array.from({ length: 20 }, (_, page) =>
      h(PdfView, { key: page, wrap: false, style: { height: 759.89 } }, () => Array.from({ length: 30 }, (_, line) =>
        h(PdfText, { key: line }, () => `Page ${page} line ${line}`))))),
  ]),
  'a tagged PDF/A-3a and PDF/UA-1 document with links and three images':
    async () => (await renderTagged({ ...TAGGED_PROPS, conformance: ['PDF/A-3a', 'PDF/UA-1'] }, structuredChildren)).bytes,
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')
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

  // Catches a random tag (the renders above) or one tag for two subsets, and
  // a tag written somewhere else than the three names of its subset. Our
  // writer derives the tag from the font, its place and its glyphs.
  it('gives each font subset its own tag, in its three names', async () => {
    const pdf = latin1(await render({ title: 'Fonts' }, () => [contentPage()]))
    const named = [...pdf.matchAll(/\/(FontName|BaseFont) \/([A-Z]{6})\+(\S+?)(?=[\s/>\]])/g)].map(match => ({ tag: match[2]!, font: match[3]! }))
    const tags = new Set([...pdf.matchAll(/[A-Z]{6}\+/g)].map(match => match[0].slice(0, 6)))

    expect([...new Set(named.map(entry => entry.font))].sort()).toEqual(['NotoSansArabic-Regular', 'Roboto-Regular'])
    expect(named).toHaveLength(6) // FontName, CID font BaseFont, Type0 BaseFont per subset
    for (const font of ['Roboto-Regular', 'NotoSansArabic-Regular']) {
      expect(new Set(named.filter(entry => entry.font === font).map(entry => entry.tag)).size).toBe(1)
    }
    expect(tags.size).toBe(2)
  }, 60_000)
})
