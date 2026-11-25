import { NuxtPdfError, PDF_ERROR_CODES, treeInvalid } from '../shared/errors'
import { computeEInvoice, DECIMALS, vatRate } from './compute'
import { formatAmount, formatDecimal, parseDecimal } from './decimal'
import type {
  EInvoice,
  EInvoiceAddress,
  EInvoiceBuyer,
  EInvoiceContact,
  EInvoiceDocumentAllowanceCharge,
  EInvoiceDocumentType,
  EInvoiceElectronicAddress,
  EInvoiceLine,
  EInvoiceLineAllowanceCharge,
  EInvoicePaymentMeans,
  EInvoicePeriod,
  EInvoiceProfile,
  EInvoiceSeller,
  EInvoiceTotals,
  EInvoiceUnit,
  EInvoiceUnitName,
  EInvoiceVat,
  EInvoiceVatCategory,
} from './types'
import { validateEInvoice } from './validate'

export interface RenderEInvoiceXmlOptions {
  profile: EInvoiceProfile
}

/**
 * What a profile writes. The lower Factur-X profiles are projections of the
 * full invoice: they leave out what their XSD does not define.
 */
interface ProfileShape {
  /** BT-24 Specification identifier. */
  guideline: string
  /** BT-23 written when the invoice gives none. */
  defaultBusinessProcess?: string
  /** Invoice lines (BG-25); BASIC WL and MINIMUM have none. */
  lines: boolean
  /** Everything beyond BASIC: contacts, BT-33, item ids and description, BIC, account name, card, BT-82, BT-114. */
  details: boolean
  /** MINIMUM: parties, references and four totals only. */
  minimum: boolean
  /** XRechnung requires a rate (BT-119) in every breakdown (BR-DE-14), also `0` for O. */
  rateForOutsideScope: boolean
}

export const PROFILE_SHAPES: Readonly<Record<EInvoiceProfile, ProfileShape>> = {
  'MINIMUM': {
    guideline: 'urn:factur-x.eu:1p0:minimum',
    lines: false,
    details: false,
    minimum: true,
    rateForOutsideScope: false,
  },
  'BASIC WL': {
    guideline: 'urn:factur-x.eu:1p0:basicwl',
    lines: false,
    details: false,
    minimum: false,
    rateForOutsideScope: false,
  },
  'BASIC': {
    guideline: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
    lines: true,
    details: false,
    minimum: false,
    rateForOutsideScope: false,
  },
  'EN 16931': {
    guideline: 'urn:cen.eu:en16931:2017',
    lines: true,
    details: true,
    minimum: false,
    rateForOutsideScope: false,
  },
  'XRECHNUNG': {
    guideline: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
    defaultBusinessProcess: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
    lines: true,
    details: true,
    minimum: false,
    rateForOutsideScope: true,
  },
}

/** BT-3, UNTDID 1001. */
export const DOCUMENT_TYPE_CODES: Readonly<Record<EInvoiceDocumentType, string>> = {
  'invoice': '380',
  'credit-note': '381',
  'corrected-invoice': '384',
  'prepayment-invoice': '386',
  'self-billed-invoice': '389',
}

/** BT-118, BT-151, UNCL 5305. */
export const VAT_CATEGORY_CODES: Readonly<Record<EInvoiceVatCategory, string>> = {
  'standard': 'S',
  'zero': 'Z',
  'exempt': 'E',
  'reverse-charge': 'AE',
  'intra-community': 'K',
  'export': 'G',
  'outside-scope': 'O',
}

/**
 * BT-121, VATEX. Only categories with one fixed reason get a code; exempt (E)
 * has many legal grounds, so its reason must be given as text.
 */
const VAT_EXEMPTION_CODES: Partial<Readonly<Record<EInvoiceVatCategory, string>>> = {
  'reverse-charge': 'VATEX-EU-AE',
  'intra-community': 'VATEX-EU-IC',
  'export': 'VATEX-EU-G',
  'outside-scope': 'VATEX-EU-O',
}

/** BT-130, UN/ECE Recommendation 20 (and 21 for `lump-sum`). */
export const UNIT_NAME_CODES: Readonly<Record<EInvoiceUnitName, string>> = {
  'piece': 'H87',
  'unit': 'C62',
  'set': 'SET',
  'pair': 'PR',
  'lump-sum': 'LS',
  'second': 'SEC',
  'minute': 'MIN',
  'hour': 'HUR',
  'day': 'DAY',
  'week': 'WEE',
  'month': 'MON',
  'year': 'ANN',
  'gram': 'GRM',
  'kilogram': 'KGM',
  'tonne': 'TNE',
  'millimetre': 'MMT',
  'centimetre': 'CMT',
  'metre': 'MTR',
  'kilometre': 'KMT',
  'square-metre': 'MTK',
  'cubic-metre': 'MTQ',
  'millilitre': 'MLT',
  'litre': 'LTR',
  'kilowatt-hour': 'KWH',
}

/** BT-81, UNTDID 4461. */
export const PAYMENT_TYPE_CODES = {
  'sepa-credit-transfer': '58',
  'credit-transfer': '30',
  'sepa-direct-debit': '59',
  'card': '48',
  'cash': '10',
} as const

const NAMESPACES = [
  ['rsm', 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100'],
  ['qdt', 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100'],
  ['ram', 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100'],
  ['udt', 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'],
] as const

const lookup = <Key extends string>(table: Readonly<Record<Key, string>>, key: string, field: string): string => {
  if (!Object.hasOwn(table, key)) {
    treeInvalid(`${field} must be one of ${Object.keys(table).map(name => `"${name}"`).join(', ')}, got ${JSON.stringify(key)}.`)
  }
  return table[key as Key]
}

// --- A minimal XML tree: elements without content are left out. ---

interface XmlElement {
  readonly name: string
  readonly attributes: readonly (readonly [string, string])[]
  readonly text?: string
  readonly children: readonly XmlElement[]
}
type XmlChild = XmlElement | undefined | false

/** An element with children; `undefined` when none of them has content. */
const el = (name: string, ...children: XmlChild[]): XmlElement | undefined => {
  const present = children.filter(child => child !== undefined && child !== false)
  return present.length === 0 ? undefined : { name, attributes: [], children: present }
}

/** A text element; `undefined` for a missing or empty value. */
const text = (name: string, value: string | undefined, attributes: readonly (readonly [string, string])[] = []): XmlElement | undefined =>
  value === undefined || value === '' ? undefined : { name, attributes, text: value, children: [] }

// The complement of the XML 1.0 `Char` production.
const NOT_XML_CHAR = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u

/** The first character XML does not allow, as `U+XXXX`, or `undefined`. */
export const forbiddenXmlCharacter = (value: string): string | undefined => {
  const bad = NOT_XML_CHAR.exec(value)
  return bad === null ? undefined : `U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
}

const escape = (value: string, quote: boolean): string => {
  const bad = forbiddenXmlCharacter(value)
  if (bad !== undefined) {
    treeInvalid(`The invoice text ${JSON.stringify(value)} has the character ${bad}, which XML does not allow.`)
  }
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return quote ? escaped.replaceAll('"', '&quot;') : escaped
}

const serialize = (element: XmlElement, depth: number, out: string[]): void => {
  const indent = '  '.repeat(depth)
  const attributes = element.attributes.map(([key, value]) => ` ${key}="${escape(value, true)}"`).join('')
  if (element.text !== undefined) {
    out.push(`${indent}<${element.name}${attributes}>${escape(element.text, false)}</${element.name}>`)
    return
  }
  if (element.children.length === 0) {
    out.push(`${indent}<${element.name}${attributes}/>`)
    return
  }
  out.push(`${indent}<${element.name}${attributes}>`)
  for (const child of element.children) serialize(child, depth + 1, out)
  out.push(`${indent}</${element.name}>`)
}

// --- Values ---

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whether a string is a calendar date written as `'YYYY-MM-DD'`. */
export const isCalendarDate = (value: string): boolean => {
  const match = DATE.exec(value)
  if (match === null) return false
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

/** `'YYYY-MM-DD'` to the CII date format 102 (`YYYYMMDD`); a typed error for anything else. */
const date102 = (value: string, field: string): string => {
  if (typeof value === 'string' && isCalendarDate(value)) return value.replaceAll('-', '')
  return treeInvalid(`${field} must be a calendar date written as "YYYY-MM-DD", got ${JSON.stringify(value)}.`)
}

const dateTime = (name: string, value: string | undefined, field: string): XmlElement | undefined =>
  value === undefined ? undefined : el(name, text('udt:DateTimeString', date102(value, field), [['format', '102']]))

const indicator = (charge: boolean): XmlElement | undefined =>
  el('ram:ChargeIndicator', text('udt:Indicator', charge ? 'true' : 'false'))

const unitCode = (unit: EInvoiceUnit, field: string): string =>
  typeof unit === 'string' ? lookup(UNIT_NAME_CODES, unit, field) : unit.code

/** `ram:ApplicableTradeTax` of a line or `ram:CategoryTradeTax` of an allowance or charge. */
const categoryTax = (name: string, vat: EInvoiceVat, field: string): XmlElement | undefined => {
  const rate = vatRate(vat, field)
  return el(
    name,
    text('ram:TypeCode', 'VAT'),
    text('ram:CategoryCode', lookup(VAT_CATEGORY_CODES, vat.category, `${field}.category`)),
    text('ram:RateApplicablePercent', rate === undefined ? undefined : formatDecimal(rate)),
  )
}

const period = (value: EInvoicePeriod | undefined, field: string): XmlElement | undefined => value === undefined
  ? undefined
  : el(
      'ram:BillingSpecifiedPeriod',
      dateTime('ram:StartDateTime', value.start, `${field}.start`),
      dateTime('ram:EndDateTime', value.end, `${field}.end`),
    )

const address = (value: EInvoiceAddress | undefined, shape: ProfileShape): XmlElement | undefined => {
  if (value === undefined) return undefined
  if (shape.minimum) return el('ram:PostalTradeAddress', text('ram:CountryID', value.country))
  return el(
    'ram:PostalTradeAddress',
    text('ram:PostcodeCode', value.postcode),
    text('ram:LineOne', value.line1),
    text('ram:LineTwo', value.line2),
    text('ram:LineThree', value.line3),
    text('ram:CityName', value.city),
    text('ram:CountryID', value.country),
    text('ram:CountrySubDivisionName', value.region),
  )
}

const contact = (value: EInvoiceContact | undefined): XmlElement | undefined => value === undefined
  ? undefined
  : el(
      'ram:DefinedTradeContact',
      text('ram:PersonName', value.name),
      el('ram:TelephoneUniversalCommunication', text('ram:CompleteNumber', value.phone)),
      el('ram:EmailURIUniversalCommunication', text('ram:URIID', value.email)),
    )

const electronicAddress = (value: EInvoiceElectronicAddress | undefined): XmlElement | undefined => {
  if (value === undefined) return undefined
  const [id, scheme] = 'email' in value ? [value.email, 'EM'] : [value.value, value.scheme]
  return el('ram:URIUniversalCommunication', text('ram:URIID', id, [['schemeID', scheme]]))
}

const party = (name: string, value: EInvoiceSeller | EInvoiceBuyer, shape: ProfileShape): XmlElement | undefined => el(
  name,
  text('ram:Name', value.name),
  shape.details && text('ram:Description', 'legalInformation' in value ? value.legalInformation : undefined),
  el(
    'ram:SpecifiedLegalOrganization',
    text('ram:ID', value.legalRegistrationId),
    !shape.minimum && text('ram:TradingBusinessName', value.tradingName),
  ),
  shape.details && contact(value.contact),
  address(value.address, shape),
  !shape.minimum && electronicAddress(value.electronicAddress),
  el('ram:SpecifiedTaxRegistration', text('ram:ID', value.vatId, [['schemeID', 'VA']])),
  el('ram:SpecifiedTaxRegistration', text('ram:ID', 'taxNumber' in value ? value.taxNumber : undefined, [['schemeID', 'FC']])),
)

const lineAllowanceCharge = (entry: EInvoiceLineAllowanceCharge, charge: boolean, field: string): XmlElement | undefined => el(
  'ram:SpecifiedTradeAllowanceCharge',
  indicator(charge),
  text('ram:ActualAmount', formatAmount(parseDecimal(entry.amount, `${field}.amount`, DECIMALS.amount))),
  text('ram:Reason', entry.reason),
)

const documentAllowanceCharge = (entry: EInvoiceDocumentAllowanceCharge, charge: boolean, field: string): XmlElement | undefined => el(
  'ram:SpecifiedTradeAllowanceCharge',
  indicator(charge),
  text('ram:ActualAmount', formatAmount(parseDecimal(entry.amount, `${field}.amount`, DECIMALS.amount))),
  text('ram:Reason', entry.reason),
  categoryTax('ram:CategoryTradeTax', entry.vat, `${field}.vat`),
)

const lineItem = (line: EInvoiceLine, index: number, netAmount: string, shape: ProfileShape): XmlElement | undefined => {
  const field = `invoice.lines[${index}]`
  const unit = unitCode(line.unit, `${field}.unit`)
  const base = line.priceBaseQuantity === undefined
    ? undefined
    : formatDecimal(parseDecimal(line.priceBaseQuantity, `${field}.priceBaseQuantity`, DECIMALS.quantity))
  return el(
    'ram:IncludedSupplyChainTradeLineItem',
    el('ram:AssociatedDocumentLineDocument', text('ram:LineID', line.id ?? String(index + 1))),
    el(
      'ram:SpecifiedTradeProduct',
      line.standardItemId === undefined
        ? undefined
        : text('ram:GlobalID', line.standardItemId.id, [['schemeID', line.standardItemId.scheme]]),
      shape.details && text('ram:SellerAssignedID', line.sellerItemId),
      shape.details && text('ram:BuyerAssignedID', line.buyerItemId),
      text('ram:Name', line.name),
      shape.details && text('ram:Description', line.description),
    ),
    el(
      'ram:SpecifiedLineTradeAgreement',
      shape.details && el('ram:BuyerOrderReferencedDocument', text('ram:LineID', line.orderLineReference)),
      el(
        'ram:NetPriceProductTradePrice',
        text('ram:ChargeAmount', formatDecimal(parseDecimal(line.netPrice, `${field}.netPrice`, DECIMALS.price))),
        text('ram:BasisQuantity', base, [['unitCode', unit]]),
      ),
    ),
    el(
      'ram:SpecifiedLineTradeDelivery',
      text('ram:BilledQuantity', formatDecimal(parseDecimal(line.quantity, `${field}.quantity`, DECIMALS.quantity)), [['unitCode', unit]]),
    ),
    el(
      'ram:SpecifiedLineTradeSettlement',
      categoryTax('ram:ApplicableTradeTax', line.vat, `${field}.vat`),
      period(line.period, `${field}.period`),
      ...(line.allowances ?? []).map((entry, at) => lineAllowanceCharge(entry, false, `${field}.allowances[${at}]`)),
      ...(line.charges ?? []).map((entry, at) => lineAllowanceCharge(entry, true, `${field}.charges[${at}]`)),
      el('ram:SpecifiedTradeSettlementLineMonetarySummation', text('ram:LineTotalAmount', netAmount)),
    ),
  )
}

const paymentMeans = (means: EInvoicePaymentMeans | undefined, shape: ProfileShape): XmlElement | undefined => {
  if (means === undefined) return undefined
  if ('code' in means) {
    return el('ram:SpecifiedTradeSettlementPaymentMeans', text('ram:TypeCode', means.code), shape.details && text('ram:Information', means.information))
  }
  const code = text('ram:TypeCode', lookup(PAYMENT_TYPE_CODES, means.type, 'invoice.payment.means.type'))
  switch (means.type) {
    case 'sepa-credit-transfer':
    case 'credit-transfer':
      return el(
        'ram:SpecifiedTradeSettlementPaymentMeans',
        code,
        el(
          'ram:PayeePartyCreditorFinancialAccount',
          text('ram:IBANID', 'iban' in means ? means.iban : undefined),
          shape.details && text('ram:AccountName', means.accountName),
          text('ram:ProprietaryID', 'accountId' in means ? means.accountId : undefined),
        ),
        shape.details && el('ram:PayeeSpecifiedCreditorFinancialInstitution', text('ram:BICID', means.bic)),
      )
    case 'sepa-direct-debit':
      return el(
        'ram:SpecifiedTradeSettlementPaymentMeans',
        code,
        el('ram:PayerPartyDebtorFinancialAccount', text('ram:IBANID', means.debtorIban)),
      )
    case 'card':
      return el(
        'ram:SpecifiedTradeSettlementPaymentMeans',
        code,
        shape.details && 'lastDigits' in means
          ? el('ram:ApplicableTradeSettlementFinancialCard', text('ram:ID', means.lastDigits), text('ram:CardholderName', means.holder))
          : undefined,
      )
    case 'cash':
      return el('ram:SpecifiedTradeSettlementPaymentMeans', code)
  }
}

const summation = (invoice: EInvoice, totals: EInvoiceTotals, shape: ProfileShape): XmlElement | undefined => el(
  'ram:SpecifiedTradeSettlementHeaderMonetarySummation',
  !shape.minimum && text('ram:LineTotalAmount', totals.lineTotal),
  !shape.minimum && Boolean(invoice.charges?.length) && text('ram:ChargeTotalAmount', totals.chargeTotal),
  !shape.minimum && Boolean(invoice.allowances?.length) && text('ram:AllowanceTotalAmount', totals.allowanceTotal),
  text('ram:TaxBasisTotalAmount', totals.taxBasisTotal),
  text('ram:TaxTotalAmount', totals.taxTotal, [['currencyID', invoice.currency]]),
  shape.details && invoice.roundingAmount !== undefined && text('ram:RoundingAmount', totals.roundingAmount),
  text('ram:GrandTotalAmount', totals.grandTotal),
  !shape.minimum && invoice.prepaidAmount !== undefined && text('ram:TotalPrepaidAmount', totals.prepaidAmount),
  text('ram:DuePayableAmount', totals.duePayable),
)

/**
 * The XML of an invoice for a profile, without the rule check. Only
 * `renderEInvoiceXml` and the tests call it: the tests use it to prove that
 * the official validators reject what `validateEInvoice` reports.
 */
export const writeEInvoiceXml = (invoice: EInvoice, profile: EInvoiceProfile): string => {
  if (!Object.hasOwn(PROFILE_SHAPES, profile)) {
    treeInvalid(`options.profile must be one of ${Object.keys(PROFILE_SHAPES).map(name => `"${name}"`).join(', ')}, got ${JSON.stringify(profile)}.`)
  }
  const shape = PROFILE_SHAPES[profile]
  const totals = computeEInvoice(invoice)
  const currency = invoice.currency
  const means = invoice.payment?.means
  const directDebit = means !== undefined && 'type' in means && means.type === 'sepa-direct-debit' ? means : undefined

  const settlement = shape.minimum
    ? el('ram:ApplicableHeaderTradeSettlement', text('ram:InvoiceCurrencyCode', currency), summation(invoice, totals, shape))
    : el(
        'ram:ApplicableHeaderTradeSettlement',
        text('ram:CreditorReferenceID', directDebit?.creditorId),
        text('ram:PaymentReference', invoice.payment?.reference),
        text('ram:InvoiceCurrencyCode', currency),
        paymentMeans(means, shape),
        ...totals.vatBreakdown.map(group => el(
          'ram:ApplicableTradeTax',
          text('ram:CalculatedAmount', group.taxAmount),
          text('ram:TypeCode', 'VAT'),
          text('ram:ExemptionReason', group.exemptionReason),
          text('ram:BasisAmount', group.taxableAmount),
          text('ram:CategoryCode', VAT_CATEGORY_CODES[group.category]),
          text('ram:ExemptionReasonCode', VAT_EXEMPTION_CODES[group.category]),
          text('ram:RateApplicablePercent', group.rate ?? (shape.rateForOutsideScope ? '0' : undefined)),
        )),
        period(invoice.billingPeriod, 'invoice.billingPeriod'),
        ...(invoice.allowances ?? []).map((entry, at) => documentAllowanceCharge(entry, false, `invoice.allowances[${at}]`)),
        ...(invoice.charges ?? []).map((entry, at) => documentAllowanceCharge(entry, true, `invoice.charges[${at}]`)),
        el(
          'ram:SpecifiedTradePaymentTerms',
          text('ram:Description', invoice.payment?.terms),
          dateTime('ram:DueDateDateTime', invoice.payment?.dueDate, 'invoice.payment.dueDate'),
          text('ram:DirectDebitMandateID', directDebit?.mandateReference),
        ),
        summation(invoice, totals, shape),
        ...(invoice.precedingInvoices ?? []).map((preceding, at) => el(
          'ram:InvoiceReferencedDocument',
          text('ram:IssuerAssignedID', preceding.number),
          preceding.issueDate === undefined
            ? undefined
            : el('ram:FormattedIssueDateTime', text('qdt:DateTimeString', date102(preceding.issueDate, `invoice.precedingInvoices[${at}].issueDate`), [['format', '102']])),
        )),
      )

  // Required by every XSD even when there is nothing to say (MINIMUM defines it empty).
  const delivery = (shape.minimum
    ? undefined
    : el(
        'ram:ApplicableHeaderTradeDelivery',
        el('ram:ShipToTradeParty', text('ram:Name', invoice.delivery?.name), address(invoice.delivery?.address, shape)),
        el('ram:ActualDeliverySupplyChainEvent', dateTime('ram:OccurrenceDateTime', invoice.delivery?.date, 'invoice.delivery.date')),
      )) ?? { name: 'ram:ApplicableHeaderTradeDelivery', attributes: [], children: [] }

  const root = el(
    'rsm:CrossIndustryInvoice',
    el(
      'rsm:ExchangedDocumentContext',
      el('ram:BusinessProcessSpecifiedDocumentContextParameter', text('ram:ID', invoice.businessProcess ?? shape.defaultBusinessProcess)),
      el('ram:GuidelineSpecifiedDocumentContextParameter', text('ram:ID', shape.guideline)),
    ),
    el(
      'rsm:ExchangedDocument',
      text('ram:ID', invoice.number),
      text('ram:TypeCode', lookup(DOCUMENT_TYPE_CODES, invoice.type ?? 'invoice', 'invoice.type')),
      dateTime('ram:IssueDateTime', invoice.issueDate, 'invoice.issueDate'),
      ...(shape.minimum ? [] : (invoice.notes ?? []).map(note => el('ram:IncludedNote', text('ram:Content', note)))),
    ),
    el(
      'rsm:SupplyChainTradeTransaction',
      ...(shape.lines ? invoice.lines.map((line, index) => lineItem(line, index, totals.lines[index]!.netAmount, shape)) : []),
      el(
        'ram:ApplicableHeaderTradeAgreement',
        text('ram:BuyerReference', invoice.buyerReference),
        party('ram:SellerTradeParty', invoice.seller, shape),
        party('ram:BuyerTradeParty', invoice.buyer, shape),
        el('ram:BuyerOrderReferencedDocument', text('ram:IssuerAssignedID', invoice.orderReference)),
        !shape.minimum && el('ram:ContractReferencedDocument', text('ram:IssuerAssignedID', invoice.contractReference)),
      ),
      delivery,
      settlement,
    ),
  )!

  const out = ['<?xml version="1.0" encoding="UTF-8"?>']
  serialize({ ...root, attributes: NAMESPACES.map(([prefix, uri]) => [`xmlns:${prefix}`, uri] as const) }, 0, out)
  return `${out.join('\n')}\n`
}

/**
 * The UN/CEFACT Cross Industry Invoice (D16B) XML of an invoice for a
 * Factur-X / ZUGFeRD profile or XRechnung (CII syntax). Elements follow the
 * order of the profile's XSD, elements without content are left out, and the
 * output has no timestamp and no random value: the same input gives the same
 * string. Every amount comes from `computeEInvoice`; a lower profile carries
 * the totals of the full invoice.
 *
 * Invalid data, a malformed value as well as a broken rule of the profile,
 * throws `PDF_INVOICE_INVALID` with every issue of `validateEInvoice` in
 * `issues`. The check runs first, so the writer sees only valid data.
 */
export const renderEInvoiceXml = (invoice: EInvoice, options: RenderEInvoiceXmlOptions): string => {
  const issues = validateEInvoice(invoice, options)
  if (issues.length > 0) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.InvoiceInvalid,
      `The invoice breaks ${issues.length === 1 ? 'a rule' : `${issues.length} rules`} of ${options.profile}:\n${issues.map(issue => `- ${issue.rule} at ${issue.path}: ${issue.message}`).join('\n')}`,
      { issues },
    )
  }
  return writeEInvoiceXml(invoice, options.profile)
}
