<script setup lang="ts">
import type { PdfTableColumn } from '@lupinum/nuxt-pdf'
import type { Invoice } from '../shared/invoice'
import {
  compactInvoice,
  formatInvoiceMoney,
  sampleInvoice,
} from '../shared/invoice'
import { toEInvoice } from './components/invoice/e-invoice'
import InvoiceBrief from './components/invoice/InvoiceBrief.vue'
import InvoiceLine from './components/invoice/InvoiceLine.vue'
import InvoicePage from './components/invoice/InvoicePage.vue'
import InvoiceSection from './components/invoice/InvoiceSection.vue'
import { theme } from './components/theme'

defineOptions({ name: 'FieldnoteInvoicePdf' })

type InvoiceProps = {
  invoice: Invoice
}

const props = defineProps<InvoiceProps>()
const invoice = props.invoice
// The machine-readable copy of this invoice (Factur-X, profile EN 16931).
// computeEInvoice (auto-imported) gives the totals the server writes into
// its XML, so the page prints exactly those.
const eInvoice = toEInvoice(invoice)
const totals = computeEInvoice(eInvoice)
const money = (value: string) => formatInvoiceMoney(Number(value), invoice.currency)
// Drop floating-point noise (0.085 * 100 = 8.500000000000002) but keep rates such as 8.25%.
const taxPercent = `${Number((invoice.taxRate * 100).toFixed(4))}%`

// #, description (takes the free width), quantity, rate, amount. The three
// figures are right-aligned, in the header and in every line.
const lineColumns: PdfTableColumn[] = [
  '26pt',
  1,
  { width: '44pt', align: 'right' },
  { width: '74pt', align: 'right' },
  { width: '80pt', align: 'right' },
]

// The meta strip and the two address blocks, each a label and its value.
const meta = [
  ['Issued', invoice.issueDate],
  ['Due', invoice.dueDate],
  ['Purchase order', invoice.purchaseOrder],
  ['Currency', invoice.currency],
] as const
const parties = [['From', invoice.from], ['Bill to', invoice.customer]] as const

definePdf<InvoiceProps>({
  title: ({ invoice }) => `Invoice ${invoice.number}`,
  filename: ({ invoice }) => `fieldnote-invoice-${invoice.number}.pdf`,
  language: 'en-GB',
  sampleData: { invoice: sampleInvoice },
  scenarios: {
    compact: { invoice: compactInvoice },
    twoPage: { invoice: sampleInvoice },
  },
})
</script>

<template>
  <PdfDocument
    author="Fieldnote Studio GmbH"
    creator="Nuxt PDF"
    subject="Consulting services invoice"
    conformance="PDF/A-3b"
  >
    <!-- Makes the PDF a Factur-X hybrid invoice. A Factur-X invoice is
         PDF/A-3b, so every text uses a registered font: Inter, set on the
         .page class. -->
    <PdfFacturX
      :invoice="eInvoice"
      profile="EN 16931"
    />

    <InvoicePage
      head-pages="continuation"
      :invoice-number="invoice.number"
      :footer-href="`mailto:${invoice.from.email}`"
      :footer-label="invoice.from.email"
      class="page"
    >
      <PdfView class="masthead">
        <PdfView class="brand">
          <PdfImage
            src="alpine.png"
            class="brand-image"
          />
          <PdfView class="brand-text">
            <PdfText class="brand-name">
              Fieldnote Studio
            </PdfText>
            <PdfText class="brand-tagline">
              Research · systems · reports
            </PdfText>
          </PdfView>
        </PdfView>
        <PdfView class="invoice-id">
          <PdfView class="badge">
            <PdfText class="badge-text">
              Invoice
            </PdfText>
          </PdfView>
          <PdfText class="invoice-number">
            {{ invoice.number }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView class="summary">
        <PdfView class="customer">
          <PdfText class="label">
            Prepared for
          </PdfText>
          <PdfText class="customer-name">
            {{ invoice.customer.name }}
          </PdfText>
        </PdfView>
        <PdfView class="amount-due tabular">
          <PdfText class="label">
            Total due
          </PdfText>
          <PdfText class="amount-due-value">
            {{ money(totals.grandTotal) }}
          </PdfText>
          <PdfView class="badge badge-accent due-badge">
            <PdfText class="badge-text">
              Due {{ invoice.dueDate }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfView
        class="meta"
        :wrap="false"
      >
        <PdfView
          v-for="([label, value], index) in meta"
          :key="label"
          :class="['meta-cell', { 'meta-cell-divided': index > 0 }]"
        >
          <PdfText class="label">
            {{ label }}
          </PdfText>
          <PdfText class="meta-value">
            {{ value }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        class="parties"
        :wrap="false"
      >
        <PdfView
          v-for="[label, party] in parties"
          :key="label"
          class="party"
        >
          <PdfText class="label">
            {{ label }}
          </PdfText>
          <PdfText class="party-name">
            {{ party.name }}
          </PdfText>
          <PdfText
            v-for="line in [...party.address, party.email]"
            :key="line"
            class="party-line"
          >
            {{ line }}
          </PdfText>
        </PdfView>
      </PdfView>

      <InvoiceSection
        label="Services"
        title="Engagement summary"
      >
        <!-- The card around the table: a rounded border, as a shadcn Table. -->
        <PdfView class="card table-card tabular">
          <PdfTable :columns="lineColumns">
            <!-- Repeats at the top of every page the table reaches. -->
            <PdfTableHeader class="line-header">
              <PdfTableCell>#</PdfTableCell>
              <PdfTableCell>Description</PdfTableCell>
              <PdfTableCell>Qty</PdfTableCell>
              <PdfTableCell>Rate</PdfTableCell>
              <PdfTableCell>Amount</PdfTableCell>
            </PdfTableHeader>
            <InvoiceLine
              v-for="(line, index) in invoice.lines"
              :key="line.id"
              :currency="invoice.currency"
              :index="index"
              :line="line"
            />
          </PdfTable>
        </PdfView>
      </InvoiceSection>

      <PdfView
        :min-presence-ahead="108"
        class="totals tabular"
        :wrap="false"
      >
        <PdfView class="totals-box">
          <PdfView class="total-row">
            <PdfText class="total-label">
              Subtotal
            </PdfText>
            <PdfText class="total-value">
              {{ money(totals.taxBasisTotal) }}
            </PdfText>
          </PdfView>
          <PdfView class="total-row">
            <PdfText class="total-label">
              VAT {{ taxPercent }}
            </PdfText>
            <PdfText class="total-value">
              {{ money(totals.taxTotal) }}
            </PdfText>
          </PdfView>
          <PdfView class="grand-total">
            <PdfText class="grand-total-label">
              Total due
            </PdfText>
            <PdfText class="grand-total-value">
              {{ money(totals.grandTotal) }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfView
        class="card payment-note"
        :wrap="false"
      >
        <PdfText class="payment-note-title">
          Payment note
        </PdfText>
        <PdfText class="payment-note-text">
          {{ invoice.paymentNote }}
        </PdfText>
      </PdfView>
    </InvoicePage>

    <InvoicePage
      v-if="invoice.includeBrief"
      head-pages="all"
      :invoice-number="invoice.number"
      footer-href="https://nuxt-pdf.lupinum.com"
      footer-label="Generated with Nuxt PDF"
      class="page"
    >
      <InvoiceBrief
        :brief="invoice.projectBrief"
        :invoice-number="invoice.number"
      />
    </InvoicePage>
  </PdfDocument>
</template>

<style>
@import './components/theme.css';

/* The shared colours and radii (components/theme.ts). */
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
  --border: v-bind('theme.border');
  --muted: v-bind('theme.muted');
  --subtle: v-bind('theme.subtle');
  --accent: v-bind('theme.accent');
  --accent-soft: v-bind('theme.accentSoft');
  --accent-border: v-bind('theme.accentBorder');
  --radius: v-bind('theme.radius');
  --radius-small: v-bind('theme.radiusSmall');
  --page-margin: 48pt;
}
.page {
  hyphens: auto;
  padding: 44pt var(--page-margin) 56pt;
  font-family: "Inter";
  font-size: 9pt;
  color: var(--foreground);
  background-color: #FFFFFF;
}

.masthead {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.brand {
  flex-direction: row;
  align-items: center;
}

.brand-image {
  width: 36pt;
  height: 36pt;
  border-radius: 8pt;
  object-fit: cover;
}

.brand-text {
  margin-left: 10pt;
}

.brand-name {
  margin-bottom: 2pt;
  font-size: 11pt;
  font-weight: 600;
  letter-spacing: -0.2pt;
}

.brand-tagline {
  font-size: 7.5pt;
  color: var(--muted-foreground);
}

.invoice-id {
  align-items: flex-end;
}

.invoice-id .badge {
  align-self: flex-end;
}

.invoice-number {
  margin-top: 5pt;
  font-size: 12pt;
  font-weight: 600;
  letter-spacing: -0.2pt;
}

.summary {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 34pt;
}

.customer {
  width: 300pt;
}

.customer-name {
  hyphens: manual;
  margin-top: 2pt;
  font-size: 24pt;
  font-weight: 600;
  letter-spacing: -0.7pt;
  line-height: 1.15;
}

.amount-due {
  align-items: flex-end;
}

.amount-due-value {
  font-size: 24pt;
  font-weight: 600;
  letter-spacing: -0.7pt;
}

/* The one accent on the page: a soft pill for the due date. */
.due-badge {
  align-self: flex-end;
  margin-top: 6pt;
}

.meta {
  flex-direction: row;
  margin-top: 26pt;
  padding: 12pt 0;
  border: 1pt solid var(--border);
  border-radius: var(--radius);
}

.meta-cell {
  width: 25%;
  padding: 0 14pt;
}

.meta-cell-divided {
  border-left: 1pt solid var(--border);
}

.meta-value {
  font-size: 9pt;
  font-weight: 500;
}

.parties {
  flex-direction: row;
  margin-top: 22pt;
  padding: 0 14pt;
}

.party {
  width: 50%;
  padding-right: 24pt;
}

.party-name {
  margin-bottom: 3pt;
  font-size: 9pt;
  font-weight: 600;
}

.party-line {
  font-size: 8pt;
  line-height: 1.5;
  color: var(--muted-foreground);
}

.table-card {
  padding: 0 14pt;
}

.line-header {
  padding-top: 9pt;
  padding-bottom: 9pt;
  font-size: 7.5pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

.totals {
  align-items: flex-end;
  margin-top: 12pt;
}

/* The totals in a muted rounded block. */
.totals-box {
  width: 236pt;
  padding: 6pt 14pt;
  border: 1pt solid var(--border);
  border-radius: var(--radius);
  background-color: var(--subtle);
}

.total-row {
  flex-direction: row;
  justify-content: space-between;
  padding: 4pt 0;
}

.total-label {
  color: var(--muted-foreground);
}

.total-value {
  font-weight: 500;
}

.grand-total {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 4pt;
  padding: 9pt 0 4pt;
  border-top: 1pt solid var(--border);
}

.grand-total-label {
  font-size: 9.5pt;
  font-weight: 600;
}

.grand-total-value {
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: -0.3pt;
}

/* A shadcn Alert: a bordered rounded box with a title and a description. */
.payment-note {
  margin-top: 22pt;
  padding: 11pt 14pt;
}

.payment-note-title {
  margin-bottom: 3pt;
  font-size: 8.5pt;
  font-weight: 600;
}

.payment-note-text {
  font-size: 8.5pt;
  color: var(--muted-foreground);
}
</style>
