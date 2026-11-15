<script setup lang="ts">
import type { PdfStyle } from '@lupinum/nuxt-pdf'
import type { Invoice } from '../shared/invoice'
import {
  compactInvoice,
  formatInvoiceMoney,
  invoiceSubtotal,
  invoiceTotal,
  sampleInvoice,
} from '../shared/invoice'
import InvoiceLine from './components/invoice/InvoiceLine.vue'
import InvoiceSection from './components/invoice/InvoiceSection.vue'
import { INVOICE_COLUMNS as columns } from './components/invoice/columns'

defineOptions({ name: 'FieldnoteInvoicePdf' })

type InvoiceProps = {
  invoice: Invoice
}

const props = defineProps<InvoiceProps>()
const invoice = props.invoice
const subtotal = invoiceSubtotal(invoice)
const tax = subtotal * invoice.taxRate
const total = invoiceTotal(invoice)
const money = (value: number) => formatInvoiceMoney(value, invoice.currency)
// Round to one decimal so 0.085 prints as 8.5, not 8.500000000000002.
const taxPercent = `${Math.round(invoice.taxRate * 1000) / 10}%`

const label = {
  color: '#6A756D',
  fontSize: 6.5,
  fontWeight: 600,
  letterSpacing: 0.9,
  marginBottom: 5,
  textTransform: 'uppercase',
} satisfies PdfStyle

const eyebrow = {
  color: '#3E6B48',
  fontSize: 7,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
} satisfies PdfStyle

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: '#18251D',
  fontFamily: 'Inter',
  fontSize: 9,
  paddingBottom: 54,
  paddingHorizontal: 48,
  paddingTop: 44,
} satisfies PdfStyle

const footerLinkStyle = {
  bottom: 24,
  color: '#758078',
  fontSize: 7,
  left: 48,
  position: 'absolute',
  textDecoration: 'none',
} satisfies PdfStyle

const footerPageStyle = {
  bottom: 24,
  color: '#758078',
  fontSize: 7,
  left: 48,
  position: 'absolute',
  right: 48,
  textAlign: 'right',
} satisfies PdfStyle

definePdf<InvoiceProps>({
  title: ({ invoice }) => `Invoice ${invoice.number}`,
  filename: ({ invoice }) => `fieldnote-invoice-${invoice.number}.pdf`,
  language: 'en-US',
  sampleData: { invoice: sampleInvoice },
  scenarios: {
    compact: { invoice: compactInvoice },
    twoPage: { invoice: sampleInvoice },
  },
})
</script>

<template>
  <PdfDocument
    author="Fieldnote Studio"
    creator="Nuxt PDF"
    subject="Consulting services invoice"
  >
    <PdfPage
      size="A4"
      :style="pageStyle"
    >
      <PdfView
        fixed
        :style="{ backgroundColor: '#264D31', height: 8, left: 0, position: 'absolute', right: 0, top: 0 }"
      />

      <PdfView :style="{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }">
        <PdfView :style="{ alignItems: 'center', flexDirection: 'row' }">
          <PdfImage
            src="alpine.png"
            :style="{ borderRadius: 4, height: 40, objectFit: 'cover', width: 40 }"
          />
          <PdfView :style="{ marginLeft: 11 }">
            <PdfText :style="{ fontSize: 12, fontWeight: 700, marginBottom: 3 }">
              Fieldnote Studio
            </PdfText>
            <PdfText :style="{ color: '#6A756D', fontSize: 7.5 }">
              Research · systems · reports
            </PdfText>
          </PdfView>
        </PdfView>
        <PdfView :style="{ alignItems: 'flex-end' }">
          <PdfText :style="eyebrow">
            Invoice
          </PdfText>
          <PdfText :style="{ fontSize: 13, fontWeight: 600, marginTop: 4 }">
            {{ invoice.number }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{ alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 }"
      >
        <PdfView :style="{ width: 330 }">
          <PdfText :style="{ ...eyebrow, marginBottom: 10 }">
            Prepared for
          </PdfText>
          <PdfText :style="{ fontFamily: 'Lora', fontSize: 26, fontWeight: 600, lineHeight: 1.1 }">
            {{ invoice.customer.name }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ alignItems: 'flex-end' }">
          <PdfText :style="label">
            Total due
          </PdfText>
          <PdfText :style="{ color: '#264D31', fontSize: 24, fontWeight: 700, letterSpacing: -0.4 }">
            {{ money(total) }}
          </PdfText>
          <PdfText :style="{ color: '#6A756D', fontSize: 7.5, marginTop: 4 }">
            Due {{ invoice.dueDate }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{ backgroundColor: '#F2F5F1', borderRadius: 4, flexDirection: 'row', marginTop: 28, paddingHorizontal: 16, paddingVertical: 13 }"
        :wrap="false"
      >
        <PdfView
          v-for="item in [
            ['Issued', invoice.issueDate],
            ['Due', invoice.dueDate],
            ['Purchase order', invoice.purchaseOrder],
            ['Currency', invoice.currency],
          ]"
          :key="item[0]"
          :style="{ width: '25%' }"
        >
          <PdfText :style="label">
            {{ item[0] }}
          </PdfText>
          <PdfText :style="{ fontSize: 9, fontWeight: 500 }">
            {{ item[1] }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{ flexDirection: 'row', marginTop: 22 }"
        :wrap="false"
      >
        <PdfView
          v-for="party in [
            { title: 'From', value: invoice.from },
            { title: 'Bill to', value: invoice.customer },
          ]"
          :key="party.title"
          :style="{ paddingRight: 24, width: '50%' }"
        >
          <PdfText :style="label">
            {{ party.title }}
          </PdfText>
          <PdfText :style="{ fontSize: 9, fontWeight: 600, marginBottom: 3 }">
            {{ party.value.name }}
          </PdfText>
          <PdfText
            v-for="line in party.value.address"
            :key="line"
            :style="{ color: '#566159', fontSize: 8, lineHeight: 1.45 }"
          >
            {{ line }}
          </PdfText>
          <PdfText :style="{ color: '#566159', fontSize: 8, lineHeight: 1.45 }">
            {{ party.value.email }}
          </PdfText>
        </PdfView>
      </PdfView>

      <InvoiceSection
        label="Services"
        title="Engagement summary"
      >
        <PdfView
          :style="{ borderBottomColor: '#18251D', borderBottomWidth: 1, flexDirection: 'row', paddingBottom: 7 }"
          :wrap="false"
        >
          <PdfText :style="{ ...label, marginBottom: 0, width: columns.sequence.width }">
            #
          </PdfText>
          <PdfText :style="{ ...label, marginBottom: 0, width: columns.description.width }">
            Description
          </PdfText>
          <PdfText :style="{ ...label, marginBottom: 0, textAlign: 'right', width: columns.quantity.width }">
            Qty
          </PdfText>
          <PdfText :style="{ ...label, marginBottom: 0, textAlign: 'right', width: columns.rate.width }">
            Rate
          </PdfText>
          <PdfText :style="{ ...label, marginBottom: 0, textAlign: 'right', width: columns.amount.width }">
            Amount
          </PdfText>
        </PdfView>
        <InvoiceLine
          v-for="(line, index) in invoice.lines"
          :key="line.id"
          :currency="invoice.currency"
          :index="index"
          :line="line"
        />
      </InvoiceSection>

      <PdfView
        :min-presence-ahead="108"
        :style="{ alignItems: 'flex-end', marginTop: 16 }"
        :wrap="false"
      >
        <PdfView :style="{ width: 230 }">
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 4 }">
            <PdfText :style="{ color: '#566159' }">
              Subtotal
            </PdfText>
            <PdfText :style="{ fontWeight: 500 }">
              {{ money(subtotal) }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 4 }">
            <PdfText :style="{ color: '#566159' }">
              Tax {{ taxPercent }}
            </PdfText>
            <PdfText :style="{ fontWeight: 500 }">
              {{ money(tax) }}
            </PdfText>
          </PdfView>
          <PdfView
            :style="{
              alignItems: 'center',
              backgroundColor: '#264D31',
              borderRadius: 4,
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }"
          >
            <PdfText :style="{ color: '#FFFFFF', fontSize: 9.5, fontWeight: 600 }">
              Total due
            </PdfText>
            <PdfText :style="{ color: '#FFFFFF', fontSize: 13, fontWeight: 700 }">
              {{ money(total) }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{ borderLeftColor: '#D9B44A', borderLeftWidth: 3, marginTop: 26, paddingLeft: 12 }"
        :wrap="false"
      >
        <PdfText :style="label">
          Payment note
        </PdfText>
        <PdfText :style="{ fontSize: 8.5 }">
          {{ invoice.paymentNote }}
        </PdfText>
      </PdfView>

      <PdfLink
        fixed
        :href="`mailto:${invoice.from.email}`"
        :style="footerLinkStyle"
      >
        {{ invoice.from.email }}
      </PdfLink>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`"
        :style="footerPageStyle"
      />
    </PdfPage>

    <PdfPage
      v-if="invoice.includeBrief"
      size="A4"
      :style="pageStyle"
    >
      <PdfView
        fixed
        :style="{ backgroundColor: '#264D31', height: 8, left: 0, position: 'absolute', right: 0, top: 0 }"
      />

      <PdfText :style="eyebrow">
        Project context
      </PdfText>
      <PdfText :style="{ fontFamily: 'Lora', fontSize: 28, fontWeight: 600, lineHeight: 1.1, marginTop: 10, width: 380 }">
        {{ invoice.projectBrief.title }}
      </PdfText>
      <PdfText :style="{ color: '#566159', fontSize: 10, lineHeight: 1.55, marginTop: 14, width: 420 }">
        {{ invoice.projectBrief.summary }}
      </PdfText>

      <PdfImage
        src="alpine.png"
        :style="{ borderRadius: 4, height: 200, marginTop: 26, objectFit: 'cover', width: '100%' }"
      />

      <InvoiceSection
        label="Scope"
        title="Included deliverables"
      >
        <PdfView
          v-for="(deliverable, index) in invoice.projectBrief.deliverables"
          :key="deliverable"
          :style="{ borderTopColor: '#DDE3DE', borderTopWidth: 1, flexDirection: 'row', paddingVertical: 13 }"
          :wrap="false"
        >
          <PdfText :style="{ color: '#3E6B48', fontSize: 8, fontWeight: 600, width: 34 }">
            {{ String(index + 1).padStart(2, '0') }}
          </PdfText>
          <PdfText :style="{ fontSize: 9.5, fontWeight: 500 }">
            {{ deliverable }}
          </PdfText>
        </PdfView>
      </InvoiceSection>

      <PdfNote>Project context supplied with invoice {{ invoice.number }}.</PdfNote>

      <PdfLink
        fixed
        href="https://nuxt-pdf.lupinum.com"
        :style="footerLinkStyle"
      >
        Generated with Nuxt PDF
      </PdfLink>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`"
        :style="footerPageStyle"
      />
    </PdfPage>
  </PdfDocument>
</template>
