import type { EInvoice } from '@lupinum/nuxt-pdf'
import { mkdir, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateEInvoice } from '@lupinum/nuxt-pdf/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { expectPdf, getPdfAttachments, renderPdfSfc } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/einvoice.vue', import.meta.url))

// The template's auto-imported `computeEInvoice` comes from the installed
// `@lupinum/nuxt-pdf`, and the compiled template runs from
// `test/authoring/node_modules/.cache`. Node gives a file inside node_modules no
// self-reference to the repository's own package, so link it as an install would.
beforeAll(async () => {
  const scope = fileURLToPath(new URL('./node_modules/@lupinum/', import.meta.url))
  await mkdir(scope, { recursive: true })
  await symlink(fileURLToPath(new URL('../..', import.meta.url)), `${scope}nuxt-pdf`, 'junction').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error
  })
})

const fonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
]

// The invoice of the E-invoices docs page, valid for every profile.
const invoice: EInvoice = {
  number: 'RE-2026-014',
  issueDate: '2026-11-03',
  currency: 'EUR',
  buyerReference: '991-01234-56',
  seller: {
    name: 'Beispiel Werkstatt GmbH',
    address: { line1: 'Beispielweg 1', postcode: '10115', city: 'Berlin', country: 'DE' },
    vatId: 'DE111111111',
    contact: { name: 'Erika Beispiel', phone: '+49 30 0000000', email: 'billing@werkstatt.example' },
    electronicAddress: { email: 'invoices@werkstatt.example' },
  },
  buyer: {
    name: 'Stadtverwaltung Musterstadt',
    address: { line1: 'Rathausplatz 2', postcode: '50667', city: 'Köln', country: 'DE' },
    electronicAddress: { email: 'rechnungen@musterstadt.example' },
  },
  payment: {
    dueDate: '2026-12-03',
    means: { type: 'sepa-credit-transfer', iban: 'DE02120300000000202051' },
  },
  lines: [
    { name: 'Design workshop', quantity: 2, unit: 'day', netPrice: '950.00', vat: { category: 'standard', rate: 19 } },
    { name: 'Printed brochures', quantity: 500, unit: 'piece', netPrice: '1.20', vat: { category: 'standard', rate: 7 } },
  ],
}

describe('einvoice.vue', () => {
  it('prints the totals and embeds the same totals in factur-x.xml', async () => {
    const { parsed, bytes } = await renderPdfSfc(template, { invoice }, { fonts })

    expectPdf(parsed).toHavePageCount(1)

    // Catches printed totals that differ from computeEInvoice (VAT rounded per line instead of per category).
    expectPdf(parsed)
      .toContainText('Net: 2500.00 EUR')
      .toContainText('VAT 19 %: 361.00 EUR')
      .toContainText('VAT 7 %: 42.00 EUR')
      .toContainText('Total: 2903.00 EUR')
      .toContainText('Amount due: 2903.00 EUR')
    // Catches a line amount that is not quantity x price.
    expectPdf(parsed).toContainText('1900.00').toContainText('600.00')

    const attachments = await getPdfAttachments(bytes)
    // Catches the XML missing, doubled, or named for another profile (XRECHNUNG would be xrechnung.xml).
    expect(attachments.map(attachment => attachment.filename)).toEqual(['factur-x.xml'])
    const xml = new TextDecoder().decode(attachments[0]!.content)

    // Catches an XML that is not the CII syntax.
    expect(xml).toContain('CrossIndustryInvoice')
    // Catches the profile ID (BT-24) of another profile.
    expect(xml).toMatch(/<ram:ID>urn:cen\.eu:en16931:2017<\/ram:ID>/)
    // Catches the invoice number, issue date and parties not being in the XML.
    expect(xml).toContain('RE-2026-014')
    expect(xml).toContain('20261103')
    expect(xml).toContain('Beispiel Werkstatt GmbH')
    // Catches XML totals that do not match the printed pages.
    expect(xml).toMatch(/<ram:TaxBasisTotalAmount>2500\.00</)
    expect(xml).toMatch(/<ram:TaxTotalAmount[^>]*>403\.00</)
    expect(xml).toMatch(/<ram:GrandTotalAmount>2903\.00</)
    expect(xml).toMatch(/<ram:DuePayableAmount>2903\.00</)

    // Catches a creationDate that is ignored: the same invoice and date must give the same bytes.
    const again = await renderPdfSfc(template, { invoice }, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('claims the PDF/A-3b of its conformance prop', async () => {
    const { bytes } = await renderPdfSfc(template, { invoice }, { fonts })
    const raw = Buffer.from(bytes).toString('latin1')

    // Catches a Factur-X invoice written without its PDF/A-3b identification.
    expect(raw).toMatch(/<pdfaid:part>3<\/pdfaid:part>/)
    expect(raw).toMatch(/<pdfaid:conformance>B<\/pdfaid:conformance>/)
  })

  it('writes xrechnung.xml for the XRECHNUNG profile', async () => {
    const { bytes } = await renderPdfSfc(template, { invoice, profile: 'XRECHNUNG' }, { fonts })
    const attachments = await getPdfAttachments(bytes)

    // Catches the file name staying factur-x.xml for XRechnung.
    expect(attachments.map(attachment => attachment.filename)).toEqual(['xrechnung.xml'])
  })

  it('reports an invoice without a Leitweg-ID as one XRechnung issue', () => {
    const { buyerReference: _removed, ...withoutReference } = invoice

    // Catches a validator that rejects the valid invoice.
    expect(validateEInvoice(invoice, { profile: 'XRECHNUNG' })).toEqual([])
    // Catches the same invoice being accepted for XRECHNUNG, or a wrong rule ID and path.
    const issues = validateEInvoice(withoutReference, { profile: 'XRECHNUNG' })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ rule: 'BR-DE-15', path: 'invoice.buyerReference' })
    // Catches the profile check being skipped: EN 16931 does not need a buyer reference.
    expect(validateEInvoice(withoutReference, { profile: 'EN 16931' })).toEqual([])
  })

  it('fails the render before layout for an invalid invoice', async () => {
    const { buyerReference: _removed, ...withoutReference } = invoice

    // Catches an invalid invoice producing a PDF with an XML that recipients reject.
    await expect(renderPdfSfc(template, { invoice: withoutReference, profile: 'XRECHNUNG' }, { fonts }))
      .rejects.toMatchObject({ code: 'PDF_INVOICE_INVALID', issues: [{ rule: 'BR-DE-15' }] })
  })
})
