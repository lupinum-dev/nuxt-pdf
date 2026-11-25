import fc from 'fast-check'
import type {
  EInvoice,
  EInvoiceBuyer,
  EInvoiceDocumentAllowanceCharge,
  EInvoiceLine,
  EInvoicePaymentMeans,
  EInvoiceSeller,
  EInvoiceUnit,
  EInvoiceVat,
} from '../../src/runtime/einvoice'
import { EXAMPLE_IBAN } from './invoices'

// Generated invoices that must be valid as EN 16931 and as XRechnung. Every
// name, number and identifier is made up; the IBAN is the public example IBAN.

/** A decimal string with exactly `digits` fraction digits, from `min` to `max` units. */
const decimalString = (min: number, max: number, digits: number): fc.Arbitrary<string> =>
  fc.integer({ min, max }).map((units) => {
    const sign = units < 0 ? '-' : ''
    const text = String(Math.abs(units)).padStart(digits + 1, '0')
    return digits === 0 ? `${sign}${text}` : `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`
  })

/** Text with the characters XML escapes, umlauts and a non-BMP character. */
const text = (prefix: string): fc.Arbitrary<string> =>
  fc.constantFrom('', ' & Co', ' <Pro>', ' "Plus"', ' Größe', ' l\'Exemple', ' 𝄞').map(suffix => `${prefix}${suffix}`)

const seller: EInvoiceSeller = {
  name: 'Generated Werkstatt GmbH',
  address: { line1: 'Generatorweg 9', postcode: '20095', city: 'Hamburg', country: 'DE' },
  vatId: 'DE111111111',
  taxNumber: '22/222/22222',
  legalRegistrationId: 'HRB 11111',
  contact: { name: 'Gen Example', phone: '+49 40 0000000', email: 'billing@werkstatt.example' },
  electronicAddress: { email: 'invoices@werkstatt.example' },
}

const domesticBuyer: EInvoiceBuyer = {
  name: 'Generated Kunde KG',
  address: { line1: 'Kundenallee 10', postcode: '50667', city: 'Köln', country: 'DE' },
  vatId: 'DE222222222',
  electronicAddress: { value: '4000001000005', scheme: '0088' },
}

interface Scenario {
  /** Categories this scenario may use; lines draw from these. */
  vats: readonly EInvoiceVat[]
  buyer: EInvoiceBuyer
  seller: EInvoiceSeller
  delivery?: EInvoice['delivery']
}

const standard = (rate: number | string): EInvoiceVat => ({ category: 'standard', rate })

const SCENARIOS: readonly Scenario[] = [
  {
    vats: [standard(19), standard(7), standard('5.5'), { category: 'zero' }, { category: 'exempt', exemptionReason: 'Exempt under § 4 Nr. 21 UStG' }],
    buyer: domesticBuyer,
    seller,
  },
  {
    vats: [{ category: 'reverse-charge', exemptionReason: 'Reverse charge' }, standard(19)],
    buyer: {
      name: 'Generiert Handel GmbH',
      address: { line1: 'Probegasse 11', postcode: '1010', city: 'Wien', country: 'AT' },
      vatId: 'ATU11111111',
      electronicAddress: { email: 'ap@handel.example' },
    },
    seller,
  },
  {
    vats: [{ category: 'intra-community' }, standard(19)],
    buyer: {
      name: 'Génération SARL',
      address: { line1: '12 rue du Test', postcode: '75002', city: 'Paris', country: 'FR' },
      vatId: 'FR11111111111',
      electronicAddress: { email: 'factures@generation.example' },
    },
    seller,
    delivery: { date: '2026-10-20', address: { line1: '13 quai du Test', postcode: '13001', city: 'Marseille', country: 'FR' } },
  },
  {
    vats: [{ category: 'export' }, standard(19)],
    buyer: {
      name: 'Generiert Import AG',
      address: { line1: 'Testweg 14', postcode: '3011', city: 'Bern', country: 'CH' },
      electronicAddress: { email: 'kreditoren@import.example' },
    },
    seller,
  },
  {
    vats: [{ category: 'outside-scope' }],
    buyer: { ...domesticBuyer, vatId: undefined },
    seller: { ...seller, vatId: undefined },
  },
]

const UNITS: readonly EInvoiceUnit[] = ['piece', 'hour', 'day', 'kilogram', 'metre', 'lump-sum', { code: 'H87' }, { code: 'XPK' }]

const PAYMENT_MEANS: readonly EInvoicePaymentMeans[] = [
  { type: 'sepa-credit-transfer', iban: EXAMPLE_IBAN },
  { type: 'credit-transfer', iban: EXAMPLE_IBAN, bic: 'BYLADEM1001', accountName: 'Generated Werkstatt GmbH' },
  { type: 'credit-transfer', accountId: '0000202051' },
  { type: 'sepa-direct-debit', mandateReference: 'GEN-MANDATE-1', creditorId: 'DE98ZZZ09999999999', debtorIban: EXAMPLE_IBAN },
  { type: 'card', lastDigits: '1234', holder: 'Gen Holder' },
  { type: 'cash' },
]

const BILLING_PERIOD = { start: '2026-10-01', end: '2026-10-31' }

const line = (vats: readonly EInvoiceVat[], index: number): fc.Arbitrary<EInvoiceLine> => fc.record({
  name: text(`Item ${index + 1}`),
  // Quantity of at least 1 and a price of at least 10 keep every line above
  // its allowances (at most 5.00), so no total turns negative.
  quantity: decimalString(10_000, 5_000_000, 4),
  netPrice: decimalString(10_000_000, 900_000_000, 6),
  priceBaseQuantity: fc.option(fc.constantFrom(1, 10, 100, '0.5'), { nil: undefined }),
  unit: fc.constantFrom(...UNITS),
  vat: fc.constantFrom(...vats),
  allowances: fc.option(fc.array(fc.record({ amount: decimalString(1, 500, 2), reason: text('Discount') }), { minLength: 1, maxLength: 2 }), { nil: undefined }),
  charges: fc.option(fc.array(fc.record({ amount: decimalString(1, 5_000, 2), reason: text('Packing') }), { minLength: 1, maxLength: 2 }), { nil: undefined }),
  period: fc.option(fc.constantFrom({ start: '2026-10-01', end: '2026-10-15' }, { start: '2026-10-16' }, { end: '2026-10-31' }), { nil: undefined }),
  standardItemId: fc.option(fc.constant({ id: '4000001000005', scheme: '0160' }), { nil: undefined }),
}, { requiredKeys: ['name', 'quantity', 'netPrice', 'unit', 'vat'] })

const documentLevel = (vats: readonly EInvoiceVat[], reason: string, maxUnits: number): fc.Arbitrary<EInvoiceDocumentAllowanceCharge[] | undefined> =>
  fc.option(fc.array(fc.record({ amount: decimalString(1, maxUnits, 2), reason: text(reason), vat: fc.constantFrom(...vats) }), { minLength: 1, maxLength: 2 }), { nil: undefined })

/**
 * Invoices across the scenarios: domestic with several rates, zero and exempt;
 * reverse charge; intra-community supply; export; not subject to VAT. Each
 * carries the XRechnung fields, so it must pass both EN 16931 and XRECHNUNG.
 */
export const einvoiceArbitrary: fc.Arbitrary<EInvoice> = fc.constantFrom(...SCENARIOS).chain(scenario =>
  fc.record({
    lines: fc.integer({ min: 1, max: 5 }).chain(count => fc.tuple(...Array.from({ length: count }, (_, index) => line(scenario.vats, index)))),
    allowances: documentLevel(scenario.vats, 'Loyalty discount', 500),
    charges: documentLevel(scenario.vats, 'Freight', 5_000),
    means: fc.constantFrom(...PAYMENT_MEANS),
    prepaid: fc.option(decimalString(1, 1_000, 2), { nil: undefined }),
    rounding: fc.option(fc.constantFrom('-0.02', '-0.01', '0.01', '0.02'), { nil: undefined }),
    number: fc.integer({ min: 1, max: 99_999 }).map(value => `GEN-${String(value).padStart(5, '0')}`),
    type: fc.constantFrom<EInvoice['type']>(undefined, 'invoice', 'credit-note', 'corrected-invoice'),
    note: fc.option(text('Generated note'), { nil: undefined }),
  }).map(({ lines, allowances, charges, means, prepaid, rounding, number, type, note }): EInvoice => ({
    number,
    ...(type === undefined ? {} : { type }),
    issueDate: '2026-11-03',
    currency: 'EUR',
    buyerReference: '991-11111-11',
    ...(note === undefined ? {} : { notes: [note] }),
    seller: scenario.seller,
    buyer: scenario.buyer,
    ...(scenario.delivery === undefined ? {} : { delivery: scenario.delivery }),
    // Line periods need the invoice period around them (PEPPOL-EN16931-R110, R111).
    ...(lines.some(entry => entry.period !== undefined) || scenario.vats.some(vat => vat.category === 'intra-community') ? { billingPeriod: BILLING_PERIOD } : {}),
    payment: { dueDate: '2026-12-03', means },
    lines,
    ...(allowances === undefined ? {} : { allowances }),
    ...(charges === undefined ? {} : { charges }),
    ...(prepaid === undefined ? {} : { prepaidAmount: prepaid }),
    ...(rounding === undefined ? {} : { roundingAmount: rounding }),
  })),
)

/** The fixed seed of the generated run; a failure prints it with the invoice. */
export const GENERATED_SEED = 20261117
export const GENERATED_COUNT = 40

export const generatedInvoices = (): EInvoice[] => fc.sample(einvoiceArbitrary, { seed: GENERATED_SEED, numRuns: GENERATED_COUNT })
