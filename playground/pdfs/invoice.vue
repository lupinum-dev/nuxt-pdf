<script setup lang="ts">
import type { Invoice } from '../shared/invoice'
import {
  compactInvoice,
  formatInvoiceMoney,
  sampleInvoice,
} from '../shared/invoice'
import { toEInvoice } from './components/invoice/e-invoice'
import InvoiceLine from './components/invoice/InvoiceLine.vue'
import InvoicePage from './components/invoice/InvoicePage.vue'
import InvoiceSection from './components/invoice/InvoiceSection.vue'

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

// #, description (takes the free width), quantity, rate, amount.
const lineColumns = ['28pt', 1, '52pt', '78pt', '86pt'] as const

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
  >
    <!-- Makes the PDF a Factur-X hybrid invoice, and so PDF/A-3b: every text
         uses the registered "Fieldnote Sans" through the .page class. -->
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
          <PdfText class="invoice-label">
            INVOICE
          </PdfText>
          <PdfText class="invoice-number">
            {{ invoice.number }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView class="summary">
        <PdfView class="customer">
          <PdfText class="customer-label">
            PREPARED FOR
          </PdfText>
          <PdfText class="customer-name">
            {{ invoice.customer.name }}
          </PdfText>
        </PdfView>
        <PdfView class="amount-due">
          <PdfText class="meta-label">
            Total due
          </PdfText>
          <PdfText class="amount-due-value">
            {{ money(totals.grandTotal) }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        class="meta"
        :wrap="false"
      >
        <PdfView class="meta-cell">
          <PdfText class="meta-label">
            Issued
          </PdfText>
          <PdfText class="meta-value">
            {{ invoice.issueDate }}
          </PdfText>
        </PdfView>
        <PdfView class="meta-cell">
          <PdfText class="meta-label">
            Due
          </PdfText>
          <PdfText class="meta-value">
            {{ invoice.dueDate }}
          </PdfText>
        </PdfView>
        <PdfView class="meta-cell">
          <PdfText class="meta-label">
            Purchase order
          </PdfText>
          <PdfText class="meta-value">
            {{ invoice.purchaseOrder }}
          </PdfText>
        </PdfView>
        <PdfView>
          <PdfText class="meta-label">
            Currency
          </PdfText>
          <PdfText class="meta-value">
            {{ invoice.currency }}
          </PdfText>
        </PdfView>
      </PdfView>

      <InvoiceSection
        label="Services"
        title="Engagement summary"
      >
        <PdfTable :columns="lineColumns">
          <!-- Repeats at the top of every page the table reaches. -->
          <PdfTableHeader class="line-header">
            <PdfTableCell>#</PdfTableCell>
            <PdfTableCell>Description</PdfTableCell>
            <PdfTableCell align="right">
              Qty
            </PdfTableCell>
            <PdfTableCell align="right">
              Rate
            </PdfTableCell>
            <PdfTableCell align="right">
              Amount
            </PdfTableCell>
          </PdfTableHeader>
          <InvoiceLine
            v-for="(line, index) in invoice.lines"
            :key="line.id"
            :currency="invoice.currency"
            :index="index"
            :line="line"
          />
        </PdfTable>
      </InvoiceSection>

      <PdfView
        :min-presence-ahead="108"
        class="totals"
        :wrap="false"
      >
        <PdfView class="totals-box">
          <PdfView class="total-row">
            <PdfText class="total-label">
              Subtotal
            </PdfText>
            <PdfText>{{ money(totals.taxBasisTotal) }}</PdfText>
          </PdfView>
          <PdfView class="total-row">
            <PdfText class="total-label">
              VAT {{ invoice.taxRate * 100 }}%
            </PdfText>
            <PdfText>{{ money(totals.taxTotal) }}</PdfText>
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
        class="payment-note"
        :wrap="false"
      >
        <PdfText class="payment-note-label">
          Payment note
        </PdfText>
        <PdfText class="meta-value">
          {{ invoice.paymentNote }}
        </PdfText>
      </PdfView>
    </InvoicePage>

    <InvoicePage
      v-if="invoice.includeBrief"
      head-pages="all"
      :invoice-number="invoice.number"
      footer-href="https://nuxt.com"
      footer-label="Generated with Nuxt PDF"
      class="page"
    >
      <PdfText class="brief-label">
        PROJECT CONTEXT
      </PdfText>
      <PdfText class="brief-title">
        {{ invoice.projectBrief.title }}
      </PdfText>
      <PdfText class="brief-summary">
        {{ invoice.projectBrief.summary }}
      </PdfText>

      <PdfImage
        src="alpine.png"
        class="brief-image"
      />

      <InvoiceSection
        label="Scope"
        title="Included deliverables"
      >
        <PdfView
          v-for="(deliverable, index) in invoice.projectBrief.deliverables"
          :key="deliverable"
          class="deliverable"
          :wrap="false"
        >
          <PdfText class="deliverable-number">
            {{ String(index + 1).padStart(2, '0') }}
          </PdfText>
          <PdfText class="deliverable-name">
            {{ deliverable }}
          </PdfText>
        </PdfView>
      </InvoiceSection>

      <PdfView
        class="parties"
        :wrap="false"
      >
        <PdfView class="party party-from">
          <PdfText class="party-label">
            From
          </PdfText>
          <PdfText class="party-name">
            {{ invoice.from.name }}
          </PdfText>
          <PdfText
            v-for="line in invoice.from.address"
            :key="line"
            class="party-address"
          >
            {{ line }}
          </PdfText>
        </PdfView>
        <PdfView class="party">
          <PdfText class="party-label">
            Bill to
          </PdfText>
          <PdfText class="party-name">
            {{ invoice.customer.name }}
          </PdfText>
          <PdfText
            v-for="line in invoice.customer.address"
            :key="line"
            class="party-address"
          >
            {{ line }}
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- A printed line, not a PdfNote: PDF/A does not allow the engine's notes. -->
      <PdfText class="context-note">
        Project context supplied with invoice {{ invoice.number }}.
      </PdfText>
    </InvoicePage>
  </PdfDocument>
</template>

<style>
:root {
  --ink-soft: #6A756D;
  --muted: #758078;
  --accent: #47734F;
  --page-margin: 48pt;
}
.page {
  padding: 44pt var(--page-margin) 54pt;
  font-family: "Fieldnote Sans";
  font-size: 9pt;
  color: #18251D;
  background-color: #FFFFFF;
}

.masthead {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-start;
}

.brand {
  flex-direction: row;
}

.brand-image {
  width: 70pt;
  height: 46pt;
  object-fit: cover;
}

.brand-text {
  margin-left: 13pt;
}

.brand-name {
  margin-bottom: 5pt;
  font-size: 13pt;
}

.brand-tagline {
  font-size: 7.5pt;
  color: var(--ink-soft);
}

.invoice-id {
  align-items: flex-end;
}

.invoice-label {
  font-size: 7pt;
  letter-spacing: 1.3pt;
  color: var(--accent);
}

.invoice-number {
  margin-top: 5pt;
  font-size: 10pt;
}

.summary {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 42pt;
}

.customer {
  width: 305pt;
}

.customer-label {
  margin-bottom: 9pt;
  font-size: 7pt;
  letter-spacing: 1.2pt;
  color: var(--accent);
}

.customer-name {
  font-size: 25pt;
  line-height: 1.08;
}

.amount-due {
  width: 150pt;
}

/* Small grey caption above a value: the amount due and the meta strip. */
.meta-label {
  margin-bottom: 4pt;
  font-size: 7pt;
  color: var(--muted);
}

.amount-due-value {
  font-size: 18pt;
}

.meta {
  flex-direction: row;
  margin-top: 32pt;
  padding: 14pt 16pt;
  background-color: #F1F4F1;
}

.meta-cell {
  width: 124pt;
}

.meta-value {
  font-size: 8.5pt;
}

.line-header {
  padding-bottom: 8pt;
  border-bottom-width: 1pt;
  border-bottom-color: #9EA8A1;
  font-size: 7pt;
  color: var(--muted);
}

.totals {
  align-items: flex-end;
  margin-top: 20pt;
}

.totals-box {
  width: 220pt;
}

.total-row {
  flex-direction: row;
  justify-content: space-between;
  padding-vertical: 5pt;
}

.total-label {
  color: var(--ink-soft);
}

.grand-total {
  flex-direction: row;
  justify-content: space-between;
  margin-top: 6pt;
  padding-top: 10pt;
  border-top-width: 1.5pt;
  border-top-color: #315D3B;
}

.grand-total-label {
  font-size: 10pt;
}

.grand-total-value {
  font-size: 12pt;
}

.payment-note {
  margin-top: 28pt;
  padding-left: 12pt;
  border-left-width: 3pt;
  border-left-color: #DABF5B;
}

.payment-note-label {
  margin-bottom: 4pt;
  font-size: 7pt;
  color: var(--ink-soft);
}

.brief-label {
  font-size: 7pt;
  letter-spacing: 1.2pt;
  color: var(--accent);
}

.brief-title {
  margin-top: 10pt;
  width: 360pt;
  font-size: 27pt;
  line-height: 1.08;
}

.brief-summary {
  margin-top: 16pt;
  width: 420pt;
  font-size: 10pt;
  line-height: 1.55;
  color: var(--ink-soft);
}

.brief-image {
  margin-top: 28pt;
  width: 100%;
  height: 190pt;
  object-fit: cover;
}

.deliverable {
  flex-direction: row;
  padding-vertical: 13pt;
  border-top-width: 1pt;
  border-top-color: #DDE3DE;
}

.deliverable-number {
  width: 34pt;
  font-size: 8pt;
  color: var(--accent);
}

.deliverable-name {
  font-size: 9.5pt;
}

.parties {
  flex-direction: row;
  margin-top: 30pt;
  padding: 18pt;
  background-color: #F1F4F1;
}

.party {
  width: 50%;
}

.party-from {
  padding-right: 24pt;
}

.party-label {
  margin-bottom: 6pt;
  font-size: 7pt;
  color: var(--muted);
}

.party-name {
  margin-bottom: 4pt;
  font-size: 9pt;
}

.party-address {
  font-size: 7.5pt;
  color: var(--ink-soft);
}

.context-note {
  margin-top: 12pt;
  font-size: 7.5pt;
  color: var(--muted);
}
</style>
