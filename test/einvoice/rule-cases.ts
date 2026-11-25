import type { EInvoice, EInvoiceProfile } from '../../src/runtime/einvoice'
import { forXRechnung, VALID_INVOICES } from './invoices'

export interface RuleCase {
  /** The rule id `validateEInvoice` must report. */
  rule: string
  /** The field path it must report. */
  path: string
  profile: EInvoiceProfile
  invoice: EInvoice
  /**
   * Cross-check: the XML of this invoice, written without the rule check,
   * must be rejected by this validator with the same rule id.
   */
  validator?: 'mustang' | 'kosit'
}

/** A changed deep copy of a valid fixture. */
const variant = (name: string, change: (invoice: EInvoice) => void, xrechnung = false): EInvoice => {
  const invoice = structuredClone(xrechnung ? forXRechnung(VALID_INVOICES[name]!) : VALID_INVOICES[name]!)
  change(invoice)
  return invoice
}
const en = (rule: string, path: string, name: string, change: (invoice: EInvoice) => void, validator?: 'mustang'): RuleCase =>
  ({ rule, path, profile: 'EN 16931', invoice: variant(name, change), ...(validator ? { validator } : {}) })
const xr = (rule: string, path: string, name: string, change: (invoice: EInvoice) => void, validator?: 'kosit'): RuleCase =>
  ({ rule, path, profile: 'XRECHNUNG', invoice: variant(name, change, true), ...(validator ? { validator } : {}) })

/**
 * One case per checked rule: the smallest change to a valid invoice that
 * breaks it. A missing case means a rule is checked but not tested.
 */
export const RULE_CASES: readonly RuleCase[] = [
  // Values the XML writer cannot write.
  en('PDF-VALUE', 'invoice.lines[0].quantity', 'one-line', (invoice) => { invoice.lines[0]!.quantity = '1e3' }),
  en('PDF-VALUE', 'invoice.issueDate', 'one-line', (invoice) => { invoice.issueDate = '2026-02-30' }),
  en('PDF-VALUE', 'invoice.lines[0].name', 'one-line', (invoice) => { invoice.lines[0]!.name = 'Bell\u0007' }),
  en('PDF-VALUE', 'invoice.buyer.electronicAddress.email', 'one-line', (invoice) => { invoice.buyer.electronicAddress = { email: ' ' } }),

  // Document.
  en('BR-02', 'invoice.number', 'one-line', (invoice) => { invoice.number = '' }, 'mustang'),
  en('BR-03', 'invoice.issueDate', 'one-line', invoice => Reflect.deleteProperty(invoice, 'issueDate')),
  en('BR-CL-01', 'invoice.type', 'one-line', invoice => Reflect.set(invoice, 'type', 'receipt')),
  en('BR-05', 'invoice.currency', 'one-line', (invoice) => { invoice.currency = '' }),
  // Mustang checks code lists with Factur-X ids (FX-SCH-A-…); KoSIT runs the
  // CEN Schematron, which reports the BR-CL ids, so code lists cross-check there.
  xr('BR-CL-04', 'invoice.currency', 'one-line', (invoice) => { invoice.currency = 'EUX' }, 'kosit'),
  en('BR-55', 'invoice.precedingInvoices[0].number', 'credit-note', (invoice) => { invoice.precedingInvoices = [{ number: ' ' }] }),

  // Parties.
  en('BR-06', 'invoice.seller.name', 'one-line', (invoice) => { invoice.seller.name = '' }, 'mustang'),
  en('BR-07', 'invoice.buyer.name', 'one-line', (invoice) => { invoice.buyer.name = '' }, 'mustang'),
  en('BR-08', 'invoice.seller.address', 'one-line', invoice => Reflect.deleteProperty(invoice.seller, 'address')),
  en('BR-09', 'invoice.seller.address.country', 'one-line', (invoice) => { invoice.seller.address.country = '' }),
  en('BR-10', 'invoice.buyer.address', 'one-line', invoice => Reflect.deleteProperty(invoice.buyer, 'address')),
  en('BR-11', 'invoice.buyer.address.country', 'one-line', (invoice) => { invoice.buyer.address.country = '' }),
  xr('BR-CL-14', 'invoice.buyer.address.country', 'one-line', (invoice) => { invoice.buyer.address.country = 'ZZ' }, 'kosit'),
  en('BR-CO-09', 'invoice.seller.vatId', 'one-line', (invoice) => { invoice.seller.vatId = '123456789' }, 'mustang'),
  en('BR-CO-26', 'invoice.seller', 'one-line', (invoice) => {
    invoice.seller.vatId = undefined
    invoice.seller.legalRegistrationId = undefined
  }, 'mustang'),
  en('BR-62', 'invoice.seller.electronicAddress.scheme', 'one-line', (invoice) => { invoice.seller.electronicAddress = { value: '4000001000005', scheme: '' } }),
  en('BR-63', 'invoice.buyer.electronicAddress.scheme', 'one-line', (invoice) => { invoice.buyer.electronicAddress = { value: '4000001000005', scheme: ' ' } }),
  xr('BR-CL-25', 'invoice.buyer.electronicAddress.scheme', 'one-line', (invoice) => { invoice.buyer.electronicAddress = { value: '4000001000005', scheme: '9999' } }, 'kosit'),

  // Delivery and periods.
  en('BR-57', 'invoice.delivery.address.country', 'intra-community', (invoice) => { invoice.delivery!.address!.country = '' }),
  en('BR-CO-19', 'invoice.billingPeriod', 'one-line', (invoice) => { invoice.billingPeriod = {} }),
  en('BR-29', 'invoice.billingPeriod.end', 'one-line', (invoice) => { invoice.billingPeriod = { start: '2026-10-31', end: '2026-10-01' } }, 'mustang'),
  en('BR-CO-20', 'invoice.lines[0].period', 'one-line', (invoice) => { invoice.lines[0]!.period = {} }),
  en('BR-30', 'invoice.lines[0].period.end', 'one-line', (invoice) => { invoice.lines[0]!.period = { start: '2026-10-31', end: '2026-10-01' } }, 'mustang'),

  // Lines.
  en('BR-16', 'invoice.lines', 'one-line', (invoice) => { invoice.lines = [] }, 'mustang'),
  en('BR-21', 'invoice.lines[0].id', 'one-line', (invoice) => { invoice.lines[0]!.id = ' ' }),
  en('BR-25', 'invoice.lines[0].name', 'one-line', (invoice) => { invoice.lines[0]!.name = '' }, 'mustang'),
  en('BR-27', 'invoice.lines[0].netPrice', 'one-line', (invoice) => { invoice.lines[0]!.netPrice = '-5' }, 'mustang'),
  en('PEPPOL-EN16931-R121', 'invoice.lines[0].priceBaseQuantity', 'one-line', (invoice) => { invoice.lines[0]!.priceBaseQuantity = 0 }),
  en('BR-CL-23', 'invoice.lines[0].unit', 'one-line', (invoice) => { invoice.lines[0]!.unit = { code: 'NOPE' } }),
  en('BR-CL-18', 'invoice.lines[0].vat.category', 'one-line', invoice => Reflect.set(invoice.lines[0]!.vat, 'category', 'reduced')),
  en('BR-S-05', 'invoice.lines[0].vat.rate', 'one-line', (invoice) => { invoice.lines[0]!.vat = { category: 'standard', rate: 0 } }, 'mustang'),
  en('BR-S-06', 'invoice.allowances[0].vat.rate', 'allowances-and-charges', (invoice) => { invoice.allowances![0]!.vat = { category: 'standard', rate: '0.00' } }),
  en('BR-S-07', 'invoice.charges[0].vat.rate', 'allowances-and-charges', (invoice) => { invoice.charges![0]!.vat = { category: 'standard', rate: -19 } }),
  en('BR-E-10', 'invoice.lines[0].vat.exemptionReason', 'exempt', (invoice) => { invoice.lines[0]!.vat = { category: 'exempt', exemptionReason: '' } }, 'mustang'),
  en('BR-DEC-24', 'invoice.lines[0].allowances[0].amount', 'allowances-and-charges', (invoice) => { invoice.lines[0]!.allowances = [{ amount: '1.005', reason: 'Discount' }] }),
  en('BR-42', 'invoice.lines[0].allowances[0].reason', 'one-line', (invoice) => { invoice.lines[0]!.allowances = [{ amount: 10, reason: '' }] }, 'mustang'),
  en('BR-DEC-27', 'invoice.lines[0].charges[0].amount', 'one-line', (invoice) => { invoice.lines[0]!.charges = [{ amount: '0.001', reason: 'Packing' }] }),
  en('BR-44', 'invoice.lines[0].charges[0].reason', 'one-line', (invoice) => { invoice.lines[0]!.charges = [{ amount: 10, reason: '' }] }, 'mustang'),
  // A blank reason is reported too, though both validators accept whitespace.
  en('BR-44', 'invoice.lines[0].charges[0].reason', 'one-line', (invoice) => { invoice.lines[0]!.charges = [{ amount: 10, reason: ' ' }] }),
  en('PDF-VALUE', 'invoice.lines[0].standardItemId.id', 'one-line', (invoice) => { invoice.lines[0]!.standardItemId = { id: '', scheme: '0160' } }),
  en('BR-64', 'invoice.lines[0].standardItemId.scheme', 'one-line', (invoice) => { invoice.lines[0]!.standardItemId = { id: '4000001000005', scheme: '' } }),
  // No cross-check: Mustang reports FX-SCH-A-000626, KoSIT downgrades BR-CL-21 to a warning.
  en('BR-CL-21', 'invoice.lines[0].standardItemId.scheme', 'one-line', (invoice) => { invoice.lines[0]!.standardItemId = { id: '4000001000005', scheme: '9999' } }),

  // Document level allowances, charges and amounts.
  en('BR-DEC-01', 'invoice.allowances[0].amount', 'allowances-and-charges', (invoice) => { invoice.allowances![0]!.amount = '2.555' }),
  en('BR-33', 'invoice.allowances[0].reason', 'allowances-and-charges', (invoice) => { invoice.allowances![0]!.reason = '' }, 'mustang'),
  en('BR-DEC-05', 'invoice.charges[0].amount', 'allowances-and-charges', (invoice) => { invoice.charges![0]!.amount = 'NaN' }),
  en('BR-38', 'invoice.charges[0].reason', 'allowances-and-charges', (invoice) => { invoice.charges![0]!.reason = '' }, 'mustang'),
  en('BR-DEC-16', 'invoice.prepaidAmount', 'one-line', (invoice) => { invoice.prepaidAmount = '10.001' }),
  en('BR-DEC-17', 'invoice.roundingAmount', 'one-line', (invoice) => { invoice.roundingAmount = '0.005' }),
  { rule: 'BR-CO-16', path: 'invoice.roundingAmount', profile: 'BASIC', invoice: VALID_INVOICES['prepaid-and-rounding']! },
  { rule: 'BR-CO-16', path: 'invoice.roundingAmount', profile: 'BASIC WL', invoice: VALID_INVOICES['prepaid-and-rounding']! },

  // VAT categories and the identifiers they need: one case per category,
  // and the -03 and -04 suffixes for allowances and charges.
  en('BR-S-02', 'invoice.seller.vatId', 'one-line', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
  }, 'mustang'),
  en('BR-Z-02', 'invoice.seller.vatId', 'zero-rate', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
  }),
  en('BR-E-02', 'invoice.seller.vatId', 'exempt', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
  }),
  en('BR-AE-02', 'invoice.buyer.vatId', 'reverse-charge', (invoice) => { invoice.buyer.vatId = undefined }, 'mustang'),
  en('BR-IC-02', 'invoice.seller.vatId', 'intra-community', (invoice) => { invoice.seller.vatId = undefined }, 'mustang'),
  en('BR-IC-02', 'invoice.buyer.vatId', 'intra-community', (invoice) => { invoice.buyer.vatId = undefined }),
  en('BR-G-02', 'invoice.seller.vatId', 'export', (invoice) => { invoice.seller.vatId = undefined }, 'mustang'),
  en('BR-O-02', 'invoice.seller.vatId', 'outside-scope', (invoice) => { invoice.seller.vatId = 'DE123456789' }, 'mustang'),
  en('BR-O-02', 'invoice.buyer.vatId', 'outside-scope', (invoice) => { invoice.buyer.vatId = 'DE987654321' }),
  en('BR-S-03', 'invoice.seller.vatId', 'allowances-and-charges', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
    for (const line of invoice.lines) line.vat = { category: 'outside-scope' }
    invoice.charges = []
  }),
  en('BR-S-04', 'invoice.seller.vatId', 'allowances-and-charges', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
    for (const line of invoice.lines) line.vat = { category: 'outside-scope' }
    invoice.allowances = []
  }),
  en('BR-O-11', 'invoice.lines[1].vat', 'outside-scope', (invoice) => {
    invoice.seller.taxNumber = '12/345/67890'
    invoice.lines.push({ name: 'Badge', quantity: 1, unit: 'piece', netPrice: 5, vat: { category: 'standard', rate: 19 } })
  }, 'mustang'),
  en('BR-O-12', 'invoice.lines[1].vat', 'outside-scope', (invoice) => {
    invoice.seller.taxNumber = '12/345/67890'
    invoice.lines.push({ name: 'Badge', quantity: 1, unit: 'piece', netPrice: 5, vat: { category: 'standard', rate: 19 } })
  }, 'mustang'),
  en('BR-O-13', 'invoice.allowances[0].vat', 'outside-scope', (invoice) => {
    invoice.seller.taxNumber = '12/345/67890'
    invoice.allowances = [{ amount: 5, reason: 'Discount', vat: { category: 'standard', rate: 19 } }]
  }, 'mustang'),
  en('BR-O-14', 'invoice.charges[0].vat', 'outside-scope', (invoice) => {
    invoice.seller.taxNumber = '12/345/67890'
    invoice.charges = [{ amount: 5, reason: 'Postage', vat: { category: 'zero' } }]
  }, 'mustang'),
  en('BR-IC-11', 'invoice.delivery.date', 'intra-community', (invoice) => { invoice.delivery!.date = undefined }, 'mustang'),
  en('BR-IC-12', 'invoice.delivery.address', 'intra-community', (invoice) => { invoice.delivery!.address = undefined }, 'mustang'),
  en('BR-AE-01', 'invoice.lines[1].vat.exemptionReason', 'reverse-charge', (invoice) => {
    invoice.lines[0]!.vat = { category: 'reverse-charge', exemptionReason: 'Reverse charge' }
    invoice.lines.push({ name: 'Testing', quantity: 2, unit: 'hour', netPrice: 95, vat: { category: 'reverse-charge', exemptionReason: 'Steuerschuldnerschaft des Leistungsempfängers' } })
  }),
  en('BR-E-01', 'invoice.charges[0].vat.exemptionReason', 'exempt', (invoice) => {
    invoice.charges = [{ amount: 5, reason: 'Postage', vat: { category: 'exempt', exemptionReason: 'Another article' } }]
  }),

  // Payment instructions.
  xr('BR-CL-16', 'invoice.payment.means.code', 'one-line', (invoice) => { invoice.payment = { means: { code: '999' } } }, 'kosit'),
  // No account is written for an empty one. Mustang reports CII-SR-470 (no
  // BR-61 cross-check by id); KoSIT reports BR-DE-23-a.
  en('BR-61', 'invoice.payment.means.iban', 'one-line', (invoice) => { invoice.payment = { means: { type: 'sepa-credit-transfer', iban: '' } } }),
  en('BR-61', 'invoice.payment.means.code', 'one-line', (invoice) => { invoice.payment = { means: { code: '58' } } }),
  xr('BR-DE-23-a', 'invoice.payment.means.iban', 'one-line', (invoice) => { invoice.payment = { means: { type: 'sepa-credit-transfer', iban: '' } } }, 'kosit'),
  en('BR-61', 'invoice.payment.means.accountId', 'prepayment-account-id', (invoice) => { invoice.payment = { means: { type: 'credit-transfer', accountId: ' ' } } }),
  xr('BR-DE-23-a', 'invoice.payment.means.code', 'one-line', (invoice) => { invoice.payment = { means: { code: '58' } } }, 'kosit'),
  en('BR-51', 'invoice.payment.means.lastDigits', 'card-and-references', (invoice) => { invoice.payment = { means: { type: 'card', lastDigits: '4000001234567899' } } }, 'mustang'),

  // XRechnung.
  xr('PEPPOL-EN16931-R110', 'invoice.lines[0].period.start', 'card-and-references', (invoice) => { invoice.billingPeriod = { start: '2026-10-05', end: '2026-10-31' } }, 'kosit'),
  xr('PEPPOL-EN16931-R111', 'invoice.lines[0].period.end', 'card-and-references', (invoice) => { invoice.billingPeriod = { start: '2026-10-01', end: '2026-10-20' } }, 'kosit'),
  xr('BR-DE-1', 'invoice.payment.means', 'one-line', (invoice) => { invoice.payment = { dueDate: '2026-12-02' } }, 'kosit'),
  xr('BR-DE-15', 'invoice.buyerReference', 'one-line', (invoice) => { invoice.buyerReference = undefined }, 'kosit'),
  xr('BR-DE-2', 'invoice.seller.contact', 'one-line', (invoice) => { invoice.seller.contact = undefined }, 'kosit'),
  xr('BR-DE-5', 'invoice.seller.contact.name', 'one-line', (invoice) => { invoice.seller.contact = { phone: '+49 30 0000000', email: 'billing@example.com' } }),
  xr('BR-DE-6', 'invoice.seller.contact.phone', 'one-line', (invoice) => { invoice.seller.contact = { name: 'Erika Example', email: 'billing@example.com' } }, 'kosit'),
  xr('BR-DE-7', 'invoice.seller.contact.email', 'one-line', (invoice) => { invoice.seller.contact = { name: 'Erika Example', phone: '+49 30 0000000' } }, 'kosit'),
  xr('BR-DE-3', 'invoice.seller.address.city', 'one-line', (invoice) => { invoice.seller.address.city = undefined }, 'kosit'),
  xr('BR-DE-4', 'invoice.seller.address.postcode', 'one-line', (invoice) => { invoice.seller.address.postcode = undefined }, 'kosit'),
  xr('BR-DE-8', 'invoice.buyer.address.city', 'one-line', (invoice) => { invoice.buyer.address.city = ' ' }),
  xr('BR-DE-9', 'invoice.buyer.address.postcode', 'one-line', (invoice) => { invoice.buyer.address.postcode = undefined }, 'kosit'),
  xr('BR-DE-10', 'invoice.delivery.address.city', 'intra-community', (invoice) => { invoice.delivery!.address!.city = undefined }, 'kosit'),
  xr('BR-DE-11', 'invoice.delivery.address.postcode', 'intra-community', (invoice) => { invoice.delivery!.address!.postcode = undefined }),
  xr('BR-DE-16', 'invoice.seller.vatId', 'one-line', (invoice) => {
    invoice.seller.vatId = undefined
    Reflect.deleteProperty(invoice.seller, 'taxNumber')
  }, 'kosit'),
  xr('PEPPOL-EN16931-R020', 'invoice.seller.electronicAddress', 'one-line', (invoice) => { invoice.seller.electronicAddress = undefined }, 'kosit'),
  xr('PEPPOL-EN16931-R010', 'invoice.buyer.electronicAddress', 'one-line', (invoice) => { invoice.buyer.electronicAddress = undefined }, 'kosit'),
  xr('BR-DE-24-a', 'invoice.payment.means.lastDigits', 'one-line', (invoice) => { invoice.payment = { means: { type: 'card' } } }, 'kosit'),
  xr('BR-DE-24-a', 'invoice.payment.means.code', 'one-line', (invoice) => { invoice.payment = { means: { code: '54' } } }),
  xr('PEPPOL-EN16931-R061', 'invoice.payment.means.code', 'one-line', (invoice) => { invoice.payment = { means: { code: '59' } } }, 'kosit'),
  xr('PEPPOL-EN16931-R061', 'invoice.payment.means.mandateReference', 'sepa-direct-debit', (invoice) => { invoice.payment = { means: { type: 'sepa-direct-debit', mandateReference: '', creditorId: 'DE98ZZZ09999999999', debtorIban: 'DE02120300000000202051' } } }),
  xr('BR-DE-30', 'invoice.payment.means.creditorId', 'sepa-direct-debit', (invoice) => { invoice.payment = { means: { type: 'sepa-direct-debit', mandateReference: 'M-1', creditorId: '', debtorIban: 'DE02120300000000202051' } } }, 'kosit'),
  xr('BR-DE-31', 'invoice.payment.means.debtorIban', 'sepa-direct-debit', (invoice) => { invoice.payment = { means: { type: 'sepa-direct-debit', mandateReference: 'M-1', creditorId: 'DE98ZZZ09999999999', debtorIban: '' } } }, 'kosit'),
]
