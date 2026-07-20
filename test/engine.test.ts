import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import * as P from '@react-pdf/primitives'
import { describe, expect, it } from 'vitest'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { parsePdf } from './utils/pdf'

const createDocument = (fontFamily = 'Helvetica'): DocumentNode => ({
  type: P.Document,
  props: {
    title: 'Engine proof',
    creationDate: new Date('2026-07-20T00:00:00.000Z'),
  },
  children: [
    {
      type: P.Page,
      box: {},
      style: { padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: P.Text,
          box: {},
          style: { fontFamily, fontSize: 18 },
          props: {},
          children: [
            { type: P.TextInstance, value: 'Nuxt PDF engine proof' },
          ],
        },
      ],
    },
  ],
} as DocumentNode)

const createDynamicPageDocument = (lineHeight?: number): DocumentNode => ({
  type: P.Document,
  props: {},
  children: [1, 2].map(pageNumber => ({
    type: P.Page,
    box: {},
    style: { lineHeight, padding: 32 },
    props: { size: 'A4' },
    children: [
      {
        type: P.Text,
        box: {},
        style: { fontFamily: 'Helvetica', fontSize: 12 },
        props: {},
        children: [{ type: P.TextInstance, value: `Body ${pageNumber}` }],
      },
      {
        type: P.Text,
        box: {},
        style: {
          bottom: 22,
          fontFamily: 'Helvetica',
          fontSize: 8,
          left: 42,
          position: 'absolute',
          right: 42,
          textAlign: 'center',
        },
        props: {
          fixed: true,
          render: ({
            pageNumber: currentPage,
            totalPages,
          }: { pageNumber: number, totalPages?: number }) =>
            `Page ${currentPage} of ${totalPages}`,
        },
        children: [],
      },
    ],
  })),
} as DocumentNode)

// Oracle for the fixed dynamic-footer geometry: the SAME document authored with
// a STATIC footer carrying identical absolute styles and NO inherited
// lineHeight (its page sets none). React PDF cannot be the oracle here — its own
// pagination drops the dynamic footer when an ancestor sets lineHeight, so a
// correct dynamic footer must instead match this resolved-away static geometry.
const createStaticFooterDocument = (): DocumentNode => ({
  type: P.Document,
  props: {},
  children: [1, 2].map(pageNumber => ({
    type: P.Page,
    box: {},
    style: { padding: 32 },
    props: { size: 'A4' },
    children: [
      {
        type: P.Text,
        box: {},
        style: { fontFamily: 'Helvetica', fontSize: 12 },
        props: {},
        children: [{ type: P.TextInstance, value: `Body ${pageNumber}` }],
      },
      {
        type: P.Text,
        box: {},
        style: {
          bottom: 22,
          fontFamily: 'Helvetica',
          fontSize: 8,
          left: 42,
          position: 'absolute',
          right: 42,
          textAlign: 'center',
        },
        props: { fixed: true },
        children: [{ type: P.TextInstance, value: `Page ${pageNumber} of 2` }],
      },
    ],
  })),
} as DocumentNode)

interface TextGeometry {
  box: { top: number, height: number }
  lines: { box: { height: number } }[]
}

const laidOutPages = (layout: SafeDocumentNode) =>
  layout.children as unknown as { children: [TextGeometry, TextGeometry] }[]

const footerGeometry = (layout: SafeDocumentNode) =>
  laidOutPages(layout).map(({ children: [, footer] }) => ({
    top: footer.box.top,
    height: footer.box.height,
    lineHeight: footer.lines[0]!.box.height,
  }))

const bodyHeight = (layout: SafeDocumentNode) =>
  laidOutPages(layout)[0]!.children[0].box.height

describe('React PDF engine pipeline', () => {
  it('lays out and serializes a compatible document tree', async () => {
    const result = await renderDocument(createDocument())
    const header = Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')

    expect(header).toBe('%PDF-')
    expect(result.bytes.byteLength).toBeGreaterThan(500)
    expect(result.layout.children).toHaveLength(1)
    expect(result.layout.children[0]?.box?.width).toBeGreaterThan(0)
  })

  it('rejects a non-document root before layout', async () => {
    const invalid = { ...createDocument(), type: P.Page } as unknown as DocumentNode

    await expect(renderDocument(invalid)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Expected a DOCUMENT root, received PAGE.',
    })
  })

  it('surfaces font-resolution failures as a layout error with the upstream message', async () => {
    const invalid = createDocument('Missing Font')

    // Font resolution is a layout sub-stage, so a missing family fails as
    // LAYOUT_ERROR carrying React PDF's own precise message rather than a
    // separately classified font code.
    await expect(renderDocument(invalid)).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: expect.stringContaining('Font family not registered'),
    })
  })

  it('renders dynamic totals on explicit pages, with or without inherited line height', async () => {
    // The inherited-lineHeight case (1.45) is the one upstream React PDF drops;
    // here it must render on both pages just like the plain case.
    for (const document of [createDynamicPageDocument(), createDynamicPageDocument(1.45)]) {
      const pdf = await parsePdf((await renderDocument(document)).bytes)

      expect(pdf.pageCount).toBe(2)
      expect(pdf.pages[0]?.text).toContain('Page 1 of 2')
      expect(pdf.pages[1]?.text).toContain('Page 2 of 2')
    }
  })

  it('gives inherited-lineHeight dynamic text the same geometry as static text', async () => {
    const dynamic = await renderDocument(createDynamicPageDocument(1.45))
    const staticEquivalent = await renderDocument(createStaticFooterDocument())

    // Core assertion: the dynamic footer under an ancestor lineHeight lands at
    // exactly the resolved-away geometry of the equivalent static footer, on
    // every page — no exploded, off-page line box.
    expect(footerGeometry(dynamic.layout)).toEqual(footerGeometry(staticEquivalent.layout))

    // Scope guard: body text on the same dynamic page still inherits lineHeight
    // (1.45 * 18pt line box = 26.1), proving the shield only touches dynamic
    // text and does not strip legitimate inherited lineHeight from static
    // content. The oracle's body, with no inherited lineHeight, stays smaller.
    expect(bodyHeight(dynamic.layout)).toBeCloseTo(26.1, 1)
    expect(bodyHeight(staticEquivalent.layout)).toBeCloseTo(13.2, 1)
  })
})
