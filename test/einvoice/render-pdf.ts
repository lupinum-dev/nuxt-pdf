import { readFileSync } from 'node:fs'
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { computeEInvoice } from '../../src/runtime/einvoice'
import type { EInvoice } from '../../src/runtime/einvoice'
import type { PdfFontDataUrl } from '../../src/runtime/fonts'
import type { PdfFacturXProfile } from '../../src/runtime/primitives'
import { installPdfCanvasGlobals } from '../../src/test/pdf'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'

installPdfCanvasGlobals()

const { PdfDocument, PdfFacturX, PdfPage, PdfText } = PDF_COMPONENTS

// PDF/A requires every font to be embedded, so the page uses a registered font.
const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}

/** What the `PdfFacturX` of the rendered invoice gets: the invoice data or finished XML. */
export type FacturXSource = { invoice: EInvoice } | { xml: string }

/**
 * A one-page hybrid invoice: the visible totals come from `computeEInvoice`,
 * the embedded XML from `invoice` (written during the render) or `xml`.
 */
export const renderInvoicePdf = async (invoice: EInvoice, profile: PdfFacturXProfile, source: FacturXSource = { invoice }): Promise<Uint8Array> => {
  const totals = computeEInvoice(invoice)
  const component = defineComponent(() => () => h(PdfDocument, { conformance: 'PDF/A-3b', title: `Invoice ${invoice.number}`, language: 'en', creationDate: new Date(Date.UTC(2026, 10, 2)) }, () => [
    h(PdfFacturX, { ...source, profile } as never),
    h(PdfPage, { size: 'A5', style: { padding: 32, fontFamily: 'Roboto', fontSize: 10 } }, () => [
      h(PdfText, null, () => `${invoice.seller.name}, invoice ${invoice.number}`),
      ...invoice.lines.map((line, index) => h(PdfText, null, () => `${line.name}: ${totals.lines[index]!.netAmount} ${invoice.currency}`)),
      h(PdfText, null, () => `Total ${totals.grandTotal} ${invoice.currency}, due ${totals.duePayable}`),
    ]),
  ]))
  const { bytes } = await renderPreparedPdfTemplate(component, {}, { fonts: [ROBOTO] })
  return bytes
}
