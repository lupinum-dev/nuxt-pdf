import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderEInvoiceXml, validateEInvoice } from '../../src/runtime/einvoice'
import type { EInvoice } from '../../src/runtime/einvoice'
import type { PdfFontDataUrl } from '../../src/runtime/fonts'
import { normalizePdfLimits } from '../../src/runtime/server/render-limits'
import { pdfRenderPlacement } from '../../src/runtime/server/worker-pool'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../src/runtime/shared/errors'
import { getPdfAttachments } from '../../src/test/pdf'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { forXRechnung, VALID_INVOICES } from './invoices'
import { renderInvoicePdf } from './render-pdf'

const { PdfDocument, PdfFacturX, PdfPage, PdfText } = PDF_COMPONENTS

const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}
const INVOICE = VALID_INVOICES['two-rates']!

/** Render a document whose `PdfFacturX` gets exactly these props. */
const renderWith = (facturX: Record<string, unknown>, limits?: { maxTotalAttachmentBytes: number }) =>
  renderPreparedPdfTemplate(defineComponent(() => () => h(PdfDocument, { conformance: 'PDF/A-3b', title: 'Invoice', language: 'en' }, () => [
    h(PdfFacturX, facturX as never),
    h(PdfPage, { size: 'A6', style: { fontFamily: 'Roboto' } }, () => h(PdfText, null, () => 'Invoice')),
  ])), {}, { fonts: [ROBOTO], limits: normalizePdfLimits(limits) })

const errorOf = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('The render did not fail.')
}

describe('PdfFacturX with invoice', () => {
  afterEach(() => {
    pdfRenderPlacement.inProcess = false
  })

  // Catches an `invoice` prop that is ignored or written with another
  // profile: the embedded file is exactly the XML renderEInvoiceXml writes.
  it.each([
    ['EN 16931', INVOICE, 'factur-x.xml'],
    ['MINIMUM', INVOICE, 'factur-x.xml'],
    ['XRECHNUNG', forXRechnung(INVOICE), 'xrechnung.xml'],
  ] as const)('embeds the %s XML written from the invoice data', async (profile, invoice, fileName) => {
    const [attachment] = await getPdfAttachments(await renderInvoicePdf(invoice, profile))

    expect(attachment?.filename).toBe(fileName)
    expect(Buffer.from(attachment!.content).toString('utf8')).toBe(renderEInvoiceXml(invoice, { profile }))
  })

  // Catches an ambiguous source: the author must give one of the two.
  it.each([
    ['both', { invoice: INVOICE, xml: renderEInvoiceXml(INVOICE, { profile: 'EN 16931' }), profile: 'EN 16931' }, '<PdfFacturX> has both "xml" and "invoice".'],
    ['neither', { profile: 'EN 16931' }, '<PdfFacturX> requires "invoice" (the invoice data) or "xml" (the finished CII XML).'],
    ['EXTENDED from invoice data', { invoice: INVOICE, profile: 'EXTENDED' }, '<PdfFacturX> cannot write the EXTENDED profile from "invoice". Give the EXTENDED XML with "xml" instead.'],
    ['an invoice that is not an object', { invoice: 'INV-1', profile: 'EN 16931' }, '<PdfFacturX> "invoice" must be the invoice data object.'],
  ])('rejects %s with a typed error', async (_case, props, message) => {
    const error = await errorOf(() => renderWith(props))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  })

  // Catches issues lost on the way to the caller, on the worker path and on
  // the in-process path that inlined builds use.
  it.each([false, true])('fails with PDF_INVOICE_INVALID and the issues (in-process: %s)', async (inProcess) => {
    pdfRenderPlacement.inProcess = inProcess
    const invoice: EInvoice = { ...INVOICE, buyerReference: undefined }
    const error = await errorOf(() => renderWith({ invoice, profile: 'XRECHNUNG' }))

    expect(error.code).toBe(PDF_ERROR_CODES.InvoiceInvalid)
    expect(error.issues).toEqual(validateEInvoice(invoice, { profile: 'XRECHNUNG' }))
    expect(error.issues?.map(issue => issue.rule)).toContain('BR-DE-15')
  })

  // Catches a malformed amount that reaches the caller as another error
  // without issues: from the XML writer, and from computeEInvoice in the
  // template, which runs before PdfFacturX.
  it.each([
    ['PdfFacturX', (invoice: EInvoice) => renderWith({ invoice, profile: 'EN 16931' })],
    ['computeEInvoice in the template', (invoice: EInvoice) => renderInvoicePdf(invoice, 'EN 16931')],
  ])('reports a malformed amount as an issue (%s)', async (_case, render) => {
    const invoice: EInvoice = { ...INVOICE, lines: [{ ...INVOICE.lines[0]!, quantity: '2,5' }] }
    const error = await errorOf(() => render(invoice))

    expect(error.code).toBe(PDF_ERROR_CODES.InvoiceInvalid)
    expect(error.issues).toEqual([{
      rule: 'PDF-VALUE',
      path: 'invoice.lines[0].quantity',
      message: 'invoice.lines[0].quantity must be a plain decimal such as "12.50", got "2,5".',
    }])
  })

  // Catches XML written from invoice data that escapes the attachment budget.
  it('counts the written XML for maxTotalAttachmentBytes', async () => {
    const bytes = Buffer.byteLength(renderEInvoiceXml(INVOICE, { profile: 'EN 16931' }))
    const error = await errorOf(() => renderWith({ invoice: INVOICE, profile: 'EN 16931' }, { maxTotalAttachmentBytes: bytes - 1 }))

    expect(error.code).toBe(PDF_ERROR_CODES.LimitExceeded)
  })
})
