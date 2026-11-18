import {
  add,
  decimal,
  type Decimal,
  divideRounded,
  formatAmount,
  formatDecimal,
  invalidInvoiceValue,
  multiply,
  parseDecimal,
  subtract,
  sum,
  ZERO,
} from './decimal'
import type { EInvoice, EInvoiceTotals, EInvoiceVat, EInvoiceVatBreakdown } from './types'

/** Fraction digits each kind of author value allows. */
export const DECIMALS = { amount: 2, quantity: 4, price: 6, rate: 2 } as const

const HUNDRED = decimal(100n)
const ONE = decimal(1n)

/** The rate a VAT category writes: the author's for S, 0 for Z, E, AE, K, G, none for O. */
const vatRate = (vat: EInvoiceVat, field: string): Decimal | undefined => {
  if (vat.category === 'standard') return parseDecimal(vat.rate, `${field}.rate`, DECIMALS.rate)
  return vat.category === 'outside-scope' ? undefined : ZERO
}

interface Group {
  category: EInvoiceVat['category']
  rate: Decimal | undefined
  exemptionReason: string | undefined
  taxable: Decimal
}

/**
 * The numbers an invoice derives from its data. A template shows exactly
 * these strings and `renderEInvoiceXml` writes exactly these strings, so the
 * visible PDF and the embedded XML cannot disagree.
 *
 * Rounding follows EN 16931: every amount is rounded half away from zero to
 * two decimals at these points and nowhere else:
 *
 * - line net amount (BT-131) = quantity × net price ÷ price base quantity,
 *   rounded, plus line charges, minus line allowances;
 * - VAT category tax amount (BT-117) = VAT category taxable amount (BT-116) ×
 *   rate ÷ 100, rounded once per breakdown group (never per line);
 * - all other totals are sums of two-decimal amounts and need no rounding.
 *
 * Invalid numbers (NaN, exponent forms, too many decimals, a price base
 * quantity of zero) fail with a typed error that names the field. Business
 * rules are not checked here.
 */
export const computeEInvoice = (invoice: EInvoice): EInvoiceTotals => {
  const groups = new Map<string, Group>()
  const groupFor = (vat: EInvoiceVat, field: string): Group => {
    const rate = vatRate(vat, `${field}.vat`)
    const key = `${vat.category}|${rate === undefined ? '' : formatDecimal(rate)}`
    let group = groups.get(key)
    if (group === undefined) {
      group = { category: vat.category, rate, exemptionReason: undefined, taxable: ZERO }
      groups.set(key, group)
    }
    if (group.exemptionReason === undefined && 'exemptionReason' in vat && vat.exemptionReason) {
      group.exemptionReason = vat.exemptionReason
    }
    return group
  }
  const amount = (value: EInvoice['prepaidAmount'], field: string): Decimal =>
    value === undefined ? ZERO : parseDecimal(value, field, DECIMALS.amount)

  const lineNets = invoice.lines.map((line, index) => {
    const field = `invoice.lines[${index}]`
    const quantity = parseDecimal(line.quantity, `${field}.quantity`, DECIMALS.quantity)
    const price = parseDecimal(line.netPrice, `${field}.netPrice`, DECIMALS.price)
    const base = line.priceBaseQuantity === undefined
      ? ONE
      : parseDecimal(line.priceBaseQuantity, `${field}.priceBaseQuantity`, DECIMALS.quantity)
    if (base.units <= 0n) {
      throw invalidInvoiceValue(`${field}.priceBaseQuantity`, `must be above zero, got "${formatDecimal(base)}".`)
    }
    const charges = sum((line.charges ?? []).map((charge, at) => amount(charge.amount, `${field}.charges[${at}].amount`)))
    const allowances = sum((line.allowances ?? []).map((allowance, at) => amount(allowance.amount, `${field}.allowances[${at}].amount`)))
    const net = subtract(add(divideRounded(multiply(quantity, price), base, 2), charges), allowances)
    const group = groupFor(line.vat, field)
    group.taxable = add(group.taxable, net)
    return net
  })

  const documentLevel = (entries: EInvoice['allowances'], name: 'allowances' | 'charges', sign: 1 | -1): Decimal =>
    sum((entries ?? []).map((entry, index) => {
      const field = `invoice.${name}[${index}]`
      const value = amount(entry.amount, `${field}.amount`)
      const group = groupFor(entry.vat, field)
      group.taxable = sign === 1 ? add(group.taxable, value) : subtract(group.taxable, value)
      return value
    }))
  const allowanceTotal = documentLevel(invoice.allowances, 'allowances', -1)
  const chargeTotal = documentLevel(invoice.charges, 'charges', 1)

  const vatBreakdown: EInvoiceVatBreakdown[] = []
  let taxTotal = ZERO
  for (const group of groups.values()) {
    const tax = group.rate === undefined ? ZERO : divideRounded(multiply(group.taxable, group.rate), HUNDRED, 2)
    taxTotal = add(taxTotal, tax)
    vatBreakdown.push({
      category: group.category,
      ...(group.rate === undefined ? {} : { rate: formatDecimal(group.rate) }),
      taxableAmount: formatAmount(group.taxable),
      taxAmount: formatAmount(tax),
      ...(group.exemptionReason === undefined ? {} : { exemptionReason: group.exemptionReason }),
    })
  }

  const lineTotal = sum(lineNets)
  const taxBasisTotal = add(subtract(lineTotal, allowanceTotal), chargeTotal)
  const grandTotal = add(taxBasisTotal, taxTotal)
  const prepaidAmount = amount(invoice.prepaidAmount, 'invoice.prepaidAmount')
  const roundingAmount = amount(invoice.roundingAmount, 'invoice.roundingAmount')

  return {
    lines: lineNets.map(net => ({ netAmount: formatAmount(net) })),
    vatBreakdown,
    lineTotal: formatAmount(lineTotal),
    allowanceTotal: formatAmount(allowanceTotal),
    chargeTotal: formatAmount(chargeTotal),
    taxBasisTotal: formatAmount(taxBasisTotal),
    taxTotal: formatAmount(taxTotal),
    grandTotal: formatAmount(grandTotal),
    prepaidAmount: formatAmount(prepaidAmount),
    roundingAmount: formatAmount(roundingAmount),
    duePayable: formatAmount(add(subtract(grandTotal, prepaidAmount), roundingAmount)),
  }
}
