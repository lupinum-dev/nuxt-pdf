import type { DocumentNode, SafeDocumentNode } from '../src/runtime/server/engine/layout/index'
import * as P from '@react-pdf/primitives'
import { describe, expect, it, vi } from 'vitest'
import {
  collectLayoutWarnings,
  LAYOUT_KEY_PROP,
  renderDocument,
} from '../src/runtime/server/engine/render-document'
import { renderPlainDocument, toEngineDocument } from '../src/runtime/server/engine/plain-tree'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import type { PdfElementNode, PdfNode } from '../src/runtime/renderer'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import { parsePdf } from '../src/test/pdf'

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

const plainNode = (
  type: PdfElementNode['type'],
  props: Record<string, unknown> = {},
  children: PdfNode[] = [],
  style: Record<string, unknown> = {},
): PdfElementNode => ({ type, box: {}, style, props, children })

const plainText = (value: string, style: Record<string, unknown> = {}): PdfElementNode =>
  plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value }], {
    fontFamily: 'Helvetica',
    fontSize: 12,
    ...style,
  })

const OVERSIZED_SOURCE = 'pdfs/report.vue:12:5'

// A4 with 40 pt top and bottom padding: 761.89 pt for content.
const createTallBlockDocument = (block: PdfElementNode, before: PdfElementNode[] = []): PdfElementNode =>
  plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
    plainNode(PDF_PRIMITIVES.Page, { size: 'A4' }, [...before, { ...block, source: OVERSIZED_SOURCE }], {
      paddingBottom: 40,
      paddingTop: 40,
    }),
  ])

const unbreakable = (style: Record<string, unknown>, children: PdfElementNode[] = []) =>
  plainNode(PDF_PRIMITIVES.View, { wrap: false }, children, style)

const textLines = (count: number) => Array.from({ length: count }, (_, index) =>
  plainText(`Too tall line ${index}`, { height: 12 }))

const withoutLayoutKeys = (node: PdfNode): PdfNode => {
  if (node.type === PDF_PRIMITIVES.TextInstance) return node
  const { [LAYOUT_KEY_PROP]: _key, ...props } = node.props
  return { ...node, props, children: node.children.map(withoutLayoutKeys) }
}

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
  // Catches a path string that reaches the engine, which opens it as a file:
  // only bytes admitted by image resolution may be laid out, even when a
  // tree changed after admission.
  it.each([
    ['a file path', { src: new URL(import.meta.url).pathname }],
    ['bytes with an extra source', { src: new Uint8Array(8), source: 'logo.png' }],
  ])('rejects an image with %s', async (_, props) => {
    const element = (
      type: PdfElementNode['type'],
      nodeProps: Record<string, unknown>,
      children: PdfElementNode[] = [],
    ): PdfElementNode => ({ type, box: {}, style: {}, props: nodeProps, children })
    const document = element(PDF_PRIMITIVES.Document, {}, [
      element(PDF_PRIMITIVES.Page, {}, [element(PDF_PRIMITIVES.Image, props)]),
    ])

    await expect(renderPlainDocument(document)).rejects.toMatchObject({
      code: 'PDF_ASSET_INVALID',
    })
  })

  it('lays out and serializes a compatible document tree', async () => {
    const result = await renderDocument(createDocument())
    const header = Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')

    expect(header).toBe('%PDF-')
    expect(result.bytes.byteLength).toBeGreaterThan(500)
    expect(result.layout.children).toHaveLength(1)
    expect(result.layout.children[0]?.box?.width).toBeGreaterThan(0)
    expect(collectLayoutWarnings(result.layout)).toEqual([])
  })

  it('rejects a non-document root before layout', async () => {
    const invalid = { ...createDocument(), type: P.Page } as unknown as DocumentNode

    await expect(renderDocument(invalid)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: 'Expected a DOCUMENT root, received PAGE.',
    })
  })

  // Catches: a block the engine shrank to the page without a word (its laid
  // out height fits the page), a warning without the source position, a
  // warning for a block that fits, and authored text in the diagnostics.
  it.each([
    { label: 'a minimum height', block: unbreakable({ minHeight: 800 }, [plainText('Too tall')]), nodeHeight: 800 },
    { label: 'a height the engine shrinks', block: unbreakable({ height: 1000 }), nodeHeight: 1000 },
    { label: 'content the engine shrinks', block: unbreakable({}, textLines(70)), nodeHeight: 840 },
    {
      label: 'a margin under content on the same page',
      block: unbreakable({ height: 1000, marginBottom: 20 }),
      before: [plainText('Intro')],
      nodeHeight: 1000,
    },
    { label: 'a block that fits exactly', block: unbreakable({ height: 761.89 }), nodeHeight: undefined },
    {
      label: 'a block that fits',
      block: unbreakable({ height: 300 }, textLines(3)),
      before: [plainText('Intro')],
      nodeHeight: undefined,
    },
  ])('warns about an unbreakable block higher than the page: $label', async ({ block, before, nodeHeight }) => {
    const upstreamWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { layoutWarnings } = await renderPlainDocument(createTallBlockDocument(block, before))
      expect(layoutWarnings).toEqual(nodeHeight === undefined
        ? []
        : [{
            availableHeight: 761.89,
            code: 'PDF_UNBREAKABLE_NODE_OVERFLOW',
            nodeHeight,
            nodeType: 'PdfView',
            pageNumber: 1,
            source: { file: 'pdfs/report.vue', line: 12, column: 5 },
          }])
      expect(JSON.stringify(layoutWarnings)).not.toContain('Too tall')
    }
    finally {
      upstreamWarning.mockRestore()
    }
  })

  // Catches: the check changing the PDF, through the extra layout or through
  // the layout keys it puts on pages and blocks.
  it('writes the same bytes as one layout of the tree without layout keys', async () => {
    const upstreamWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const document = createTallBlockDocument(unbreakable({}, textLines(70)), [plainText('Intro')])
      const checked = await renderPlainDocument(document)
      const facts = { destinations: {}, breaks: [], firstPages: {}, sizeEveryPage: false }
      const plain = withoutLayoutKeys(toEngineDocument(document, facts).document as unknown as PdfNode)
      const unchecked = await renderDocument(plain as unknown as DocumentNode)

      expect(checked.layoutWarnings).toHaveLength(1)
      expect(Buffer.from(checked.bytes).equals(Buffer.from(unchecked.bytes))).toBe(true)
    }
    finally {
      upstreamWarning.mockRestore()
    }
  })

  // A4 with 40 pt padding leaves 761.89 pt. `fixed` nodes repeat above the
  // content after them, so content that never fits made pagination loop
  // until the timeout (in-process: forever).
  const fixedPage = (children: PdfElementNode[]) => plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
    plainNode(PDF_PRIMITIVES.Page, { size: 'A4' }, children, { paddingBottom: 40, paddingTop: 40 }),
  ])
  const fixedBlock = (height: number, props: Record<string, unknown> = {}, style: Record<string, unknown> = {}): PdfElementNode =>
    ({ ...plainNode(PDF_PRIMITIVES.View, { fixed: true, ...props }, [plainText('Head')], { height, ...style }), source: OVERSIZED_SOURCE })
  const smallLimits = () => createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, maxPages: 20, timeoutMs: 20_000 })

  // Catches: a render that loops instead of failing, an error without the
  // node, its position and both heights, and a document that renders today
  // (fixed content after the flow, only fixed content, absolute) failing.
  it.each([
    { label: 'one fixed node', children: [fixedBlock(900), ...textLines(80)], message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is 900 pt high, but every page has 761.89 pt for content.' },
    { label: 'a first-page node', children: [fixedBlock(900, { pages: 'first' }), ...textLines(80)], message: 'is 900 pt high, but the first page has 761.89 pt' },
    { label: 'a continuation node', children: [fixedBlock(900, { pages: 'continuation' }), ...textLines(80)], message: 'is 900 pt high, but every page after the first has 761.89 pt' },
    { label: 'two fixed nodes together', children: [fixedBlock(400), fixedBlock(400), ...textLines(80)], message: 'are 800 pt high together, but every page has 761.89 pt' },
    // Each fits its own pages, but the engine keeps the continuation node's
    // room on the first page too (measured: without the check, the render
    // runs until the timeout).
    {
      label: 'a first-page and a continuation node that fit alone',
      children: [fixedBlock(500, { pages: 'first' }), fixedBlock(400, { pages: 'continuation' }), ...textLines(80)],
      message: 'are 900 pt high together, but the first page has 761.89 pt for content. A pages="continuation" node keeps its room on the first page too',
    },
    {
      label: 'continuation content that fills the later pages alone',
      children: [fixedBlock(100, { pages: 'first' }), fixedBlock(800, { pages: 'continuation' }), ...textLines(80)],
      message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is 800 pt high, but every page after the first has 761.89 pt for content.',
    },
    { label: 'a fixed node inside a view', children: [plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(900), ...textLines(80)])], message: 'is 900 pt high' },
    { label: 'a fixed node after the content', children: [...textLines(80), fixedBlock(900)], message: undefined },
    { label: 'only fixed content', children: [fixedBlock(900)], message: undefined },
    { label: 'an absolute fixed node', children: [fixedBlock(900, {}, { position: 'absolute' }), ...textLines(80)], message: undefined },
  ])('fails fast when fixed content fills the page: $label', async ({ children, message }) => {
    const render = renderPlainDocument(fixedPage(children), { limits: smallLimits() })
    if (message === undefined) {
      await expect(render).resolves.toMatchObject({ bytes: expect.any(Uint8Array) })
      return
    }
    await expect(render).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      source: { file: 'pdfs/report.vue', line: 12, column: 5 },
      message: expect.stringContaining(message),
    })
  }, 30_000)

  // Catches: a case the precheck cannot judge looping forever in-process
  // (the deadline is otherwise checked only after layout), and an error that
  // does not say why.
  it.each([
    {
      label: 'an SVG that cannot break below half-page fixed content',
      children: [fixedBlock(500), plainNode(PDF_PRIMITIVES.Svg, { width: 100, height: 400, viewBox: '0 0 100 400' }, [], { width: 100, height: 400 })],
      cause: 'Fixed content takes 500 pt of the 761.89 pt content area on every page it repeats on.',
    },
    {
      label: 'an SVG higher than the room below a low fixed head',
      children: [fixedBlock(200), plainNode(PDF_PRIMITIVES.Svg, { width: 100, height: 700, viewBox: '0 0 100 700' }, [], { width: 100, height: 700 })],
      cause: 'Fixed content takes 200 pt of the 761.89 pt content area on every page it repeats on.',
    },
    // The fixed-content check does not look inside rows, so only the
    // deadline ends this shape, and the hint names the row.
    {
      label: 'a fixed node higher than the page above the content of a row column',
      children: [plainNode(PDF_PRIMITIVES.View, {}, [
        plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(900), plainText('Below the fixed node')], { flexGrow: 1 }),
        plainNode(PDF_PRIMITIVES.View, {}, [plainText('Beside the fixed node')], { flexGrow: 1 }),
      ], { flexDirection: 'row' })],
      cause: 'A fixed node in a row repeats next to the content on every page the row reaches.',
    },
  ])('ends pagination at the deadline when $label', async ({ children, cause }) => {
    const limits = createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 2_000 })
    await expect(renderPlainDocument(fixedPage(children), { limits })).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining(`PDF layout did not finish within its 2000ms time budget. ${cause}`),
    })
  }, 30_000)

  // Catches: a row whose next part holds only its fixed child making a new
  // page forever, and a row split dropping a painted box that starts below the
  // page end (an empty view that the split counted as nothing to show).
  it('ends a split row when only its fixed child is left and keeps a painted box', async () => {
    const lines = Array.from({ length: 57 }, (_, index) => plainText(`Row line ${index}`))
    const column = plainNode(PDF_PRIMITIVES.View, {}, [...lines, plainNode(PDF_PRIMITIVES.View, {}, [], { height: 60, marginTop: 10, backgroundColor: 'red' })], { flexGrow: 1 })
    const render = await renderPlainDocument(fixedPage([plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(900), column], { flexDirection: 'row' })]), { limits: smallLimits() })
    const pdf = await parsePdf(render.bytes)
    interface Painted { style?: { backgroundColor?: unknown }, children?: readonly Painted[] }
    const redBoxes = (node: Painted): number =>
      (node.style?.backgroundColor === 'red' ? 1 : 0) + (node.children ?? []).reduce((sum, child) => sum + redBoxes(child), 0)

    expect(pdf.pages.map(page => page.text.match(/Row line \d+/g)?.length ?? 0)).toEqual([57, 0])
    expect(pdf.pages.map(page => page.text.match(/Head/g)?.length ?? 0)).toEqual([1, 1])
    expect(render.layout.children.map(redBoxes)).toEqual([0, 1])
  })

  // Catches: the page guard reaching the PDF (each node paints `q … Q`).
  it('writes the same bytes with the page guard as without it', async () => {
    const document = fixedPage([fixedBlock(500), ...textLines(80)])
    const guarded = await renderPlainDocument(document, { limits: smallLimits() })
    const facts = { destinations: {}, breaks: [], firstPages: {}, sizeEveryPage: false }
    const unguarded = await renderDocument(toEngineDocument(document, facts).document)
    expect(guarded.layout.children.length).toBeGreaterThan(1)
    expect(Buffer.from(guarded.bytes).equals(Buffer.from(unguarded.bytes))).toBe(true)
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
