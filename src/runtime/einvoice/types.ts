import type { PdfFacturXProfile } from '../primitives'
import type { PdfInvoiceIssue } from '../shared/errors'
import type { DecimalInput } from './decimal'

/**
 * The invoice data that `computeEInvoice` and `renderEInvoiceXml` read. It is
 * plain data (strings, numbers, arrays and objects) so it can cross a worker
 * boundary and give the same result every time. Dates are `'YYYY-MM-DD'`
 * strings. Each field names its EN 16931 business term (`BT-…`) or group
 * (`BG-…`); code lists are hidden behind plain names.
 *
 * Amounts, quantities, prices and rates are a number or a plain decimal string
 * (`12.5` or `'12.50'`). Amounts allow two decimals, quantities four, prices
 * six, rates two.
 */
export interface EInvoice {
  /** BT-1 Invoice number. */
  number: string
  /** BT-2 Invoice issue date, `'YYYY-MM-DD'`. */
  issueDate: string
  /** BT-3 Invoice type code. Default `'invoice'`. */
  type?: EInvoiceDocumentType
  /**
   * BT-23 Business process type. XRECHNUNG writes
   * `'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'` when it is not given;
   * the other profiles write it only when given.
   */
  businessProcess?: string
  /** BT-5 Invoice currency code, ISO 4217 (`'EUR'`). */
  currency: string
  /** BG-1 / BT-22 Invoice notes, one free text each. */
  notes?: string[]
  /** BT-10 Buyer reference, for example the German Leitweg-ID. */
  buyerReference?: string
  /** BT-13 Purchase order reference. */
  orderReference?: string
  /** BT-12 Contract reference. */
  contractReference?: string
  /** BG-3 Preceding invoice reference, for a credit note or a corrected invoice. */
  precedingInvoices?: EInvoicePrecedingInvoice[]
  /** BG-4 Seller. */
  seller: EInvoiceSeller
  /** BG-7 Buyer. */
  buyer: EInvoiceBuyer
  /** BG-13 Delivery information. */
  delivery?: EInvoiceDelivery
  /** BG-14 Invoicing period. */
  billingPeriod?: EInvoicePeriod
  /** BG-16 and the payment terms. */
  payment?: EInvoicePayment
  /** BG-20 Document level allowances, without VAT. */
  allowances?: EInvoiceDocumentAllowanceCharge[]
  /** BG-21 Document level charges, without VAT. */
  charges?: EInvoiceDocumentAllowanceCharge[]
  /** BG-25 Invoice lines. At least one. */
  lines: EInvoiceLine[]
  /** BT-113 Paid amount: what the buyer has paid already. */
  prepaidAmount?: DecimalInput
  /** BT-114 Rounding amount, added to the amount due. */
  roundingAmount?: DecimalInput
}

/**
 * BT-3 Invoice type code: `'invoice'` 380, `'credit-note'` 381,
 * `'corrected-invoice'` 384, `'prepayment-invoice'` 386,
 * `'self-billed-invoice'` 389.
 */
export type EInvoiceDocumentType
  = | 'invoice'
    | 'credit-note'
    | 'corrected-invoice'
    | 'prepayment-invoice'
    | 'self-billed-invoice'

/** BG-3 Preceding invoice reference. */
export interface EInvoicePrecedingInvoice {
  /** BT-25 Preceding invoice number. */
  number: string
  /** BT-26 Preceding invoice issue date, `'YYYY-MM-DD'`. */
  issueDate?: string
}

/** BG-5, BG-8, BG-15 Postal address. */
export interface EInvoiceAddress {
  /** BT-35, BT-50, BT-75 Address line 1. */
  line1?: string
  /** BT-36, BT-51, BT-76 Address line 2. */
  line2?: string
  /** BT-162, BT-163, BT-165 Address line 3. */
  line3?: string
  /** BT-37, BT-52, BT-77 City. */
  city?: string
  /** BT-38, BT-53, BT-78 Post code. */
  postcode?: string
  /** BT-39, BT-54, BT-79 Country subdivision, for example a region. */
  region?: string
  /** BT-40, BT-55, BT-80 Country code, ISO 3166-1 alpha-2 (`'DE'`). */
  country: string
}

/** BG-6, BG-9 Contact. */
export interface EInvoiceContact {
  /** BT-41, BT-56 Contact point: a person or a department. */
  name?: string
  /** BT-42, BT-57 Contact telephone number. */
  phone?: string
  /** BT-43, BT-58 Contact email address. */
  email?: string
}

/**
 * BT-34, BT-49 Electronic address. `{ email }` uses the scheme `EM`; otherwise
 * give the value with its EAS scheme code (for example `'0088'` for a GLN or
 * `'9930'` for a German VAT number).
 */
export type EInvoiceElectronicAddress
  = | { email: string }
    | { value: string, scheme: string }

interface EInvoiceParty {
  /** BT-27, BT-44 Name. */
  name: string
  /** BT-28, BT-45 Trading name, if it differs from the name. */
  tradingName?: string
  /** BG-5, BG-8 Postal address. */
  address: EInvoiceAddress
  /** BT-31, BT-48 VAT identifier, with the country prefix (`'DE123456789'`). */
  vatId?: string
  /** BT-30, BT-47 Legal registration identifier, for example a trade register number. */
  legalRegistrationId?: string
  /** BG-6, BG-9 Contact. */
  contact?: EInvoiceContact
  /** BT-34, BT-49 Electronic address. */
  electronicAddress?: EInvoiceElectronicAddress
}

/** BG-4 Seller. */
export interface EInvoiceSeller extends EInvoiceParty {
  /** BT-32 Seller tax registration identifier (the local tax number). */
  taxNumber?: string
  /** BT-33 Seller additional legal information, for example the share capital. */
  legalInformation?: string
}

/** BG-7 Buyer. EN 16931 has no tax number for the buyer. */
export type EInvoiceBuyer = EInvoiceParty

/** BG-13 Delivery information. */
export interface EInvoiceDelivery {
  /** BT-72 Actual delivery date, `'YYYY-MM-DD'`. */
  date?: string
  /** BT-70 Deliver to party name. */
  name?: string
  /** BG-15 Deliver to address. */
  address?: EInvoiceAddress
}

/** BG-14, BG-26 Period. */
export interface EInvoicePeriod {
  /** BT-73, BT-134 Start date, `'YYYY-MM-DD'`. */
  start?: string
  /** BT-74, BT-135 End date, `'YYYY-MM-DD'`. */
  end?: string
}

/** Payment instructions and terms. */
export interface EInvoicePayment {
  /** BT-9 Payment due date, `'YYYY-MM-DD'`. */
  dueDate?: string
  /** BT-20 Payment terms, free text. */
  terms?: string
  /** BT-83 Remittance information: the text the buyer puts on the transfer. */
  reference?: string
  /** BG-16 Payment means. */
  means?: EInvoicePaymentMeans
}

/** BG-17 Credit transfer account. */
interface EInvoiceCreditAccount {
  /** BT-85 Payment account name. */
  accountName?: string
  /** BT-86 Payment service provider identifier (BIC). */
  bic?: string
}

/**
 * BG-16 Payment means (BT-81 code in brackets): `'sepa-credit-transfer'` (58),
 * `'credit-transfer'` (30), `'sepa-direct-debit'` (59), `'card'` (48),
 * `'cash'` (10), or `{ code }` with a UNTDID 4461 code.
 */
export type EInvoicePaymentMeans
  = | EInvoiceCreditAccount & {
    type: 'sepa-credit-transfer'
    /** BT-84 Payment account identifier: the IBAN. */
    iban: string
  }
  | EInvoiceCreditAccount & {
    type: 'credit-transfer'
    /** BT-84 Payment account identifier: the IBAN. */
    iban: string
  }
  | EInvoiceCreditAccount & {
    type: 'credit-transfer'
    /** BT-84 Payment account identifier: a national account number, if there is no IBAN. */
    accountId: string
  }
  | {
    type: 'sepa-direct-debit'
    /** BT-89 Mandate reference identifier. */
    mandateReference: string
    /** BT-90 Bank assigned creditor identifier (SEPA creditor id). */
    creditorId: string
    /** BT-91 Debited account identifier: the buyer's IBAN. */
    debtorIban: string
  }
  | { type: 'card' }
  | {
    type: 'card'
    /** BT-87 Payment card primary account number: the last 4 to 6 digits only. */
    lastDigits: string
    /** BT-88 Payment card holder name. */
    holder?: string
  }
  | { type: 'cash' }
  | {
    /** BT-81 Payment means type code, UNTDID 4461. */
    code: string
    /** BT-82 Payment means text. */
    information?: string
  }

/**
 * VAT category (BT-118, BT-151 code in brackets): `'standard'` (S) with a rate
 * above zero, `'zero'` (Z), `'exempt'` (E, needs a reason), `'reverse-charge'`
 * (AE), `'intra-community'` (K, intra-community supply), `'export'` (G, export
 * outside the EU) and `'outside-scope'` (O, not subject to VAT). The last four
 * write their VATEX reason code (BT-121) themselves; a reason text is
 * optional.
 */
export type EInvoiceVat
  = | {
    category: 'standard'
    /** BT-119, BT-152 VAT rate in percent (`19`, `'5.5'`). */
    rate: DecimalInput
  }
  | { category: 'zero' }
  | {
    category: 'exempt'
    /** BT-120 VAT exemption reason text. */
    exemptionReason: string
  }
  | {
    category: 'reverse-charge' | 'intra-community' | 'export' | 'outside-scope'
    /** BT-120 VAT exemption reason text. */
    exemptionReason?: string
  }

export type EInvoiceVatCategory = EInvoiceVat['category']

/** BG-20, BG-21 Document level allowance or charge. */
export interface EInvoiceDocumentAllowanceCharge {
  /** BT-92, BT-99 Amount, without VAT. */
  amount: DecimalInput
  /** BT-97, BT-104 Reason. */
  reason: string
  /** BT-95, BT-96, BT-102, BT-103 The VAT that applies to it. */
  vat: EInvoiceVat
}

/** BG-27, BG-28 Invoice line allowance or charge. */
export interface EInvoiceLineAllowanceCharge {
  /** BT-136, BT-141 Amount, without VAT. */
  amount: DecimalInput
  /** BT-139, BT-144 Reason. */
  reason: string
}

/**
 * BT-130, BT-150 Unit of measure, as a common name (mapped to UN/ECE
 * Recommendation 20) or `{ code }` with any Recommendation 20 or 21 code.
 */
export type EInvoiceUnit = EInvoiceUnitName | { code: string }

export type EInvoiceUnitName
  = | 'piece'
    | 'unit'
    | 'set'
    | 'pair'
    | 'lump-sum'
    | 'second'
    | 'minute'
    | 'hour'
    | 'day'
    | 'week'
    | 'month'
    | 'year'
    | 'gram'
    | 'kilogram'
    | 'tonne'
    | 'millimetre'
    | 'centimetre'
    | 'metre'
    | 'kilometre'
    | 'square-metre'
    | 'cubic-metre'
    | 'millilitre'
    | 'litre'
    | 'kilowatt-hour'

/** BG-25 Invoice line. */
export interface EInvoiceLine {
  /** BT-126 Invoice line identifier. Default: the 1-based position. */
  id?: string
  /** BT-153 Item name. */
  name: string
  /** BT-154 Item description. */
  description?: string
  /** BT-129 Invoiced quantity. */
  quantity: DecimalInput
  /** BT-130 Unit of measure. */
  unit: EInvoiceUnit
  /** BT-146 Item net price, without VAT, per `priceBaseQuantity` units. */
  netPrice: DecimalInput
  /** BT-149 Item price base quantity. Default 1. */
  priceBaseQuantity?: DecimalInput
  /** BG-27 Invoice line allowances. */
  allowances?: EInvoiceLineAllowanceCharge[]
  /** BG-28 Invoice line charges. */
  charges?: EInvoiceLineAllowanceCharge[]
  /** BG-30 Line VAT information. */
  vat: EInvoiceVat
  /** BG-26 Invoice line period. */
  period?: EInvoicePeriod
  /** BT-155 Item seller's identifier. */
  sellerItemId?: string
  /** BT-156 Item buyer's identifier. */
  buyerItemId?: string
  /** BT-157 Item standard identifier with its scheme (`'0160'` for a GTIN). */
  standardItemId?: { id: string, scheme: string }
  /** BT-132 Referenced purchase order line reference. */
  orderLineReference?: string
}

/**
 * The profiles `renderEInvoiceXml` writes. MINIMUM, BASIC WL and BASIC write
 * the subset of the invoice their XSD defines (the visible PDF is the
 * invoice); EN 16931 and XRECHNUNG write all of it. XRECHNUNG is the CII
 * syntax of XRechnung 3.0. EXTENDED is only for XML the author supplies.
 */
export type EInvoiceProfile = Exclude<PdfFacturXProfile, 'EXTENDED'>

/** A problem in the invoice data for a profile, from `validateEInvoice`. */
export type EInvoiceIssue = PdfInvoiceIssue

/** The numbers an invoice derives from its data, as decimal strings with two decimals. */
export interface EInvoiceTotals {
  /** Per invoice line, in the order of `invoice.lines`. */
  lines: EInvoiceLineTotals[]
  /** BG-23 VAT breakdown, one group per category and rate, in order of first use. */
  vatBreakdown: EInvoiceVatBreakdown[]
  /** BT-106 Sum of invoice line net amounts. */
  lineTotal: string
  /** BT-107 Sum of document level allowances. */
  allowanceTotal: string
  /** BT-108 Sum of document level charges. */
  chargeTotal: string
  /** BT-109 Invoice total amount without VAT. */
  taxBasisTotal: string
  /** BT-110 Invoice total VAT amount. */
  taxTotal: string
  /** BT-112 Invoice total amount with VAT. */
  grandTotal: string
  /** BT-113 Paid amount. */
  prepaidAmount: string
  /** BT-114 Rounding amount. */
  roundingAmount: string
  /** BT-115 Amount due for payment. */
  duePayable: string
}

export interface EInvoiceLineTotals {
  /** BT-131 Invoice line net amount. */
  netAmount: string
}

/** BG-23 VAT breakdown group. */
export interface EInvoiceVatBreakdown {
  /** BT-118 VAT category. */
  category: EInvoiceVatCategory
  /** BT-119 VAT rate in percent, shortest form (`'19'`, `'5.5'`); `'0'` for Z, E, AE, K, G; absent for O. */
  rate?: string
  /** BT-116 VAT category taxable amount. */
  taxableAmount: string
  /** BT-117 VAT category tax amount. */
  taxAmount: string
  /** BT-120 VAT exemption reason text, from the first line or allowance of the group that has one. */
  exemptionReason?: string
}
