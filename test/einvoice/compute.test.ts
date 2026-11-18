import { describe, expect, it } from 'vitest'
import { computeEInvoice, type EInvoice, type EInvoiceLine } from '../../src/runtime/einvoice'
import { NuxtPdfError } from '../../src/runtime/shared/errors'

// All expected values are worked out by hand in the comments.

const S19 = { category: 'standard', rate: 19 } as const
const S7 = { category: 'standard', rate: 7 } as const

const line = (quantity: EInvoiceLine['quantity'], netPrice: EInvoiceLine['netPrice'], extra: Partial<EInvoiceLine> = {}): EInvoiceLine =>
  ({ name: 'Item', unit: 'piece', vat: S19, quantity, netPrice, ...extra })

const invoice = (lines: EInvoiceLine[], extra: Partial<EInvoice> = {}): EInvoice => ({
  number: 'T-1',
  issueDate: '2026-11-02',
  currency: 'EUR',
  seller: { name: 'Example Seller', address: { country: 'DE' } },
  buyer: { name: 'Example Buyer', address: { country: 'DE' } },
  lines,
  ...extra,
})

describe('computeEInvoice', () => {
  // Catches float rounding (10.5 × 0.19 = 1.9949999… → 1.99), banker's
  // rounding (0.125 → 0.12) and float products (3 × 0.335 = 1.00499… → 1.00).
  it('rounds .005 half up at the line and the VAT group', () => {
    expect(computeEInvoice(invoice([line(1, '10.50')]))).toMatchObject({
      lines: [{ netAmount: '10.50' }],
      vatBreakdown: [{ category: 'standard', rate: '19', taxableAmount: '10.50', taxAmount: '2.00' }],
      grandTotal: '12.50',
    })
    // 0.125 → 0.13; 3 × 0.335 = 1.005 → 1.01; group 1.14 × 0.19 = 0.2166 → 0.22.
    expect(computeEInvoice(invoice([line(1, '0.125'), line(3, '0.335')]))).toMatchObject({
      lines: [{ netAmount: '0.13' }, { netAmount: '1.01' }],
      lineTotal: '1.14',
      taxTotal: '0.22',
    })
  })

  // Catches rounding the sum instead of each line (10.00) and rounding VAT
  // per line (3 × 0.63 = 1.89) instead of once per group (9.99 × 0.19 =
  // 1.8981 → 1.90).
  it('rounds each line, then the VAT once per group, for lines with thirds', () => {
    const third = line(1, 10, { priceBaseQuantity: 3 })
    expect(computeEInvoice(invoice([third, third, third]))).toEqual({
      lines: [{ netAmount: '3.33' }, { netAmount: '3.33' }, { netAmount: '3.33' }],
      vatBreakdown: [{ category: 'standard', rate: '19', taxableAmount: '9.99', taxAmount: '1.90' }],
      lineTotal: '9.99',
      allowanceTotal: '0.00',
      chargeTotal: '0.00',
      taxBasisTotal: '9.99',
      taxTotal: '1.90',
      grandTotal: '11.89',
      prepaidAmount: '0.00',
      roundingAmount: '0.00',
      duePayable: '11.89',
    })
  })

  // Catches dividing by the price base quantity before multiplying
  // (1.99 / 100 = 0.0199 → rounding too early) and ignoring it.
  it('divides by the price base quantity', () => {
    // 1500 × 1.99 / 100 = 29.85.
    expect(computeEInvoice(invoice([line(1500, '1.99', { priceBaseQuantity: 100 })])).lines).toEqual([{ netAmount: '29.85' }])
  })

  // Catches mixing VAT rates in one group, losing the order of first use,
  // and treating 19 and '19.00' as different rates.
  it('keeps one breakdown group per rate, in order of first use', () => {
    const totals = computeEInvoice(invoice([line(1, 100), line(1, 50, { vat: S7 }), line(1, '33.33', { vat: { category: 'standard', rate: '19.00' } })]))
    // 19 %: 133.33 × 0.19 = 25.3327 → 25.33; 7 %: 50.00 × 0.07 = 3.50.
    expect(totals.vatBreakdown).toEqual([
      { category: 'standard', rate: '19', taxableAmount: '133.33', taxAmount: '25.33' },
      { category: 'standard', rate: '7', taxableAmount: '50.00', taxAmount: '3.50' },
    ])
    expect(totals).toMatchObject({ lineTotal: '183.33', taxBasisTotal: '183.33', taxTotal: '28.83', grandTotal: '212.16' })
  })

  // Catches adding a line allowance instead of subtracting it, leaving
  // document level amounts out of their VAT group, and swapping the
  // allowance and charge totals.
  it('applies line and document level allowances and charges', () => {
    const totals = computeEInvoice(invoice(
      [
        // 10 × 9.95 = 99.50 − 4.50 + 2.00 = 97.00.
        line(10, '9.95', { allowances: [{ amount: '4.50', reason: 'Discount' }], charges: [{ amount: 2, reason: 'Packing' }] }),
        // 2 × 15 = 30.00.
        line(2, 15, { vat: S7 }),
      ],
      {
        allowances: [{ amount: 7, reason: 'Discount', vat: S19 }, { amount: 1, reason: 'Discount', vat: S7 }],
        charges: [{ amount: 5, reason: 'Freight', vat: S19 }],
      },
    ))
    expect(totals).toEqual({
      lines: [{ netAmount: '97.00' }, { netAmount: '30.00' }],
      vatBreakdown: [
        // 97.00 − 7.00 + 5.00 = 95.00; × 0.19 = 18.05.
        { category: 'standard', rate: '19', taxableAmount: '95.00', taxAmount: '18.05' },
        // 30.00 − 1.00 = 29.00; × 0.07 = 2.03.
        { category: 'standard', rate: '7', taxableAmount: '29.00', taxAmount: '2.03' },
      ],
      lineTotal: '127.00',
      allowanceTotal: '8.00',
      chargeTotal: '5.00',
      taxBasisTotal: '124.00',
      taxTotal: '20.08',
      grandTotal: '144.08',
      prepaidAmount: '0.00',
      roundingAmount: '0.00',
      duePayable: '144.08',
    })
  })

  // Catches adding the prepaid amount or subtracting the rounding amount.
  it('subtracts the prepaid amount and adds the rounding amount', () => {
    // 2.5 × 40.01 = 100.025 → 100.03; × 0.19 = 19.0057 → 19.01; 119.04 − 50 − 0.04 = 69.00.
    expect(computeEInvoice(invoice([line('2.5', '40.01')], { prepaidAmount: 50, roundingAmount: '-0.04' }))).toMatchObject({
      grandTotal: '119.04',
      prepaidAmount: '50.00',
      roundingAmount: '-0.04',
      duePayable: '69.00',
    })
  })

  // Catches a credit note being negated by the code (EN 16931 credit notes
  // carry positive amounts) and asymmetric rounding of negative quantities.
  it('computes a credit note like an invoice and mirrors negative quantities', () => {
    // 2 × 24.95 = 49.90; × 0.07 = 3.493 → 3.49.
    expect(computeEInvoice(invoice([line(2, '24.95', { vat: S7 })], { type: 'credit-note' }))).toMatchObject({
      lineTotal: '49.90',
      taxTotal: '3.49',
      grandTotal: '53.39',
      duePayable: '53.39',
    })
    // −1 × 0.125 = −0.125 → −0.13; −0.13 × 0.19 = −0.0247 → −0.02.
    expect(computeEInvoice(invoice([line(-1, '0.125')]))).toMatchObject({
      lines: [{ netAmount: '-0.13' }],
      taxTotal: '-0.02',
      duePayable: '-0.15',
    })
  })

  // Catches a wrong rate or tax for a category (only S is taxed here; O has
  // no rate) and a lost exemption reason.
  it('writes the rate and tax of each VAT category', () => {
    const totals = computeEInvoice(invoice([
      line(1, 100),
      line(1, 100, { vat: { category: 'zero' } }),
      line(1, 100, { vat: { category: 'exempt', exemptionReason: 'Medical care' } }),
      line(1, 100, { vat: { category: 'reverse-charge' } }),
      line(1, 100, { vat: { category: 'intra-community', exemptionReason: 'Intra-community supply' } }),
      line(1, 100, { vat: { category: 'export' } }),
      line(1, 100, { vat: { category: 'outside-scope' } }),
    ]))
    expect(totals.vatBreakdown).toEqual([
      { category: 'standard', rate: '19', taxableAmount: '100.00', taxAmount: '19.00' },
      { category: 'zero', rate: '0', taxableAmount: '100.00', taxAmount: '0.00' },
      { category: 'exempt', rate: '0', taxableAmount: '100.00', taxAmount: '0.00', exemptionReason: 'Medical care' },
      { category: 'reverse-charge', rate: '0', taxableAmount: '100.00', taxAmount: '0.00' },
      { category: 'intra-community', rate: '0', taxableAmount: '100.00', taxAmount: '0.00', exemptionReason: 'Intra-community supply' },
      { category: 'export', rate: '0', taxableAmount: '100.00', taxAmount: '0.00' },
      { category: 'outside-scope', taxableAmount: '100.00', taxAmount: '0.00' },
    ])
    expect(totals).toMatchObject({ taxBasisTotal: '700.00', taxTotal: '19.00', grandTotal: '719.00' })
  })

  // Catches silently accepting a value the XML could not carry exactly.
  it.each([
    [{ netPrice: '1.2345678' }, 'invoice.lines[0].netPrice allows at most 6 decimals'],
    [{ quantity: Number.NaN }, 'invoice.lines[0].quantity must be a finite number'],
    [{ priceBaseQuantity: 0 }, 'invoice.lines[0].priceBaseQuantity must be above zero'],
    [{ vat: { category: 'standard', rate: '19.001' } }, 'invoice.lines[0].vat.rate allows at most 2 decimals'],
    [{ allowances: [{ amount: '1.001', reason: 'x' }] }, 'invoice.lines[0].allowances[0].amount allows at most 2 decimals'],
  ] satisfies [Partial<EInvoiceLine>, string][])('rejects %j', (extra, message) => {
    const run = () => computeEInvoice(invoice([line(1, 1, extra)]))
    expect(run).toThrowError(NuxtPdfError)
    expect(run).toThrowError(message)
  })
})
