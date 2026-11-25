// The playground invoice as e-invoice data for <PdfFacturX :invoice>. The
// server writes the Factur-X XML from it, and the template prints the totals
// computeEInvoice derives from it, so the page and the XML cannot disagree.
// Example data only: the seller VAT ID below is made up.
import type { EInvoice, EInvoiceAddress } from '@lupinum/nuxt-pdf'
import type { Invoice, InvoiceParty } from '../../../shared/invoice'

/** The VAT ID of the example seller (BT-31). Not a real registration. */
const SELLER_VAT_ID = 'ATU00000000'

const COUNTRIES: Readonly<Record<string, string>> = { Austria: 'AT', Switzerland: 'CH' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A printed date such as "20 July 2026" as `2026-07-20`. */
const isoDate = (printed: string): string => {
  const [, day, month, year] = /^(\d{1,2}) (\p{L}+) (\d{4})$/u.exec(printed) ?? []
  const index = MONTHS.indexOf(month ?? '')
  if (!day || !year || index === -1) throw new Error(`Cannot read the invoice date "${printed}"; expected a date such as "20 July 2026".`)
  return `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** The postal address of a party whose last address line reads "1040 Vienna, Austria". */
const address = (party: InvoiceParty): EInvoiceAddress => {
  const [line1, line2] = party.address.slice(0, -1)
  const [, postcode, city, country] = /^(\S+) (.+), (.+)$/.exec(party.address.at(-1) ?? '') ?? []
  const countryCode = COUNTRIES[country ?? '']
  if (!postcode || !city || !countryCode) throw new Error(`Cannot read the address of "${party.name}"; expected a last line such as "1040 Vienna, Austria".`)
  return { line1, line2, postcode, city, country: countryCode }
}

/** Every line has the standard VAT rate of the invoice. */
export const toEInvoice = (invoice: Invoice): EInvoice => ({
  number: invoice.number,
  issueDate: isoDate(invoice.issueDate),
  currency: invoice.currency,
  notes: [invoice.paymentNote],
  orderReference: invoice.purchaseOrder,
  seller: {
    name: invoice.from.name,
    address: address(invoice.from),
    vatId: SELLER_VAT_ID,
    electronicAddress: { email: invoice.from.email },
  },
  buyer: {
    name: invoice.customer.name,
    address: address(invoice.customer),
    electronicAddress: { email: invoice.customer.email },
  },
  payment: { dueDate: isoDate(invoice.dueDate), reference: invoice.number },
  lines: invoice.lines.map(line => ({
    name: line.description,
    description: line.detail,
    quantity: line.quantity,
    unit: 'day',
    netPrice: line.unitPrice,
    // 0.2 → '20': a string keeps the rate exact.
    vat: { category: 'standard', rate: String(Math.round(invoice.taxRate * 10_000) / 100) },
  })),
})
