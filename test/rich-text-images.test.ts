import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseMarkdown } from 'comark'
import { defineComponent, h, type Component, type VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfDocumentProps } from '../src/runtime/primitives'
import { mountPdfComponent } from '../src/runtime/renderer'
import { parseRichTextMarkdown, validateRichText } from '../src/runtime/rich-text'
import { mapComark } from '../src/runtime/rich-text/comark'
import { parseRichTextHtml } from '../src/runtime/rich-text/parse'
import { normalizeRemoteAssetPolicy } from '../src/runtime/server/assets/remote'
import type { PdfImageAssetMap } from '../src/runtime/server/assets/local-image'
import { resolvePdfImageAssets } from '../src/runtime/server/assets/resolve-images'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { createRenderLimits, DEFAULT_PDF_RENDER_LIMITS, type PdfRenderLimits } from '../src/runtime/server/render-limits'
import { NuxtPdfError } from '../src/runtime/shared/errors'
import { PDF_DEFINITION_PROPERTY, type PdfRenderResult } from '../src/runtime/shared/template'
import { installPdfCanvasGlobals, parsePdf } from '../src/test/pdf'

installPdfCanvasGlobals()

const { PdfDocument, PdfPage, PdfRichText, PdfView } = PDF_COMPONENTS

/** 700 × 420 px (5:3), the playground photo. */
const PHOTO = readFileSync(resolve('playground/pdfs/assets/alpine.png'))
/** A JPEG file under a `.png` key: its bytes do not match the format the path claims. */
const JPEG = readFileSync(resolve('test/fixtures/corpus/images-sample.jpg'))
const ASSETS: PdfImageAssetMap = {
  'photos/alpine.png': { dataB64: PHOTO.toString('base64'), format: 'png' },
  'photos/fake.png': { dataB64: JPEG.toString('base64'), format: 'png' },
}
const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync(resolve('test/fixtures/assets/Roboto-Regular.ttf')).toString('base64')}`,
} as const
/** The regular file again at 700: a caption heading asks for bold, and the test checks tags, not glyphs. */
const ROBOTO_AS_BOLD = { ...ROBOTO, fontWeight: 700 } as const
const REMOTE = normalizeRemoteAssetPolicy({ allow: ['https://media.example.test/'] })

// A4 with 40 pt padding: content box 515.28 × 761.89 pt.
const PAGE = { size: 'A4', style: { padding: 40, fontSize: 10 } } as const
/** Tagged documents embed every font, so their pages use Roboto. */
const ROBOTO_PAGE = { size: 'A4', style: { padding: 40, fontSize: 10, fontFamily: 'Roboto' } } as const

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

describe('rich text image mapping', () => {
  const t = (text: string, marks: { bold?: true, italic?: true } = {}) => ({ type: 'text', text, ...marks })
  const p = (...children: unknown[]) => ({ type: 'paragraph', children })

  // Catches an img that is dropped, kept inside a paragraph, or read with CSS units or out-of-range sizes.
  it.each<[string, string, unknown[]]>([
    ['a block image with every field', '<p>Before</p><img src=" photos/heron.png " alt=" A  grey   heron " width="120" height="80"><p>After</p>',
      [p(t('Before')), { type: 'image', src: 'photos/heron.png', alt: 'A grey heron', width: 120, height: 80 }, p(t('After'))]],
    ['an inline image ends the paragraph and keeps the marks around it', '<p>One <strong>bold <img src="a.png" alt="x"> tail</strong> two</p>',
      [p(t('One '), t('bold', { bold: true })), { type: 'image', src: 'a.png', alt: 'x' }, p(t('tail', { bold: true }), t(' two'))]],
    ['a figure with a caption is one block', '<figure><img src="a.png" alt="x"><figcaption>Cap <em>y</em></figcaption></figure>',
      [{ type: 'image', src: 'a.png', alt: 'x', caption: [t('Cap '), t('y', { italic: true })] }]],
    ['a figure without a caption', '<figure>\n <img src="a.png">\n</figure>', [{ type: 'image', src: 'a.png' }]],
    ['a figure with two images stays a container', '<figure><img src="a.png"><img src="b.png"><figcaption>Two</figcaption></figure>',
      [{ type: 'image', src: 'a.png' }, { type: 'image', src: 'b.png' }, p(t('Two'))]],
    ['sizes with a unit or zero are dropped', '<img src="a.png" width="120px" height="0">', [{ type: 'image', src: 'a.png' }]],
    ['a decimal size and the largest size', '<img src="a.png" width="12.5" height="10000">', [{ type: 'image', src: 'a.png', width: 12.5, height: 10000 }]],
    ['a negative size and one over the limit', '<img src="a.png" width="-5" height="10001">', [{ type: 'image', src: 'a.png' }]],
    ['exponent notation is dropped, spaces around digits are not', '<img src="a.png" width="1e3" height=" 40 ">', [{ type: 'image', src: 'a.png', height: 40 }]],
    ['style is never read', '<img src="a.png" style="width: 20px">', [{ type: 'image', src: 'a.png' }]],
    ['an image without a source is dropped', '<img alt="no source"><img src="   ">', []],
    ['an empty alt is no alt', '<img src="a.png" alt="">', [{ type: 'image', src: 'a.png' }]],
    ['an image in a heading is dropped', '<h2>Title <img src="a.png"></h2>', [{ type: 'heading', level: 2, children: [t('Title')] }]],
    ['a link around an image is lost', '<a href="https://example.test"><img src="a.png" alt="linked"></a>', [{ type: 'image', src: 'a.png', alt: 'linked' }]],
    ['an image in a list item is a block of the item', '<ul><li>Item <img src="a.png"></li></ul>',
      [{ type: 'list', ordered: false, items: [[p(t('Item')), { type: 'image', src: 'a.png' }]] }]],
    ['an image in a code block is dropped', '<pre>code <img src="a.png"></pre>', [{ type: 'code', text: 'code ' }]],
    ['any source is kept: the asset rules decide at render time', '<img src="javascript:alert(1)">', [{ type: 'image', src: 'javascript:alert(1)' }]],
  ])('HTML: %s', (_, html, expected) => {
    expect(parseRichTextHtml(html)).toEqual(expected)
  })

  // Catches a Markdown image that maps differently from the same image in comark or HTML.
  it.each<[string, unknown[]]>([
    ['![A heron](photos/heron.png "On the bank")', [{ type: 'image', src: 'photos/heron.png', alt: 'A heron' }]],
    ['Text ![x](a.png) more', [p(t('Text')), { type: 'image', src: 'a.png', alt: 'x' }, p(t('more'))]],
    ['![](a.png)', [{ type: 'image', src: 'a.png' }]],
    ['[![linked](a.png)](https://example.test)', [{ type: 'image', src: 'a.png', alt: 'linked' }]],
  ])('Markdown and comark: %s', async (markdown, expected) => {
    expect(await parseRichTextMarkdown(markdown)).toEqual(expected)
    expect(mapComark(await parseMarkdown(markdown))).toEqual(expected)
  })

  // Catches untrusted content that grows the model without bound.
  it('cuts alt at 1,000 characters, drops a source over 4,096 and stops at 100 images', () => {
    expect(parseRichTextHtml(`<img src="a.png" alt="${'a'.repeat(1200)}">`)).toEqual([{ type: 'image', src: 'a.png', alt: 'a'.repeat(1000) }])
    expect(parseRichTextHtml(`<img src="${'a'.repeat(4097)}">`)).toEqual([])
    expect(parseRichTextHtml('<img src="a.png">'.repeat(100))).toHaveLength(100)
    expect(() => parseRichTextHtml('<img src="a.png">'.repeat(101))).toThrow('Rich text input is invalid: html: more than 100 images, over the limit.')
  })

  // Catches a content model whose image fields the render would trust unchecked.
  it('validates the image fields of a content model, naming each path', () => {
    const issues = validateRichText([
      { type: 'image', src: '' },
      { type: 'image', src: 'a.png', alt: '', width: 0, height: Number.NaN },
      { type: 'image', src: 'a.png', width: 10001, caption: 'text', title: 'x' },
      { type: 'image', src: 'a.png', alt: 'a'.repeat(1001) },
      { type: 'image', src: 'a.png', alt: 'Fine', width: 10000, height: 0.5, caption: [{ type: 'text', text: 'Cap' }] },
    ])
    expect(issues.map(issue => `${issue.path}: ${issue.message}`)).toEqual([
      'content[0].src: expected a path or URL of 1 to 4096 characters, found ""',
      'content[1].alt: expected a non-empty string, found ""',
      'content[1].width: expected a number of points above 0 and at most 10000, found 0',
      'content[1].height: expected a number of points above 0 and at most 10000, found NaN',
      'content[2].title: a image node has no field "title"',
      'content[2].width: expected a number of points above 0 and at most 10000, found 10001',
      'content[2].caption: expected an array, found "text"',
      'content[3].alt: the alt text is longer than the limit of 1000 characters',
    ])
    const many = Array.from({ length: 101 }, () => ({ type: 'image', src: 'a.png' }))
    expect(validateRichText(many.slice(0, 100))).toEqual([])
    expect(validateRichText(many).map(issue => `${issue.path}: ${issue.message}`)).toEqual(['content[100]: more than 100 images, over the limit'])
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type ImageBox = { page: number, width: number, height: number }

/** The size and page of every image the engine laid out, in tree order. */
const imageBoxes = (layout: { children: readonly unknown[] }): ImageBox[] => {
  const found: ImageBox[] = []
  const visit = (node: unknown, page: number): void => {
    if (typeof node !== 'object' || node === null) return
    if ('type' in node && node.type === 'IMAGE' && 'box' in node && typeof node.box === 'object' && node.box !== null && 'width' in node.box && 'height' in node.box) {
      found.push({ page, width: Math.round(Number(node.box.width) * 100) / 100, height: Math.round(Number(node.box.height) * 100) / 100 })
    }
    if ('children' in node && Array.isArray(node.children)) for (const child of node.children) visit(child, page)
  }
  layout.children.forEach((page, index) => visit(page, index + 1))
  return found
}

/** Mount, resolve the images and lay out, as a render does, keeping the layout tree. */
const layOut = async (content: () => VNode[]) => {
  const limits = createRenderLimits(DEFAULT_PDF_RENDER_LIMITS)
  const mounted = await mountPdfComponent(defineComponent(() => () =>
    h(PdfDocument, { creationDate: new Date(0) }, () => h(PdfPage, PAGE, content))))
  try {
    const document = mounted.take()
    await resolvePdfImageAssets(document, { assets: ASSETS, limits })
    const result = await renderPlainDocument(document, { limits })
    return { boxes: imageBoxes(result.layout), layoutWarnings: result.layoutWarnings }
  }
  finally {
    mounted.unmount()
  }
}

/** A real template render: asset map, remote policy and limits as the registry passes them. */
const render = (
  content: () => VNode[],
  options: { document?: Partial<PdfDocumentProps>, limits?: Partial<PdfRenderLimits> } = {},
): Promise<PdfRenderResult> => {
  const component: Component = Object.assign(defineComponent(() => () =>
    h(PdfDocument, { creationDate: new Date(0), ...options.document }, () => h(PdfPage, ROBOTO_PAGE, content))), {
    [PDF_DEFINITION_PROPERTY]: {},
  })
  return createPdfTemplate('rich-text-images', component, {
    assets: ASSETS,
    fonts: [ROBOTO, ROBOTO_AS_BOLD],
    limits: { ...DEFAULT_PDF_RENDER_LIMITS, ...options.limits },
    remote: REMOTE,
  }).render({})
}

const failure = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('expected a NuxtPdfError')
}

const richText = (html: string, props: Record<string, unknown> = {}) => () => [h(PdfRichText, { html, ...props })]

describe('rich text images in the PDF', () => {
  // Catches an image that overflows the column, grows past its own width or loses its proportions.
  it.each<[string, string, ImageBox]>([
    ['fills the column without a size', '<img src="photos/alpine.png" alt="Peaks">', { page: 1, width: 515.28, height: 309.17 }],
    ['keeps a width and its proportions', '<img src="photos/alpine.png" width="120">', { page: 1, width: 120, height: 72 }],
    ['keeps a height and its proportions', '<img src="photos/alpine.png" height="60">', { page: 1, width: 100, height: 60 }],
    ['scales a width wider than the column down to it', '<img src="photos/alpine.png" width="900">', { page: 1, width: 515.28, height: 309.17 }],
    // The bullet column is 1.6 em of the 10 pt body: 16 pt.
    ['scales down to the body of a list item', '<ul><li><img src="photos/alpine.png" width="900"></li></ul>', { page: 1, width: 499.28, height: 299.57 }],
    ['fills the column in a figure', '<figure><img src="photos/alpine.png" alt="Peaks"><figcaption>Lake</figcaption></figure>', { page: 1, width: 515.28, height: 309.17 }],
  ])('%s', async (_, html, expected) => {
    expect((await layOut(richText(html))).boxes).toEqual([expected])
  })

  // Catches an image that the engine splits or that overflows the page end.
  it.each([
    ['a block image', '<img src="photos/alpine.png" alt="Peaks">'],
    ['an image in a list item', '<ul><li><img src="photos/alpine.png" alt="Peaks"></li></ul>'],
  ])('moves %s that does not fit to the next page whole', async (_, html) => {
    // 600 pt of the 761.89 pt column are taken; the image is 309.17 pt (299.57 in the list) tall.
    const { boxes, layoutWarnings } = await layOut(() => [h(PdfView, { style: { height: 600 } }), h(PdfRichText, { html })])
    expect(boxes.map(box => box.page)).toEqual([2])
    expect(layoutWarnings).toEqual([])
  })

  // Catches a loaded image that still prints its placeholder, or a refused one that takes the render down.
  it('prints the image when its source loads, and the alt text in a box when it is refused', async () => {
    const result = await render(richText('<p>Alpha</p><img src="photos/alpine.png" alt="Peaks above the lake"><img src="photos/missing.png" alt="A heron at dawn"><img src="photos/missing.png"><p>Omega</p>', { brokenImages: 'placeholder' }))
    const parsed = await parsePdf(result)
    expect(parsed.pages[0]!.text).toBe('Alpha A heron at dawn Omega')
    expect(result.diagnostics.imageWarnings).toEqual([
      { code: 'PDF_RICH_TEXT_IMAGE_REPLACED', reason: 'PDF_ASSET_INVALID', path: 'content[2]' },
      { code: 'PDF_RICH_TEXT_IMAGE_REPLACED', reason: 'PDF_ASSET_INVALID', path: 'content[3]' },
    ])
    expect(Object.isFrozen(result.diagnostics.imageWarnings[0])).toBe(true)
  })

  // Catches a hostile source that reaches the disk or the network, and a refused image that does not fail the render by default.
  it.each<[string, string, 'PDF_ASSET_BLOCKED' | 'PDF_ASSET_INVALID', string]>([
    ['file:', 'file:///etc/passwd', 'PDF_ASSET_BLOCKED', 'PDF images must use a relative local asset path.'],
    ['javascript:', 'javascript:alert(1)', 'PDF_ASSET_BLOCKED', 'PDF images must use a relative local asset path.'],
    ['a data URL', `data:image/png;base64,${JPEG.toString('base64')}`, 'PDF_ASSET_BLOCKED', 'PDF images must use a relative local asset path.'],
    ['an asset whose bytes are not its format', 'photos/fake.png', 'PDF_ASSET_INVALID', 'The PDF image structure, file extension, and declared format must agree.'],
    ['a path with ..', 'photos/../../secret.png', 'PDF_ASSET_BLOCKED', 'Parent-directory traversal is blocked'],
    ['a host off the allowlist', 'https://evil.example.test/a.png', 'PDF_ASSET_BLOCKED', 'is not permitted by pdf.remote.allow.'],
    ['an allowed host that answers 404', 'https://media.example.test/gone.png', 'PDF_ASSET_BLOCKED', 'returned HTTP 404'],
  ])('fails on %s by default, or prints the placeholder with brokenImages="placeholder"', async (_, src, reason, message) => {
    const fetch = vi.fn(async () => new Response('missing', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const html = `<p>Alpha</p><img src="${src}" alt="Refused">`

    const strict = await failure(() => render(richText(html)))
    expect(strict.code).toBe(reason)
    expect(strict.message).toContain('<PdfRichText> image content[1]: ')
    expect(strict.message.toLowerCase()).toContain(message.toLowerCase())

    const lenient = await render(richText(html, { brokenImages: 'placeholder' }))
    expect((await parsePdf(lenient)).pages[0]!.text).toBe('Alpha Refused')
    expect(lenient.diagnostics.imageWarnings).toEqual([{ code: 'PDF_RICH_TEXT_IMAGE_REPLACED', reason, path: 'content[1]' }])
    // Only the allowed host is ever asked, once per render.
    expect(fetch).toHaveBeenCalledTimes(src.startsWith('https://media.') ? 2 : 0)
  })

  // Catches an allowlisted remote image that the rich text path refuses or fetches twice.
  it('loads an allowlisted remote image once', async () => {
    const fetch = vi.fn(async () => new Response(PHOTO, { status: 200, headers: { 'content-length': String(PHOTO.byteLength) } }))
    vi.stubGlobal('fetch', fetch)
    const result = await render(richText('<p>Alpha</p><img src="https://media.example.test/alpine.png" alt="Peaks">'))
    expect((await parsePdf(result)).pages[0]!.text).toBe('Alpha')
    expect(result.diagnostics.imageWarnings).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // Catches a limit that the lenient mode turns into a placeholder: limits protect the server.
  it('fails on a 50 MB length claim and on the image byte total in both modes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } })))
    for (const brokenImages of ['placeholder', 'error']) {
      const claim = await failure(() => render(richText('<img src="https://media.example.test/huge.png" alt="Huge">', { brokenImages })))
      expect([claim.code, claim.message]).toEqual(['PDF_LIMIT_EXCEEDED', `PDF template "rich-text-images": A remote PDF image exceeds pdf.limits.maxTotalImageBytes (${DEFAULT_PDF_RENDER_LIMITS.maxTotalImageBytes}).`])
      const total = await failure(() => render(richText('<img src="photos/alpine.png" alt="Peaks">', { brokenImages }), { limits: { maxTotalImageBytes: 1024 } }))
      expect(total.code).toBe('PDF_LIMIT_EXCEEDED')
    }
  })

  // Catches a styles.image float that the image ignores, or that leaves the caption of a figure behind.
  it('floats each image with styles.image, a figure with its caption', async () => {
    const result = await render(richText('<p>Alpha</p><figure><img src="photos/alpine.png" alt="Peaks"><figcaption>Lake</figcaption></figure><p>Omega</p>', { styles: { image: { float: 'top' } } }))
    expect((await parsePdf(result)).pages[0]!.text).toBe('Lake Alpha Omega')
  })

  // Catches an image in a list item whose float fails with a message about views the content author never wrote.
  it('fails a floating image in a list item, naming its content path and styles.image', async () => {
    const error = await failure(() => render(richText('<ul><li><p>Alpha</p><img src="photos/alpine.png" alt="Peaks"></li></ul>', { styles: { image: { float: 'top' } } })))
    expect([error.code, error.message]).toEqual(['PDF_TREE_INVALID', 'PDF template "rich-text-images": <PdfRichText> cannot float the image at content[0].items[0][1] (float "top" from styles.image): the image is in a list item, whose content stands beside the item\'s marker, so it cannot float out of it. Remove float from styles.image, or move the image out of the list.'])
  })

  // Catches a wrong value that silently falls back to one of the modes.
  it('fails on an unknown brokenImages value', async () => {
    const error = await failure(() => render(richText('<p>Alpha</p>', { brokenImages: 'strict' })))
    expect([error.code, error.message]).toEqual(['PDF_TREE_INVALID', 'PDF template "rich-text-images": <PdfRichText> requires "brokenImages" to be "placeholder" or "error", found "strict".'])
  })
})

// ---------------------------------------------------------------------------
// Tagged PDF
// ---------------------------------------------------------------------------

type StructureNode = { role: string, alt?: string, children: StructureNode[] }

const structure = async (bytes: Uint8Array): Promise<StructureNode[]> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const reduce = (node: unknown): StructureNode[] => {
    if (typeof node !== 'object' || node === null || !('children' in node) || !Array.isArray(node.children)) return []
    const children = node.children.flatMap(reduce)
    if (!('role' in node) || typeof node.role !== 'string') return children
    return [{ role: node.role, ...('alt' in node && typeof node.alt === 'string' ? { alt: node.alt } : {}), children }]
  }
  try {
    const doc = await task.promise
    return reduce(await (await doc.getPage(1)).getStructTree())
  }
  finally {
    await task.destroy()
  }
}

const TAGGED = { conformance: 'PDF/UA-1', title: 'Field notes', language: 'en' } as const

describe('rich text images in tagged PDF', () => {
  // Catches an image without its Figure, its Alt or its caption in the structure tree.
  it('writes Figure with Alt, a captioned image as one Figure, and a placeholder as text', async () => {
    const result = await render(richText([
      '<h1>Field notes</h1>',
      '<img src="photos/alpine.png" alt="Peaks above the lake" width="120">',
      '<figure><img src="photos/alpine.png" alt="The lake at noon" width="120"><figcaption>Lake Inventa</figcaption></figure>',
      '<img src="photos/missing.png" alt="A heron at dawn">',
    ].join(''), { brokenImages: 'placeholder' }), { document: TAGGED })
    expect(await structure(await result.toUint8Array())).toEqual([{ role: 'Root', children: [{ role: 'Document', children: [
      { role: 'H1', children: [] },
      { role: 'Figure', alt: 'Peaks above the lake', children: [] },
      { role: 'Figure', alt: 'The lake at noon', children: [{ role: 'Caption', children: [{ role: 'P', children: [] }] }] },
      { role: 'P', children: [] },
    ] }] }])
  })

  // Catches an image without alternative text in PDF/UA, or an error that names a prop the editor cannot see.
  it.each([
    ['an image', '<h1>Notes</h1><img src="photos/alpine.png">', 'content[1]'],
    ['a captioned image', '<h1>Notes</h1><ul><li><figure><img src="photos/alpine.png"><figcaption>Lake</figcaption></figure></li></ul>', 'content[1].items[0][0]'],
  ])('fails on %s without alt, naming its path', async (_, html, path) => {
    const error = await failure(() => render(richText(html), { document: TAGGED }))
    expect([error.code, error.message]).toEqual(['PDF_TREE_INVALID', `PDF template "rich-text-images": <PdfRichText> image ${path} needs alternative text in a PDF/UA-1 document: a short text that says what it shows (the "alt" attribute of the img, or the text in ![...] in Markdown).`])
  })
})
