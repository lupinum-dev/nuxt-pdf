import type { DocumentNode } from '@react-pdf/layout'
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

  it('classifies missing fonts before serialization', async () => {
    const invalid = createDocument('Missing Font')

    await expect(renderDocument(invalid)).rejects.toMatchObject({
      code: 'PDF_FONT_ERROR',
    })
  })

  it('renders dynamic totals on explicit pages', async () => {
    const result = await renderDocument(createDynamicPageDocument())
    const pdf = await parsePdf(result.bytes)

    expect(pdf.pageCount).toBe(2)
    expect(pdf.pages[0]?.text).toContain('Page 1 of 2')
    expect(pdf.pages[1]?.text).toContain('Page 2 of 2')
  })

  it('rejects inherited line height before it can hide dynamic page text', async () => {
    await expect(renderDocument(createDynamicPageDocument(1.45))).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: expect.stringContaining(
        'Move lineHeight from PdfPage or PdfView to static PdfText styles',
      ),
    })
  })
})
