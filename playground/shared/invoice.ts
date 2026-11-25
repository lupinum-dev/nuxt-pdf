export interface InvoiceParty {
  name: string
  address: readonly string[]
  email: string
}

export interface InvoiceLineItem {
  id: string
  description: string
  detail: string
  quantity: number
  unitPrice: number
}

export interface InvoiceProjectBrief {
  title: string
  summary: string
  deliverables: readonly string[]
}

export interface Invoice {
  number: string
  issueDate: string
  dueDate: string
  currency: string
  purchaseOrder: string
  from: InvoiceParty
  customer: InvoiceParty
  lines: readonly InvoiceLineItem[]
  taxRate: number
  paymentNote: string
  includeBrief: boolean
  projectBrief: InvoiceProjectBrief
}

const baseInvoice: Omit<Invoice, 'includeBrief'> = {
  number: 'FN-1042',
  issueDate: '20 July 2026',
  dueDate: '19 August 2026',
  currency: 'EUR',
  purchaseOrder: 'PO-4821',
  from: {
    name: 'Fieldnote Studio GmbH',
    address: ['Wiedner Hauptstraße 52', '1040 Vienna, Austria'],
    email: 'accounts@fieldnote.studio',
  },
  customer: {
    name: 'Northstar Alpine AG',
    address: ['Seefeldstrasse 122', '8008 Zürich, Switzerland'],
    email: 'finance@northstar.example',
  },
  lines: [
    {
      id: 'discovery',
      description: 'Field research and discovery',
      detail: 'Stakeholder interviews, evidence review, and synthesis',
      quantity: 3,
      unitPrice: 950,
    },
    {
      id: 'system',
      description: 'Reporting system design',
      detail: 'Information architecture and reusable document patterns',
      quantity: 5,
      unitPrice: 1100,
    },
    {
      id: 'prototype',
      description: 'Interactive report prototype',
      detail: 'High-fidelity prototype with two review rounds',
      quantity: 1,
      unitPrice: 3200,
    },
    {
      id: 'handoff',
      description: 'Engineering handoff',
      detail: 'Production specifications and implementation review',
      quantity: 2,
      unitPrice: 850,
    },
  ],
  taxRate: 0.2,
  paymentNote: 'Please include invoice FN-1042 with your bank transfer.',
  projectBrief: {
    title: 'Alpine impact report · 2026',
    summary: 'A clear, evidence-led annual report for stakeholders working across conservation, tourism, and mountain infrastructure.',
    deliverables: [
      'Research synthesis and narrative structure',
      'Reusable report system for print and digital delivery',
      'Production-ready specifications and implementation review',
    ],
  },
}

export const sampleInvoice: Invoice = {
  ...baseInvoice,
  includeBrief: true,
}

export const compactInvoice: Invoice = {
  ...baseInvoice,
  number: 'FN-1042-C',
  includeBrief: false,
}

export const invoiceSubtotal = (invoice: Invoice): number =>
  invoice.lines.reduce(
    (total, line) => total + line.quantity * line.unitPrice,
    0,
  )

export const invoiceTotal = (invoice: Invoice): number => {
  const subtotal = invoiceSubtotal(invoice)
  return subtotal + subtotal * invoice.taxRate
}

export const formatInvoiceMoney = (
  value: number,
  currency: string,
): string => new Intl.NumberFormat('en-GB', {
  currency,
  currencyDisplay: 'symbol',
  minimumFractionDigits: 2,
  style: 'currency',
}).format(value)
