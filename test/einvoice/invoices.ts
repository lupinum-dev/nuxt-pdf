import type { EInvoice, EInvoiceBuyer, EInvoiceSeller } from '../../src/runtime/einvoice'

// Every party, number, address and identifier here is made up. The IBAN is
// the public example IBAN.
export const EXAMPLE_IBAN = 'DE02120300000000202051'

const seller: EInvoiceSeller = {
  name: 'Example Atelier GmbH',
  address: { line1: 'Beispielweg 1', postcode: '10115', city: 'Berlin', country: 'DE' },
  vatId: 'DE123456789',
  taxNumber: '12/345/67890',
  legalRegistrationId: 'HRB 00000',
  contact: { name: 'Erika Example', phone: '+49 30 0000000', email: 'billing@example.com' },
  electronicAddress: { email: 'invoices@example.com' },
}

const buyer: EInvoiceBuyer = {
  name: 'Sample Customer AG',
  address: { line1: 'Probestraße 2', postcode: '80331', city: 'München', country: 'DE' },
  vatId: 'DE987654321',
  electronicAddress: { email: 'ap@customer.example' },
}

const base = {
  issueDate: '2026-11-02',
  currency: 'EUR',
  seller,
  buyer,
  payment: {
    dueDate: '2026-12-02',
    terms: 'Payable within 30 days without deduction.',
    means: { type: 'sepa-credit-transfer', iban: EXAMPLE_IBAN },
  },
} satisfies Partial<EInvoice>

const standard19 = { category: 'standard', rate: 19 } as const
const standard7 = { category: 'standard', rate: 7 } as const

/**
 * Invoices that differ in substance. Each must pass the official validator as
 * EN 16931. The key is the file name of its XML.
 */
export const VALID_INVOICES: Readonly<Record<string, EInvoice>> = {
  'one-line': {
    ...base,
    number: 'INV-0001',
    lines: [{ name: 'Website design', quantity: 1, unit: 'lump-sum', netPrice: 1200, vat: standard19 }],
  },
  'many-lines': {
    ...base,
    number: 'INV-0002',
    lines: [
      { name: 'Consulting', quantity: 3, unit: 'hour', netPrice: '33.333333', vat: standard19 },
      { name: 'Retainer third', quantity: '0.3333', unit: 'month', netPrice: 900, vat: standard19 },
      { name: 'Paper', quantity: 1500, unit: 'piece', netPrice: '1.99', priceBaseQuantity: 100, vat: standard19 },
      { name: 'Cable', quantity: '12.5', unit: 'metre', netPrice: '2.333', vat: standard19 },
      { name: 'Hosting', quantity: 12, unit: 'month', netPrice: '9.99', vat: standard19 },
      { name: 'Electricity', quantity: '1234.5', unit: 'kilowatt-hour', netPrice: '0.28375', vat: standard19 },
      { name: 'Travel', quantity: 432, unit: 'kilometre', netPrice: '0.30', vat: standard19 },
      { name: 'Printed copies', quantity: 7, unit: { code: 'C62' }, netPrice: '0.333333', vat: standard19 },
    ],
  },
  'two-rates': {
    ...base,
    number: 'INV-0003',
    lines: [
      { name: 'Workshop', quantity: 2, unit: 'day', netPrice: 850, vat: standard19 },
      { name: 'Handbook', quantity: 15, unit: 'piece', netPrice: '24.95', vat: standard7 },
      { name: 'Catering', quantity: 15, unit: 'piece', netPrice: '12.49', vat: standard7 },
    ],
  },
  'zero-rate': {
    ...base,
    number: 'INV-0004',
    lines: [{ name: 'Solar panel', quantity: 10, unit: 'piece', netPrice: 210, vat: { category: 'zero' } }],
  },
  'exempt': {
    ...base,
    number: 'INV-0005',
    lines: [{
      name: 'Language course',
      quantity: 20,
      unit: 'hour',
      netPrice: 45,
      vat: { category: 'exempt', exemptionReason: 'Exempt under section 4 no. 21 of the German VAT Act' },
    }],
  },
  'reverse-charge': {
    ...base,
    number: 'INV-0006',
    buyer: {
      name: 'Probe Handels GmbH',
      address: { line1: 'Testgasse 3', postcode: '1010', city: 'Wien', country: 'AT' },
      vatId: 'ATU00000000',
    },
    notes: ['Reverse charge: the recipient owes the VAT.'],
    lines: [{ name: 'Software development', quantity: 40, unit: 'hour', netPrice: 95, vat: { category: 'reverse-charge' } }],
  },
  'intra-community': {
    ...base,
    number: 'INV-0007',
    buyer: {
      name: 'Exemple Distribution SARL',
      address: { line1: '4 rue de l\'Exemple', postcode: '75001', city: 'Paris', country: 'FR' },
      vatId: 'FR00000000000',
    },
    delivery: {
      date: '2026-10-28',
      name: 'Exemple Entrepôt',
      address: { line1: '5 avenue du Test', postcode: '69001', city: 'Lyon', country: 'FR' },
    },
    lines: [{
      name: 'Oak table',
      quantity: 4,
      unit: 'piece',
      netPrice: '780.50',
      vat: { category: 'intra-community', exemptionReason: 'Intra-community supply' },
    }],
  },
  'export': {
    ...base,
    number: 'INV-0008',
    buyer: {
      name: 'Beispiel Import AG',
      address: { line1: 'Musterstrasse 6', postcode: '8001', city: 'Zürich', country: 'CH' },
    },
    lines: [{ name: 'Printing machine', quantity: 1, unit: 'piece', netPrice: 18500, vat: { category: 'export' } }],
  },
  'allowances-and-charges': {
    ...base,
    number: 'INV-0009',
    lines: [
      {
        name: 'Chair',
        quantity: 12,
        unit: 'piece',
        netPrice: '149.90',
        allowances: [{ amount: '89.94', reason: 'Volume discount' }],
        charges: [{ amount: 24, reason: 'Assembly' }],
        vat: standard19,
      },
      { name: 'Cookbook', quantity: 3, unit: 'piece', netPrice: '19.99', vat: standard7 },
    ],
    allowances: [
      { amount: 50, reason: 'Loyalty discount', vat: standard19 },
      { amount: '2.10', reason: 'Loyalty discount', vat: standard7 },
    ],
    charges: [{ amount: '39.90', reason: 'Freight', vat: standard19 }],
  },
  'credit-note': {
    ...base,
    number: 'CN-0001',
    type: 'credit-note',
    precedingInvoices: [{ number: 'INV-0003', issueDate: '2026-11-02' }],
    notes: ['Credit for two handbooks returned damaged.'],
    payment: { dueDate: '2026-11-16', means: { type: 'sepa-credit-transfer', iban: EXAMPLE_IBAN } },
    lines: [{ name: 'Handbook', quantity: 2, unit: 'piece', netPrice: '24.95', vat: standard7 }],
  },
  'sepa-direct-debit': {
    ...base,
    number: 'INV-0011',
    billingPeriod: { start: '2026-11-01', end: '2026-11-30' },
    payment: {
      dueDate: '2026-11-20',
      terms: 'The amount is collected by SEPA direct debit on the due date.',
      means: {
        type: 'sepa-direct-debit',
        mandateReference: 'MANDATE-0001',
        creditorId: 'DE98ZZZ09999999999',
        debtorIban: EXAMPLE_IBAN,
      },
    },
    lines: [{ name: 'Monthly support plan', quantity: 1, unit: 'month', netPrice: '249.00', vat: standard19 }],
  },
  'prepaid-and-rounding': {
    ...base,
    number: 'INV-0012',
    prepaidAmount: 50,
    roundingAmount: '-0.03',
    lines: [{ name: 'Repair', quantity: '2.5', unit: 'hour', netPrice: '40.01', vat: standard19 }],
  },
  'outside-scope': {
    ...base,
    number: 'INV-0013',
    seller: {
      name: 'Example Verein e. V.',
      address: { line1: 'Vereinsweg 7', postcode: '04109', city: 'Leipzig', country: 'DE' },
      legalRegistrationId: 'VR 00000',
    },
    buyer: {
      name: 'Sample Member',
      address: { line1: 'Mitgliederweg 8', postcode: '04109', city: 'Leipzig', country: 'DE' },
    },
    lines: [{ name: 'Annual membership fee', quantity: 1, unit: 'year', netPrice: 60, vat: { category: 'outside-scope' } }],
  },
  'card-and-references': {
    ...base,
    number: 'INV-0014 <A&B>',
    buyerReference: '04011000-12345-34',
    orderReference: 'PO-"7781"',
    contractReference: 'CT-2026-01',
    notes: ['Thank you for your order & trust.', 'Questions? <billing@example.com>'],
    seller: { ...seller, tradingName: 'Atelier & Co', legalInformation: 'Share capital 25,000 EUR' },
    buyer: {
      ...buyer,
      legalRegistrationId: 'HRB 99999',
      contact: { name: 'Max Sample', email: 'max@customer.example' },
      address: { ...buyer.address, line2: 'Building C', line3: 'Floor 2', region: 'Bayern' },
      electronicAddress: { value: '4000001000005', scheme: '0088' },
    },
    payment: { dueDate: '2026-11-02', means: { type: 'card', lastDigits: '4242', holder: 'Max Sample' } },
    lines: [{
      id: 'A-1',
      name: 'Photo print 30 × 40',
      description: 'Matte paper, "gallery" quality',
      quantity: 3,
      unit: 'piece',
      netPrice: '39.00',
      vat: standard19,
      period: { start: '2026-10-01', end: '2026-10-31' },
      sellerItemId: 'SKU-001',
      buyerItemId: 'BUY-77',
      standardItemId: { id: '4000001000005', scheme: '0160' },
      orderLineReference: '10',
    }],
  },
  'cash-self-billed': {
    ...base,
    number: 'SB-0001',
    type: 'self-billed-invoice',
    payment: { dueDate: '2026-11-02', means: { type: 'cash' } },
    lines: [{ name: 'Scrap metal', quantity: '125.75', unit: 'kilogram', netPrice: '0.42', vat: standard19 }],
  },
  'prepayment-account-id': {
    ...base,
    number: 'PP-0001',
    type: 'prepayment-invoice',
    payment: {
      dueDate: '2026-11-09',
      reference: 'PP-0001',
      means: { type: 'credit-transfer', accountId: '0000202051', bic: 'BYLADEM1001', accountName: 'Example Atelier GmbH' },
    },
    lines: [{ name: 'Advance payment for the kitchen project', quantity: 1, unit: 'lump-sum', netPrice: 5000, vat: standard19 }],
  },
}

/**
 * The same invoice with the fields XRechnung adds to EN 16931: the buyer
 * reference (BR-DE-15), both electronic addresses (PEPPOL-EN16931-R010,
 * R020) and the seller contact (BR-DE-2). Fields the invoice already has
 * stay as they are.
 */
export const forXRechnung = (invoice: EInvoice): EInvoice => ({
  ...invoice,
  buyerReference: invoice.buyerReference ?? '991-00000-00',
  seller: {
    ...invoice.seller,
    contact: invoice.seller.contact ?? { name: 'Office', phone: '+49 341 0000000', email: 'office@verein.example' },
    electronicAddress: invoice.seller.electronicAddress ?? { email: 'office@verein.example' },
  },
  buyer: { ...invoice.buyer, electronicAddress: invoice.buyer.electronicAddress ?? { email: 'invoices@buyer.example' } },
})
