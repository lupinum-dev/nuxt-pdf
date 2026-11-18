import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { getPdfAttachments } from '../src/test/pdf'
import { compactInvoice, invoiceTotal, sampleInvoice, type Invoice } from '../playground/shared/invoice'

// The real playground invoice, compiled through the shipped test helper. Its
// line table is a PdfTable whose rows are a local component (InvoiceLine.vue).
const invoiceSource = resolve('playground/pdfs/invoice.vue')

const manyLines = (count: number): Invoice => ({
  ...compactInvoice,
  lines: Array.from({ length: count }, (_, index) => ({
    id: `line-${index}`,
    description: `Service item ${index + 1}`,
    detail: 'Detail text',
    quantity: 1,
    unitPrice: 100,
  })),
})

describe('playground invoice.vue (PdfTable)', () => {
  it('renders the sample with the table header once and every line', async () => {
    const { parsed } = await renderPdfSfc(invoiceSource, { invoice: sampleInvoice })
    const first = parsed.pages[0]!

    expect(first.textItems.filter(item => item === 'Description')).toHaveLength(1)
    for (const line of sampleInvoice.lines) expect(first.text).toContain(line.description)
  })

  // Catches: a header that does not repeat, or rows printed twice or lost when
  // the table breaks across pages.
  it('repeats the header on every page of a long line table', async () => {
    const invoice = manyLines(30)
    const { parsed } = await renderPdfSfc(invoiceSource, { invoice })
    const itemPattern = /^Service item \d+$/
    const tablePages = parsed.pages.filter(page => page.textItems.some(item => itemPattern.test(item)))

    expect(tablePages.length).toBeGreaterThanOrEqual(2)
    for (const page of tablePages) {
      expect(page.textItems.filter(item => item === 'Description')).toHaveLength(1)
    }
    expect(parsed.pages.flatMap(page => page.textItems.filter(item => itemPattern.test(item))))
      .toEqual(invoice.lines.map(line => line.description))
  })

  // Catches a running head printed on page 1 (`pages` ignored), missing on a
  // continuation page, or with the wrong page number.
  it('prints the running head on every page except the first', async () => {
    const { parsed } = await renderPdfSfc(invoiceSource, { invoice: manyLines(30) })
    const heads = parsed.pages.map(page => page.textItems.find(item => item.startsWith('Invoice FN-1042-C · Page')))

    expect(heads).toEqual([undefined, ...parsed.pages.slice(1).map(page => `Invoice FN-1042-C · Page ${page.number}`)])
  })

  // Catches a missing Factur-X file, an XML total that differs from the page,
  // a value written into the XML without escaping, or a document that is not
  // PDF/A (the XMP identification is missing).
  it('embeds the Factur-X XML of the printed invoice in a PDF/A-3b document', async () => {
    const invoice: Invoice = {
      ...sampleInvoice,
      lines: [{ ...sampleInvoice.lines[0]!, description: 'Research & <design>' }, ...sampleInvoice.lines.slice(1)],
    }
    const { bytes } = await renderPdfSfc(invoiceSource, { invoice })
    const attachments = await getPdfAttachments(bytes)
    const xml = attachments.map(item => ({ name: item.filename, content: Buffer.from(item.content).toString('utf8') }))

    expect(xml).toEqual([{
      name: 'factur-x.xml',
      content: expect.stringMatching(new RegExp(
        '<ram:ID>urn:cen\\.eu:en16931:2017</ram:ID>[\\s\\S]*'
        + '<udt:DateTimeString format="102">20260720</udt:DateTimeString>[\\s\\S]*'
        + '<ram:Name>Research &amp; &lt;design&gt;</ram:Name>[\\s\\S]*'
        + `<ram:GrandTotalAmount>${invoiceTotal(invoice).toFixed(2)}</ram:GrandTotalAmount>`,
      )),
    }])
    expect(Buffer.from(bytes).toString('latin1')).toContain('<pdfaid:part>3</pdfaid:part>')
  })
})
