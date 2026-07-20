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

interface DynamicDocumentOptions {
  lineHeight?: number | string
  /** Extra style on the dynamic footer itself (e.g. its own lineHeight). */
  footerStyle?: Record<string, unknown>
  /** Wrap the footer in a View that also sets a lineHeight. */
  nestedViewLineHeight?: number
}

const createDynamicPageDocument = (
  options: DynamicDocumentOptions = {},
): DocumentNode => ({
  type: P.Document,
  props: {},
  children: [1, 2].map((pageNumber) => {
    const footer = {
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
        ...options.footerStyle,
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
    }

    return {
      type: P.Page,
      box: {},
      style: { lineHeight: options.lineHeight, padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: P.Text,
          box: {},
          style: { fontFamily: 'Helvetica', fontSize: 12 },
          props: {},
          children: [{ type: P.TextInstance, value: `Body ${pageNumber}` }],
        },
        options.nestedViewLineHeight === undefined
          ? footer
          : {
              type: P.View,
              box: {},
              style: { lineHeight: options.nestedViewLineHeight },
              props: {},
              children: [footer],
            },
      ],
    }
  }),
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
  layout.children as unknown as {
    children: [TextGeometry, TextGeometry & { children?: TextGeometry[] }]
  }[]

// The footer is the page's second child, or that child's own first child when
// the fixture wraps the footer in a View.
const footerGeometry = (layout: SafeDocumentNode) =>
  laidOutPages(layout).map(({ children: [, second] }) => {
    const footer = second.lines ? second : second.children![0]!
    return {
      top: footer.box.top,
      height: footer.box.height,
      lineHeight: footer.lines[0]!.box.height,
    }
  })

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
    for (const document of [createDynamicPageDocument(), createDynamicPageDocument({ lineHeight: 1.45 })]) {
      const pdf = await parsePdf((await renderDocument(document)).bytes)

      expect(pdf.pageCount).toBe(2)
      expect(pdf.pages[0]?.text).toContain('Page 1 of 2')
      expect(pdf.pages[1]?.text).toContain('Page 2 of 2')
    }
  })

  it('gives inherited-lineHeight dynamic text the same geometry as static text', async () => {
    const dynamic = await renderDocument(createDynamicPageDocument({ lineHeight: 1.45 }))
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

  it('shields dynamic text from every lineHeight source, not just a page number', async () => {
    const oracle = footerGeometry(
      (await renderDocument(createStaticFooterDocument())).layout,
    )

    // Percent lineHeight, an own lineHeight on the dynamic node itself, and a
    // nested View chain each hit the same non-idempotent upstream resolution;
    // all must resolve to the clean static line geometry. The nested variant's
    // box.top is relative to its wrapping View rather than the page, so only
    // the frame-independent line metrics are compared there.
    const variants = [
      { document: createDynamicPageDocument({ lineHeight: '145%' }), sameFrame: true },
      { document: createDynamicPageDocument({ footerStyle: { lineHeight: 1.45 } }), sameFrame: true },
      {
        document: createDynamicPageDocument({ lineHeight: 1.3, nestedViewLineHeight: 1.45 }),
        sameFrame: false,
      },
    ]

    for (const { document, sameFrame } of variants) {
      const { layout, bytes } = await renderDocument(document)
      const geometry = footerGeometry(layout)

      if (sameFrame) {
        expect(geometry).toEqual(oracle)
      }
      else {
        expect(geometry.map(({ height, lineHeight }) => ({ height, lineHeight })))
          .toEqual(oracle.map(({ height, lineHeight }) => ({ height, lineHeight })))
      }

      const pdf = await parsePdf(bytes)
      expect(pdf.pages[0]?.text).toContain('Page 1 of 2')
      expect(pdf.pages[1]?.text).toContain('Page 2 of 2')
    }
  })
})
