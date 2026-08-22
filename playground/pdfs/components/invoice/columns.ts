/**
 * One source of truth for the invoice table geometry. The header row in
 * `invoice.vue` and the body rows in `InvoiceLine.vue` both read from here, so
 * a column change can never drift between them.
 */
export const INVOICE_COLUMNS = {
  amount: { align: 'right', width: 86 },
  description: { align: 'left', width: 246 },
  quantity: { align: 'right', width: 52 },
  rate: { align: 'right', width: 78 },
  sequence: { align: 'left', width: 28 },
} as const
