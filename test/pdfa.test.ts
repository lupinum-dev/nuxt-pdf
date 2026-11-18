import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineComponent, h, type VNode } from 'vue'
import { afterAll, describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import type { PdfDocumentProps, PdfFacturXProfile } from '../src/runtime/primitives'
import { buildSrgbIccProfile, srgbColorantsD50 } from '../src/runtime/server/engine/pdfa'
import { mountPdfComponent } from '../src/runtime/renderer'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { normalizePdfLimits } from '../src/runtime/server/render-limits'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_SOURCE_PROP } from '../src/runtime/shared/template'
import { getPdfAttachments, installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { accessibleChildren, renderTagged, structuredChildren, TAGGED_PROPS } from './fixtures/tagged-document'
import verapdfImage from './fixtures/verapdf-image.json'

installPdfCanvasGlobals()

const {
  PdfAttachment,
  PdfDocument,
  PdfFacturX,
  PdfImage,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfPageNumber,
  PdfSvg,
  PdfTable,
  PdfTableCell,
  PdfTableHeader,
  PdfTableRow,
  PdfText,
  PdfView,
} = PDF_COMPONENTS

const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}
// RGBA, so the image has a soft mask.
const SAMPLE_PNG = new Uint8Array(readFileSync('test/fixtures/assets/sample.png'))
const CREATED = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
const PAGE_STYLE = { padding: 32, fontFamily: 'Roboto', fontSize: 10 }

// A synthetic CII invoice. Every party, number and address is made up.
const ciiInvoice = (guideline: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>${guideline}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>TEST-0001</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260102</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Example Supplier Ltd</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>00000</ram:PostcodeCode><ram:LineOne>Sample Street 1</ram:LineOne><ram:CityName>Exampletown</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE000000000</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Example Customer Ltd</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>00000</ram:PostcodeCode><ram:LineOne>Test Road 2</ram:LineOne><ram:CityName>Sampleville</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery />
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">19.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>119.00</ram:GrandTotalAmount>
        <ram:DuePayableAmount>119.00</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`
const EN_16931 = 'urn:cen.eu:en16931:2017'
const MINIMUM = 'urn:factur-x.eu:1p0:minimum'
const GUIDELINE = (id: string) => `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${id}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>`
const XRECHNUNG = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'

type DocumentProps = PdfDocumentProps & Record<string, unknown>

const documentWith = (props: DocumentProps, children: () => VNode[]) => defineComponent(() => () =>
  h(PdfDocument, { creationDate: CREATED, ...props }, children))

const render = (props: DocumentProps, children: () => VNode[], options: { maxTotalAttachmentBytes?: number } = {}) =>
  renderPreparedPdfTemplate(documentWith(props, children), {}, {
    fonts: [ROBOTO],
    limits: normalizePdfLimits(options.maxTotalAttachmentBytes === undefined ? undefined : options),
  })

const textPage = (text: string) => h(PdfPage, { size: 'A6', style: PAGE_STYLE }, () => h(PdfText, null, () => text))

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

/** The uncompressed XMP packet of a rendered PDF. */
const xmpOf = (bytes: Uint8Array): string => {
  const match = /<\?xpacket begin[\s\S]*?<\?xpacket end="w"\?>/.exec(Buffer.from(bytes).toString('utf8'))
  return match?.[0] ?? ''
}

const errorOf = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('expected the render to fail')
}

/** Fixture (a): every feature a plain archival document is checked with. */
const archivalChildren = () => [
  h(PdfAttachment, { name: 'notes.txt', type: 'text/plain', description: 'Plain notes', data: 'Plain attachment content\n' }),
  h(PdfAttachment, { name: 'raw.bin', data: new Uint8Array([0, 1, 2, 255]) }),
  h(PdfPage, { size: 'A5', style: PAGE_STYLE }, () => [
    h(PdfView, { fixed: true, style: { marginBottom: 8 } }, () => h(PdfText, null, () => ['Field report · page ', h(PdfPageNumber)])),
    h(PdfText, { style: { fontSize: 16, marginBottom: 8 } }, () => 'Grüße aus dem Archiv & <more>'),
    h(PdfImage, { src: SAMPLE_PNG, style: { width: 140, marginBottom: 8 } }),
    h(PdfLink, { href: 'https://example.com/archive' }, () => h(PdfText, { style: { color: '#1d4ed8' } }, () => 'example.com/archive')),
    h(PdfTable, { columns: [1, '60pt'], style: { marginTop: 8 } }, () => [
      h(PdfTableHeader, { fixed: true, style: { backgroundColor: '#e5e7eb' } }, () => [
        h(PdfTableCell, null, () => 'Item'),
        h(PdfTableCell, { align: 'right' }, () => 'Amount'),
      ]),
      ...Array.from({ length: 60 }, (_, index) => h(PdfTableRow, { key: index }, () => [
        h(PdfTableCell, null, () => `Observation ${index + 1}`),
        h(PdfTableCell, { align: 'right' }, () => `${index * 3}.00`),
      ])),
    ]),
  ]),
]

const ARCHIVAL_PROPS: DocumentProps = {
  title: 'Field report & notes <2026>',
  author: 'Example Author',
  subject: 'PDF/A-3b fixture',
  keywords: 'archive, test',
  language: 'en-GB',
  conformance: 'PDF/A-3b',
}

/** Fixture (b): a hybrid invoice. */
const invoiceChildren = (profile: PdfFacturXProfile = 'EN 16931', guideline = EN_16931) => () => [
  h(PdfFacturX, { xml: ciiInvoice(guideline), profile }),
  h(PdfPage, { size: 'A4', style: PAGE_STYLE }, () => [
    h(PdfText, { style: { fontSize: 18, marginBottom: 12 } }, () => 'Invoice TEST-0001'),
    h(PdfText, null, () => 'Example Supplier Ltd · Sample Street 1 · 00000 Exampletown'),
    h(PdfTable, { columns: [1, '80pt'], style: { marginTop: 12 } }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => 'Service'), h(PdfTableCell, { align: 'right' }, () => 'Amount')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Consulting'), h(PdfTableCell, { align: 'right' }, () => '100.00 EUR')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'VAT 19 %'), h(PdfTableCell, { align: 'right' }, () => '19.00 EUR')]),
      h(PdfTableRow, null, () => [h(PdfTableCell, null, () => 'Total'), h(PdfTableCell, { align: 'right' }, () => '119.00 EUR')]),
    ]),
  ]),
]

const INVOICE_PROPS: DocumentProps = { title: 'Invoice TEST-0001', author: 'Example Supplier Ltd', language: 'de' }

describe('documents without a conformance claim', () => {
  // Catches any PDF/A branch leaking into ordinary documents: the header, the
  // XMP, the output intent or a reordered Info dictionary would change these
  // bytes. The hash was taken from the renderer before phase 14 (commit
  // a7faca7); update it only for an intended change of ordinary output.
  it('write the same bytes as before', async () => {
    // No registered font, so the hash also holds for the renderer before
    // subset names became reproducible.
    const { bytes } = await renderPreparedPdfTemplate(documentWith({ title: 'Plain & simple', author: 'Example Author' }, () => [
      h(PdfAttachment, { name: 'notes.txt', type: 'text/plain', data: 'notes' }),
      h(PdfAttachment, { name: 'raw.bin', data: 'no type' }),
      h(PdfPage, { size: 'A6' }, () => [
        h(PdfText, null, () => 'Plain document'),
        h(PdfImage, { src: SAMPLE_PNG, style: { width: 60 } }),
        h(PdfLink, { href: 'https://example.com' }, () => h(PdfText, null, () => 'Link')),
      ]),
    ]), {})

    expect(latin1(bytes.subarray(0, 8))).toBe('%PDF-1.3')
    expect(latin1(bytes)).not.toContain('/OutputIntents')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PLAIN_DOCUMENT_SHA256)
  }, 60_000)
})

describe('conformance="PDF/A-3b"', () => {
  // Catches an XMP packet that is missing, unescaped (the engine's own writer
  // does not escape) or out of step with the Info dictionary.
  // A file without a MIME type fails veraPDF rule 6.8-1.
  it('writes PDF 1.7 with an escaped XMP packet, an sRGB output intent and typed files', async () => {
    const { bytes } = await render(ARCHIVAL_PROPS, () => [h(PdfAttachment, { name: 'raw.bin', data: 'x' }), textPage('Archive')])
    const xmp = xmpOf(bytes)

    expect(latin1(bytes)).toContain('/Subtype /application#2Foctet-stream')
    expect(latin1(bytes.subarray(0, 8))).toBe('%PDF-1.7')
    expect(latin1(bytes)).toMatch(/\/OutputIntents \[\d+ 0 R\]/)
    expect(latin1(bytes)).toContain('/S /GTS_PDFA1')
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>')
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Field report &amp; notes &lt;2026&gt;</rdf:li>')
    expect(xmp).toContain('<pdf:Producer>nuxt-pdf</pdf:Producer>')
    expect(xmp).toContain('<xmp:CreateDate>2026-01-02T03:04:05Z</xmp:CreateDate>')
    expect(xmp).not.toContain('fx:')
  })

  // Catches a text in a font the PDF does not embed, which veraPDF rejects
  // (rule 6.2.11.4.1): the default font, a named standard font, a page
  // number token that inherits the default, a character the registered font
  // lacks (the engine paints it in Helvetica), and SVG text, which does not
  // inherit the page font. Each message names the cause the author can fix.
  const REGISTER = 'Register a font in pdf.fonts (nuxt.config) and set fontFamily on the text, its page or a parent view.'
  it.each([
    ['the default font', {}, () => h(PdfText, null, () => 'Default'), `<PdfText> uses the standard font "Helvetica", which is not embedded. ${REGISTER}`],
    ['a standard font family', {}, () => h(PdfText, { style: { fontFamily: 'Times-Roman' } }, () => 'Times'), `<PdfText> uses the standard font "Times-Roman", which is not embedded. ${REGISTER}`],
    ['a page number', {}, () => h(PdfText, null, () => h(PdfPageNumber)), `<PdfText> uses the standard font "Helvetica", which is not embedded. ${REGISTER}`],
    ['characters the font lacks', PAGE_STYLE, () => h(PdfText, null, () => 'Total\t42 € 🙂'), '<PdfText> has characters that font "Roboto" does not contain: U+0009, U+1F642 "🙂". The engine paints them in the standard font "Helvetica", which is not embedded. Remove or replace these characters (a tab with spaces, for example), or register a font that contains them and add it to fontFamily.'],
    ['SVG text', PAGE_STYLE, () => h(PdfSvg, { width: 40, height: 20, viewBox: '0 0 40 20' }, () => h(PdfText, { x: 0, y: 10 }, () => 'Label')), '<PdfText> inside <PdfSvg> uses the standard font "Helvetica", which is not embedded. SVG text does not inherit fontFamily from the page: register a font in pdf.fonts (nuxt.config) and set fontFamily in the style of the SVG text.'],
  ])('fails for %s with a message that names the cause', async (_label, style, content, message) => {
    const error = await errorOf(() => render({ conformance: 'PDF/A-3b' }, () => [
      h(PdfPage, { size: 'A6', style }, content),
    ]))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(`PDF/A-3b requires embedded fonts, but ${message}`)
  })

  // Catches an error that does not lead the author to the text. In-process:
  // the worker boundary does not carry the position yet (see the p14 record).
  it('names the source position of the text in a standard font', async () => {
    const mounted = await mountPdfComponent(documentWith({ conformance: 'PDF/A-3b' }, () => [
      h(PdfPage, { size: 'A6' }, () => h(PdfText, { [PDF_SOURCE_PROP]: 'report.vue:4:7' }, () => 'Default')),
    ]))
    try {
      const error = await errorOf(() => renderPlainDocument(mounted.document))
      expect(error.source).toEqual({ file: 'report.vue', line: 4, column: 7 })
    }
    finally {
      mounted.unmount()
    }
  })
})

describe('PdfFacturX', () => {
  // Catches a wrong file name, MIME type or relationship (readers look for
  // exactly these), and XMP without the Factur-X facts.
  it('embeds the XML as factur-x.xml and states the profile in the XMP', async () => {
    const { bytes } = await render(INVOICE_PROPS, invoiceChildren())
    const [attachment] = await getPdfAttachments(bytes)
    const xmp = xmpOf(bytes)

    expect(attachment?.filename).toBe('factur-x.xml')
    expect(Buffer.from(attachment!.content).toString('utf8')).toBe(ciiInvoice(EN_16931))
    expect(latin1(bytes)).toContain('/Subtype /text#2Fxml')
    expect(latin1(bytes)).toContain('/AFRelationship /Alternative')
    expect(latin1(bytes.subarray(0, 8))).toBe('%PDF-1.7')
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>')
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>')
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>')
    expect(xmp).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>')
  })

  it.each([
    ['MINIMUM', 'urn:factur-x.eu:1p0:minimum', 'factur-x.xml', 'Data'],
    ['XRECHNUNG', XRECHNUNG, 'xrechnung.xml', 'Alternative'],
  ] as const)('uses the file name and relationship of %s', async (profile, guideline, name, relationship) => {
    const { bytes } = await render(INVOICE_PROPS, invoiceChildren(profile, guideline))
    const [attachment] = await getPdfAttachments(bytes)

    expect(attachment?.filename).toBe(name)
    expect(latin1(bytes)).toContain(`/AFRelationship /${relationship}`)
    expect(xmpOf(bytes)).toContain(`<fx:ConformanceLevel>${profile}</fx:ConformanceLevel>`)
  })

  // Catches XML bytes that escape the attachment budget.
  it('counts the XML for maxTotalAttachmentBytes', async () => {
    const xml = ciiInvoice(EN_16931)
    const error = await errorOf(() => render(INVOICE_PROPS, () => [
      h(PdfAttachment, { name: 'notes.txt', data: 'x'.repeat(10) }),
      h(PdfFacturX, { xml, profile: 'EN 16931' }),
      textPage('Invoice'),
    ], { maxTotalAttachmentBytes: Buffer.byteLength(xml) + 9 }))

    expect(error.code).toBe(PDF_ERROR_CODES.LimitExceeded)
  })

  const invalid: Array<[string, DocumentProps, () => VNode[], string]> = [
    ['an unknown conformance', { conformance: 'PDF/A-1b' } as never, () => [textPage('x')], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['an Invalid Date as creationDate', { conformance: 'PDF/A-3b', creationDate: new Date(Number.NaN) }, () => [textPage('x')], '<PdfDocument> requires "creationDate" to be a valid Date, such as new Date(\'2026-01-31\'); got an Invalid Date.'],
    ['a creationDate after the year 9999', { conformance: 'PDF/A-3b', creationDate: new Date(Date.UTC(10000, 0, 1)) }, () => [textPage('x')], '<PdfDocument> requires "creationDate" to have a year from 0 to 9999 (UTC), which a PDF date can hold; got the year 10000.'],
    ['another PDF version', { conformance: 'PDF/A-3b', pdfVersion: '1.4' }, () => [textPage('x')], '<PdfDocument> claims PDF/A-3b, which is written as PDF 1.7; remove "pdfVersion" or set it to "1.7".'],
    ['another PDF version with PdfFacturX', { pdfVersion: '1.3' }, invoiceChildren(), '<PdfDocument> claims PDF/A-3b, which is written as PDF 1.7; remove "pdfVersion" or set it to "1.7".'],
    ['a note in a PDF/A document', { conformance: 'PDF/A-3b' }, () => [h(PdfPage, null, () => h(PdfNote, null, () => 'x'))], '<PdfNote> is not supported in a PDF/A document: PDF/A requires a printable appearance for every note, which the engine does not write. Print the note as <PdfText> instead.'],
    ['a note in a hybrid invoice', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'EN 16931' }), h(PdfPage, null, () => h(PdfNote, null, () => 'x'))], '<PdfNote> is not supported in a PDF/A document'],
    ['an unknown profile', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'COMFORT' } as never), textPage('x')], '<PdfFacturX> requires "profile" to be "MINIMUM", "BASIC WL", "BASIC", "EN 16931", "EXTENDED" or "XRECHNUNG".'],
    ['a missing profile', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931) } as never), textPage('x')], '<PdfFacturX> requires the "profile" prop.'],
    ['an invalid relationship', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'EN 16931', relationship: 'Supplement' } as never), textPage('x')], '<PdfFacturX> requires "relationship" to be "Data", "Alternative" or "Source".'],
    ['Alternative for a MINIMUM invoice', {}, () => [h(PdfFacturX, { xml: ciiInvoice(MINIMUM), profile: 'MINIMUM', relationship: 'Alternative' }), textPage('x')], '<PdfFacturX> "relationship" is "Alternative", but a MINIMUM invoice must use "Data": its XML holds less than the visible invoice (Factur-X 1.07.2, section 6.2.2). Remove "relationship" or set it to "Data".'],
    ['Source for a BASIC WL invoice', {}, () => [h(PdfFacturX, { xml: ciiInvoice('urn:factur-x.eu:1p0:basicwl'), profile: 'BASIC WL', relationship: 'Source' }), textPage('x')], '<PdfFacturX> "relationship" is "Source", but a BASIC WL invoice must use "Data"'],
    // eslint-disable-next-line no-sparse-arrays -- the hole is the case
    ['a conformance list with a hole', { conformance: [, 'PDF/A-3b'] as never }, () => [textPage('x')], '<PdfDocument> requires "conformance" to be "PDF/A-3b", "PDF/A-3a" or "PDF/UA-1", or a list of them with at most one PDF/A level.'],
    ['XML that is not text or bytes', {}, () => [h(PdfFacturX, { xml: 42, profile: 'EN 16931' } as never), textPage('x')], '<PdfFacturX> "xml" must be a string or a Uint8Array with the file content.'],
    ['XML of another profile', {}, () => [h(PdfFacturX, { xml: ciiInvoice('urn:factur-x.eu:1p0:minimum'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "profile" is "EN 16931", but the XML names "urn:factur-x.eu:1p0:minimum" (MINIMUM).'],
    ['XML of no known profile', {}, () => [h(PdfFacturX, { xml: ciiInvoice('urn:example:other'), profile: 'BASIC' }), textPage('x')], '<PdfFacturX> "profile" is "BASIC", but the XML names "urn:example:other", which is not a Factur-X profile.'],
    ['XML without a profile', {}, () => [h(PdfFacturX, { xml: '<rsm:CrossIndustryInvoice xmlns:rsm="urn:x"/>', profile: 'BASIC' }), textPage('x')], '<PdfFacturX> "xml" does not name a profile: it has no GuidelineSpecifiedDocumentContextParameter ID (BT-24).'],
    ['XML that is not a CII invoice', {}, () => [h(PdfFacturX, { xml: '<Invoice/>', profile: 'BASIC' }), textPage('x')], '<PdfFacturX> "xml" has the root element <Invoice>; a Factur-X invoice is a CII file with the root element <rsm:CrossIndustryInvoice>.'],
    ['a profile ID in a comment', {}, () => [h(PdfFacturX, { xml: ciiInvoice(MINIMUM).replace('<rsm:ExchangedDocumentContext>', `<rsm:ExchangedDocumentContext><!-- ${GUIDELINE(EN_16931)} -->`), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "profile" is "EN 16931", but the XML names "urn:factur-x.eu:1p0:minimum" (MINIMUM).'],
    ['a profile ID in a CDATA section', {}, () => [h(PdfFacturX, { xml: ciiInvoice(MINIMUM).replace('<rsm:ExchangedDocumentContext>', `<rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID><![CDATA[${GUIDELINE(EN_16931)}]]></ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>`), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "profile" is "EN 16931", but the XML names "urn:factur-x.eu:1p0:minimum" (MINIMUM).'],
    ['XML with an unclosed tag', {}, () => [h(PdfFacturX, { xml: `${GUIDELINE(EN_16931)}<unclosed`, profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: the tag <unclosed> is malformed or not closed (line 1).'],
    ['XML with crossed tags', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('</rsm:ExchangedDocumentContext>', ''), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: the closing tag </rsm:CrossIndustryInvoice> does not match <rsm:ExchangedDocumentContext>'],
    ['XML with an unknown entity', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('TEST-0001', 'TEST&nbsp;0001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has an "&" that is not a known entity or a character reference to an allowed character (line 9).'],
    ['XML with a bare & in an attribute', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('<ram:ID>TEST-0001', '<ram:ID schemeID="a&b">TEST-0001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: the attribute "schemeID" of <ram:ID> has an "&" that is not a known entity or a character reference to an allowed character (line 9).'],
    ['XML with a duplicate attribute', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('<ram:ID>TEST-0001', '<ram:ID schemeID="a" schemeID="b">TEST-0001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: the tag <ram:ID> has the attribute "schemeID" twice (line 9).'],
    ['XML with ]]> in text', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('TEST-0001', 'TEST]]>0001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has "]]>" in text, which must be written as "]]&gt;" (line 9).'],
    ['XML with a control character', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('TEST-0001', 'TEST\u00010001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has the character U+0001, which XML does not allow (line 9).'],
    ['XML with a reference to a surrogate', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931).replace('TEST-0001', 'TEST&#xD800;0001'), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has an "&" that is not a known entity or a character reference to an allowed character (line 9).'],
    ['XML with whitespace before the declaration', {}, () => [h(PdfFacturX, { xml: ` ${ciiInvoice(EN_16931)}`, profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has an XML declaration that is not at the very start of the file (line 1).'],
    ['XML with a no-break space after the root', {}, () => [h(PdfFacturX, { xml: `${ciiInvoice(EN_16931)}\u00A0`, profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not well-formed XML: it has text outside the root element'],
    ['XML that is not UTF-8', {}, () => [h(PdfFacturX, { xml: new Uint8Array(Buffer.from(`\uFEFF${ciiInvoice(EN_16931)}`, 'utf16le')), profile: 'EN 16931' }), textPage('x')], '<PdfFacturX> "xml" is not UTF-8 text; Factur-X requires a UTF-8 XML file.'],
    ['a second PdfFacturX', {}, () => [...invoiceChildren()(), h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'EN 16931' })], '<PdfDocument> may contain only one <PdfFacturX>.'],
    ['an attachment with its file name', {}, () => [h(PdfAttachment, { name: 'factur-x.xml', data: '<x/>' }), ...invoiceChildren()()], '<PdfAttachment> "factur-x.xml" is the file name of <PdfFacturX>; choose another name.'],
    ['PdfFacturX inside a page', {}, () => [h(PdfPage, null, () => h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'EN 16931' }))], 'Invalid PDF nesting: <PdfPage> cannot contain <PdfFacturX>.'],
    ['a child inside PdfFacturX', {}, () => [h(PdfFacturX, { xml: ciiInvoice(EN_16931), profile: 'EN 16931' }, () => h(PdfView)), textPage('x')], 'Invalid PDF nesting: <PdfFacturX> cannot contain <PdfView>.'],
  ]

  // Catches invalid input that would write a file which claims PDF/A or
  // Factur-X and is not.
  it.each(invalid)('fails for %s', async (_label, props, children, message) => {
    const error = await errorOf(() => render(props, children))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  })

  // Catches a profile check that reads the text instead of the elements:
  // each XML is well-formed and names its profile in another valid form.
  it.each([
    ['a comment before the ID', ciiInvoice(EN_16931).replace('<ram:ID>urn', '<!-- BT-24 --><ram:ID>urn'), 'EN 16931'],
    ['the ID in a CDATA section', ciiInvoice(`<![CDATA[${EN_16931}]]>`), 'EN 16931'],
    ['character references in the ID', ciiInvoice('urn:cen.eu:en16931:2017&#x23;compliant&#35;urn:factur-x.eu:1p0:basic'), 'BASIC'],
    ['references and ">" in attribute values', ciiInvoice(EN_16931).replace('<ram:ID>TEST-0001', '<ram:ID schemeID="a &amp; b &#169;" note=\'x>y\'>TEST-0001'), 'EN 16931'],
    ['a BOM, an XML declaration and whitespace after the root', `\uFEFF${ciiInvoice(EN_16931)}\r\n\t `, 'EN 16931'],
  ] as const)('reads the profile with %s', async (_label, xml, profile) => {
    const mounted = await mountPdfComponent(documentWith({}, () => [h(PdfFacturX, { xml, profile }), textPage('x')]))
    mounted.unmount()
  })
})

describe('the sRGB ICC profile', () => {
  // Catches wrong colorant math, which no validator notices: veraPDF checks
  // the profile structure, not its colors. Expected values are the colorants
  // of the ICC's published sRGB profiles.
  it('states the published D50 colorants of sRGB', () => {
    const [red, green, blue] = srgbColorantsD50()
    const published = [[0.436066, 0.222488, 0.013916], [0.385147, 0.716873, 0.097076], [0.143066, 0.060608, 0.714096]]

    for (const [index, colorant] of [red, green, blue].entries()) {
      colorant.forEach((value, axis) => expect(value).toBeCloseTo(published[index]![axis]!, 3))
    }
  })

  // Catches a header or tag table that does not match the profile's bytes.
  it('has a consistent header and tag table', () => {
    const profile = Buffer.from(buildSrgbIccProfile())
    const tagCount = profile.readUInt32BE(128)
    const tags = Array.from({ length: tagCount }, (_, index) => ({
      signature: profile.toString('latin1', 132 + index * 12, 136 + index * 12),
      end: profile.readUInt32BE(136 + index * 12) + profile.readUInt32BE(140 + index * 12),
    }))

    expect(profile.readUInt32BE(0)).toBe(profile.byteLength)
    expect(profile.toString('latin1', 36, 40)).toBe('acsp')
    expect(tags.map(tag => tag.signature)).toEqual(['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC'])
    for (const tag of tags) expect(tag.end).toBeLessThanOrEqual(profile.byteLength)
  })
})

// veraPDF from the pinned image. `pnpm test:pdfa` sets NUXT_PDF_VERAPDF and
// fails before this file runs when Docker is missing; `pnpm test` skips it.
// The image is pinned by digest in test/fixtures/verapdf-image.json, which
// scripts/test-pdfa.mjs pulls before vitest starts.
const VERAPDF_IMAGE = verapdfImage.image

describe.runIf(process.env.NUXT_PDF_VERAPDF === '1')('veraPDF (PDF/A-3b, PDF/A-3a, PDF/UA-1)', () => {
  const directories: string[] = []
  afterAll(async () => {
    await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })))
  })

  const validate = async (name: string, bytes: Uint8Array, flavour: '3b' | '3a' | 'ua1' = '3b'): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-pdfa-'))
    directories.push(directory)
    // mkdtemp makes the folder private (0700). On Linux the container's user is
    // not ours, so veraPDF reported "File /data/<name> doesn't exist".
    await chmod(directory, 0o755)
    await writeFile(join(directory, name), bytes, { mode: 0o644 })
    if (process.env.NUXT_PDF_VERAPDF_KEEP) await writeFile(join(process.env.NUXT_PDF_VERAPDF_KEEP, name), bytes)
    try {
      return execFileSync('docker', [
        'run', '--rm', '-v', `${directory}:/data`, VERAPDF_IMAGE,
        '--flavour', flavour, '--format', 'text', '-v', `/data/${name}`,
      ], { encoding: 'utf8', timeout: 120_000 })
    }
    catch (error) {
      // veraPDF exits non-zero when a file fails; its report is on stdout.
      const stdout = (error as { stdout?: unknown }).stdout
      if (typeof stdout === 'string' && stdout.trim() !== '') return stdout
      throw error
    }
  }

  it.each([
    ['archival.pdf', () => render(ARCHIVAL_PROPS, archivalChildren)],
    ['factur-x-invoice.pdf', () => render(INVOICE_PROPS, invoiceChildren())],
  ])('passes %s', async (name, run) => {
    const { bytes, parsed } = await run()
    if (name === 'archival.pdf') expect(parsed.pageCount).toBeGreaterThanOrEqual(2)
    const report = await validate(name, bytes)

    expect(report, report).toMatch(new RegExp(`^PASS /data/${name.replace('.', '\\.')}`, 'm'))
  }, 180_000)

  // A Factur-X invoice that is also tagged: the embedded XML, the PDF/A-3a
  // metadata and the structure tree in one file.
  it('passes a tagged Factur-X invoice as PDF/A-3a and PDF/UA-1', async () => {
    const name = 'factur-x-tagged.pdf'
    const { bytes } = await render({ ...INVOICE_PROPS, conformance: ['PDF/A-3a', 'PDF/UA-1'] }, invoiceChildren())

    for (const flavour of ['3a', 'ua1'] as const) {
      const report = await validate(name, bytes, flavour)
      expect(report, report).toMatch(new RegExp(`^PASS /data/factur-x-tagged\\.pdf ${flavour}`, 'm'))
    }
  }, 240_000)

  // The phase 15a fixture (test/fixtures/tagged-document.ts): headings,
  // paragraphs over two pages, a figure, a decorative image, a view with a
  // background and border, a fixed running head with a page number.
  it.each([
    ['tagged.pdf', TAGGED_PROPS, ['ua1']],
    ['tagged-archival.pdf', { ...TAGGED_PROPS, conformance: ['PDF/A-3b', 'PDF/UA-1'] }, ['ua1', '3b']],
  ] as const)('passes %s', async (name, props, flavours) => {
    const { bytes, parsed } = await renderTagged(props)
    expect(parsed.pageCount).toBe(2)

    for (const flavour of flavours) {
      const report = await validate(name, bytes, flavour)
      expect(report, report).toMatch(new RegExp(`^PASS /data/${name.replace('.', '\\.')} ${flavour}`, 'm'))
    }
  }, 240_000)

  // The phase 15b fixture: a section with a heading, inline and block links
  // (external and internal), a list, a quote, a figure with a caption, inline
  // images, a page number in the flow, and a table over two pages with a
  // repeated header and a colspan. `'PDF/A-3a'` is the tagged PDF/A level.
  const STRUCTURED = { ...TAGGED_PROPS, title: 'Structured report' }
  it.each([
    ['structured.pdf', STRUCTURED, ['ua1']],
    ['structured-archival.pdf', { ...STRUCTURED, conformance: ['PDF/A-3b', 'PDF/UA-1'] }, ['ua1', '3b']],
    ['structured-3a.pdf', { ...STRUCTURED, title: undefined, conformance: 'PDF/A-3a' }, ['3a']],
    ['structured-3a-ua.pdf', { ...STRUCTURED, conformance: ['PDF/A-3a', 'PDF/UA-1'] }, ['3a', 'ua1']],
  ] as const)('passes %s', async (name, props, flavours) => {
    const { bytes, parsed } = await renderTagged(props, structuredChildren)
    expect(parsed.pageCount).toBe(2)

    for (const flavour of flavours) {
      const report = await validate(name, bytes, flavour)
      expect(report, report).toMatch(new RegExp(`^PASS /data/${name.replace('.', '\\.')} ${flavour}`, 'm'))
    }
  }, 240_000)

  // The phase 18 fixture: ActualText on capitals and letter spacing (also on
  // each page's part of a split paragraph), a figure view with its content
  // and caption, a decorative figure, and row headers.
  const ACCESSIBLE = { ...TAGGED_PROPS, title: 'Accessible details' }
  it.each([
    ['accessible.pdf', ACCESSIBLE, ['ua1']],
    ['accessible-3a-ua.pdf', { ...ACCESSIBLE, conformance: ['PDF/A-3a', 'PDF/UA-1'] }, ['3a', 'ua1']],
  ] as const)('passes %s', async (name, props, flavours) => {
    const { bytes, parsed } = await renderTagged(props, accessibleChildren)
    expect(parsed.pageCount).toBe(2)

    for (const flavour of flavours) {
      const report = await validate(name, bytes, flavour)
      expect(report, report).toMatch(new RegExp(`^PASS /data/${name.replace('.', '\\.')} ${flavour}`, 'm'))
    }
  }, 240_000)
})

// sha256 of the plain document above, rendered without any phase 14 code.
const PLAIN_DOCUMENT_SHA256 = 'ece2a4a856d3ded19d7c3bd551f0b8c57c5cf9892935ee80be73afcb96362615'
