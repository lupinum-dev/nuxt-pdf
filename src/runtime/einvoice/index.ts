export { computeEInvoice } from './compute'
export { renderEInvoiceXml, type RenderEInvoiceXmlOptions } from './cii'
export type { DecimalInput } from './decimal'
export { validateEInvoice, type ValidateEInvoiceOptions } from './validate'
// Named, not `export type *`: the declaration build adds the `.js` extension
// only to named re-exports, and strict ESM resolution (node16) needs it.
export type {
  EInvoice,
  EInvoiceDocumentType,
  EInvoicePrecedingInvoice,
  EInvoiceAddress,
  EInvoiceContact,
  EInvoiceElectronicAddress,
  EInvoiceSeller,
  EInvoiceBuyer,
  EInvoiceDelivery,
  EInvoicePeriod,
  EInvoicePayment,
  EInvoicePaymentMeans,
  EInvoiceVat,
  EInvoiceVatCategory,
  EInvoiceDocumentAllowanceCharge,
  EInvoiceLineAllowanceCharge,
  EInvoiceUnit,
  EInvoiceUnitName,
  EInvoiceLine,
  EInvoiceProfile,
  EInvoiceIssue,
  EInvoiceTotals,
  EInvoiceLineTotals,
  EInvoiceVatBreakdown,
} from './types'
