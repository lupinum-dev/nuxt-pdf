import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { pdfRenderPlacement } from '../src/runtime/server/worker-render'
import { PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { getPdfAttachments } from '../src/test'
import { installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPdfTemplate, type RenderPdfTemplateOptions } from '../src/test/render-template'

installPdfCanvasGlobals()

const { PdfAttachment, PdfDocument, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice><Total>119.00</Total><Note>Grüße</Note></Invoice>\n'
// Every byte value, so a text or UTF-8 round trip anywhere would corrupt it.
const BINARY = Uint8Array.from({ length: 256 }, (_, index) => 255 - index)
const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url))

const page = (text: string) => h(PdfPage, { size: 'A6' }, () => h(PdfText, null, () => text))

const documentWith = (children: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: new Date(0) }, children))

const render = (children: () => VNode[], options?: RenderPdfTemplateOptions) =>
  renderPdfTemplate(documentWith(children), {}, options)

const utf8 = (text: string) => new TextEncoder().encode(text)
const rawText = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

describe('PdfAttachment', () => {
  // Catches bytes lost or changed at the worker boundary (string encoding,
  // Buffer wrapping) and a second attachment that is dropped.
  it('embeds string and byte content through the render worker', async () => {
    expect(pdfRenderPlacement.inProcess).toBe(false)
    const { bytes, parsed } = await render(() => [
      h(PdfAttachment, { name: 'factur-x.xml', type: 'text/xml', description: 'Invoice data', data: XML }),
      page('One'),
      page('Two'),
      h(PdfAttachment, { name: 'blob.bin', type: 'application/octet-stream', description: 'Raw bytes', data: BINARY }),
      page('Three'),
    ])

    expect(parsed.pageCount).toBe(3)
    expect(parsed.pages.map(item => item.text)).toEqual(['One', 'Two', 'Three'])
    const attachments = await getPdfAttachments(bytes)
    expect(attachments.map(({ filename, description }) => ({ filename, description }))).toEqual([
      { filename: 'blob.bin', description: 'Raw bytes' },
      { filename: 'factur-x.xml', description: 'Invoice data' },
    ])
    const byName = new Map(attachments.map(item => [item.filename, item.content]))
    expect(byName.get('factur-x.xml')).toEqual(utf8(XML))
    expect(byName.get('blob.bin')).toEqual(BINARY)
    expect(rawText(bytes)).toContain('/Subtype /text#2Fxml')
    expect(rawText(bytes)).toContain('/Subtype /application#2Foctet-stream')
  })

  // Catches the engine reading a string as a server file path: the PDF would
  // then carry the content of package.json.
  it('embeds string data that looks like a file path as that text', async () => {
    const { bytes } = await render(() => [
      h(PdfAttachment, { name: 'path.txt', data: PACKAGE_JSON }),
      page('Path'),
    ])

    const [attachment] = await getPdfAttachments(bytes)
    expect(Buffer.from(attachment!.content).toString('utf8')).toBe(PACKAGE_JSON)
  })

  // Catches a relationship that is not written, or a default other than Unspecified.
  it('writes the relationship, Unspecified by default', async () => {
    const { bytes } = await render(() => [
      h(PdfAttachment, { name: 'a.xml', relationship: 'Alternative', data: XML }),
      h(PdfAttachment, { name: 'b.xml', data: XML }),
      page('Relationship'),
    ])

    const raw = rawText(bytes)
    expect(raw).toContain('/AFRelationship /Alternative')
    expect(raw).toContain('/AFRelationship /Unspecified')
  })

  // Catches an invalid attachment that is accepted, or rejected without the typed tree error.
  it.each([
    ['a missing name', () => h(PdfAttachment, { data: XML } as never), '<PdfAttachment> requires "name": a file name without path separators.'],
    ['a name with a slash', () => h(PdfAttachment, { name: '../x.xml', data: XML }), '<PdfAttachment> requires "name": a file name of at most 255 characters'],
    ['a duplicate name', () => [h(PdfAttachment, { name: 'x.xml', data: XML }), h(PdfAttachment, { name: 'x.xml', data: XML })], '<PdfAttachment> "x.xml" is declared twice.'],
    ['data of a wrong type', () => h(PdfAttachment, { name: 'x.xml', data: 42 } as never), '<PdfAttachment> "data" must be a string or a Uint8Array'],
    ['an invalid relationship', () => h(PdfAttachment, { name: 'x.xml', data: XML, relationship: 'Other' } as never), '<PdfAttachment> requires "relationship" to be "Alternative"'],
    ['an invalid MIME type', () => h(PdfAttachment, { name: 'x.xml', data: XML, type: 'xml' }), '<PdfAttachment> requires "type" to be a MIME type such as "text/xml".'],
    ['an attachment inside a page', () => h(PdfPage, null, () => h(PdfAttachment, { name: 'x.xml', data: XML })), 'Invalid PDF nesting: <PdfPage> cannot contain <PdfAttachment>.'],
    ['a child inside an attachment', () => h(PdfAttachment, { name: 'x.xml', data: XML }, () => h(PdfView)), 'Invalid PDF nesting: <PdfAttachment> cannot contain <PdfView>.'],
  ])('rejects %s', async (_case, attachment, message) => {
    const component = documentWith(() => [attachment(), page('Rejected')].flat())
    await expect(mountPdfComponent(component)).rejects.toMatchObject({
      code: PDF_ERROR_CODES.TreeInvalid,
      message: expect.stringContaining(message),
    })
  })

  // Catches a missing or off-by-one total check, and string content counted by
  // characters instead of UTF-8 bytes.
  it('limits the total attachment bytes of one render', async () => {
    const limit = utf8(XML).byteLength + BINARY.byteLength
    const attachments = () => [
      h(PdfAttachment, { name: 'factur-x.xml', data: XML }),
      h(PdfAttachment, { name: 'blob.bin', data: BINARY }),
      page('Limit'),
    ]

    await expect(render(attachments, { limits: { maxTotalAttachmentBytes: limit } })).resolves.toBeDefined()
    await expect(render(attachments, { limits: { maxTotalAttachmentBytes: limit - 1 } })).rejects.toMatchObject({
      code: PDF_ERROR_CODES.LimitExceeded,
      message: expect.stringContaining(`PDF attachments of this render exceed pdf.limits.maxTotalAttachmentBytes (${limit - 1} bytes in total).`),
    })
  })
})
