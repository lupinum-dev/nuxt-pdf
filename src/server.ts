/** Node-only production runtime. No source compiler or Nuxt virtual imports. */
export { createPdfRegistry, createPdfTemplate } from './runtime/server/registry'
export { NuxtPdfError, PDF_ERROR_CODES } from './runtime/shared/errors'
export type { PdfErrorCode, PdfInvoiceIssue, PdfSourcePosition } from './runtime/shared/errors'
export { computeEInvoice, renderEInvoiceXml, validateEInvoice } from './runtime/einvoice'
export type {
  DecimalInput,
  EInvoice,
  EInvoiceAddress,
  EInvoiceBuyer,
  EInvoiceContact,
  EInvoiceDelivery,
  EInvoiceDocumentAllowanceCharge,
  EInvoiceDocumentType,
  EInvoiceElectronicAddress,
  EInvoiceIssue,
  EInvoiceLine,
  EInvoiceLineAllowanceCharge,
  EInvoiceLineTotals,
  EInvoicePayment,
  EInvoicePaymentMeans,
  EInvoicePeriod,
  EInvoicePrecedingInvoice,
  EInvoiceProfile,
  EInvoiceSeller,
  EInvoiceTotals,
  EInvoiceUnit,
  EInvoiceUnitName,
  EInvoiceVat,
  EInvoiceVatBreakdown,
  EInvoiceVatCategory,
  RenderEInvoiceXmlOptions,
  ValidateEInvoiceOptions,
} from './runtime/einvoice'
export type { PdfRegistry, PdfRegistryEntries } from './runtime/server/registry'
export type {
  PdfComponentProps,
  PdfDefinition,
  PdfLayoutWarning,
  PdfRenderResult,
  PdfTemplate,
} from './runtime/shared/template'
