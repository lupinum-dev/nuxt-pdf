import { NuxtPdfError } from '../shared/errors'
import {
  DOCUMENT_TYPE_CODES,
  forbiddenXmlCharacter,
  isCalendarDate,
  PAYMENT_TYPE_CODES,
  UNIT_NAME_CODES,
  VAT_CATEGORY_CODES,
} from './cii'
import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  ELECTRONIC_ADDRESS_SCHEMES,
  ITEM_ID_SCHEMES,
  PAYMENT_MEANS_CODES,
  UNIT_CODES,
  VAT_ID_PREFIXES,
} from './codes'
import { DECIMALS } from './compute'
import { compare, type Decimal, type DecimalInput, parseDecimal, ZERO } from './decimal'
import type {
  EInvoice,
  EInvoiceAddress,
  EInvoiceElectronicAddress,
  EInvoiceIssue,
  EInvoicePeriod,
  EInvoiceProfile,
  EInvoiceUnit,
  EInvoiceVat,
  EInvoiceVatCategory,
} from './types'

export interface ValidateEInvoiceOptions {
  profile: EInvoiceProfile
}

/** Where a VAT category is used: a line, a document allowance or a document charge. */
type Usage = 'line' | 'allowance' | 'charge'

/** The rule suffix of each usage in the per-category rules (`BR-S-02`, `-03`, `-04`). */
const USAGE_SUFFIX: Readonly<Record<Usage, string>> = { line: '02', allowance: '03', charge: '04' }
const USAGE_NAME: Readonly<Record<Usage, string>> = { line: 'an invoice line', allowance: 'a document allowance', charge: 'a document charge' }

/** The rule prefix of each VAT category (`BR-IC-…` for intra-community). */
const RULE_PREFIX: Readonly<Record<EInvoiceVatCategory, string>> = {
  'standard': 'BR-S',
  'zero': 'BR-Z',
  'exempt': 'BR-E',
  'reverse-charge': 'BR-AE',
  'intra-community': 'BR-IC',
  'export': 'BR-G',
  'outside-scope': 'BR-O',
}

const blank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === ''
const has = (value: unknown): boolean => !blank(value)

/**
 * Check invoice data against the business rules of EN 16931 and, for
 * XRECHNUNG, the BR-DE rules of XRechnung 3.0. Returns every problem found,
 * each with the rule id (`BR-16`, `BR-DE-15`, or `PDF-VALUE` for a malformed
 * number, date or text), the field path and what to do; an empty list means
 * `renderEInvoiceXml` writes the XML. It never throws for invoice content, nor
 * for a missing invoice, so a form can show the issues.
 *
 * The rules of EN 16931 apply to the invoice data in every profile, because
 * the lower Factur-X profiles are projections of the same full invoice.
 * Rules that the types already make impossible, and rules the XML writer
 * satisfies by construction (totals, breakdown amounts, element order), are
 * not checked again here.
 */
export const validateEInvoice = (invoice: EInvoice, options: ValidateEInvoiceOptions): EInvoiceIssue[] => {
  // A request body is not typed at runtime: an empty one reads as undefined.
  if (invoice === null || typeof invoice !== 'object') {
    return [{ rule: 'PDF-VALUE', path: 'invoice', message: 'invoice is missing. Send the invoice data as an object.' }]
  }
  const issues: EInvoiceIssue[] = []
  const issue = (rule: string, path: string, message: string): void => {
    issues.push({ rule, path, message })
  }
  const xrechnung = options.profile === 'XRECHNUNG'

  // --- Values: a malformed value fails the XML writer, so report it here. ---

  const number = (value: DecimalInput | undefined, path: string, decimals: number, rule = 'PDF-VALUE'): Decimal | undefined => {
    if (value === undefined) return undefined
    try {
      return parseDecimal(value, path, decimals)
    }
    catch (error) {
      if (!(error instanceof NuxtPdfError)) throw error
      issue(rule, path, error.message)
      return undefined
    }
  }
  const date = (value: unknown, path: string): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value === 'string' && isCalendarDate(value)) return value
    issue('PDF-VALUE', path, `${path} must be a calendar date written as "YYYY-MM-DD", got ${JSON.stringify(value)}.`)
    return undefined
  }
  const walkText = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      const bad = forbiddenXmlCharacter(value)
      if (bad !== undefined) issue('PDF-VALUE', path, `${path} has the character ${bad}, which XML does not allow. Remove it.`)
    }
    else if (Array.isArray(value)) {
      value.forEach((entry, index) => walkText(entry, `${path}[${index}]`))
    }
    else if (typeof value === 'object' && value !== null) {
      for (const [key, entry] of Object.entries(value)) walkText(entry, `${path}.${key}`)
    }
  }
  walkText(invoice, 'invoice')

  const period = (value: EInvoicePeriod | undefined, path: string, anyRule: string, orderRule: string): void => {
    if (value === undefined) return
    const start = date(value.start, `${path}.start`)
    const end = date(value.end, `${path}.end`)
    if (value.start === undefined && value.end === undefined) {
      issue(anyRule, path, `${path} needs a start date, an end date or both. Give one or leave the period out.`)
    }
    if (start !== undefined && end !== undefined && end < start) {
      issue(orderRule, `${path}.end`, `${path}.end (${end}) is before ${path}.start (${start}). The end date must be on or after the start date.`)
    }
  }

  const country = (value: EInvoiceAddress | undefined, path: string, missingRule: string, countryRule: string): void => {
    if (value === undefined || typeof value !== 'object') {
      issue(missingRule, path, `${path} is missing. Give the postal address with at least the country code.`)
      return
    }
    if (blank(value.country)) issue(countryRule, `${path}.country`, `${path}.country is missing. Give the ISO 3166-1 country code, for example "DE".`)
    else if (!COUNTRY_CODES.has(value.country)) issue('BR-CL-14', `${path}.country`, `${path}.country "${value.country}" is not an ISO 3166-1 alpha-2 code. Use a code such as "DE" or "FR".`)
  }

  const vatIdPrefix = (vatId: string | undefined, path: string): void => {
    if (vatId === undefined) return
    if (!VAT_ID_PREFIXES.has(vatId.slice(0, 2))) {
      issue('BR-CO-09', path, `${path} "${vatId}" must start with the country prefix, for example "DE123456789" (Greece uses "EL").`)
    }
  }

  const electronicAddress = (value: EInvoiceElectronicAddress | undefined, path: string, schemeRule: string): void => {
    if (value === undefined) return
    if ('email' in value) {
      if (blank(value.email)) issue('PDF-VALUE', `${path}.email`, `${path}.email is empty. Give the address or leave ${path} out.`)
      return
    }
    if (blank(value.value)) issue('PDF-VALUE', `${path}.value`, `${path}.value is empty. Give the address or leave ${path} out.`)
    if (blank(value.scheme)) issue(schemeRule, `${path}.scheme`, `${path}.scheme is missing. Give the EAS code of the address, for example "0088" for a GLN.`)
    else if (!ELECTRONIC_ADDRESS_SCHEMES.has(value.scheme)) issue('BR-CL-25', `${path}.scheme`, `${path}.scheme "${value.scheme}" is not a CEF EAS code. Use a code such as "0088", "9930" or { email } for an email address.`)
  }

  const unit = (value: EInvoiceUnit, path: string): void => {
    if (typeof value === 'string') {
      if (!Object.hasOwn(UNIT_NAME_CODES, value)) issue('BR-CL-23', path, `${path} "${value}" is not a known unit name. Use one of ${Object.keys(UNIT_NAME_CODES).join(', ')} or { code } with a UN/ECE Recommendation 20 code.`)
    }
    else if (typeof value !== 'object' || value === null || !UNIT_CODES.has(value.code)) {
      issue('BR-CL-23', path, `${path} must be a unit name or { code } with a UN/ECE Recommendation 20 or 21 code such as "H87".`)
    }
  }

  // VAT: the category of every line, allowance and charge, with its usage.
  const usages: { category: EInvoiceVatCategory, usage: Usage, path: string, reason?: string }[] = []
  const vat = (value: EInvoiceVat, path: string, usage: Usage, positiveRateRule: string): void => {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(VAT_CATEGORY_CODES, value.category)) {
      issue('BR-CL-18', `${path}.category`, `${path}.category must be one of ${Object.keys(VAT_CATEGORY_CODES).join(', ')}.`)
      return
    }
    if (value.category === 'standard') {
      const rate = number(value.rate, `${path}.rate`, DECIMALS.rate)
      if (rate !== undefined && compare(rate, ZERO) <= 0) {
        issue(positiveRateRule, `${path}.rate`, `${path}.rate must be above 0 for the standard category. Use { category: 'zero' } for a zero rate.`)
      }
    }
    if (value.category === 'exempt' && blank(value.exemptionReason)) {
      issue('BR-E-10', `${path}.exemptionReason`, `${path}.exemptionReason is missing. An exempt supply needs the legal reason, for example the article of the VAT law.`)
    }
    usages.push({ category: value.category, usage, path, reason: 'exemptionReason' in value && has(value.exemptionReason) ? value.exemptionReason : undefined })
  }

  // --- Document (BG-0, BG-2) ---

  if (blank(invoice.number)) issue('BR-02', 'invoice.number', 'invoice.number is missing. Give the invoice number.')
  if (invoice.issueDate === undefined) issue('BR-03', 'invoice.issueDate', 'invoice.issueDate is missing. Give the issue date as "YYYY-MM-DD".')
  else date(invoice.issueDate, 'invoice.issueDate')
  if (invoice.type !== undefined && !Object.hasOwn(DOCUMENT_TYPE_CODES, invoice.type)) {
    issue('BR-CL-01', 'invoice.type', `invoice.type must be one of ${Object.keys(DOCUMENT_TYPE_CODES).join(', ')}.`)
  }
  if (blank(invoice.currency)) issue('BR-05', 'invoice.currency', 'invoice.currency is missing. Give the ISO 4217 code, for example "EUR".')
  else if (!CURRENCY_CODES.has(invoice.currency)) issue('BR-CL-04', 'invoice.currency', `invoice.currency "${invoice.currency}" is not an ISO 4217 code. Use a code such as "EUR".`)
  for (const [index, preceding] of (invoice.precedingInvoices ?? []).entries()) {
    const path = `invoice.precedingInvoices[${index}]`
    if (blank(preceding.number)) issue('BR-55', `${path}.number`, `${path}.number is missing. Give the number of the preceding invoice.`)
    date(preceding.issueDate, `${path}.issueDate`)
  }

  // --- Seller (BG-4) and buyer (BG-7) ---

  const seller = invoice.seller ?? { name: '', address: undefined }
  const buyer = invoice.buyer ?? { name: '', address: undefined }
  if (blank(seller.name)) issue('BR-06', 'invoice.seller.name', 'invoice.seller.name is missing. Give the seller\'s name.')
  if (blank(buyer.name)) issue('BR-07', 'invoice.buyer.name', 'invoice.buyer.name is missing. Give the buyer\'s name.')
  country(seller.address, 'invoice.seller.address', 'BR-08', 'BR-09')
  country(buyer.address, 'invoice.buyer.address', 'BR-10', 'BR-11')
  vatIdPrefix(seller.vatId, 'invoice.seller.vatId')
  vatIdPrefix(buyer.vatId, 'invoice.buyer.vatId')
  if (blank(seller.vatId) && blank(seller.legalRegistrationId)) {
    issue('BR-CO-26', 'invoice.seller', 'The seller needs a VAT identifier (invoice.seller.vatId) or a legal registration identifier (invoice.seller.legalRegistrationId) so the buyer can identify them.')
  }
  electronicAddress(seller.electronicAddress, 'invoice.seller.electronicAddress', 'BR-62')
  electronicAddress(buyer.electronicAddress, 'invoice.buyer.electronicAddress', 'BR-63')

  // --- Delivery (BG-13) and invoicing period (BG-14) ---

  date(invoice.delivery?.date, 'invoice.delivery.date')
  if (invoice.delivery?.address !== undefined) country(invoice.delivery.address, 'invoice.delivery.address', 'BR-57', 'BR-57')
  period(invoice.billingPeriod, 'invoice.billingPeriod', 'BR-CO-19', 'BR-29')

  // --- Lines (BG-25) ---

  const lines = Array.isArray(invoice.lines) ? invoice.lines : []
  if (lines.length === 0) issue('BR-16', 'invoice.lines', 'invoice.lines is empty. An invoice needs at least one line.')
  for (const [index, line] of lines.entries()) {
    const path = `invoice.lines[${index}]`
    if (line.id !== undefined && blank(line.id)) issue('BR-21', `${path}.id`, `${path}.id is empty. Give the line identifier or leave it out to use the position.`)
    if (blank(line.name)) issue('BR-25', `${path}.name`, `${path}.name is missing. Give the item name.`)
    number(line.quantity, `${path}.quantity`, DECIMALS.quantity)
    const price = number(line.netPrice, `${path}.netPrice`, DECIMALS.price)
    if (price !== undefined && compare(price, ZERO) < 0) {
      issue('BR-27', `${path}.netPrice`, `${path}.netPrice must not be negative. Put a reduction in ${path}.allowances or use a negative quantity.`)
    }
    const base = number(line.priceBaseQuantity, `${path}.priceBaseQuantity`, DECIMALS.quantity)
    if (base !== undefined && compare(base, ZERO) <= 0) {
      issue('PEPPOL-EN16931-R121', `${path}.priceBaseQuantity`, `${path}.priceBaseQuantity must be above 0. Leave it out for a price per unit.`)
    }
    unit(line.unit, `${path}.unit`)
    vat(line.vat, `${path}.vat`, 'line', 'BR-S-05')
    for (const [at, allowance] of (line.allowances ?? []).entries()) {
      number(allowance.amount, `${path}.allowances[${at}].amount`, DECIMALS.amount, 'BR-DEC-24')
      if (blank(allowance.reason)) issue('BR-42', `${path}.allowances[${at}].reason`, `${path}.allowances[${at}].reason is missing. Say why the allowance is given.`)
    }
    for (const [at, charge] of (line.charges ?? []).entries()) {
      number(charge.amount, `${path}.charges[${at}].amount`, DECIMALS.amount, 'BR-DEC-27')
      if (blank(charge.reason)) issue('BR-44', `${path}.charges[${at}].reason`, `${path}.charges[${at}].reason is missing. Say what the charge is for.`)
    }
    period(line.period, `${path}.period`, 'BR-CO-20', 'BR-30')
    if (line.standardItemId !== undefined) {
      if (blank(line.standardItemId.id)) issue('PDF-VALUE', `${path}.standardItemId.id`, `${path}.standardItemId.id is empty. Give the identifier or leave standardItemId out.`)
      if (blank(line.standardItemId.scheme)) issue('BR-64', `${path}.standardItemId.scheme`, `${path}.standardItemId.scheme is missing. Give the ISO 6523 scheme, for example "0160" for a GTIN.`)
      else if (!ITEM_ID_SCHEMES.has(line.standardItemId.scheme)) issue('BR-CL-21', `${path}.standardItemId.scheme`, `${path}.standardItemId.scheme "${line.standardItemId.scheme}" is not an ISO 6523 ICD code. Use a code such as "0160" for a GTIN.`)
    }
    if (xrechnung && line.period !== undefined && invoice.billingPeriod !== undefined) {
      const { start, end } = line.period
      if (start !== undefined && invoice.billingPeriod.start !== undefined && start < invoice.billingPeriod.start) {
        issue('PEPPOL-EN16931-R110', `${path}.period.start`, `${path}.period.start (${start}) is before the invoicing period starts (${invoice.billingPeriod.start}). A line period must lie within invoice.billingPeriod.`)
      }
      if (end !== undefined && invoice.billingPeriod.end !== undefined && end > invoice.billingPeriod.end) {
        issue('PEPPOL-EN16931-R111', `${path}.period.end`, `${path}.period.end (${end}) is after the invoicing period ends (${invoice.billingPeriod.end}). A line period must lie within invoice.billingPeriod.`)
      }
    }
  }

  // --- Document level allowances (BG-20) and charges (BG-21), amounts (BG-22) ---

  for (const [index, allowance] of (invoice.allowances ?? []).entries()) {
    const path = `invoice.allowances[${index}]`
    number(allowance.amount, `${path}.amount`, DECIMALS.amount, 'BR-DEC-01')
    if (blank(allowance.reason)) issue('BR-33', `${path}.reason`, `${path}.reason is missing. Say why the allowance is given.`)
    vat(allowance.vat, `${path}.vat`, 'allowance', 'BR-S-06')
  }
  for (const [index, charge] of (invoice.charges ?? []).entries()) {
    const path = `invoice.charges[${index}]`
    number(charge.amount, `${path}.amount`, DECIMALS.amount, 'BR-DEC-05')
    if (blank(charge.reason)) issue('BR-38', `${path}.reason`, `${path}.reason is missing. Say what the charge is for.`)
    vat(charge.vat, `${path}.vat`, 'charge', 'BR-S-07')
  }
  number(invoice.prepaidAmount, 'invoice.prepaidAmount', DECIMALS.amount, 'BR-DEC-16')
  const rounding = number(invoice.roundingAmount, 'invoice.roundingAmount', DECIMALS.amount, 'BR-DEC-17')
  if ((options.profile === 'BASIC' || options.profile === 'BASIC WL') && rounding !== undefined && compare(rounding, ZERO) !== 0) {
    issue('BR-CO-16', 'invoice.roundingAmount', `${options.profile} has no rounding amount (BT-114), so its amount due would not add up. Use the profile EN 16931 or leave invoice.roundingAmount out.`)
  }

  // --- VAT categories and the parties they need ---

  const sellerVat = has(seller.vatId)
  const sellerTax = sellerVat || has('taxNumber' in seller ? seller.taxNumber : undefined)
  const buyerVat = has(buyer.vatId)
  const reported = new Set<string>()
  const once = (rule: string, path: string, message: string): void => {
    if (reported.has(`${rule} ${path}`)) return
    reported.add(`${rule} ${path}`)
    issue(rule, path, message)
  }
  for (const { category, usage, path } of usages) {
    const rule = `${RULE_PREFIX[category]}-${USAGE_SUFFIX[usage]}`
    const where = `${USAGE_NAME[usage]} (${path})`
    switch (category) {
      case 'standard':
      case 'zero':
      case 'exempt':
        if (!sellerTax) once(rule, 'invoice.seller.vatId', `The ${category} VAT category on ${where} needs the seller's VAT identifier (invoice.seller.vatId) or tax number (invoice.seller.taxNumber).`)
        break
      case 'reverse-charge':
        if (!sellerTax) once(rule, 'invoice.seller.vatId', `Reverse charge on ${where} needs the seller's VAT identifier (invoice.seller.vatId) or tax number (invoice.seller.taxNumber).`)
        if (!buyerVat && blank(buyer.legalRegistrationId)) once(rule, 'invoice.buyer.vatId', `Reverse charge on ${where} needs the buyer's VAT identifier (invoice.buyer.vatId) or legal registration identifier.`)
        break
      case 'intra-community':
        if (!sellerVat) once(rule, 'invoice.seller.vatId', `An intra-community supply on ${where} needs the seller's VAT identifier (invoice.seller.vatId).`)
        if (!buyerVat) once(rule, 'invoice.buyer.vatId', `An intra-community supply on ${where} needs the buyer's VAT identifier (invoice.buyer.vatId).`)
        break
      case 'export':
        if (!sellerVat) once(rule, 'invoice.seller.vatId', `An export on ${where} needs the seller's VAT identifier (invoice.seller.vatId).`)
        break
      case 'outside-scope':
        if (sellerVat) once(rule, 'invoice.seller.vatId', `A supply not subject to VAT on ${where} must not carry the seller's VAT identifier. Leave invoice.seller.vatId out.`)
        if (buyerVat) once(rule, 'invoice.buyer.vatId', `A supply not subject to VAT on ${where} must not carry the buyer's VAT identifier. Leave invoice.buyer.vatId out.`)
        break
    }
  }
  const categories = new Set(usages.map(usage => usage.category))
  if (categories.has('outside-scope')) {
    const others = usages.filter(usage => usage.category !== 'outside-scope')
    if (others.length > 0) {
      issue('BR-O-11', others[0]!.path, 'An invoice with the category outside-scope (not subject to VAT) must not have any other VAT category. Split it into two invoices.')
    }
    for (const other of others) {
      const rule = other.usage === 'line' ? 'BR-O-12' : other.usage === 'allowance' ? 'BR-O-13' : 'BR-O-14'
      issue(rule, other.path, `${other.path} has the category ${other.category} in an invoice not subject to VAT. Use outside-scope here too or split the invoice.`)
    }
  }
  if (categories.has('intra-community')) {
    if (invoice.delivery?.date === undefined && invoice.billingPeriod?.start === undefined && invoice.billingPeriod?.end === undefined) {
      issue('BR-IC-11', 'invoice.delivery.date', 'An intra-community supply needs the delivery date (invoice.delivery.date) or the invoicing period (invoice.billingPeriod).')
    }
    if (invoice.delivery?.address === undefined) {
      issue('BR-IC-12', 'invoice.delivery.address', 'An intra-community supply needs the deliver-to address with its country (invoice.delivery.address.country).')
    }
  }
  // One breakdown per category with a reason: the reasons must agree.
  const reasons = new Map<EInvoiceVatCategory, { reason: string, path: string }>()
  for (const { category, path, reason } of usages) {
    if (reason === undefined || category === 'standard' || category === 'zero') continue
    const first = reasons.get(category)
    if (first === undefined) reasons.set(category, { reason, path })
    else if (first.reason !== reason) {
      issue(`${RULE_PREFIX[category]}-01`, `${path}.exemptionReason`, `${path}.exemptionReason differs from ${first.path}.exemptionReason. An invoice has one VAT breakdown per category, so all ${category} items must give the same reason.`)
    }
  }

  // --- Payment instructions (BG-16) ---

  const means = invoice.payment?.means
  date(invoice.payment?.dueDate, 'invoice.payment.dueDate')
  if (means !== undefined) {
    const path = 'invoice.payment.means'
    // A credit transfer without an account: the writer writes no account
    // element, so the CEN rule BR-61 (which looks inside that element) stays
    // silent, but Mustang rejects it as CII-SR-470 and XRechnung as BR-DE-23-a.
    const creditTransferRule = xrechnung ? 'BR-DE-23-a' : 'BR-61'
    if ('code' in means) {
      if (!PAYMENT_MEANS_CODES.has(means.code)) issue('BR-CL-16', `${path}.code`, `${path}.code "${means.code}" is not a UNTDID 4461 code.`)
      else if (means.code === '30' || means.code === '58') issue(creditTransferRule, `${path}.code`, `A credit transfer needs the account the buyer pays to. Use { type: '${means.code === '58' ? 'sepa-credit-transfer' : 'credit-transfer'}' } with the IBAN instead of { code: '${means.code}' }.`)
      else if (xrechnung && ['48', '54', '55'].includes(means.code)) issue('BR-DE-24-a', `${path}.code`, `XRechnung needs the card details for a card payment. Use { type: 'card', lastDigits } instead of { code: '${means.code}' }.`)
      else if (xrechnung && (means.code === '59' || means.code === '49')) issue('PEPPOL-EN16931-R061', `${path}.code`, `XRechnung needs the mandate reference for a direct debit. Use { type: 'sepa-direct-debit' } instead of { code: '${means.code}' }.`)
    }
    else if (!Object.hasOwn(PAYMENT_TYPE_CODES, means.type)) {
      issue('BR-CL-16', `${path}.type`, `${path}.type must be one of ${Object.keys(PAYMENT_TYPE_CODES).join(', ')}, or use { code }.`)
    }
    else if (means.type === 'sepa-credit-transfer' || means.type === 'credit-transfer') {
      if ('iban' in means ? blank(means.iban) : blank('accountId' in means ? means.accountId : undefined)) {
        const field = 'iban' in means ? 'iban' : 'accountId'
        issue(creditTransferRule, `${path}.${field}`, `${path}.${field} is empty. A credit transfer needs the account the buyer pays to.`)
      }
    }
    else if (means.type === 'sepa-direct-debit' && xrechnung) {
      if (blank(means.mandateReference)) issue('PEPPOL-EN16931-R061', `${path}.mandateReference`, `${path}.mandateReference is missing. Give the SEPA mandate reference.`)
      if (blank(means.creditorId)) issue('BR-DE-30', `${path}.creditorId`, `${path}.creditorId is missing. Give the SEPA creditor identifier.`)
      if (blank(means.debtorIban)) issue('BR-DE-31', `${path}.debtorIban`, `${path}.debtorIban is missing. Give the buyer's IBAN.`)
    }
    else if (means.type === 'card') {
      if ('lastDigits' in means && typeof means.lastDigits === 'string' && means.lastDigits.trim().length > 10) {
        issue('BR-51', `${path}.lastDigits`, `${path}.lastDigits must hold only the last digits of the card number (at most 10 characters), never the full number.`)
      }
      if (xrechnung && !('lastDigits' in means && has(means.lastDigits))) {
        issue('BR-DE-24-a', `${path}.lastDigits`, `XRechnung needs the last digits of the card for a card payment. Give ${path}.lastDigits.`)
      }
    }
  }

  // --- XRechnung 3.0 (CIUS): what it requires beyond EN 16931 ---

  if (xrechnung) {
    if (means === undefined) issue('BR-DE-1', 'invoice.payment.means', 'XRechnung needs the payment instructions. Give invoice.payment.means.')
    if (blank(invoice.buyerReference)) issue('BR-DE-15', 'invoice.buyerReference', 'XRechnung needs the buyer reference, for a public buyer the Leitweg-ID. Give invoice.buyerReference.')
    const contact = seller.contact
    if (contact === undefined) {
      issue('BR-DE-2', 'invoice.seller.contact', 'XRechnung needs the seller contact with name, phone and email. Give invoice.seller.contact.')
    }
    else {
      if (blank(contact.name)) issue('BR-DE-5', 'invoice.seller.contact.name', 'XRechnung needs the seller contact point. Give invoice.seller.contact.name.')
      if (blank(contact.phone)) issue('BR-DE-6', 'invoice.seller.contact.phone', 'XRechnung needs the seller contact phone number. Give invoice.seller.contact.phone.')
      if (blank(contact.email)) issue('BR-DE-7', 'invoice.seller.contact.email', 'XRechnung needs the seller contact email address. Give invoice.seller.contact.email.')
    }
    if (blank(seller.address?.city)) issue('BR-DE-3', 'invoice.seller.address.city', 'XRechnung needs the seller city. Give invoice.seller.address.city.')
    if (blank(seller.address?.postcode)) issue('BR-DE-4', 'invoice.seller.address.postcode', 'XRechnung needs the seller post code. Give invoice.seller.address.postcode.')
    if (blank(buyer.address?.city)) issue('BR-DE-8', 'invoice.buyer.address.city', 'XRechnung needs the buyer city. Give invoice.buyer.address.city.')
    if (blank(buyer.address?.postcode)) issue('BR-DE-9', 'invoice.buyer.address.postcode', 'XRechnung needs the buyer post code. Give invoice.buyer.address.postcode.')
    const deliverTo = invoice.delivery?.address
    if (deliverTo !== undefined) {
      if (blank(deliverTo.city)) issue('BR-DE-10', 'invoice.delivery.address.city', 'XRechnung needs the city of the deliver-to address. Give invoice.delivery.address.city.')
      if (blank(deliverTo.postcode)) issue('BR-DE-11', 'invoice.delivery.address.postcode', 'XRechnung needs the post code of the deliver-to address. Give invoice.delivery.address.postcode.')
    }
    if (!sellerTax && usages.some(usage => usage.category !== 'outside-scope')) {
      issue('BR-DE-16', 'invoice.seller.vatId', 'XRechnung needs the seller\'s VAT identifier (invoice.seller.vatId) or tax number (invoice.seller.taxNumber) for this VAT category.')
    }
    if (seller.electronicAddress === undefined) issue('PEPPOL-EN16931-R020', 'invoice.seller.electronicAddress', 'XRechnung needs the seller\'s electronic address. Give invoice.seller.electronicAddress, for example { email }.')
    if (buyer.electronicAddress === undefined) issue('PEPPOL-EN16931-R010', 'invoice.buyer.electronicAddress', 'XRechnung needs the buyer\'s electronic address. Give invoice.buyer.electronicAddress, for example { email }.')
  }

  return issues
}
