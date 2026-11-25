import layoutDocument, { type DocumentNode, type SafeDocumentNode } from '../src/runtime/server/engine/layout/index'
import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { collectLayoutWarnings } from '../src/runtime/server/engine/layout-diagnostics'
import { LAYOUT_KEY_PROP } from '../src/runtime/server/engine/laid-out'
import { layoutPdfTree } from '../src/runtime/server/engine/layout-pass'
import { serializePdfLayout } from '../src/runtime/server/engine/render-document'
import { renderDocument } from './engine-render'
import { renderPlainDocument, toEngineDocument } from '../src/runtime/server/engine/plain-tree'
import { countedWork } from '../src/runtime/server/engine/work'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import type { PdfElementNode, PdfNode } from '../src/runtime/renderer'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS, renderDeadlineError } from '../src/runtime/server/render-limits'
import { parsePdf } from '../src/test/pdf'
import { pageContents } from './fixtures/tagged-document'

const createDocument = (fontFamily = 'Helvetica'): DocumentNode => ({
  type: PDF_PRIMITIVES.Document,
  props: {
    title: 'Engine proof',
    creationDate: new Date('2026-07-20T00:00:00.000Z'),
  },
  children: [
    {
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: PDF_PRIMITIVES.Text,
          box: {},
          style: { fontFamily, fontSize: 18 },
          props: {},
          children: [
            { type: PDF_PRIMITIVES.TextInstance, value: 'Nuxt PDF engine proof' },
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
  plainText(`Too tall line ${index}`, { height: 12, lineHeight: 1 }))

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
  /** The footer's text as written, without a page token: the oracle's footer. */
  staticFooter?: boolean
}

const createDynamicPageDocument = (
  options: DynamicDocumentOptions = {},
): DocumentNode => ({
  type: PDF_PRIMITIVES.Document,
  props: {},
  children: [1, 2].map((pageNumber) => {
    const footer = {
      type: PDF_PRIMITIVES.Text,
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
      props: options.staticFooter
        ? { fixed: true }
        : {
            fixed: true,
            render: ({
              pageNumber: currentPage,
              totalPages,
            }: { pageNumber: number, totalPages?: number }) =>
              `Page ${currentPage} of ${totalPages}`,
          },
      children: options.staticFooter ? [{ type: PDF_PRIMITIVES.TextInstance, value: `Page ${pageNumber} of 2` }] : [],
    }

    return {
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { lineHeight: options.lineHeight, padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: PDF_PRIMITIVES.Text,
          box: {},
          style: { fontFamily: 'Helvetica', fontSize: 12 },
          props: {},
          children: [{ type: PDF_PRIMITIVES.TextInstance, value: `Body ${pageNumber}` }],
        },
        options.nestedViewLineHeight === undefined
          ? footer
          : {
              type: PDF_PRIMITIVES.View,
              box: {},
              style: { lineHeight: options.nestedViewLineHeight },
              props: {},
              children: [footer],
            },
      ],
    }
  }),
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

describe('React PDF engine pipeline', () => {
  // Catches a path string that reaches the engine, which opens it as a file:
  // only bytes admitted by image resolution may be laid out, even when a
  // tree changed after admission.
  it.each([
    ['a file path', { src: new URL(import.meta.url).pathname }],
    ['bytes with an extra source', { src: new Uint8Array(8), source: 'logo.png' }],
    ['bytes that are not an image', { src: new Uint8Array(8) }],
    // A JPEG signature with an EXIF block that claims 65,535 entries and no
    // EOI marker at the end: the header reader the layout shares with
    // admission (engine/image) fails.
    ['bytes that do not decode', { src: Buffer.from('ffd8ffe1001245786966000049492a0008000000ffffc0ff000b0800010001010111ff00da0008010100003f0000d9ff', 'hex') }],
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
    const invalid = { ...createDocument(), type: PDF_PRIMITIVES.Page } as unknown as DocumentNode

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
    // Pagination never places a fixed node: every page draws it where it is,
    // like a watermark, so no content is lost to a page it does not fit.
    {
      label: 'a fixed block (none: pagination does not place it)',
      block: plainNode(PDF_PRIMITIVES.View, { wrap: false, fixed: true }, [], { position: 'absolute', height: 1000 }),
      nodeHeight: undefined,
    },
    {
      label: 'a block that fits',
      block: unbreakable({ height: 300 }, textLines(3)),
      before: [plainText('Intro')],
      nodeHeight: undefined,
    },
    // An absolute node takes no flow room and its page clips it: nothing
    // shrinks it, so it has no natural height to report.
    {
      label: 'an absolute block (none: it is not in the flow)',
      block: plainNode(PDF_PRIMITIVES.View, { wrap: false }, [], { position: 'absolute', top: 0, height: 1000 }),
      nodeHeight: undefined,
    },
    // The natural-height layout leaves the page height automatic; a
    // percentage height beside the block keeps the page's height as its base.
    {
      label: 'a block beside a percentage height',
      block: unbreakable({ height: 1000 }),
      before: [plainNode(PDF_PRIMITIVES.View, {}, [], { height: '10%' })],
      nodeHeight: 1000,
    },
    // A fixed node takes its room on every page, so the block fits no page:
    // it is shrunk to the room below the fixed node, as when it is higher
    // than the page. Catches pagination that moves it page after page.
    {
      label: 'a block higher than the room an in-flow fixed node leaves',
      block: unbreakable({ height: 500 }, textLines(3)),
      before: [plainNode(PDF_PRIMITIVES.View, { fixed: true }, [plainText('Head')], { height: 400 }), plainText('Intro')],
      nodeHeight: 500,
      availableHeight: 361.89,
    },
  ])('warns about an unbreakable block higher than the page: $label', async ({ block, before, nodeHeight, availableHeight = 761.89 }) => {
    const upstreamWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { layoutWarnings } = await renderPlainDocument(createTallBlockDocument(block, before))
      expect(layoutWarnings).toEqual(nodeHeight === undefined
        ? []
        : [{
            availableHeight,
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

  // A full-page absolute background above a page-high view: the SVG is
  // 842 pt on a page of 841.89. Catches the background taken as a flow block
  // higher than the page: the natural-height layout ran and the view's 100%
  // failed it with PDF_TREE_INVALID (the earlier pagination put the SVG alone
  // on page 1 and warned twice).
  const fullPageSvg = () => plainNode(PDF_PRIMITIVES.Svg, { width: 595, height: 842, viewBox: '0 0 595 842' }, [plainNode(PDF_PRIMITIVES.Rect, { x: 0, y: 0, width: 595, height: 842, fill: '#eeeeee' })], { position: 'absolute', top: 0, left: 0 })
  const backgroundPage = (children: PdfElementNode[]) => plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
    plainNode(PDF_PRIMITIVES.Page, { size: 'A4' }, [fullPageSvg(), ...children], { padding: 0 }),
  ])
  it('keeps a full-page absolute SVG on the page of the content, with no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await renderPlainDocument(backgroundPage([plainNode(PDF_PRIMITIVES.View, {}, [plainText('Body')], { height: '100%' })]))
      expect({ pages: (await parsePdf(result.bytes)).pages.map(page => page.text), layoutWarnings: result.layoutWarnings, warned: warn.mock.calls.map(call => String(call[0])) })
        .toEqual({ pages: ['Body'], layoutWarnings: [], warned: [] })
    }
    finally {
      warn.mockRestore()
    }
  })

  // Catches the background counted as a block that fills the page: the
  // natural-height layout, a whole layout more, ran for every such document.
  it('lays out a document with a full-page absolute background once', async () => {
    const { work } = await countedWork(() => renderPlainDocument(backgroundPage([plainText('Body')])))
    expect(work.layouts).toBe(1)
  })

  // Catches: lines that a box's height cuts off, or an absolute node's lines
  // and boxes below the page end, going unreported (content missing with no
  // signal), a count that differs from what is not drawn, and a warning for
  // lines past `maxLines`, which the author asked to drop.
  const tenLines = Array.from({ length: 10 }, (_, index) => `Line ${index}`).join('\n')
  const at = { source: { file: 'pdfs/report.vue', line: 12, column: 5 } }
  it.each([
    { label: 'a text with a height', block: plainText(tenLines, { height: 40 }), hidden: { nodeType: 'PdfText', hiddenLines: 7, hiddenNodes: 0, ...at } },
    { label: 'a text in a view with a height', block: plainNode(PDF_PRIMITIVES.View, {}, [plainText(tenLines)], { height: 40 }), hidden: { nodeType: 'PdfText', hiddenLines: 7, hiddenNodes: 0 } },
    { label: 'a text in a view with a maxHeight', block: plainNode(PDF_PRIMITIVES.View, {}, [plainText(tenLines)], { maxHeight: 40 }), hidden: { nodeType: 'PdfText', hiddenLines: 7, hiddenNodes: 0 } },
    // The wrapper starts at the content top, 40 pt: the lines from 780 pt on are past the page end at 841.89 pt.
    { label: 'an absolute text below the page end', block: plainNode(PDF_PRIMITIVES.View, {}, [plainText('Intro'), plainText(tenLines, { position: 'absolute', top: 740, left: 40 })]), hidden: { nodeType: 'PdfText', hiddenLines: 5, hiddenNodes: 0 } },
    {
      label: 'an absolute view with an image below the page end',
      block: plainNode(PDF_PRIMITIVES.View, {}, [plainText('Intro'), plainNode(PDF_PRIMITIVES.View, {}, [plainNode(PDF_PRIMITIVES.Image, { src: readFileSync(new URL('./fixtures/assets/sample.png', import.meta.url)) }, [], { width: 20, height: 20 })], { position: 'absolute', top: 850, left: 40 })]),
      hidden: { nodeType: 'PdfView', hiddenLines: 0, hiddenNodes: 1 },
    },
    { label: 'a text with maxLines (none)', block: plainText(tenLines, { maxLines: 2 }), hidden: undefined },
  ])('warns about content that is not drawn: $label', async ({ block, hidden }) => {
    const { layoutWarnings } = await renderPlainDocument(createTallBlockDocument(block))
    expect(layoutWarnings.filter(warning => warning.code === 'PDF_CONTENT_HIDDEN')).toEqual(hidden === undefined ? [] : [{ code: 'PDF_CONTENT_HIDDEN', pageNumber: 1, ...hidden }])
  })

  // yoga sizes a child of a wrapping column by its max-content width: a call
  // without a width, with a height that is yoga's guess. Catches that height
  // read as a cut, which hid lines and reported them hidden, and the text
  // laid out without a width, which put each word on its own line.
  it('keeps every line of a text without a width in a wrapping column', async () => {
    const result = await renderPlainDocument(createTallBlockDocument(plainNode(PDF_PRIMITIVES.View, {}, [plainText('Line 0\nLine 1')], { flexWrap: 'wrap' })))
    expect(result.layoutWarnings.filter(warning => warning.code === 'PDF_CONTENT_HIDDEN')).toEqual([])
    expect((await parsePdf(result.bytes)).pages.map(page => page.textRuns.map(run => run.text))).toEqual([['Line 0', 'Line 1']])
  })

  // A footer declared last, after a block that can never fit and stays cut
  // at the page end. Catches the fixed nodes after the block left off its
  // page: the footer would print on page 2 only.
  it('repeats a fixed node after a block that stays cut at the page end', async () => {
    const upstreamWarning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const footer = plainNode(PDF_PRIMITIVES.Text, { fixed: true }, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Footer' }], {
        fontFamily: 'Helvetica', fontSize: 12, position: 'absolute', bottom: 10, left: 40,
      })
      const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
        plainNode(PDF_PRIMITIVES.Page, { size: 'A4' }, [plainText('TOP'), unbreakable({ height: 900 }), plainText('After'), footer], { paddingTop: 40, paddingBottom: 40 }),
      ])
      const parsed = await parsePdf((await renderPlainDocument(document)).bytes)
      expect(['TOP', 'After', 'Footer'].map(text => parsed.pages.filter(page => page.textItems.includes(text)).map(page => page.number))).toEqual([[1], [2], [1, 2]])
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
      const facts = { destinations: {}, breaks: [] }
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
    // Each fits its own pages: a continuation node takes no room on the
    // first page.
    {
      label: 'a first-page and a continuation node that fit alone',
      children: [fixedBlock(500, { pages: 'first' }), fixedBlock(400, { pages: 'continuation' }), ...textLines(80)],
      message: undefined,
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

  // Catches: a fixed node on the page between flow content rendered. On a page
  // that ends before it, pagination puts it below that page's flow and squeezes
  // the flow to fit it, so lines overlap (measured: 27 lines of 13.2 pt in
  // 12.85 pt steps). A fixed node between the flow content of a view squeezes
  // the pages that view reaches the same way (measured: 374.3 and 387.1 pt
  // lines on one page). Also catches the error for fixed nodes before or after
  // the flow, absolute ones, a fixed cell of a row (beside the other cells)
  // and those in a fixed or wrap={false} view, which never breaks.
  it.each([
    { label: 'between flow content', children: () => [...textLines(60), fixedBlock(20), ...textLines(20)], message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is between the flow content. ' },
    // One page: the error does not depend on the page count, so it shows in the first render, before the data grows.
    { label: 'between flow content on one page', children: () => [plainText('Intro'), fixedBlock(20), plainText('After')], message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is between the flow content. ' },
    { label: 'before and after the flow', children: () => [fixedBlock(20), ...textLines(80), fixedBlock(20)], message: undefined },
    { label: 'absolute, between flow content', children: () => [plainText('Intro'), fixedBlock(20, {}, { position: 'absolute' }), ...textLines(80)], message: undefined },
    { label: 'inside a view, between its flow content', children: () => [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Intro'), fixedBlock(20), ...textLines(80)])], message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is between the flow content of a <PdfView>. ', parent: true },
    { label: 'in a view inside a row cell', children: () => [plainNode(PDF_PRIMITIVES.View, {}, [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Intro'), fixedBlock(20), plainText('After')], { width: 100 })], { flexDirection: 'row' })], message: 'A fixed <PdfView> at pdfs/report.vue:12:5 is between the flow content of a <PdfView>. ', parent: true },
    { label: 'inside a view, before and after its flow content', children: () => [plainText('Intro'), plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(20), ...textLines(80), fixedBlock(20)])], message: undefined },
    { label: 'a fixed cell between the cells of a row', children: () => [plainNode(PDF_PRIMITIVES.View, {}, [plainNode(PDF_PRIMITIVES.View, {}, textLines(80), { width: 100 }), fixedBlock(20, {}, { width: 100 }), plainNode(PDF_PRIMITIVES.View, {}, textLines(3), { width: 100 })], { flexDirection: 'row' })], message: undefined },
    { label: 'inside a wrap={false} view', children: () => [plainNode(PDF_PRIMITIVES.View, { wrap: false }, [plainText('Intro'), fixedBlock(20), plainText('After')])], message: undefined },
    { label: 'inside a fixed view', children: () => [plainNode(PDF_PRIMITIVES.View, { fixed: true }, [plainText('Intro'), fixedBlock(20), plainText('After')]), ...textLines(80)], message: undefined },
  ])('rejects a fixed node on the page between flow content: $label', async ({ children, message, parent }) => {
    const render = renderPlainDocument(fixedPage(children()), { limits: smallLimits() })
    if (message === undefined) {
      await expect(render).resolves.toMatchObject({ bytes: expect.any(Uint8Array) })
      return
    }
    await expect(render).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      source: { file: 'pdfs/report.vue', line: 12, column: 5 },
      message: expect.stringContaining(message + `A fixed node repeats on every page${parent ? ' its parent reaches' : ''}, so on a page that ends before it, the content of that page would be squeezed to make room for it. Put fixed nodes before the flow (a header) or after it (a footer written last), or give the node position: absolute.`),
    })
  }, 30_000)

  // A block that cannot split and is higher than the room below the fixed
  // content stays where it starts, cut, with the warning. Catches the move to
  // the next page, where it crossed the page end again under the same fixed
  // content: pagination looped until the deadline (in a row, since the
  // guard, it failed with 'Pagination cannot end').
  it.each([
    { label: 'an SVG that cannot break below half-page fixed content', fixed: 500, height: 400, inRow: false },
    { label: 'an SVG higher than the room below a low fixed head', fixed: 200, height: 700, inRow: false },
    { label: 'an SVG cell of a row higher than the room below a header', fixed: 100, height: 700, inRow: true },
  ])('keeps $label where it starts, with the warning', async ({ fixed, height, inRow }) => {
    const svg = plainNode(PDF_PRIMITIVES.Svg, { width: 100, height, viewBox: `0 0 100 ${height}` }, [], { width: 100, height })
    const children = inRow
      ? [plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(fixed), plainNode(PDF_PRIMITIVES.View, {}, [svg, plainText('Beside the block')], { flexDirection: 'row' })])]
      : [fixedBlock(fixed), svg]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { layoutWarnings } = await renderPlainDocument(fixedPage(children), { limits: smallLimits() })
    expect(layoutWarnings).toEqual([{ code: 'PDF_UNBREAKABLE_NODE_OVERFLOW', pageNumber: 1, nodeType: 'PdfSvg', nodeHeight: height, availableHeight: Math.round((761.89 - fixed) * 100) / 100 }])
  }, 30_000)

  // A fixed node written after the flow (a footer written last) follows the
  // last line of each page and takes its room there: 57 lines of 13.2 pt
  // fit 761.89 pt, 56 with the footer. Catches a footer that takes room on a
  // page it does not show on: a pages="continuation" footer leaves page 1 its
  // 57th line (decision 1; today's pagination kept the room there too).
  it.each([
    { label: 'on every page', pages: undefined, lines: [56, 56, 56, 32], footers: [1, 2, 3, 4] },
    { label: 'from page 2 on', pages: 'continuation', lines: [57, 56, 56, 31], footers: [2, 3, 4] },
  ])('places a footer written after the flow below each page\'s last line, $label', async ({ pages, lines, footers }) => {
    const footer = plainNode(PDF_PRIMITIVES.Text, { fixed: true, ...(pages ? { pages } : {}) }, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Footer' }], { fontFamily: 'Helvetica', fontSize: 12 })
    const lineTexts = Array.from({ length: 200 }, (_, index) => plainText(`Line ${index}`))
    const parsed = await parsePdf((await renderPlainDocument(fixedPage([...lineTexts, footer]))).bytes)
    const onPages = parsed.pages.map(page => page.textRuns.filter(run => run.text.startsWith('Line ')))

    expect(onPages.map(runs => runs.length)).toEqual(lines)
    expect(parsed.pages.flatMap(page => page.textRuns.some(run => run.text === 'Footer') ? [page.number] : [])).toEqual(footers)
    for (const number of footers) {
      const footerRun = parsed.pages[number - 1]!.textRuns.find(run => run.text === 'Footer')!
      expect(onPages[number - 1]!.at(-1)!.y - footerRun.y).toBeCloseTo(13.2, 2)
    }
  })

  // Catches: a page number or total on a page with wrap={false} that differs
  // from its place, that page split or painted before its header got its
  // values (the header of the whole page is laid out with them), and a
  // pages="continuation" node on it taking room in that layout but not in
  // the paint with the total (the render fails on the shift).
  it('lays out a page with wrap={false} as one page between pages that split', async () => {
    const header = plainNode(PDF_PRIMITIVES.Text, { fixed: true }, [
      { type: PDF_PRIMITIVES.TextInstance, value: 'Page ' },
      plainNode(PDF_PRIMITIVES.PageNumber),
      { type: PDF_PRIMITIVES.TextInstance, value: ' of ' },
      plainNode(PDF_PRIMITIVES.PageCount),
    ], { fontFamily: 'Helvetica', fontSize: 12 })
    const continued = plainNode(PDF_PRIMITIVES.Text, { fixed: true, pages: 'continuation' }, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Continued' }], { fontFamily: 'Helvetica', fontSize: 12 })
    const page = (props: Record<string, unknown>, texts: string[]) =>
      plainNode(PDF_PRIMITIVES.Page, { size: 'A6', ...props }, [header, continued, ...texts.map(text => plainText(text))], { paddingBottom: 30, paddingTop: 30 })
    const lines = (from: number, count: number) => Array.from({ length: count }, (_, index) => `Line ${from + index}`)
    const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
      page({}, lines(0, 60)),
      page({ wrap: false }, ['Whole page', ...lines(60, 5)]),
      page({}, lines(65, 40)),
    ])
    const parsed = await parsePdf((await renderPlainDocument(document)).bytes)

    const total = parsed.pages.length
    expect(parsed.pages.map(page => page.textRuns.find(run => run.text.startsWith('Page '))?.text)).toEqual(parsed.pages.map(page => `Page ${page.number} of ${total}`))
    const whole = parsed.pages.filter(page => page.textRuns.some(run => run.text === 'Whole page'))
    expect(whole.map(page => page.textRuns.filter(run => run.text.startsWith('Line ')).map(run => run.text))).toEqual([lines(60, 5)])
    expect(whole[0]!.textRuns.some(run => run.text === 'Continued')).toBe(false)
    expect(parsed.pages.flatMap(page => page.textRuns.filter(run => run.text.startsWith('Line ')).map(run => run.text))).toEqual(lines(0, 105))
  })

  // Catches: a box with a height that crosses the page end split there (its
  // first lines on page 1, as the earlier pagination did) instead of moving
  // whole. 25 lines of
  // 13.2 pt end at 330 pt of 359.53 pt: the 100 pt box does not fit below.
  const boxLines = Array.from({ length: 8 }, (_, index) => `Box ${index}`).join('\n')
  it.each([
    { label: 'a view with a height', box: () => plainNode(PDF_PRIMITIVES.View, {}, [plainText(boxLines)], { height: 100 }), height: 100 },
    // At most 100 pt: as high as the 7 lines it keeps.
    { label: 'a view with a maxHeight', box: () => plainNode(PDF_PRIMITIVES.View, {}, [plainText(boxLines)], { maxHeight: 100 }), height: 92.4 },
    { label: 'a text with a height', box: () => plainText(boxLines, { height: 100 }), height: 100 },
  ])('moves $label whole to the next page when it crosses the page end', async ({ box, height }) => {
    const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
      plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [...Array.from({ length: 25 }, (_, index) => plainText(`Line ${index}`)), box(), plainText('After')], { paddingBottom: 30, paddingTop: 30 }),
    ])
    const parsed = await parsePdf((await renderPlainDocument(document)).bytes)

    // 100 pt hold 7 lines of 13.2 pt: Box 7 is not drawn (PDF_CONTENT_HIDDEN).
    expect(parsed.pages.map(page => page.textRuns.filter(run => run.text.startsWith('Box ')).map(run => run.text))).toEqual([[], ['Box 0', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5', 'Box 6']])
    const second = parsed.pages[1]!.textRuns
    expect(second.find(run => run.text === 'After')!.y).toBeCloseTo(second.find(run => run.text === 'Box 0')!.y - height, 1)
  })

  // Catches the line between the two box rules in the wrong place: a box
  // just lower than the content area (761.89 pt) split instead of moving,
  // or one higher than a page cut at the first page end, which drops what
  // today's pagination paints, its parts not adding up to its height, and a
  // part without the background.
  it.each([
    { label: 'a box just lower than the content area moves whole', height: 760, parts: [760] },
    { label: 'a box higher than two pages splits, and its parts share its height', height: 2000, parts: [761.89, 761.89, 476.22] },
  ])('$label', async ({ height, parts }) => {
    const box = plainNode(PDF_PRIMITIVES.View, {}, [], { height, backgroundColor: '#ff0000' })
    const { bytes, layout } = await renderPlainDocument(fixedPage([plainText('Before'), box]))
    type Laid = { children: { style: Record<string, unknown>, box: { height: number } }[] }
    const boxes = (layout.children as unknown as Laid[]).flatMap(page => page.children.filter(child => child.style.backgroundColor !== undefined))
    // After 'Before' (13.2 pt), the first page has no room for the 760 pt box; the 2000 pt box starts below it.
    const expected = height === 2000 ? [761.89 - 13.2, 761.89, 2000 - 761.89 * 2 + 13.2] : parts
    expect(boxes.map(part => Math.round(part.box.height * 100) / 100)).toEqual(expected.map(value => Math.round(value * 100) / 100))
    expect(boxes.reduce((sum, part) => sum + part.box.height, 0)).toBeCloseTo(height, 1)
    const painted = pageContents(bytes).map(content => content.includes('1 0 0 rg'))
    expect(painted).toEqual(height === 2000 ? [true, true, true] : [false, true])
  })

  // Catches: a pagination that cannot end running until the deadline (and,
  // without limits, forever) instead of failing at once with a typed error.
  // The precheck judges none of these: the fixed node is in a row, or lower
  // than the page.
  it.each([
    {
      label: 'a fixed node higher than the page above the content of a row column',
      children: [plainNode(PDF_PRIMITIVES.View, {}, [
        plainNode(PDF_PRIMITIVES.View, {}, [fixedBlock(900), plainText('Below the fixed node')], { flexGrow: 1 }),
        plainNode(PDF_PRIMITIVES.View, {}, [plainText('Beside the fixed node')], { flexGrow: 1 }),
      ], { flexDirection: 'row' })],
      pages: '2 and 3',
    },
    { label: 'a line that never fits below fixed content', children: [fixedBlock(755), ...['One', 'Two', 'Three'].map(text => plainText(text))], pages: '1 and 2' },
  ])('fails fast when pagination cannot end: $label', async ({ children, pages }) => {
    const limits = createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 5_000 })
    await expect(renderPlainDocument(fixedPage(children), { limits })).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: expect.stringContaining(`Pagination cannot end: pages ${pages} take no content from the flow`),
    })
  }, 30_000)

  // Catches the check above failing pages that take only what an author
  // asked for (the box of an empty view, a forced break: blank pages), or
  // failing at the first page that takes nothing: the first part of a view
  // keeps its top padding, the next part does not. Two such pages with a
  // page that takes content between them are not in a row; catches a count
  // that a page with content does not reset.
  it.each([
    { label: 'nothing, once: a top padding that leaves no room for the first line', children: [plainNode(PDF_PRIMITIVES.View, {}, [plainText('After the padding')], { paddingTop: 755 })], pageCount: 2 },
    {
      label: 'nothing on two pages that are not in a row',
      children: [
        plainNode(PDF_PRIMITIVES.View, {}, [plainText('One')], { paddingTop: 755 }),
        ...textLines(3),
        plainNode(PDF_PRIMITIVES.View, { break: true }, [plainText('Two')], { paddingTop: 755 }),
      ],
      pageCount: 4,
    },
    { label: 'only parts of a coloured view higher than two pages', children: [plainNode(PDF_PRIMITIVES.View, {}, [], { height: 2000, backgroundColor: '#eeeeee' })], pageCount: 3 },
    {
      label: 'only a forced break, three times in a row',
      children: [plainText('First'), ...Array.from({ length: 3 }, () => plainNode(PDF_PRIMITIVES.View, { break: true })), plainText('Last')],
      pageCount: 4,
    },
  ])('renders pages that take $label', async ({ children, pageCount }) => {
    const { bytes } = await renderPlainDocument(fixedPage(children), { limits: smallLimits() })
    expect((await parsePdf(bytes)).pages).toHaveLength(pageCount)
  }, 30_000)

  // Catches a pagination that runs past the deadline: in-process, the
  // deadline was checked only after the layout returned. The clock says time
  // is left at the stage boundaries (`check`) and none while pagination runs
  // (`remainingMs`), as for a document too long for its budget.
  it('ends pagination at the deadline', async () => {
    const limits = { ...smallLimits(), deadline: { check() {}, remainingMs: () => 0 } }
    await expect(renderPlainDocument(fixedPage(textLines(80)), { limits })).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('PDF render exceeded its 20000ms time budget'),
    })
  })

  // Catches a paint that ignores the deadline: in-process (a serverless build
  // has no worker timer) a long document would be written past its budget.
  // The clock has time left at the check before the paint and none after it.
  it('ends the paint at the deadline', async () => {
    const document = createDocument()
    const layout = await layoutPdfTree(document, createPdfFontStore())
    let checks = 0
    const deadline = {
      check: () => {
        checks += 1
        if (checks > 1) throw renderDeadlineError(20_000, 20_001)
      },
      remainingMs: () => 0,
    }
    await expect(serializePdfLayout(document.props, layout, true, { ...smallLimits(), deadline })).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('PDF render exceeded its 20000ms time budget'),
    })
  })

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

  // Catches a family without the asked face failing with the store's bare
  // message, which names neither the node nor its position nor the fix, and
  // a weight without a face painted in the closest registered weight
  // (semibold Helvetica painted bold). `Helvetica-Bold` as a family has one
  // face, normal 400.
  it.each([
    ['style', { fontFamily: 'Helvetica-Bold', fontStyle: 'italic' }, 'asks for Helvetica-Bold in fontStyle italic, fontWeight 400, but Helvetica-Bold has no italic face (registered: normal 400). Register an italic file for Helvetica-Bold in `pdf.fonts`, or use another family.'],
    ['weight', { fontFamily: 'Helvetica', fontWeight: 'semibold' }, 'asks for Helvetica in fontStyle normal, fontWeight 600, but Helvetica has no normal face of weight 600 (registered: normal 400, normal 700, italic 400, italic 700). Register the normal 600 face of Helvetica in `pdf.fonts`, or use a registered weight.'],
  ] as const)('names the node, its position and the faces of a family without the asked %s', async (_, style, message) => {
    const row = { ...plainNode(PDF_PRIMITIVES.View, {}, [plainText('Grüner Veltliner')], style), source: 'pdfs/menu.vue:12:5' }
    await expect(renderPlainDocument(plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, {}, [row])]))).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: `<PdfView> at pdfs/menu.vue:12:5 ${message}`,
      source: { file: 'pdfs/menu.vue', line: 12, column: 5 },
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

  // Dynamic text (a page token) is laid out again on every page. It must
  // take every lineHeight as static text does: inherited, as a percentage,
  // its own, and through a nested view. The engine used to give it the
  // font's normal line height instead.
  it.each<[string, DynamicDocumentOptions]>([
    ['inherited from the page', { lineHeight: 1.45 }],
    ['as a percentage', { lineHeight: '145%' }],
    ['of its own', { footerStyle: { lineHeight: 1.45 } }],
    ['through a nested view', { lineHeight: 1.3, nestedViewLineHeight: 1.45 }],
  ])('lays out dynamic text with a lineHeight %s like static text', async (_, options) => {
    const dynamic = await renderDocument(createDynamicPageDocument(options))
    const staticEquivalent = await renderDocument(createDynamicPageDocument({ ...options, staticFooter: true }))
    const plain = footerGeometry((await renderDocument(createDynamicPageDocument({ staticFooter: true }))).layout)

    expect(footerGeometry(dynamic.layout)).toEqual(footerGeometry(staticEquivalent.layout))
    expect(footerGeometry(dynamic.layout)[0]!.lineHeight).not.toBeCloseTo(plain[0]!.lineHeight, 1)
    const pdf = await parsePdf(dynamic.bytes)
    expect(pdf.pages.map(page => page.text)).toEqual([expect.stringContaining('Page 1 of 2'), expect.stringContaining('Page 2 of 2')])
  })
})

// The sizes yoga asks a measure function for depend on where the node sits:
// a column stretches it (an exact width), a row offers room up to its width
// and height, an absolute node in a row gets no width at all. The suite's
// other documents give images and SVGs a size, so each placement is here
// (branch coverage). Page 200 x 200 pt, no
// padding; the image is 700 x 420 px.
describe('measured sizes by placement', () => {
  const PNG = readFileSync(new URL('./fixtures/assets/sample.png', import.meta.url))
  // A gray PNG 1 px wide and 2 px high, for an image taller than wide.
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(2, 4)
  header.set([8, 0, 0, 0, 0], 8)
  const PORTRAIT_PNG = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 128, 0, 128]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
  // A JPEG 48 px wide and 32 px high with an EXIF block (big-endian TIFF,
  // one IFD entry) that sets its orientation.
  const SAMPLE_JPEG = readFileSync(new URL('./fixtures/corpus/images-sample.jpg', import.meta.url))
  const orientedJpeg = (orientation: number): Buffer => {
    const exif = Buffer.alloc(36)
    exif.writeUInt16BE(0xFFE1, 0)
    exif.writeUInt16BE(exif.length - 2, 2)
    exif.write('Exif\0\0MM', 4, 'latin1')
    exif.writeUInt16BE(42, 12)
    exif.writeUInt32BE(8, 14)
    exif.writeUInt16BE(1, 18)
    exif.writeUInt16BE(0x0112, 20)
    exif.writeUInt16BE(3, 22)
    exif.writeUInt32BE(1, 24)
    exif.writeUInt16BE(orientation, 28)
    return Buffer.concat([SAMPLE_JPEG.subarray(0, 2), exif, SAMPLE_JPEG.subarray(2)])
  }
  const node = (type: string, style: Record<string, unknown>, props: Record<string, unknown> = {}, children: unknown[] = []) =>
    ({ type, box: {}, style, props, children })
  const row = (child: unknown) => node(PDF_PRIMITIVES.View, { flexDirection: 'row' }, {}, [child])
  const topOfRow = (child: unknown) => node(PDF_PRIMITIVES.View, { flexDirection: 'row', height: 80, alignItems: 'flex-start' }, {}, [child])
  const absolute = { position: 'absolute' }
  const image = (style: Record<string, unknown> = {}, src: Buffer = PNG) => node(PDF_PRIMITIVES.Image, style, { src })
  const svg = (style: Record<string, unknown> = {}, viewBox?: string) => node(PDF_PRIMITIVES.Svg, style, viewBox === undefined ? {} : { viewBox })

  type Box = { width: number, height: number }
  type Laid = { box: Box, children?: Laid[] }
  const measured = (laid: Laid): Box => {
    const { width, height } = laid.children?.[0]?.children?.[0]?.box ?? laid.children![0]!.box
    return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 }
  }

  it.each([
    { label: 'an image in a row (room up to a width and a height)', child: row(image()), size: { width: 200, height: 120 } },
    { label: 'an image taller than wide at the top of a row 80 pt high', child: topOfRow(image({}, PORTRAIT_PNG)), size: { width: 40, height: 80 } },
    // An EXIF orientation above 4 turns the photo a quarter, so it is as wide
    // on the page as it is stored high: a tall image takes the row's height,
    // where the wide one takes the whole width.
    { label: 'a JPEG with EXIF orientation 1 at the top of a row 80 pt high', child: topOfRow(image({}, orientedJpeg(1))), size: { width: 200, height: 80 } },
    { label: 'a JPEG with EXIF orientation 6 at the top of a row 80 pt high', child: topOfRow(image({}, orientedJpeg(6))), size: { width: 53.33, height: 80 } },
    { label: 'an absolute image (room up to a width, no height)', child: image(absolute), size: { width: 200, height: 120 } },
    { label: 'an image with a height, absolute in a row (no width)', child: row(image({ ...absolute, height: 60 })), size: { width: 100, height: 60 } },
    // Higher than the page (240 pt at 400 pt wide): capped at the page less
    // the margins yoga resolved and 10 pt. A margin left as a string (`'auto'`,
    // `'0%'`) made the cap NaN, and the image 0 pt high.
    { label: 'an image higher than the page with a top margin of 10%', child: image({ width: 400, marginTop: '10%' }), size: { width: 400, height: 170 } },
    { label: 'an image higher than the page with a top margin of auto', child: image({ width: 400, marginTop: 'auto' }), size: { width: 400, height: 190 } },
    { label: 'an image higher than the page with a top margin of 0%', child: image({ width: 400, marginTop: '0%' }), size: { width: 400, height: 190 } },
    { label: 'an SVG without a size', child: svg({}, '0 0 200 100'), size: { width: 200, height: 100 } },
    { label: 'an SVG without a size or a view box', child: svg(), size: { width: 200, height: 200 } },
    { label: 'an SVG with a height, absolute in a row (no width): as in a column', child: row(svg({ ...absolute, height: 50 }, '0 0 200 100')), size: { width: 200, height: 50 } },
    { label: 'an SVG with a height, absolute in a column', child: svg({ ...absolute, height: 50 }, '0 0 200 100'), size: { width: 200, height: 50 } },
  ])('$label', async ({ child, size }) => {
    const document = {
      type: PDF_PRIMITIVES.Document,
      props: {},
      children: [node(PDF_PRIMITIVES.Page, { padding: 0 }, { size: [200, 200] }, [child])],
    } as unknown as DocumentNode
    const { layout } = await renderDocument(document)
    expect(measured(layout.children[0] as unknown as Laid)).toEqual(size)
  })

  // A row child that cannot split crosses the page end: it moves whole, or,
  // higher than the content area, stays cut at the page end. Each image is
  // drawn once: as split parts, an image was drawn on both pages, and one
  // as high as the page repeated forever. `onPage` ends a loop at 30 pages.
  it.each([
    {
      label: 'an image higher than the page in a row stays, cut at the page end',
      children: [row(image({}, PORTRAIT_PNG))],
      images: [1],
    },
    {
      label: 'an image that crosses the page end in a row moves whole',
      children: [node(PDF_PRIMITIVES.View, { height: 120 }), node(PDF_PRIMITIVES.View, { flexDirection: 'row' }, {}, [image({ height: 150 }, PORTRAIT_PNG), node(PDF_PRIMITIVES.View, { width: 20, height: 30 })])],
      images: [0, 1],
    },
    {
      label: 'an image cell of a split row is not drawn again on the next page',
      children: [node(PDF_PRIMITIVES.View, { flexDirection: 'row' }, {}, [image({ height: 50 }, PORTRAIT_PNG), node(PDF_PRIMITIVES.View, { width: 100 }, {}, Array.from({ length: 30 }, (_, index) => node(PDF_PRIMITIVES.Text, { fontFamily: 'Helvetica', fontSize: 10 }, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: `Line ${index}` }])))])],
      images: [1, 0],
    },
  ])('$label', async ({ children, images }) => {
    let pages = 0
    const document = {
      type: PDF_PRIMITIVES.Document,
      props: {},
      onPage: () => {
        if (++pages > 30) throw new Error('Pagination did not end.')
      },
      children: [node(PDF_PRIMITIVES.Page, { padding: 0 }, { size: [200, 200] }, children)],
    } as unknown as DocumentNode
    type Painted = { type: string, children?: Painted[] }
    const imagesIn = (painted: Painted): number =>
      (painted.type === PDF_PRIMITIVES.Image ? 1 : 0) + (painted.children ?? []).reduce((sum, child) => sum + imagesIn(child), 0)
    const { layout } = await renderDocument(document)
    expect((layout.children as unknown as Painted[]).map(imagesIn)).toEqual(images)
  })

  // X1-1: a row child that cannot split and crosses the page end moves
  // whole, at its own size, next to a column that splits. Split, the
  // `wrap={false}` view lost its lower lines to the next page and the SVG was
  // drawn shrunk into the room left.
  const lines = (word: string, count: number) => Array.from({ length: count }, (_, index) =>
    node(PDF_PRIMITIVES.Text, { fontFamily: 'Helvetica', fontSize: 10 }, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: `${word} ${index}` }]))
  it.each([
    { label: 'a wrap={false} view', child: node(PDF_PRIMITIVES.View, { width: 60 }, { wrap: false }, lines('Keep', 6)), kept: [[], ['Keep 0', 'Keep 1', 'Keep 2', 'Keep 3', 'Keep 4', 'Keep 5']] },
    { label: 'an SVG', child: svg({ width: 80, height: 80 }, '0 0 80 80'), kept: [[], ['80 x 80']] },
  ])('moves $label in a row whole when it crosses the page end', async ({ child, kept }) => {
    const document = {
      type: PDF_PRIMITIVES.Document,
      props: {},
      children: [node(PDF_PRIMITIVES.Page, { padding: 0 }, { size: [200, 200] }, [
        node(PDF_PRIMITIVES.View, { height: 150 }),
        node(PDF_PRIMITIVES.View, { flexDirection: 'row' }, {}, [child, node(PDF_PRIMITIVES.View, { width: 60 }, {}, lines('Side', 10))]),
      ])],
    } as unknown as DocumentNode
    type Painted = { type: string, box: { width: number, height: number }, children?: Painted[], lines?: { string: string }[] }
    // What each page draws of the kept child: its SVG's size, its lines.
    const keptOn = (painted: Painted): string[] => painted.type === PDF_PRIMITIVES.Svg
      ? [`${Math.round(painted.box.width)} x ${Math.round(painted.box.height)}`]
      : [...(painted.lines ?? []).map(line => line.string).filter(line => line.startsWith('Keep')), ...(painted.children ?? []).flatMap(keptOn)]
    const { layout } = await renderDocument(document)
    expect((layout.children as unknown as Painted[]).map(keptOn)).toEqual(kept)
  })

  it('places a static node where the flow puts it: it ignores top', async () => {
    const topOf = async (position: string) => {
      const document = {
        type: PDF_PRIMITIVES.Document,
        props: {},
        children: [node(PDF_PRIMITIVES.Page, { padding: 0 }, { size: [200, 200] }, [node(PDF_PRIMITIVES.View, { position, top: 50, height: 10 })])],
      } as unknown as DocumentNode
      const page = (await renderDocument(document)).layout.children[0] as unknown as { children: { box: { top: number } }[] }
      return page.children[0]!.box.top
    }
    expect(await topOf('static')).toBe(0)
    expect(await topOf('relative')).toBe(50)
  })

  // yoga offers an absolute child its parent's width only in a column; in a
  // row the node gets the size it has in a column (dimensions/index.ts).
  const text = (style: Record<string, unknown>) =>
    node(PDF_PRIMITIVES.Text, { fontFamily: 'Helvetica', fontSize: 10, ...style }, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Twelve words in one text that is wider than its page of two hundred points.' }])
  it.each([
    { label: 'a text', make: text, size: { width: 200, height: 22 } },
    { label: 'an image', make: image, size: { width: 200, height: 120 } },
    { label: 'an SVG', make: (style: Record<string, unknown>) => svg(style, '0 0 200 100'), size: { width: 200, height: 100 } },
  ])('$label absolute without a width measures in a row as in a column', async ({ make, size }) => {
    const layoutOf = async (child: unknown) => {
      const document = {
        type: PDF_PRIMITIVES.Document,
        props: {},
        children: [node(PDF_PRIMITIVES.Page, { padding: 0 }, { size: [200, 200] }, [child])],
      } as unknown as DocumentNode
      return measured((await renderDocument(document)).layout.children[0] as unknown as Laid)
    }
    expect(await layoutOf(row(make(absolute)))).toEqual(size)
    expect(await layoutOf(make(absolute))).toEqual(size)
  })
})

// The two places where pagination deliberately differs from the copy it
// replaced.
// Admission reads `'+0'` and `'0e1'` as points (shared/style-values.ts); the
// layout must read them the same way: the package left them as strings, a
// box edge stayed `'+0'`, and the painter failed with NaN.
it.each(['+0', '0e1'])('renders box edges of %j as the points admission reads', async (value) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [
      plainNode(PDF_PRIMITIVES.View, {}, [plainText('Edges')], { paddingTop: value, marginLeft: value, top: value }),
    ]),
  ])
  const { layout } = await renderPlainDocument(document)
  const view = (layout.children[0] as unknown as { children: { box: Record<string, unknown> }[] }).children[0]!
  expect([view.box.paddingTop, view.box.marginLeft, view.box.top]).toEqual([0, 0, 0])
})

// Style forms admission lets through that the SFC compiler never writes (it
// expands shorthands), so only a `:style` object brings them: each catches a
// side, part or operation that the style step reads wrong or drops.
it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
  ['a padding of 3 parts', { padding: '1pt 2pt 3pt' }, { paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 2 }],
  ['a margin of 4 parts', { margin: '1pt 2pt 3pt 4pt' }, { marginTop: 1, marginRight: 2, marginBottom: 3, marginLeft: 4 }],
  ['a margin with whitespace around it', { margin: ' 4pt  8pt ' }, { marginTop: 4, marginRight: 8, marginBottom: 4, marginLeft: 8 }],
  // Each side of a two-sided shorthand: the first part is the top or the
  // right side, the second the bottom or the left side (expand.ts, `boxPair`).
  ['a vertical margin of 1 part', { marginVertical: '3pt' }, { marginTop: 3, marginBottom: 3 }],
  ['a vertical margin of 2 parts', { marginVertical: '1pt 2pt' }, { marginTop: 1, marginBottom: 2 }],
  ['a horizontal margin of 1 part', { marginHorizontal: '3pt' }, { marginRight: 3, marginLeft: 3 }],
  ['a horizontal margin of 2 parts', { marginHorizontal: '1pt 2pt' }, { marginRight: 1, marginLeft: 2 }],
  ['a vertical padding of 1 part', { paddingVertical: '3pt' }, { paddingTop: 3, paddingBottom: 3 }],
  ['a vertical padding of 2 parts', { paddingVertical: '1pt 2pt' }, { paddingTop: 1, paddingBottom: 2 }],
  ['a horizontal padding of 1 part', { paddingHorizontal: '3pt' }, { paddingRight: 3, paddingLeft: 3 }],
  ['a horizontal padding of 2 parts', { paddingHorizontal: '1pt 2pt' }, { paddingRight: 1, paddingLeft: 2 }],
  // One value for every side or corner (expand.ts, `everyBorder`).
  ['a border width', { borderWidth: '2pt' }, { borderTopWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderLeftWidth: 2 }],
  ['a border colour', { borderColor: '#336699' }, { borderTopColor: '#336699', borderRightColor: '#336699', borderBottomColor: '#336699', borderLeftColor: '#336699' }],
  ['a border style', { borderStyle: 'dashed' }, { borderTopStyle: 'dashed', borderRightStyle: 'dashed', borderBottomStyle: 'dashed', borderLeftStyle: 'dashed' }],
  ['a border radius', { borderRadius: '3pt' }, { borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, borderBottomLeftRadius: 3 }],
  ['a flex keyword', { flex: 'none' }, { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }],
  ['a flex of grow and shrink', { flex: '2 3' }, { flexGrow: 2, flexShrink: 3, flexBasis: 0 }],
  ['a flex of grow, shrink and basis', { flex: '2 0 30pt' }, { flexGrow: 2, flexShrink: 0, flexBasis: 30 }],
  ['a gap of 1 part', { gap: '6pt' }, { rowGap: 6, columnGap: 6 }],
  ['a gap of 2 parts', { gap: '4pt 8pt' }, { rowGap: 4, columnGap: 8 }],
  ['a font weight as a name', { fontWeight: 'Bold' }, { fontWeight: 700 }],
  ['a font weight as a number string', { fontWeight: '700' }, { fontWeight: 700 }],
  // As written: the painter reads it, so its alpha stays exact (not 128/255).
  ['a colour with alpha', { backgroundColor: 'hsla(350, 60%, 75%, 0.5)' }, { backgroundColor: 'hsla(350, 60%, 75%, 0.5)' }],
  ['the transforms of one axis', { transform: 'scaleX(2) scaleY(3) translateY(5) translate(4)' }, { transform: [
    { operation: 'scale', value: [2, 1] },
    { operation: 'scale', value: [1, 3] },
    { operation: 'translate', value: [0, 5] },
    { operation: 'translate', value: [4, undefined] },
  ] }],
  ['the skew transforms', { transform: 'skew(10deg, 20deg) skewX(1rad) skewY(30)' }, { transform: [
    { operation: 'skew', value: [10, 20] },
    { operation: 'skew', value: [180 / Math.PI, 0] },
    { operation: 'skew', value: [0, 30] },
  ] }],
])('resolves %s', async (_name, style, expected) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Styled')], style)]),
  ])
  const { layout } = await renderPlainDocument(document)
  const view = (layout.children[0] as unknown as { children: { style: Record<string, unknown> }[] }).children[0]!
  expect(view.style).toMatchObject(expected)
})

// Catches a translation read as points: `px` is a length of the page's dpi
// in a transform as everywhere else, so on a 96 dpi page `translateX(96px)`
// moves as far as `width: '96px'` is wide, 72 pt, not 96.
it('reads a px translation at the page dpi', async () => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200], dpi: 96 }, [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Moved')], { width: '96px', transform: 'translateX(96px) translate(48px, 24pt)' })]),
  ])
  const { layout } = await renderPlainDocument(document)
  const view = layout.children[0]?.children?.[0]
  expect(view?.style).toMatchObject({ width: 72, transform: [{ operation: 'translate', value: [72, 0] }, { operation: 'translate', value: [36, 24] }] })
})

// Catches px rounded to whole points: on a 96 dpi page 1 px is 0.75 pt, so a
// hairline border neither vanishes nor doubles, and a page of 201 px is
// 150.75 pt wide.
it('converts px exactly at the page dpi, in a style and in the page size', async () => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: ['201px', '100px'], dpi: 96 }, [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Ruled')], { borderTopWidth: '1px', width: '0.5px' })]),
  ])
  const { layout } = await renderPlainDocument(document)
  expect(layout.children[0]?.style).toMatchObject({ width: 150.75, height: 75 })
  expect(layout.children[0]?.children?.[0]?.style).toMatchObject({ borderTopWidth: 0.75, width: 0.375 })
})

// Catches a rem that stops following the page: as in CSS, where it is the
// root element's font size, `rem` is the page's `fontSize`, else 18 pt.
it.each<[string, Record<string, unknown>, number]>([
  ['a page with a font size', { fontSize: 10 }, 20],
  ['a page without a font size', {}, 36],
])('reads rem as the font size of %s', async (_name, pageStyle, width) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Sized')], { width: '2rem' })], pageStyle),
  ])
  const { layout } = await renderPlainDocument(document)
  expect(layout.children[0]?.children?.[0]?.style).toMatchObject({ width })
})

// A line height with a unit is points, not a factor of the font size.
it('lays out the lines of a text with a line height in points', async () => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [plainText('Spaced', { fontSize: 10, lineHeight: '14pt' })]),
  ])
  const { layout } = await renderPlainDocument(document)
  const text = (layout.children[0] as unknown as { children: { lines: { box: { height: number } }[] }[] }).children[0]!
  expect(text.lines.map(line => line.box.height)).toEqual([14])
})

// Catches a unitless line height inherited as points: a view with 1.4 and no
// font size gave its texts 25.2 pt lines (1.4 times 18), whatever their size.
it('inherits a unitless lineHeight as a factor', async () => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [
      plainNode(PDF_PRIMITIVES.View, {}, [plainText('Small', { fontSize: 10 }), plainText('Large', { fontSize: 20 })], { lineHeight: 1.4 }),
    ]),
  ])
  const { layout } = await renderPlainDocument(document)
  const view = (layout.children[0] as unknown as { children: { children: { lines: { box: { height: number } }[] }[] }[] }).children[0]!
  expect(view.children.map(text => text.lines.map(line => line.box.height))).toEqual([[14], [28]])
})

// Catches a percentage line height taken of 18 pt instead of the element's
// inherited font size (27 pt lines for 10 pt text), and one passed down as a
// percentage instead of points.
it.each([
  ['a text with an inherited font size', [plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Line' }], { fontFamily: 'Helvetica', lineHeight: '150%' })], [15]],
  ['a view with an inherited font size, inherited by a larger text', [plainNode(PDF_PRIMITIVES.View, {}, [plainText('Line', { fontSize: 20 })], { lineHeight: '150%' })], [15]],
  // Catches a percentage line height taken of the inherited size (20 pt lines)
  // instead of the node's own percentage font size.
  ['a text with a percentage font size', [plainText('Line', { fontSize: '50%', lineHeight: '200%' })], [10]],
])('resolves a percentage lineHeight on %s', async (_label, children, heights) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [plainNode(PDF_PRIMITIVES.View, {}, children, { fontSize: 10 })]),
  ])
  const { layout } = await renderPlainDocument(document)
  type Laid = { lines?: { box: { height: number } }[], children?: Laid[] }
  const lineHeightsOf = (node: Laid): number[] => node.lines ? node.lines.map(line => line.box.height) : (node.children ?? []).flatMap(lineHeightsOf)
  expect(lineHeightsOf(layout as unknown as Laid)).toEqual(heights)
})

// Catches a percentage font size that is dropped (the text at its parent's
// size), taken of 18 pt instead of the inherited size, applied twice, or lost
// when a page number is laid out again on its page.
it.each<[string, PdfNode[], Array<[string, number]>]>([
  ['a nested text at 70 % of its parent', [plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Outer ' }, plainText('Inner', { fontSize: '70%' })], { fontFamily: 'Helvetica' })], [['Outer', 20], ['Inner', 14]]],
  ['a percentage of a percentage', [plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Half ' }, plainText('Quarter', { fontSize: '50%' })], { fontFamily: 'Helvetica', fontSize: '50%' })], [['Half', 10], ['Quarter', 5]]],
  ['a page number in a text at 70 %', [plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Page ' }, plainNode(PDF_PRIMITIVES.PageNumber)], { fontFamily: 'Helvetica', fontSize: '70%' })], [['Page', 14]]],
])('resolves a percentage fontSize: %s', async (_label, children, sizes) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [
    plainNode(PDF_PRIMITIVES.Page, { size: [300, 200] }, [plainNode(PDF_PRIMITIVES.View, {}, children, { fontSize: 20 })]),
  ])
  const pdf = await parsePdf((await renderPlainDocument(document)).bytes)
  const runs = pdf.pages[0]!.textRuns
  expect(sizes.map(([text]) => [text, runs.find(run => run.text.includes(text))?.fontSize])).toEqual(sizes)
})

// Catches a page size reader narrower than admission: these forms pass it,
// and the layout threw a plain Error ("Invalid page size").
it.each([['+100pt', 100], ['1e2pt', 100], ['100PT', 100], ['1IN', 72], ['10.mm', 28.35]])('lays out a page %s wide', async (width, points) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [width, '200pt'] })])
  const { layout } = await renderPlainDocument(document)
  expect((layout.children[0] as unknown as { box: { width: number } }).box.width).toBeCloseTo(points, 2)
})

// Catches an unanchored percentage pattern: `.5%` read as 5 %, so the box
// was ten times too wide.
it('lays out a width of .5%', async () => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [plainNode(PDF_PRIMITIVES.View, {}, [], { width: '.5%', height: 10 })])])
  const { layout } = await renderPlainDocument(document)
  expect((layout.children[0] as unknown as { children: { box: { width: number } }[] }).children[0]!.box.width).toBeCloseTo(1, 2)
})

// Catches a view box read untrimmed: admission trims it, the layout split
// ' 0 0 100 50' into five parts and drew the SVG without its view box.
it('reads a view box with whitespace around it', async () => {
  const svg = plainNode(PDF_PRIMITIVES.Svg, { width: 200, height: 100, viewBox: ' 0 0 100 50 ' }, [plainNode(PDF_PRIMITIVES.Rect, { x: 0, y: 0, width: 10, height: 10 })])
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [300, 300] }, [svg])])
  const { layout } = await renderPlainDocument(document)
  const laid = (layout.children[0] as unknown as { children: { props: { viewBox: unknown } }[] }).children[0]!
  expect(laid.props.viewBox).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 })
})

// Catches a word joiner the font lacks removed (then a page range broke after
// its en dash) or painted as a missing-glyph box: Helvetica has no word joiner.
it('keeps a word joiner the font lacks, holds its break and paints nothing', async () => {
  const range = plainText('Pages 201\u2013\u2060216', { width: 60, fontSize: 10 })
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [300, 300] }, [range])])
  const result = await renderPlainDocument(document)
  const text = (result.layout.children[0] as unknown as { children: { lines: { string: string }[] }[] }).children[0]!
  expect(text.lines.map(line => line.string.trim())).toEqual(['Pages', '201\u2013\u2060216'])
  expect(result.layoutWarnings).toEqual([])
  expect((await parsePdf(result.bytes)).pages[0]!.text.replace(/\s+/g, ' ').trim()).toBe('Pages 201\u2013216')
})

// Catches a line or paragraph separator removed as an ignorable character
// (the line went on) or painted: Helvetica has neither, and the standard
// font is not embedded (UAX #14, D44).
it.each([['a line', '\u2028'], ['a paragraph', '\u2029']])('ends the line at %s separator the font lacks, and paints none', async (_name, separator) => {
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [300, 300] }, [plainText(`one${separator}two`)])])
  const { layout } = await renderPlainDocument(document)
  const text = (layout.children[0] as unknown as { children: { lines: { string: string }[] }[] }).children[0]!
  expect(text.lines.map(line => line.string)).toEqual(['one', 'two'])
})

// The shapes of a clip path are drawn shapes: their lengths resolve like
// those outside `<defs>`. They got only the gradient parser and stayed
// strings, and `width: '50%'` failed at the painter.
it.each([['50%', 50], ['50', 50]])('resolves a clip path shape width of %j', async (width, points) => {
  const svg = plainNode(PDF_PRIMITIVES.Svg, { width: 100, height: 100, viewBox: '0 0 100 100' }, [
    plainNode(PDF_PRIMITIVES.Defs, {}, [
      plainNode(PDF_PRIMITIVES.ClipPath, { id: 'half' }, [plainNode(PDF_PRIMITIVES.Rect, { x: 0, y: 0, width, height: '100%' })]),
    ]),
    plainNode(PDF_PRIMITIVES.Rect, { x: 0, y: 0, width: 100, height: 100, fill: '#ff0000', clipPath: 'url(#half)' }),
  ])
  const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: [200, 200] }, [svg])])
  const { layout } = await renderPlainDocument(document)
  type Shape = { props: { clipPath?: { children: { props: Record<string, unknown> }[] } }, children?: Shape[] }
  const drawn = (layout.children[0] as unknown as Shape).children![0]!.children![0]!
  expect(drawn.props.clipPath!.children[0]!.props).toMatchObject({ width: points, height: 100 })
})

describe('pagination inputs', () => {
  const node = (type: string, style: Record<string, unknown>, props: Record<string, unknown> = {}, children: unknown[] = []) =>
    ({ type, box: {}, style, props, children })
  const page = (...children: unknown[]) => ({
    type: PDF_PRIMITIVES.Document,
    props: {},
    children: [node(PDF_PRIMITIVES.Page, { padding: 20 }, { size: [200, 200] }, children)],
  }) as unknown as DocumentNode
  const words = (style: Record<string, unknown>, props: Record<string, unknown> = {}) =>
    node(PDF_PRIMITIVES.Text, { fontFamily: 'Helvetica', fontSize: 10, width: 24, ...style }, props, [{ type: PDF_PRIMITIVES.TextInstance, value: 'X1 X2 X3 X4' }])

  // Catches a node moved to the next page for ending a float residual past
  // the page end. The split took 0.001 pt (SAFETY_THRESHOLD) for a node it
  // splits; the break test and the presence test took none. The page holds
  // 160 pt.
  it.each<[string, unknown[]]>([
    ['kept whole that ends', [node(PDF_PRIMITIVES.View, { height: 100 }), node(PDF_PRIMITIVES.View, { height: 60.0005 }, { wrap: false })]],
    ['whose minPresenceAhead reaches', [node(PDF_PRIMITIVES.View, { height: 100 }), node(PDF_PRIMITIVES.View, { height: 30 }, { minPresenceAhead: 30.0005 }), node(PDF_PRIMITIVES.View, { minHeight: 100 })]],
  ])('keeps on its page a node %s 0.0005 pt past the page end', async (_name, children) => {
    const layout = await layoutDocument(page(...children), createPdfFontStore())
    type Laid = { children: { props: Record<string, unknown> }[] }
    const pages = layout.children as unknown as Laid[]
    expect(pages[0]!.children).toHaveLength(children.length === 2 ? 2 : 3)
    expect(pages[0]!.children[1]!.props).toEqual((children[1] as { props: unknown }).props)
  })

  // Catches pagination that skips `onPage`: the render deadline is checked
  // there (plain-tree.ts), so without the call an endless document runs on
  // until the worker's hard timer, or forever in process.
  it('calls onPage once for every page it makes', async () => {
    const document = page(...Array.from({ length: 3 }, () => node(PDF_PRIMITIVES.View, { height: 150, flexShrink: 0 })))
    const onPage = vi.fn()
    const layout = await layoutDocument({ ...document, onPage }, createPdfFontStore())
    expect(layout.children).toHaveLength(3)
    expect(onPage).toHaveBeenCalledTimes(3)
  })

  // Catches a style resolved again on relayout: 1.4 at 10 pt is 14 pt, and
  // each relayout of the page multiplied the stored 14 by the font size
  // again, so the text had no line that fit (a page-conditional node in a
  // full render hung).
  it.each([
    ['a page-number text', words({ lineHeight: 1.4, width: 100 }, { render: () => 'Page 1' })],
    ['a text a page-conditional node shows', node(PDF_PRIMITIVES.View, { lineHeight: 1.4, fontSize: 10 }, {
      render: () => ({ type: PDF_PRIMITIVES.Text, props: { style: { fontFamily: 'Helvetica', fontSize: 10 }, children: 'First' } }),
    })],
  ])('lays out %s with its line height resolved once', async (_name, content) => {
    const layout = await layoutDocument(page(content), createPdfFontStore())
    type Laid = { lines?: { box: { height: number } }[], children?: Laid[] }
    const lines = (laid: Laid): number[] => [...(laid.lines ?? []).map(line => line.box.height), ...(laid.children ?? []).flatMap(lines)]
    expect(lines(layout.children[0] as unknown as Laid)).toEqual([14])
  })

  // Catches a percentage minHeight that runs past the page end. Pagination
  // measures a page as one tall box, so yoga had no base for `'90%'` there
  // and applied it only in the page's last layout: 144 pt below an 80 pt
  // view, past the page end. The page has 160 pt of content height; the
  // 80 pt view above cannot shrink.
  const lines = (count: number) => Array.from({ length: count }, (_, index) =>
    node(PDF_PRIMITIVES.Text, { fontFamily: 'Helvetica', fontSize: 10 }, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: `Line ${index}` }]))
  it.each([
    { label: 'a percentage minHeight', view: node(PDF_PRIMITIVES.View, { minHeight: '90%', backgroundColor: 'red' }, {}, lines(1)), parts: [[100, 80], [20, 64]] },
    { label: 'the same minHeight in points', view: node(PDF_PRIMITIVES.View, { minHeight: 144, backgroundColor: 'red' }, {}, lines(1)), parts: [[100, 80], [20, 64]] },
  ])('splits a view with $label at the page end', async ({ view, parts }) => {
    const layout = await layoutDocument(page(node(PDF_PRIMITIVES.View, { minHeight: 80 }), view), createPdfFontStore())
    type Laid = { box: { top: number, height: number }, children: Laid[] }
    const boxes = (layout.children as unknown as Laid[]).map(laid => laid.children.at(-1)!.box)
    expect(boxes.map(({ top, height }) => [top, Math.round(height)])).toEqual(parts)
  })

  // A percentage height is a share of the parent's height inside its
  // paddings and borders, resolved to points before layout: here 50% of
  // 200 - 20 - 10 - 2 * 5 pt. A parent that splits keeps the points in every
  // part. Catches the share taken again from each part (yoga's base there is
  // the part's height) and a page child's maxHeight taken from the tall box
  // pagination measures (no limit).
  it.each([
    { label: 'height inside a parent with paddings and borders', parent: { height: 200, paddingTop: 20, paddingBottom: 10, borderTopWidth: 5, borderBottomWidth: 5, borderColor: 'black' }, child: { height: '50%' }, heights: [80] },
    { label: 'minHeight in a parent that splits', parent: { height: 300 }, child: { minHeight: '90%' }, heights: [80, 160, 30] },
    { label: 'maxHeight on a page child', parent: undefined, child: { maxHeight: '25%' }, heights: [40] },
  ])('resolves a percentage $label to points', async ({ parent, child, heights }) => {
    const view = node(PDF_PRIMITIVES.View, { backgroundColor: 'red', ...child }, {}, lines(parent ? 2 : 30))
    const layout = await layoutDocument(page(node(PDF_PRIMITIVES.View, { minHeight: 80 }), parent ? node(PDF_PRIMITIVES.View, parent, {}, [view]) : view), createPdfFontStore())
    type Laid = { type: string, style: { backgroundColor?: string }, box: { height: number }, children?: Laid[] }
    const red = (laid: Laid): Laid[] => laid.style?.backgroundColor === 'red' ? [laid] : (laid.children ?? []).flatMap(red)
    expect((layout.children as unknown as Laid[]).flatMap(red).map(laid => Math.round(laid.box.height))).toEqual(heights)
  })

  // A parent without a height known before layout gives no base: fail.
  it('fails a percentage height in a parent without a height', async () => {
    await expect(layoutDocument(page(node(PDF_PRIMITIVES.View, { minHeight: 80 }, {}, [node(PDF_PRIMITIVES.View, { minHeight: '90%' }, {}, lines(1))])), createPdfFontStore())).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: '<PdfView> has minHeight "90%", but its parent <PdfView> has no height known before layout: a percentage height is a share of the parent\'s height inside its paddings, which needs a height in points (or a percentage of a parent with one) and paddings and borders in points. Give the parent a height, or give the minHeight in points.',
    })
  })

  // Catches: a callback result that is neither text nor an element turned
  // into a node of no known type, which fails later without a reason.
  it('fails with a typed error when a render callback returns something else', async () => {
    const document = page(words({}, { render: () => ({ text: 'Page 1' }) }))
    await expect(renderDocument(document)).rejects.toMatchObject({
      code: 'PDF_RENDER_ERROR',
      message: expect.stringContaining('A render callback returned something other than text or an element.'),
    })
  })

  // Catches a box edge kept as its style string: a bottom margin of 'auto'
  // that yoga computed as 0 made the end of the presence NaN, and a node that
  // asks for presence ahead stayed above a sibling that moved.
  it('moves a node with presence ahead whose bottom margin is auto', async () => {
    const layout = await layoutDocument(page(
      node(PDF_PRIMITIVES.View, { height: 20, flexShrink: 0 }),
      node(PDF_PRIMITIVES.View, { height: 60, flexShrink: 0, marginBottom: 'auto' }, { minPresenceAhead: 100 }),
      node(PDF_PRIMITIVES.View, { height: 100, flexShrink: 0 }),
    ), createPdfFontStore())
    expect((layout.children as unknown as { children: unknown[] }[]).map(laidPage => laidPage.children.length)).toEqual([1, 2])
  })

  // Catches: box edges added with `+`. A zero padding written '+0' stays a
  // string in the box (dimensions/edges.ts), and `+` joins it with the top
  // into text, so no line fits and the text moves whole. As a number, two
  // of its four lines stay (orphans and widows 2).
  it('reads box edges as numbers when it breaks a text', async () => {
    const layout = await layoutDocument(page(node(PDF_PRIMITIVES.View, { height: 130 }), words({ paddingTop: '+0' })), createPdfFontStore())
    const linesPerPage = (layout.children as unknown as { children: { lines?: unknown[] }[] }[])
      .map(laidPage => laidPage.children.reduce((sum, child) => sum + (child.lines?.length ?? 0), 0))
    expect(linesPerPage).toEqual([2, 2])
  })
})

describe('anchors of nested texts', () => {
  // Catches the anchors in the wrong order: two nested texts that start at
  // the same glyph give its run both, the outer one first, the order an
  // outline nests them in (CONTRACTS.md, "A run names where a nested text
  // starts").
  it('gives the run where two nested texts start both anchors, the outer one first', async () => {
    const style = { fontFamily: 'Helvetica', fontSize: 10 }
    const inner = plainNode(PDF_PRIMITIVES.Text, { id: 'inner' }, [{ type: PDF_PRIMITIVES.TextInstance, value: 'both' }], style)
    const outer = plainNode(PDF_PRIMITIVES.Text, { id: 'outer' }, [inner, { type: PDF_PRIMITIVES.TextInstance, value: ' here' }], style)
    const text = plainNode(PDF_PRIMITIVES.Text, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'See ' }, outer], style)
    const document = { type: PDF_PRIMITIVES.Document, props: {}, children: [plainNode(PDF_PRIMITIVES.Page, { size: [300, 200] }, [text], { padding: 20 })] } as unknown as DocumentNode
    const layout = await layoutDocument(document, createPdfFontStore())
    type Laid = { lines?: { runs: { attributes: { anchors?: unknown } }[] }[], children?: Laid[] }
    const runs = (laid: Laid): { attributes: { anchors?: unknown } }[] => [...(laid.lines ?? []).flatMap(line => line.runs), ...(laid.children ?? []).flatMap(runs)]
    const anchored = runs(layout as unknown as Laid).filter(run => run.attributes.anchors)
    expect(anchored.map(run => run.attributes.anchors)).toEqual([[{ id: 'outer' }, { id: 'inner' }]])
  })
})

describe('flex factors', () => {
  // Catches a written flexShrink of 0 read as 1 (the setter wrote
  // `flexShrink || 1`): a 150 pt child shrank with its neighbour in a 200 pt
  // row instead of keeping its width.
  it.each<[string, Record<string, unknown>, number[]]>([
    ['flexShrink: 0', { flexShrink: 0 }, [150, 50]],
    ['flex: none', { flex: 'none' }, [150, 50]],
    ['no flexShrink, which is 1', {}, [100, 100]],
  ])('lays out a row child with %s', async (_name, style, widths) => {
    const row = plainNode(PDF_PRIMITIVES.View, {}, [plainNode(PDF_PRIMITIVES.View, {}, [], { width: 150, height: 10, ...style }), plainNode(PDF_PRIMITIVES.View, {}, [], { width: 150, height: 10 })], { flexDirection: 'row' })
    const document = { type: PDF_PRIMITIVES.Document, props: {}, children: [plainNode(PDF_PRIMITIVES.Page, { size: [200, 100] }, [row], { padding: 0 })] } as unknown as DocumentNode
    const layout = await layoutDocument(document, createPdfFontStore())
    type Laid = { box: { width: number }, children: Laid[] }
    expect((layout.children[0] as unknown as Laid).children[0]!.children.map(child => child.box.width)).toEqual(widths)
  })
})

describe('a text split across pages', () => {
  // Catches the next part of a split text drawn with the top padding of the
  // whole text: the split sets its top padding to 0, yoga computed 0, and the
  // box kept the 30 pt of the earlier layout (dimensions/edges.ts), so the
  // lines on page 2 started 30 pt lower than after a top margin, which the
  // split drops the same way.
  it.each(['paddingTop', 'marginTop'])('starts its lines on the next page at the content top, after a %s', async (edge) => {
    const words = Array.from({ length: 300 }, (_, index) => `word${index}`).join(' ')
    const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [plainText(words, { [edge]: 30 })], { padding: 24 })])
    const pdf = await parsePdf((await renderPlainDocument(document)).bytes)
    expect(pdf.pages[1]!.textRuns[0]!.y).toBe(384.73)
  })
})

describe('content inside its own edges', () => {
  // The lines of a text start inside its border and its padding, as layout
  // keeps room for both. Three texts with 12 pt of top and left edge each:
  // padding only, border only, and 4 pt border plus 8 pt padding. Catches
  // lines placed by the padding alone: the second text would print 12 pt
  // higher and further left, over its own border.
  it('starts the lines of a text below and right of its border', async () => {
    const edges = [
      { paddingTop: 12, paddingLeft: 12 },
      { borderTopWidth: 12, borderLeftWidth: 12, borderColor: '#999999' },
      { borderTopWidth: 4, borderLeftWidth: 4, borderColor: '#999999', paddingTop: 8, paddingLeft: 8 },
    ]
    const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
      plainNode(PDF_PRIMITIVES.Page, { size: 'A4' }, edges.map((style, index) => plainText(`Text ${index + 1}`, style)), { padding: 40 }),
    ])
    const parsed = await parsePdf((await renderPlainDocument(document)).bytes)
    const runs = parsed.pages[0]!.textRuns.filter(run => run.text.startsWith('Text '))
    const round = (value: number) => Math.round(value * 100) / 100
    expect(runs.map(run => [run.text, round(run.x), round(run.y)])).toEqual([['Text 1', 52, 779.09], ['Text 2', 52, 753.89], ['Text 3', 52, 728.69]])
  })
  // An image and an SVG 124 x 84 pt with 12 pt of edge on each side, alone
  // on a 300 pt page with no padding: their content box is 100 x 60 at
  // (12, 12) for padding, border, and border plus padding alike. The image
  // is drawn there at that size; the SVG's view box (50 x 30) moves there and
  // scales by 2 into it. Catches content placed by the padding alone (drawn
  // at 0 over the border, 124 x 84) and an SVG fitted into the whole box
  // (scale 2.48, 24 pt past its right edge).
  const EDGES = [
    { padding: 12 },
    { borderWidth: 12, borderColor: '#999999' },
    { borderWidth: 4, borderColor: '#999999', padding: 8 },
  ]
  const drawn = async (child: PdfElementNode): Promise<string[]> => {
    const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
      plainNode(PDF_PRIMITIVES.Page, { size: [300, 300] }, [child], { padding: 0 }),
    ])
    const content = pageContents((await renderPlainDocument(document)).bytes)[0]!
    return content.split('\n').filter(line => line.endsWith(' cm') || line.endsWith(' Do')).slice(1)
  }

  it.each(EDGES)('draws an image inside its border and padding (%j)', async (style) => {
    const src = readFileSync(new URL('./fixtures/assets/sample.png', import.meta.url))
    expect(await drawn(plainNode(PDF_PRIMITIVES.Image, { src }, [], { width: 124, height: 84, ...style }))).toEqual(['100 0 0 -60 12 72 cm', '/I1 Do'])
  })

  it.each(EDGES)('fits an SVG into the box inside its border and padding (%j)', async (style) => {
    const rect = plainNode('RECT', { x: 0, y: 0, width: 50, height: 30 }, [], { fill: '#ff0000' })
    expect(await drawn(plainNode(PDF_PRIMITIVES.Svg, { viewBox: '0 0 50 30' }, [rect], { width: 124, height: 84, ...style }))).toEqual(['1 0 0 1 12 12 cm', '2 0 0 2 0 0 cm'])
  })
})

// Absolute nodes and relative offsets on the page builder (step 7, item 1),
// on A6 with 30 pt top and bottom padding: 359.53 pt for 13.2 pt lines (the
// earlier pagination made the same places, measured before the rule).
// A6 pages of 12 pt Helvetica lines (13.2 pt each, 27 a page).
const lineRuns = (prefix: string, from: number, count: number) => Array.from({ length: count }, (_, index) => plainText(`${prefix}${from + index}`))
const placesIn = async (children: PdfElementNode[], pageStyle: Record<string, unknown> = {}) => {
  const document = plainNode(PDF_PRIMITIVES.Document, { creationDate: new Date('2026-07-20T00:00:00.000Z') }, [
    plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, children, { paddingBottom: 30, paddingTop: 30, paddingLeft: 20, ...pageStyle }),
  ])
  const { bytes } = await renderPlainDocument(document)
  const parsed = await parsePdf(bytes)
  /** Each run of `text` as [page, x, top from the page top], rounded to 0.1 pt. */
  const places = (text: string) => parsed.pages.flatMap(page => page.textRuns.filter(run => run.text === text)
    .map(run => [page.number, Math.round(run.x), Math.round((page.height - run.y) * 10) / 10]))
  return { places, contents: pageContents(bytes), pdf: parsed }
}

describe('absolute nodes and offsets on the page builder', () => {
  const absolute = (label: string, style: Record<string, unknown>, props: Record<string, unknown> = {}) =>
    plainNode(PDF_PRIMITIVES.View, props, [plainText(label)], { position: 'absolute', ...style })

  // Catches an absolute child that moves the flow (it takes no room), one
  // placed with the wrong part of a split card (a top badge on the last part,
  // a bottom badge on the first) and the last part counting the badge's
  // height (13.2 pt lower: the page check failed).
  it.each([
    { label: 'by top goes with the first part', badge: () => absolute('BADGE', { top: 0, right: 0 }), first: true, place: [1, 256, 304.8] },
    { label: 'by bottom goes with the last part', badge: () => absolute('BADGE', { bottom: 0, right: 0 }), first: false, place: [2, 256, 331.2] },
  ])('places an absolute child of a card that splits: $label', async ({ badge, first, place }) => {
    const card = plainNode(PDF_PRIMITIVES.View, {}, first ? [badge(), ...lineRuns('C', 0, 30)] : [...lineRuns('C', 0, 30), badge()], { backgroundColor: '#eeeeee' })
    const { places } = await placesIn([...lineRuns('B', 0, 20), card, plainText('After')])
    expect([places('BADGE'), places('C0'), places('C7'), places('After')]).toEqual([[place], [[1, 20, 304.8]], [[2, 20, 40.8]], [[2, 20, 344.4]]])
  })

  // Catches an absolute node on the page that takes room, or that shows on
  // the page where its flow position falls: by top (or with no vertical
  // inset) it goes with the first page of its PdfPage, by bottom only with
  // the last. An absolute fixed node repeats on every page wherever it stands.
  it.each([
    { label: 'by top', node: () => absolute('ABS', { top: 10, right: 10 }), pages: [[1, 264, 20.8]] },
    { label: 'with no vertical inset', node: () => absolute('ABS', { left: 100 }), pages: [[1, 100, 40.8]] },
    { label: 'by bottom', node: () => absolute('ABS', { bottom: 10, left: 100 }), pages: [[3, 100, 407.1]] },
    { label: 'fixed', node: () => absolute('ABS', { top: 10, right: 10 }, { fixed: true }), pages: [[1, 264, 20.8], [2, 264, 20.8], [3, 264, 20.8]] },
  ])('places an absolute node between the flow of a page $label', async ({ node, pages }) => {
    const { places } = await placesIn([...lineRuns('L', 0, 30), node(), ...lineRuns('L', 30, 40)])
    expect([places('ABS'), places('L27'), places('L54')]).toEqual([pages, [[2, 20, 40.8]], [[3, 20, 40.8]]])
  })

  // Catches a background before a fixed head painted over the head: the
  // head went first in the page's children (its paint order).
  it('paints an absolute node before the head of the page under it', async () => {
    const background = plainNode(PDF_PRIMITIVES.View, {}, [], { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#ff0000' })
    const { contents } = await placesIn([background, plainText('Head', {}), ...lineRuns('L', 0, 20)].map((child, index) => index === 1 ? { ...child, props: { fixed: true } } : child))
    expect(contents.map(content => content.indexOf('1 0 0 rg') < content.indexOf('BT'))).toEqual([true])
  })

  // A relative offset moves the box, not the nodes after it, and the page
  // end applies to the moved box: the view breaks 20 pt earlier (after C4,
  // which ends at 390.8 moved), its part on page 2 keeps the offset, and
  // the text after the view starts below its unmoved place. Catches the break
  // taken at the unmoved box (C5 on page 1, its moved box past the page end)
  // and the next node moved with it.
  it('breaks a view with a relative top where its moved box crosses the page end', async () => {
    const { places } = await placesIn([...lineRuns('B', 0, 20), plainNode(PDF_PRIMITIVES.View, {}, lineRuns('C', 0, 30), { top: 20 }), plainText('After')])
    expect([places('C0'), places('C4'), places('C5'), places('After')]).toEqual([[[1, 20, 324.8]], [[1, 20, 377.6]], [[2, 20, 60.8]], [[2, 20, 370.8]]])
  })

  // In a row that splits, an absolute child goes with the row's first part
  // when top or no inset places it (centered there with alignSelf center),
  // and with its last part when bottom alone or the row's end does, also
  // over three pages. Catches it placed with the wrong part, or the row sent
  // away from the builder.
  const row = (badge: PdfElementNode, cells = 12) => plainNode(PDF_PRIMITIVES.View, {}, [plainNode(PDF_PRIMITIVES.View, {}, lineRuns('C', 0, cells), { width: 60 }), badge], { flexDirection: 'row' })
  it.each([
    { label: 'by top', badge: () => absolute('Z', { top: 10, left: 150 }), places: [[1, 170, 314.8]] },
    { label: 'with no inset', badge: () => absolute('Z', { left: 150 }), places: [[1, 170, 304.8]] },
    { label: 'centered', badge: () => absolute('Z', { left: 150, alignSelf: 'center' }), places: [[1, 170, 346]] },
    { label: 'by bottom', badge: () => absolute('Z', { bottom: 10, left: 150 }), places: [[2, 170, 83.6]] },
    { label: 'at the row end', badge: () => absolute('Z', { left: 150, alignSelf: 'flex-end' }), places: [[2, 170, 93.6]] },
    { label: 'by bottom over three pages', badge: () => absolute('Z', { bottom: 10, left: 150 }), cells: 40, places: [[3, 170, 96.8]] },
  ])('places an absolute child of a row that splits $label', async ({ badge, cells, places: expected }) => {
    const { places } = await placesIn([...lineRuns('B', 0, 20), row(badge(), cells), plainText('After')])
    expect(places('Z')).toEqual(expected)
  })

  // A relative offset moves a cell's box in every part of a row that splits;
  // the page end applies to the moved box (D6 goes to page 2 with top, stays
  // with bottom), and the row's rest is as high as its cells, not moved.
  // Catches the offset dropped on a part, or the break taken at the unmoved box.
  it.each([
    { label: 'top', style: { top: 10 }, places: { D0: [[1, 80, 314.8]], D6: [[2, 80, 50.8]], After: [[2, 20, 120]] } },
    { label: 'bottom', style: { bottom: 10 }, places: { D0: [[1, 80, 294.8]], D6: [[1, 80, 374]], D7: [[2, 80, 30.8]], After: [[2, 20, 106.8]] } },
  ])('breaks a row cell with a relative $label at its moved box', async ({ style, places: expected }) => {
    const cell = (prefix: string, extra: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, lineRuns(prefix, 0, 12), { width: 60, ...extra })
    const { places } = await placesIn([...lineRuns('B', 0, 20), plainNode(PDF_PRIMITIVES.View, {}, [cell('C'), cell('D', style)], { flexDirection: 'row' }), plainText('After')])
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })

  // Without a vertical inset, under justifyContent center, space-around or
  // space-evenly, an absolute child goes with the first part of its view and
  // is centered there (as `top` or no inset elsewhere). Catches it placed on
  // a later part, or the view sent away from the builder.
  it.each(['center', 'space-around', 'space-evenly'])('centers an absolute child without an inset in the first part under %s', async (justify) => {
    const { places } = await placesIn([...lineRuns('B', 0, 3), plainNode(PDF_PRIMITIVES.View, {}, [...lineRuns('L', 0, 60), absolute('Z', { left: 150 })], { minHeight: 900, justifyContent: justify })])
    expect(places('Z')).toEqual([[1, 170, 233.8]])
  })

  // The parts of a parent that splits stack as one tall parent, as CSS
  // fragments do: an absolute child that `top` places below the part on this
  // page goes on the part where the offset lands, that part's padding box
  // higher (400 - 319.93 pt on page 2; 700 - 319.93 - 359.53 pt on page 3).
  // A percentage inset takes the whole parent's padding box (75% of 568 pt is
  // 426 pt), a relative offset in percent its content box (5% of 567.6 pt).
  // Catches the node cut on the first part, the offset taken again from a
  // later part's top, and a percentage of a part's height.
  it.each([
    { label: 'top below the first part', children: () => [...lineRuns('L', 0, 40), absolute('Z', { left: 150, top: 400 })], style: {}, places: { Z: [[2, 170, 120.9]] } },
    { label: 'top below two parts', children: () => [...lineRuns('L', 0, 60), absolute('Z', { left: 150, top: 700 })], style: {}, places: { Z: [[3, 170, 61.3]] } },
    { label: 'top below a first part with a top border', children: () => [...lineRuns('L', 0, 40), absolute('Z', { left: 150, top: 400 })], style: { borderTopWidth: 10, paddingTop: 10, borderColor: 'black' }, places: { Z: [[2, 170, 130.9]] } },
    { label: 'top in percent', children: () => [...lineRuns('L', 0, 40), absolute('Z', { left: 150, top: '75%' })], style: { paddingTop: 20, paddingBottom: 20 }, places: { Z: [[2, 170, 146.9]] } },
    { label: 'bottom in percent', children: () => [...lineRuns('L', 0, 40), absolute('Z', { left: 150, bottom: '10%' })], style: {}, places: { Z: [[2, 170, 186]] } },
    { label: 'a relative top in percent', children: () => [...lineRuns('L', 0, 30), plainNode(PDF_PRIMITIVES.View, {}, lineRuns('M', 0, 3), { top: '5%' }), ...lineRuns('N', 0, 10)], style: { paddingTop: 20, paddingBottom: 20 }, places: { M0: [[2, 20, 174.8]], N0: [[2, 20, 186]] } },
  ])('places $label in a view that splits', async ({ children, style, places: expected }) => {
    const { places } = await placesIn([...lineRuns('B', 0, 3), plainNode(PDF_PRIMITIVES.View, {}, children(), style), plainText('After')])
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })

  it('places an absolute child that top places below the first part of a row on the rest', async () => {
    const cell = plainNode(PDF_PRIMITIVES.View, {}, lineRuns('C', 0, 40), { width: 60 })
    const { places } = await placesIn([...lineRuns('B', 0, 3), plainNode(PDF_PRIMITIVES.View, {}, [cell, absolute('Z', { left: 150, top: 400 })], { flexDirection: 'row' }), plainText('After')])
    expect(places('Z')).toEqual([[2, 170, 120.9]])
  })
})

// The values are today's pagination output, which these rules keep.
describe('flexGrow and justifyContent on the page builder', () => {
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, children, style)
  const grown = (style: Record<string, unknown> = {}) => view([plainText('G')], { flexGrow: 1, ...style })

  // The free room of each page goes to its grown nodes, by their factors: all
  // the room below the content on the last page, only the room below the last
  // line that fits on a full page, and a grown node with a maxHeight keeps it
  // and leaves the rest to the others. In a view, only the room its
  // minHeight leaves. Catches the page laid out without the grown room (the
  // check fails) and a share past the maxHeight (Z below the page end).
  it.each([
    { label: 'on the last page', children: () => [...lineRuns('L', 0, 30), grown(), ...lineRuns('A', 0, 5)], places: { A0: [[2, 20, 334.3]], A4: [[2, 20, 387.1]] } },
    { label: 'on a full page', children: () => [...lineRuns('L', 0, 30), grown(), ...lineRuns('A', 0, 40)], places: { A0: [[2, 20, 96.7]], A22: [[2, 20, 387.1]] } },
    { label: 'by their factors', children: () => [...lineRuns('L', 0, 30), grown(), ...lineRuns('A', 0, 3), grown({ flexGrow: 3 }), plainText('Z')], places: { A0: [[2, 20, 153.8]], Z: [[2, 20, 387.1]] } },
    { label: 'up to a maxHeight', children: () => [...lineRuns('L', 0, 30), grown({ maxHeight: 20 }), ...lineRuns('A', 0, 3), grown(), plainText('Z')], places: { A0: [[2, 20, 100.4]], Z: [[2, 20, 387.1]] } },
    { label: 'in a view with a minHeight', children: () => [...lineRuns('L', 0, 5), view([plainText('W'), grown(), plainText('X')], { minHeight: 100 }), ...lineRuns('A', 0, 5)], places: { X: [[1, 20, 193.6]], A0: [[1, 20, 206.8]] } },
  ])('gives the free room to grown nodes $label', async ({ children, places: want }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(want).map(text => [text, places(text)]))).toEqual(want)
  })

  // A page justifies its content in the room each page leaves: on a full
  // page, the room below the last line that fits. A fixed head is one of the
  // children it spaces. Catches a value placed as flex-start and a wrong
  // share per gap (space-around and space-evenly differ only there).
  it.each([
    { justify: 'center', places: [[[1, 20, 42.4]], [[2, 20, 134.8]], [[2, 20, 293.2]]] },
    { justify: 'flex-end', places: [[[1, 20, 43.9]], [[2, 20, 228.7]], [[2, 20, 387.1]]] },
    { justify: 'space-between', places: [[[1, 20, 40.8]], [[2, 20, 40.8]], [[2, 20, 387.1]]] },
    { justify: 'space-around', places: [[[1, 20, 40.9]], [[2, 20, 48]], [[2, 20, 379.9]]] },
    { justify: 'space-evenly', places: [[[1, 20, 40.9]], [[2, 20, 54.2]], [[2, 20, 373.7]]] },
  ])('justifies the content of each page: $justify', async ({ justify, places: want }) => {
    const { places } = await placesIn(lineRuns('L', 0, 40), { justifyContent: justify })
    expect(['L0', 'L27', 'L39'].map(places)).toEqual(want)
  })

  it('justifies a fixed head with the content of each page', async () => {
    const head = { ...plainText('HEAD'), props: { fixed: true } }
    const { places } = await placesIn([head, ...lineRuns('L', 0, 40)], { justifyContent: 'center' })
    expect([places('HEAD'), places('L26')]).toEqual([[[1, 20, 42.4], [2, 20, 121.6]], [[2, 20, 134.8]]])
  })

  // A container splits where its whole layout puts its children: justified
  // in its whole height (a minHeight, or the row height a cell stretches
  // to; the rest of a row is laid out again as a whole, so a cell's rest is
  // as high as the rest of its row). Each part is then justified in its own
  // height. Catches a split taken from the top of the container: the
  // flex-end lines on page 1 (the view moves whole, its lines start below
  // the page end), L2 on page 1, W at the bottom of page 1 beside L2, and W2
  // on page 2; and a cell's part left unjustified on its page (the check
  // fails).
  it.each([
    { label: 'flex-end in a minHeight', children: () => [...lineRuns('B', 0, 20), view(lineRuns('L', 0, 3), { justifyContent: 'flex-end', minHeight: 150 }), plainText('After')], places: { L0: [[2, 20, 151.2]], After: [[2, 20, 190.8]] } },
    { label: 'space-between in a minHeight', children: () => [...lineRuns('B', 0, 20), view(lineRuns('L', 0, 3), { justifyContent: 'space-between', minHeight: 150 }), plainText('After')], places: { L1: [[1, 20, 387.1]], L2: [[2, 20, 40.8]], After: [[2, 20, 95.3]] } },
    { label: 'center in a row cell', children: () => [...lineRuns('B', 0, 24), view([view(lineRuns('L', 0, 6), { width: 80 }), view([plainText('W')], { width: 80, justifyContent: 'center' })], { flexDirection: 'row' }), plainText('After')], places: { W: [[2, 100, 54]], After: [[2, 20, 80.4]] } },
    { label: 'center in a view that splits', children: () => [view(lineRuns('L', 0, 40), { justifyContent: 'center' }), plainText('After')], places: { L0: [[1, 20, 42.4]], L27: [[2, 20, 40.8]], After: [[2, 20, 212.4]] } },
    { label: 'center in a cell of a row over three pages', children: () => [view([view(lineRuns('L', 0, 60), { width: 80 }), view([plainText('W0'), plainText('W1')], { width: 80, justifyContent: 'center' })], { flexDirection: 'row' }), plainText('After')], places: { W0: [[2, 100, 207.4]], W1: [[2, 100, 220.6]], After: [[3, 20, 120]] } },
    { label: 'space-between in a cell of a row over three pages', children: () => [view([view(lineRuns('L', 0, 60), { width: 80 }), view([plainText('W0'), plainText('W1'), plainText('W2')], { width: 80, justifyContent: 'space-between' })], { flexDirection: 'row' }), plainText('After')], places: { W0: [[1, 100, 40.8]], W1: [[2, 100, 40.8]], W2: [[3, 100, 40.8]] } },
  ])('splits a justified container where its whole layout puts the children: $label', async ({ children, places: want }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(want).map(text => [text, places(text)]))).toEqual(want)
  })

  // A column container placed whole is justified in its minHeight: its
  // columns move as one. Catches the content inside a container placed whole
  // left at its top.
  it('justifies a column container placed whole', async () => {
    const { places } = await placesIn([view(lineRuns('L', 0, 10), { columnCount: 2, columnGap: 20, justifyContent: 'center', minHeight: 200 }), plainText('Z')])
    expect([places('L0'), places('Z')]).toEqual([[[1, 20, 107.8]], [[1, 20, 240.8]]])
  })
})

describe('alignSelf and alignItems in a row on the page builder', () => {
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, children, style)
  const row = (cells: PdfElementNode[], style: Record<string, unknown> = {}) => view(cells, { flexDirection: 'row', ...style })
  const cell = (children: PdfElementNode[], style: Record<string, unknown> = {}) => view(children, { width: 80, ...style })
  const short = (align: string) => cell([plainText('W0'), plainText('W1')], { alignSelf: align })

  // A cell that does not stretch stands where the row aligns it: in a row
  // placed whole, at its top, middle or bottom, and by its first baseline
  // (W0 below the larger BIG). In a row that splits, its place in the whole
  // row decides the page of each line (the whole row, or its rest laid out
  // again as a whole on the next page), and each row part aligns it again.
  // A row part ends at the page end, so on a row's first part an aligned cell
  // sits lower than on today's pagination, whose first part ends at its last
  // line: by half (center) or all (flex-end) of the room below that line.
  // Catches a cell placed at the row's top (W0 and W1 on page 1 with
  // flex-end, the check fails with center), a baseline offset dropped, and a
  // row's rest without it (the rest is that much higher: After 13.2 pt up).
  it.each([
    { label: 'center, row whole', children: () => [...lineRuns('B', 0, 3), row([cell(lineRuns('L', 0, 5)), short('center')]), plainText('After')], places: { W0: [[1, 100, 100.2]], After: [[1, 20, 146.4]] } },
    { label: 'flex-end, row whole', children: () => [...lineRuns('B', 0, 3), row([cell(lineRuns('L', 0, 5)), short('flex-end')]), plainText('After')], places: { W0: [[1, 100, 120]], After: [[1, 20, 146.4]] } },
    { label: 'baseline, row whole', children: () => [...lineRuns('B', 0, 3), row([plainText('BIG', { fontSize: 24, width: 80 }), plainText('W0', { width: 80 })], { alignItems: 'baseline' }), plainText('After')], places: { W0: [[1, 100, 93.6]], After: [[1, 20, 106.8]] } },
    { label: 'baseline, row split', children: () => [...lineRuns('B', 0, 22), row([cell(['G0', 'G1', 'G2', 'G3'].map(text => plainText(text, { fontSize: 24 }))), cell(lineRuns('W', 0, 8))], { alignItems: 'baseline' }), plainText('After')], places: { W0: [[1, 100, 344.4]], W4: [[2, 100, 54]], After: [[2, 20, 106.8]] } },
    { label: 'center, row split', children: () => [...lineRuns('B', 0, 24), row([cell(lineRuns('L', 0, 6)), short('center')]), plainText('After')], places: { W0: [[1, 100, 372.4]], W1: [[2, 100, 54]], After: [[2, 20, 80.4]] } },
    { label: 'flex-end, row split', children: () => [...lineRuns('B', 0, 24), row([cell(lineRuns('L', 0, 6)), short('flex-end')]), plainText('After')], places: { W0: [[2, 100, 54]], W1: [[2, 100, 67.2]], After: [[2, 20, 80.4]] } },
    { label: 'center, row over three pages', children: () => [row([cell(lineRuns('L', 0, 60)), short('center')]), plainText('After')], places: { W0: [[2, 100, 207.4]], After: [[3, 20, 120]] } },
    { label: 'flex-end, row over three pages', children: () => [row([cell(lineRuns('L', 0, 60)), short('flex-end')]), plainText('After')], places: { W0: [[3, 100, 93.6]], After: [[3, 20, 120]] } },
    { label: 'flex-end, a cell that splits', children: () => [...lineRuns('B', 0, 10), row([cell(lineRuns('L', 0, 40)), cell(lineRuns('W', 0, 20), { alignSelf: 'flex-end' })]), plainText('After')], places: { W0: [[2, 100, 80.4]], W19: [[2, 100, 331.2]], After: [[2, 20, 344.4]] } },
    { label: 'center, a cell that splits', children: () => [...lineRuns('B', 0, 10), row([cell(lineRuns('L', 0, 40)), cell(lineRuns('W', 0, 20), { alignSelf: 'center' })]), plainText('After')], places: { W0: [[1, 100, 240.4]], W7: [[2, 100, 106.8]], After: [[2, 20, 344.4]] } },
    { label: 'alignItems flex-end, row split', children: () => [...lineRuns('B', 0, 24), row([cell(lineRuns('L', 0, 6)), cell([plainText('W0'), plainText('W1')])], { alignItems: 'flex-end' }), plainText('After')], places: { L0: [[1, 20, 360.7]], W0: [[2, 100, 54]], After: [[2, 20, 80.4]] } },
  ])('aligns a cell of a row: $label', async ({ children, places: want }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(want).map(text => [text, places(text)]))).toEqual(want)
  })
})

describe('flexWrap, fixed={false} and justifyContent in a row on the page builder', () => {
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, props, children, style)
  const narrow = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => plainText(`${prefix}${index}`, { width: 60 }))
  const cell = (prefix: string, count: number, width: number) => view(lineRuns(prefix, 0, count), { width })

  // A column without a height has one flex line, so flexWrap splits it as a
  // column without it; wrap-reverse puts that line at the cross end (x 238)
  // on every page. Catches a part laid out without the container's flexWrap
  // (x 20 on a later page) and a wrapping column the builder cannot place.
  it.each([
    { label: 'wrap', style: { flexWrap: 'wrap' }, x: 20 },
    { label: 'wrap-reverse', style: { flexWrap: 'wrap-reverse' }, x: 238 },
  ])('splits a column with flexWrap $label as one line', async ({ style, x }) => {
    const { places } = await placesIn([...lineRuns('B', 0, 3), view(narrow('L', 40), style), plainText('After')])
    expect([places('L0'), places('L23'), places('L24'), places('After')]).toEqual([[[1, x, 80.4]], [[1, x, 384]], [[2, x, 40.8]], [[2, 20, 252]]])
  })

  // A view with a height that wraps lays its children out in lines of that
  // height: placed whole when it fits a page (L7 starts the second line at x
  // 80), and an error when it is higher, as each part would wrap its share
  // into other lines. Catches the error for every wrapping box, and a tall
  // one split with its lines changed.
  it('places a wrapping view with a height whole, in its lines', async () => {
    const { places } = await placesIn([...lineRuns('B', 0, 3), view(narrow('L', 20), { height: 100, flexWrap: 'wrap' }), plainText('After')])
    expect([places('L6'), places('L7'), places('After')]).toEqual([[[1, 20, 159.6]], [[1, 80, 80.4]], [[1, 20, 180.4]]])
  })

  it('fails a wrapping view with a height higher than a page', async () => {
    const document = plainNode(PDF_PRIMITIVES.Document, {}, [
      plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [view(narrow('L', 60), { height: 500, flexWrap: 'wrap' })], { paddingTop: 30, paddingBottom: 30 }),
    ])
    await expect(renderPlainDocument(document)).rejects.toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      message: 'A <PdfView> with flexWrap "wrap" is 500 pt high, more than the 359.53 pt a page holds, so it would break across pages and wrap its children into other lines on each. Give it a height that fits on a page, or remove its height and maxHeight so it breaks as a column, or put the children in a <PdfView> with flexDirection "row" and flexWrap.',
    })
  })

  // fixed={false} is no fixed: the node breaks, moves whole and splits as
  // any other. Catches the upstream reading by presence, which skips a break
  // (L0 on page 1) and splits a wrap={false} node that crosses the page end.
  it.each([
    { label: 'a break', children: () => [...lineRuns('B', 0, 3), view(lineRuns('L', 0, 3), {}, { fixed: false, break: true }), plainText('After')], places: { L0: [[2, 20, 40.8]], After: [[2, 20, 80.4]] } },
    { label: 'wrap={false} across the page end', children: () => [...lineRuns('B', 0, 20), view(lineRuns('L', 0, 10), {}, { fixed: false, wrap: false }), plainText('After')], places: { L0: [[2, 20, 40.8]], After: [[2, 20, 172.8]] } },
    { label: 'a view that splits', children: () => [...lineRuns('B', 0, 3), view(lineRuns('L', 0, 40), {}, { fixed: false }), plainText('After')], places: { L23: [[1, 20, 384]], L24: [[2, 20, 40.8]], After: [[2, 20, 252]] } },
  ])('places a node with fixed={false} and $label as one without fixed', async ({ children, places: expected }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })

  // justifyContent places a row's cells side by side; each row part does it
  // again. Catches a row part laid out at flex-start (C7 at x 20 on page 2
  // with center) and a row the builder cannot place.
  it.each([
    { label: 'center', style: { justifyContent: 'center' }, cells: () => [cell('C', 12, 60), cell('D', 4, 60)], places: { C0: [[1, 99, 304.8]], D0: [[1, 159, 304.8]], C7: [[2, 99, 40.8]], After: [[2, 20, 106.8]] } },
    { label: 'space-between', style: { justifyContent: 'space-between' }, cells: () => [cell('C', 12, 60), cell('D', 4, 60), cell('E', 2, 40)], places: { C0: [[1, 20, 304.8]], D0: [[1, 139, 304.8]], E0: [[1, 258, 304.8]], C7: [[2, 20, 40.8]] } },
  ])('splits a row with justifyContent $label', async ({ style, cells, places: expected }) => {
    const { places } = await placesIn([...lineRuns('B', 0, 20), view(cells(), { flexDirection: 'row', ...style }), plainText('After')])
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })
})

describe('minHeight on a text on the page builder', () => {
  const paragraph = (count: number, style: Record<string, unknown>) => plainText(Array.from({ length: count }, (_, index) => `X${index}`).join(' '), { width: 40, ...style })

  // A text with a minHeight breaks by lines as any text and shares its
  // minHeight as a view does: the part on the page fills to the page end, the
  // next part keeps the rest (100 pt less the 70.4 pt left on page 1). Catches
  // today's layout, which squeezes the lines of the whole page to keep the
  // minHeight (B1 at 52.6) and starts After at 140.8.
  it.each([
    { label: 'crosses the page end', children: () => [...lineRuns('B', 0, 22), paragraph(3, { minHeight: 100 }), plainText('After')], places: { B1: [[1, 20, 54]], X2: [[1, 20, 344.4]], After: [[2, 20, 71.7]] } },
    { label: 'is higher than its lines and the room', children: () => [...lineRuns('B', 0, 20), paragraph(3, { minHeight: 300 }), plainText('After')], places: { B1: [[1, 20, 54]], X2: [[1, 20, 318]], After: [[2, 20, 245.3]] } },
  ])('splits a text with a minHeight that $label', async ({ children, places: expected }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })
})

describe('reverse directions on the page builder', () => {
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, children, style)
  const cell = (prefix: string, count: number, width: number) => view(lineRuns(prefix, 0, count), { width })

  // A column-reverse container draws its last child at the top, so it breaks
  // in that order: page 1 holds L11 to L5, packed at the bottom of the part
  // that fills the page, and page 2 holds L4 to L0; a page breaks the same way.
  // A fixed node written first is drawn at the bottom of every page, below
  // the content. A row-reverse row breaks as a row, its cells mirrored on
  // every page. Catches a container split in its source order (L0 on page 1),
  // and today's page, which squeezes 28 lines into the room of 27.
  it.each([
    { label: 'a column-reverse view', children: () => [...lineRuns('B', 0, 20), view(lineRuns('L', 0, 12), { flexDirection: 'column-reverse' }), plainText('After')], places: { L11: [[1, 20, 307.9]], L5: [[1, 20, 387.1]], L4: [[2, 20, 40.8]], L0: [[2, 20, 93.6]], After: [[2, 20, 106.8]] } },
    { label: 'a page with column-reverse', children: () => [...lineRuns('B', 0, 30), plainText('After')], pageStyle: { flexDirection: 'column-reverse' }, places: { After: [[1, 20, 43.9]], B4: [[1, 20, 387.1]], B3: [[2, 20, 347.5]], B0: [[2, 20, 387.1]] } },
    { label: 'a page with column-reverse and a fixed node written first', children: () => [{ ...plainText('Head'), props: { fixed: true } }, ...lineRuns('B', 0, 30)], pageStyle: { flexDirection: 'column-reverse' }, places: { Head: [[1, 20, 387.1], [2, 20, 387.1]], B29: [[1, 20, 43.9]], B4: [[1, 20, 373.9]], B3: [[2, 20, 334.3]] } },
    { label: 'a row-reverse row', children: () => [...lineRuns('B', 0, 20), view([cell('C', 12, 60), cell('D', 4, 60)], { flexDirection: 'row-reverse' }), plainText('After')], places: { C0: [[1, 238, 304.8]], D0: [[1, 178, 304.8]], C7: [[2, 238, 40.8]], After: [[2, 20, 106.8]] } },
  ])('breaks $label in drawing order', async ({ children, pageStyle, places: expected }) => {
    const { places } = await placesIn(children(), pageStyle)
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })

  // Each part keeps its children in source order, so the structure and the
  // paint order follow the template. Catches the parts left in drawing order
  // (L4 painted first on page 2).
  it('paints the parts of a column-reverse view in source order', async () => {
    const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [...lineRuns('B', 0, 20), view(lineRuns('L', 0, 12), { flexDirection: 'column-reverse' })], { paddingBottom: 30, paddingTop: 30, paddingLeft: 20 })])
    const pdf = await parsePdf((await renderPlainDocument(document)).bytes)
    expect(pdf.pages[1]!.textRuns.map(run => run.text)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])
  })
})

describe('a note on the page builder', () => {
  const note = (style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.Note, {}, [{ type: PDF_PRIMITIVES.TextInstance, value: 'Remark' }], { width: 20, height: 20, ...style })
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, children, style)

  // A PdfNote is a leaf with a box of its own, as an image: it never splits,
  // so a note that crosses the page end moves whole to the next page, also in
  // a view or a row cell, and the content after it follows.
  it.each([
    { label: 'on the page', children: () => [...lineRuns('B', 0, 26), note(), plainText('After')], rect: [2, 20, 367.5, 42, 389.5], places: { After: [[2, 20, 60.8]] } },
    { label: 'in a view', children: () => [...lineRuns('B', 0, 20), view([...lineRuns('L', 0, 6), note(), plainText('After')])], rect: [2, 20, 367.5, 42, 389.5], places: { L5: [[1, 20, 370.8]], After: [[2, 20, 60.8]] } },
    { label: 'in a row cell', children: () => [...lineRuns('B', 0, 20), view([view([...lineRuns('L', 0, 6), note(), plainText('After')], { width: 80 }), view(lineRuns('D', 0, 12), { width: 80 })], { flexDirection: 'row' })], rect: [2, 20, 367.5, 42, 389.5], places: { After: [[2, 20, 60.8]], D7: [[2, 100, 40.8]] } },
  ])('moves a note $label whole to the next page', async ({ children, rect, places: expected }) => {
    const { places, pdf } = await placesIn(children())
    expect(pdf.pages.flatMap(page => page.annotations.filter(annotation => annotation.subtype === 'Text').map(annotation => [page.number, ...annotation.rect!.map(value => Math.round(value * 10) / 10)]))).toEqual([rect])
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })
})

describe('a wrapping row on the page builder', () => {
  const view = (children: PdfElementNode[], style: Record<string, unknown> = {}) => plainNode(PDF_PRIMITIVES.View, {}, children, style)
  const card = (prefix: string, count: number) => view(lineRuns(prefix, 0, count), { width: 80 })
  const wrapRow = (children: PdfElementNode[], style: Record<string, unknown> = {}) => view(children, { flexDirection: 'row', flexWrap: 'wrap', ...style })
  const cards = (prefixes: string, count: number) => [...prefixes].map(prefix => card(prefix, count))

  // A row with flexWrap breaks between its flex lines, three cards of 80 pt
  // to a line: a line that crosses the page end splits as a row, and the next
  // line starts below it on the next page. The rest of a split line starts at
  // the page top, with no row gap above it (today adds the 10 pt gap again:
  // E2 at 50.8). wrap-reverse stacks the lines from the bottom, so the first
  // line is the one that splits. A position: absolute child without insets
  // keeps the place yoga gives it in the whole row (today centres it in the
  // row's part on page 1, about 18 pt higher).
  it.each([
    { label: 'lines that cross the page end', children: () => [...lineRuns('B', 0, 20), wrapRow(cards('ACDEFGIJK', 4)), plainText('After')], places: { A0: [[1, 20, 304.8]], E0: [[1, 20, 357.6]], E3: [[2, 20, 40.8]], I0: [[2, 20, 54]], K0: [[2, 180, 54]], After: [[2, 20, 106.8]] } },
    { label: 'a line higher than a page', children: () => [...lineRuns('B', 0, 3), wrapRow([card('A', 3), card('C', 3), card('D', 3), card('E', 40), card('F', 2)]), plainText('After')], places: { E0: [[1, 20, 120]], F0: [[1, 100, 120]], E21: [[2, 20, 40.8]], After: [[2, 20, 291.6]] } },
    { label: 'a row gap', children: () => [...lineRuns('B', 0, 18), wrapRow(cards('ACDEFG', 6), { rowGap: 10, columnGap: 5 }), plainText('After')], places: { C0: [[1, 105, 278.4]], E0: [[1, 20, 367.6]], E2: [[2, 20, 40.8]], G2: [[2, 190, 40.8]], After: [[2, 20, 93.6]] } },
    { label: 'wrap-reverse', children: () => [...lineRuns('B', 0, 18), wrapRow(cards('ACDEFG', 6), { flexWrap: 'wrap-reverse' }), plainText('After')], places: { E0: [[1, 20, 278.4]], A0: [[1, 20, 357.6]], A3: [[2, 20, 40.8]], After: [[2, 20, 80.4]] } },
    { label: 'texts as items', children: () => [...lineRuns('B', 0, 14), wrapRow(Array.from({ length: 60 }, (_, index) => plainText(`T${index}`, { width: 80 }))), plainText('After')], places: { T0: [[1, 20, 225.6]], T36: [[1, 20, 384]], T39: [[2, 20, 40.8]], After: [[2, 20, 133.2]] } },
    { label: 'an absolute child without insets', children: () => [...lineRuns('B', 0, 18), wrapRow([...cards('ACDEFG', 6), plainText('Q', { position: 'absolute' })], { justifyContent: 'center', alignItems: 'center' }), plainText('After')], places: { A0: [[1, 39, 278.4]], Q: [[1, 154, 351]], E3: [[2, 39, 40.8]], After: [[2, 20, 80.4]] } },
  ])('breaks $label between its lines', async ({ children, places: expected }) => {
    const { places } = await placesIn(children())
    expect(Object.fromEntries(Object.keys(expected).map(text => [text, places(text)]))).toEqual(expected)
  })

  // Each part is a wrapping row again that holds its items (for the structure
  // and the paint order). Catches the lines left in the layout as views of their own.
  it('keeps each part one row of its items', async () => {
    const document = plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [...lineRuns('B', 0, 20), wrapRow(cards('ACDEFG', 4))], { paddingBottom: 30, paddingTop: 30, paddingLeft: 20 })])
    const facts = { destinations: {}, breaks: [] }
    const layout = await layoutPdfTree(toEngineDocument(document, facts).document as unknown as DocumentNode, createPdfFontStore())
    const rows = layout.children.map(page => page.children?.find(child => child.type === PDF_PRIMITIVES.View))
    expect(rows.map(row => [row?.style?.flexWrap, row?.children?.length])).toEqual([['wrap', 6], ['wrap', 3]])
  })

  // A fixed item has no place of its own on the next page: repeated there, it
  // would wrap the other items into other lines (today it repeats as a line
  // of its own, which no wrapping row lays out). It fails only when the row breaks.
  it('fails a fixed item of a row that breaks', async () => {
    const fixedItem = { ...card('X', 2), props: { fixed: true } }
    const page = (lines: number) => plainNode(PDF_PRIMITIVES.Document, {}, [plainNode(PDF_PRIMITIVES.Page, { size: 'A6' }, [...lineRuns('B', 0, lines), wrapRow([card('A', 6), fixedItem, ...cards('DEFG', 6)])], { paddingBottom: 30, paddingTop: 30, paddingLeft: 20 })])
    await expect(renderPlainDocument(page(18))).rejects.toMatchObject({ code: 'PDF_LAYOUT_ERROR', message: expect.stringContaining('is an item of a <PdfView> with flexWrap "wrap" that breaks across pages') })
    await expect(renderPlainDocument(page(3))).resolves.toBeDefined()
  })
})
