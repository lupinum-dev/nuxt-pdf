export interface LupinumInvoiceParty {
  name: string
  address: string
  postalCity: string
  vatId?: string
}

export interface LupinumInvoiceCompany extends LupinumInvoiceParty {
  contact: {
    website: string
    websiteUrl: string
    email: string
    phone: string
  }
}

export type LupinumInvoiceLinePricing
  = | { kind: 'fixed', amount: number, detail?: string }
    | { kind: 'hourly', hours: number, hourlyRate: number }
    | { kind: 'quantity', quantity: number, unitPrice: number, unitLabel?: string }

export type LupinumInvoiceLine = {
  id: string
  title: string
  description?: string
  servicePeriod?: { from: string, to: string }
} & LupinumInvoiceLinePricing

export type LupinumInvoiceDiscount
  = | { kind: 'fixed', amount: number, label?: string }
    | { kind: 'percentage', percentage: number, label?: string }

export interface LupinumInvoicePayment {
  accountHolder: string
  iban: string
  bic: string
}

export interface LupinumInvoiceCopy {
  documentLabel: string
  customerLabel: string
  detailsLabel: string
  invoiceNumberLabel: string
  invoiceDateLabel: string
  dueDateLabel: string
  servicesLabel: string
  subtotalLabel: string
  netLabel: string
  vatLabel: string
  totalLabel: string
  paymentLeadBeforeDays: string
  paymentLeadAfterDays: string
  accountHolderLabel: string
  ibanLabel: string
  bicLabel: string
  referenceLabel: string
  thankYou: string
  greeting: string
  signature: string
  qrCaption: readonly string[]
  continuationLabel: string
}

export interface LupinumInvoice {
  number: string
  issueDate: string
  dueDate?: string
  dueDays: number
  currency: 'EUR'
  locale: string
  company: LupinumInvoiceCompany
  customer: LupinumInvoiceParty
  intro: string
  lines: readonly LupinumInvoiceLine[]
  discount?: LupinumInvoiceDiscount
  vatRate: number
  payment: LupinumInvoicePayment
  copy?: Partial<LupinumInvoiceCopy>
}

export interface LupinumInvoiceTotals {
  subtotal: number
  discount: number
  net: number
  vat: number
  total: number
}

export const defaultLupinumInvoiceCopy: LupinumInvoiceCopy = {
  documentLabel: 'Rechnung',
  customerLabel: 'Kunde',
  detailsLabel: 'Rechnungsdetails',
  invoiceNumberLabel: 'Rechnungsnummer:',
  invoiceDateLabel: 'Rechnungsdatum:',
  dueDateLabel: 'Zahlbar bis:',
  servicesLabel: 'Leistungen',
  subtotalLabel: 'Zwischensumme',
  netLabel: 'Nettobetrag',
  vatLabel: 'USt',
  totalLabel: 'Rechnungsbetrag',
  paymentLeadBeforeDays: 'Wir bitten höflichst, den ausstehenden Betrag binnen',
  paymentLeadAfterDays: 'auf folgendes Konto zu überweisen:',
  accountHolderLabel: 'Kontoinhaber:',
  ibanLabel: 'IBAN:',
  bicLabel: 'BIC:',
  referenceLabel: 'Verwendungszweck:',
  thankYou: 'Vielen Dank für dein Vertrauen und die gute Zusammenarbeit.',
  greeting: 'Mit freundlichen Grüßen',
  signature: 'Romi & Matthias',
  qrCaption: ['Schnelle Überweisung', 'in deiner Bankapp', 'mit QR-Code'],
  continuationLabel: 'Leistungen · Fortsetzung',
}

export const resolveLupinumInvoiceCopy = (
  invoice: LupinumInvoice,
): LupinumInvoiceCopy => ({
  ...defaultLupinumInvoiceCopy,
  ...invoice.copy,
})

export const lupinumInvoiceLineTotal = (line: LupinumInvoiceLine): number => {
  if (line.kind === 'hourly') return line.hours * line.hourlyRate
  if (line.kind === 'quantity') return line.quantity * line.unitPrice
  return line.amount
}

export const lupinumInvoiceTotals = (
  invoice: LupinumInvoice,
): LupinumInvoiceTotals => {
  const subtotal = invoice.lines.reduce(
    (sum, line) => sum + lupinumInvoiceLineTotal(line),
    0,
  )
  const discount = invoice.discount?.kind === 'percentage'
    ? subtotal * invoice.discount.percentage / 100
    : invoice.discount?.amount ?? 0
  const net = subtotal - discount
  const vat = net * invoice.vatRate

  return { subtotal, discount, net, vat, total: net + vat }
}

const splitDecimal = (value: number, locale: string): [string, string] => {
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    useGrouping: false,
  }).format(Math.abs(value))
  const separator = formatted.includes(',') ? ',' : '.'
  const [integer = '0', decimal = '00'] = formatted.split(separator)
  return [integer, decimal]
}

export const formatLupinumMoney = (
  value: number,
  locale: string,
  options: { sign?: boolean } = {},
): string => {
  const [integer, decimal] = splitDecimal(value, locale)
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')
  const prefix = options.sign ? (value < 0 ? '- ' : '+ ') : (value < 0 ? '- ' : '')
  return `${prefix}${grouped},${decimal}\u00A0€`
}

export const formatLupinumQuantity = (
  value: number,
  locale: string,
): string => new Intl.NumberFormat(locale, {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  useGrouping: false,
}).format(value)

export const formatLupinumDate = (
  value: string,
  locale: string,
): string => {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) throw new TypeError(`Invalid invoice date "${value}".`)
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date)
}

export const lupinumInvoiceDueDate = (invoice: LupinumInvoice): string => {
  if (invoice.dueDate) return invoice.dueDate
  const date = new Date(invoice.issueDate)
  if (Number.isNaN(date.valueOf())) {
    throw new TypeError(`Invalid invoice date "${invoice.issueDate}".`)
  }
  date.setUTCDate(date.getUTCDate() + invoice.dueDays)
  return date.toISOString().slice(0, 10)
}

export const lupinumInvoiceLineDetail = (
  line: LupinumInvoiceLine,
  locale: string,
): string | undefined => {
  if (line.description) return line.description
  if (line.kind === 'hourly') {
    return `${formatLupinumQuantity(line.hours, locale)} Stunden × ${formatLupinumMoney(line.hourlyRate, locale).replace(/\u00A0€$/, '')} €/h`
  }
  if (line.kind === 'quantity') {
    const label = line.unitLabel ?? 'Stück'
    return `${formatLupinumQuantity(line.quantity, locale)} ${label} × ${formatLupinumMoney(line.unitPrice, locale).replace(/\u00A0€$/, '')} €`
  }
  return line.detail
}

export const buildEpcQrPayload = (
  invoice: LupinumInvoice,
  total: number,
): string => [
  'BCD',
  '002',
  '1',
  'SCT',
  invoice.payment.bic,
  invoice.payment.accountHolder,
  invoice.payment.iban.replaceAll(' ', ''),
  `EUR${total.toFixed(2)}`,
  '',
  '',
  invoice.number,
  '',
].join('\n')

export const sampleLupinumInvoice: LupinumInvoice = {
  number: 'RE-260527-1',
  issueDate: '2026-05-27',
  dueDays: 14,
  currency: 'EUR',
  locale: 'de-AT',
  company: {
    name: 'Lupinum OG',
    address: 'Innerzaun 26/1',
    postalCity: '3321 Kollmitzberg',
    vatId: 'ATU80979201',
    contact: {
      website: 'www.lupinum.com',
      websiteUrl: 'https://www.lupinum.com',
      email: 'info@lupinum.com',
      phone: '+43 681 20303240',
    },
  },
  customer: {
    name: 'Glaspro GmbH',
    address: 'Randegg 46',
    postalCity: 'A-3263 Randegg',
    vatId: 'ATU78413012',
  },
  intro: 'Für unsere Tätigkeiten im Rahmen des Freebie-Pakets stellen wir folgenden Betrag in Rechnung:',
  lines: [
    {
      id: '1',
      kind: 'hourly',
      title: 'Videoproduktion und Schnitt',
      hours: 29,
      hourlyRate: 55,
    },
    {
      id: '2',
      kind: 'hourly',
      title: 'Entwicklung und Design PDF & Rechner',
      hours: 23,
      hourlyRate: 55,
    },
  ],
  vatRate: 0.2,
  payment: {
    accountHolder: 'Amon Matthias und Netzberger Romana',
    iban: 'AT47 3202 5002 0103 5104',
    bic: 'RLNWATWWAMS',
  },
}

export const longLupinumInvoice: LupinumInvoice = {
  ...sampleLupinumInvoice,
  number: 'RE-260527-LONG',
  customer: {
    ...sampleLupinumInvoice.customer,
    name: 'Glaspro GmbH · Langformat',
  },
  lines: Array.from({ length: 18 }, (_, index): LupinumInvoiceLine => ({
    id: String(index + 1),
    kind: 'hourly',
    title: index % 2 === 0
      ? 'Videoproduktion, Abstimmung und Schnitt'
      : 'Entwicklung und Design PDF & Rechner',
    hours: 2 + index,
    hourlyRate: 55,
  })),
}
