// The PDF/UA-1 fixtures of phases 15a and 15b, shared by `test/tagged.test.ts`
// (the structure tree read back) and the veraPDF block of `test/pdfa.test.ts`.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import type { PdfFontDataUrl } from '../../src/runtime/fonts'
import type { PdfDocumentProps } from '../../src/runtime/primitives'
import { normalizePdfLimits } from '../../src/runtime/server/render-limits'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'

const {
  PdfContents,
  PdfDocument,
  PdfFootnote,
  PdfImage,
  PdfLink,
  PdfPage,
  PdfPageNumber,
  PdfRect,
  PdfRichText,
  PdfSvg,
  PdfTable,
  PdfTableCell,
  PdfTableHeader,
  PdfTableRow,
  PdfText,
  PdfView,
} = PDF_COMPONENTS

export const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}
/** The regular file again at 700: rich text and a contents ask for bold, and these tests check tags, not glyphs. */
export const ROBOTO_AS_BOLD = { ...ROBOTO, fontWeight: 700 }
// RGBA, so the image has a soft mask.
const SAMPLE_PNG = new Uint8Array(readFileSync('test/fixtures/assets/sample.png'))
const CREATED = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))

export const PARAGRAPH = 'Accessible documents carry their reading order, roles and alternative texts inside the file, so a screen reader can follow them. '

export const TAGGED_PROPS = {
  title: 'Annual report & outlook',
  language: 'en',
  creationDate: CREATED,
  conformance: 'PDF/UA-1',
} satisfies PdfDocumentProps

type DocumentProps = PdfDocumentProps & Record<string, unknown>

/**
 * A6 pages: a fixed running head with a page number, an `h1`, paragraphs
 * that run over two pages (the third paragraph splits at the break), an
 * `h2`, an image with `alt`, a decorative image, and a view with a
 * background and a border around a paragraph.
 */
export const taggedChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', paddingTop: 40, fontFamily: 'Roboto', fontSize: 10 } }, () => [
    h(PdfText, { fixed: true, style: { position: 'absolute', top: 14, left: 28, fontSize: 7 } }, () => ['Annual report · page ', h(PdfPageNumber)]),
    h(PdfText, { tag: 'h1', style: { fontSize: 16, marginBottom: 6 } }, () => 'Results'),
    h(PdfText, { style: { marginBottom: 6 } }, () => PARAGRAPH.repeat(3)),
    h(PdfText, { style: { marginBottom: 6 } }, () => ['Nested text ', h(PdfText, { style: { color: '#a00' } }, () => 'is part of'), ' its paragraph. ', PARAGRAPH.repeat(2)]),
    h(PdfText, { id: 'split', style: { marginBottom: 6 } }, () => PARAGRAPH.repeat(9)),
    h(PdfText, { tag: 'h2', style: { fontSize: 13, marginBottom: 4 } }, () => 'Details'),
    h(PdfImage, { src: SAMPLE_PNG, alt: 'A small sample chart', style: { width: 60, height: 40, marginBottom: 6 } }),
    h(PdfImage, { src: SAMPLE_PNG, decorative: true, style: { width: 20, height: 12, marginBottom: 6 } }),
    h(PdfView, { style: { backgroundColor: '#eef', borderWidth: 1, borderColor: '#88a', padding: 4 } }, () =>
      h(PdfText, null, () => 'A boxed note inside a view with a background and a border.')),
  ]),
]

/** Rows of the price table: enough to run it onto the second A6 page. */
export const TABLE_ROWS = 24

/**
 * The phase 15b document on A6 pages: a running head; a section with an
 * `h1`, a paragraph with an external and an internal inline link, a link
 * around a text, a list, a quote, a figure with a caption, a paragraph with
 * an inline image and a decorative one, and a paragraph with a page number;
 * then an `h2` and a table over two pages with a repeated header, one cell
 * with block content and a last row whose first cell spans two columns.
 */
export const structuredChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', paddingTop: 40, fontFamily: 'Roboto', fontSize: 9 } }, () => [
    h(PdfText, { fixed: true, style: { position: 'absolute', top: 14, left: 28, fontSize: 7 } }, () => ['Structured report · page ', h(PdfPageNumber)]),
    h(PdfView, { tag: 'section', style: { marginBottom: 6 } }, () => [
      h(PdfText, { tag: 'h1', style: { fontSize: 15, marginBottom: 4 } }, () => 'Structured report'),
      h(PdfText, { style: { marginBottom: 4 } }, () => [
        'Read the ',
        h(PdfLink, { href: 'https://example.com/report' }, () => 'online version'),
        ' or go to the ',
        h(PdfLink, { href: '#prices' }, () => 'price table'),
        ' below.',
      ]),
      h(PdfLink, { href: 'https://example.com', style: { marginBottom: 4 } }, () => 'example.com'),
      h(PdfView, { tag: 'list', style: { marginBottom: 4 } }, () => ['Tables', 'Links', 'Lists'].map(item =>
        h(PdfView, { tag: 'list-item', style: { flexDirection: 'row' } }, () => [
          h(PdfText, { style: { width: 10 } }, () => '•'),
          h(PdfText, null, () => item),
        ]))),
      h(PdfView, { tag: 'quote', style: { marginLeft: 10, marginBottom: 4 } }, () =>
        h(PdfText, { style: { fontStyle: 'normal' } }, () => 'Structure is what a screen reader reads.')),
      h(PdfImage, { src: SAMPLE_PNG, alt: 'A small sample chart', style: { width: 50, height: 30 } }),
      h(PdfView, { tag: 'caption', style: { marginBottom: 4 } }, () => h(PdfText, { style: { fontSize: 7 } }, () => 'Figure 1: a sample chart')),
      h(PdfText, { style: { marginBottom: 4 } }, () => [
        'An icon ',
        h(PdfImage, { src: SAMPLE_PNG, alt: 'check mark', style: { width: 8, height: 8 } }),
        ' and an ornament ',
        h(PdfImage, { src: SAMPLE_PNG, decorative: true, style: { width: 8, height: 8 } }),
        ' sit in the text.',
      ]),
      h(PdfText, null, () => ['This paragraph is on page ', h(PdfPageNumber), '.']),
    ]),
    h(PdfText, { tag: 'h2', id: 'prices', style: { fontSize: 12, marginBottom: 4 } }, () => 'Prices'),
    h(PdfTable, { columns: [3, 1, 1] }, () => [
      h(PdfTableHeader, { style: { borderBottomWidth: 1 } }, () => [
        h(PdfTableCell, null, () => 'Item'),
        h(PdfTableCell, { align: 'right' }, () => 'Qty'),
        h(PdfTableCell, { align: 'right' }, () => 'Price'),
      ]),
      ...Array.from({ length: TABLE_ROWS }, (_, row) => h(PdfTableRow, null, () => [
        row === 0
          ? h(PdfTableCell, null, () => h(PdfText, null, () => 'Block content'))
          : h(PdfTableCell, null, () => `Item ${row + 1}`),
        h(PdfTableCell, { align: 'right' }, () => String(row + 1)),
        h(PdfTableCell, { align: 'right' }, () => `${row + 1}.00`),
      ])),
      h(PdfTableRow, null, () => [
        h(PdfTableCell, { colspan: 2 }, () => 'Total'),
        h(PdfTableCell, { align: 'right' }, () => '300.00'),
      ]),
    ]),
  ]),
]

/**
 * The phase 18 document on A6 pages: an eyebrow in capitals with letter
 * spacing, a paragraph in capitals that splits over two pages, a figure that
 * holds a label, an image, a graphic and its caption, a decorative figure,
 * and a table whose first column is row headers.
 */
export const accessibleChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', fontFamily: 'Roboto', fontSize: 9 } }, () => [
    h(PdfText, { style: { textTransform: 'uppercase', letterSpacing: 1.6, fontSize: 7 } }, () => 'From the managing director'),
    h(PdfText, { tag: 'h1', style: { fontSize: 15, marginBottom: 4 } }, () => 'Accessible details'),
    h(PdfText, { style: { textTransform: 'uppercase', marginBottom: 6 } }, () => PARAGRAPH.repeat(11)),
    h(PdfView, { tag: 'figure', alt: 'Revenue grew from 410 to 520 thousand euros', style: { marginBottom: 6 } }, () => [
      h(PdfText, { style: { fontSize: 6 } }, () => 'EUR thousand'),
      h(PdfImage, { src: SAMPLE_PNG, style: { width: 50, height: 30 } }),
      h(PdfSvg, { width: 40, height: 10 }, () => h(PdfRect, { x: 0, y: 0, width: 40, height: 10, fill: '#2F5D3A' })),
      h(PdfView, { tag: 'caption' }, () => h(PdfText, { style: { fontSize: 7 } }, () => 'Figure 1: revenue by year')),
    ]),
    h(PdfView, { tag: 'figure', decorative: true, style: { marginBottom: 6 } }, () =>
      h(PdfImage, { src: SAMPLE_PNG, style: { width: 20, height: 12 } })),
    h(PdfTable, { columns: [2, 1, 1] }, () => [
      h(PdfTableHeader, { style: { borderBottomWidth: 1 } }, () => [
        h(PdfTableCell, null, () => 'Line'),
        h(PdfTableCell, { align: 'right' }, () => 'FY 2025'),
        h(PdfTableCell, { align: 'right' }, () => 'FY 2024'),
      ]),
      ...['Revenue', 'Costs', 'Result'].map(line => h(PdfTableRow, null, () => [
        h(PdfTableCell, { header: true }, () => line),
        h(PdfTableCell, { align: 'right' }, () => '520'),
        h(PdfTableCell, { align: 'right' }, () => '410'),
      ])),
    ]),
  ]),
]

/**
 * The row-span document on A6 pages: an `h1`, and a table over two pages
 * whose first column holds cells over several rows: groups of three rows
 * with a row header (`header`) over the group, groups of two with a plain
 * cell, the hole each span leaves in the rows below, and a group that moves
 * to the second page whole.
 */
export const spanChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', fontFamily: 'Roboto', fontSize: 9 } }, () => [
    h(PdfText, { tag: 'h1', style: { fontSize: 15, marginBottom: 4 } }, () => 'Hours by project'),
    h(PdfTable, { columns: ['auto', 2, 1] }, () => [
      h(PdfTableHeader, { style: { borderBottomWidth: 1 } }, () => [
        h(PdfTableCell, null, () => 'Project'),
        h(PdfTableCell, null, () => 'Task'),
        h(PdfTableCell, { align: 'right' }, () => 'Hours'),
      ]),
      ...Array.from({ length: 18 }, (_, group) => {
        const rows = group % 2 === 0 ? 3 : 2
        return Array.from({ length: rows }, (_, row) => h(PdfTableRow, { key: `${group}-${row}` }, () => [
          ...(row === 0 ? [h(PdfTableCell, { rowspan: rows, header: group % 2 === 0, style: { backgroundColor: '#eef2ee' } }, () => `Project ${group + 1}`)] : []),
          h(PdfTableCell, null, () => `Task ${row + 1}`),
          h(PdfTableCell, { align: 'right' }, () => `${(group + 1) * (row + 2)}.0`),
        ]))
      }).flat(),
    ]),
  ]),
]

/**
 * The footnote document on A6 pages: a mark in a heading, in a paragraph
 * that runs onto the second page, in a table cell, and in rich text that
 * marks one note twice; notes print on both pages, and the paragraph's long
 * note continues on the second page.
 */
export const footnoteChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', fontFamily: 'Roboto', fontSize: 9 } }, () => [
    h(PdfText, { tag: 'h1', style: { fontSize: 15, marginBottom: 4 } }, () => ['Peatland report', h(PdfFootnote, null, () => 'Draft of 2 January 2026.')]),
    h(PdfText, { style: { marginBottom: 6 } }, () => ['Peat stores carbon', h(PdfFootnote, null, () => `Source: the national inventory. ${PARAGRAPH.repeat(4)}`), ` ${PARAGRAPH.repeat(14)}`]),
    h(PdfRichText, {
      html: '<p>Bogs<sup class="footnote-ref"><a href="#fn1">1</a></sup> and fens<sup class="footnote-ref"><a href="#fn2">2</a></sup> hold water; fens<sup class="footnote-ref"><a href="#fn2">2</a></sup> are fed by ground water.</p>'
        + '<section class="footnotes"><ol><li id="fn1">Fed by rain.</li><li id="fn2">Fed by springs and streams.</li></ol></section>',
    }),
    h(PdfTable, { columns: [2, 1] }, () => h(PdfTableRow, null, () => [
      h(PdfTableCell, null, () => ['Raised bog', h(PdfFootnote, null, () => 'Area in hectares.')]),
      h(PdfTableCell, { align: 'right' }, () => '12'),
    ])),
  ]),
]

/**
 * A contents on the first page and two chapters on the next, the first with
 * a section: one `TOCI` with a nested `TOC`, one without. The heading above
 * the contents is in the outline but not in the contents.
 */
export const contentsChildren = (): VNode[] => [
  h(PdfPage, { size: 'A6', style: { padding: 28, hyphens: 'auto', fontFamily: 'Roboto', fontSize: 9 } }, () => [
    h(PdfText, { tag: 'h1', bookmark: { title: 'Contents', contents: false }, style: { fontSize: 15, marginBottom: 4 } }, () => 'Contents'),
    h(PdfContents),
    h(PdfView, { bookmark: 'Peatlands', break: true }, () => [
      h(PdfText, { tag: 'h1', style: { fontSize: 15 } }, () => 'Peatlands'),
      h(PdfText, null, () => PARAGRAPH),
      h(PdfView, { bookmark: 'Carbon' }, () => [h(PdfText, { tag: 'h2', style: { fontSize: 12 } }, () => 'Carbon'), h(PdfText, null, () => PARAGRAPH)]),
    ]),
    h(PdfView, { bookmark: 'Outlook' }, () => [h(PdfText, { tag: 'h1', style: { fontSize: 15 } }, () => 'Outlook'), h(PdfText, null, () => PARAGRAPH)]),
  ]),
]

export const renderTagged = (props: DocumentProps = TAGGED_PROPS, children: () => VNode[] = taggedChildren) =>
  renderPreparedPdfTemplate(
    defineComponent(() => () => h(PdfDocument, props, children)),
    {},
    { fonts: [ROBOTO, ROBOTO_AS_BOLD], limits: normalizePdfLimits(undefined) },
  )

/** The decompressed content stream of each page, in page order. */
export const pageContents = (bytes: Uint8Array): string[] => {
  const raw = Buffer.from(bytes).toString('latin1')
  const contentIds = [...raw.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)].map(match => match[1])
  return contentIds.map((id) => {
    const object = new RegExp(`(?:^|\\n)${id} 0 obj\\n[^]*?stream\\n([^]*?)\\nendstream`).exec(raw)
    return inflateSync(Buffer.from(object![1]!, 'latin1')).toString('latin1')
  })
}

/** The `/ActualText` of each marked-content sequence of a page that has one, decoded, with its tag and MCID. */
export const actualTexts = (content: string): { tag: string, mcid: number, text: string }[] =>
  [...content.matchAll(/^\/(\w+) <<\/MCID (\d+) \/ActualText <FEFF([0-9A-F]*)>>> BDC$/gm)].map(match => ({
    tag: match[1]!,
    mcid: Number(match[2]),
    text: String.fromCharCode(...(match[3]!.match(/.{4}/g) ?? []).map(unit => Number.parseInt(unit, 16))),
  }))
