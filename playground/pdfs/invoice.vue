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

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: '#18251D',
  fontFamily: 'Fieldnote Sans',
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
    <PdfPage
      size="A4"
      :style="pageStyle"
    >
      <PdfView
        fixed
        :style="{
          backgroundColor: '#315D3B',
          height: 9,
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }"
      />

      <PdfView
        :style="{
          alignItems: 'flex-start',
          flexDirection: 'row',
          justifyContent: 'space-between',
        }"
      >
        <PdfView :style="{ flexDirection: 'row' }">
          <PdfImage
            src="alpine.png"
            :style="{ height: 46, objectFit: 'cover', width: 70 }"
          />
          <PdfView :style="{ marginLeft: 13 }">
            <PdfText :style="{ fontSize: 13, marginBottom: 5 }">
              Fieldnote Studio
            </PdfText>
            <PdfText :style="{ color: '#6A756D', fontSize: 7.5 }">
              Research · systems · reports
            </PdfText>
          </PdfView>
        </PdfView>
        <PdfView :style="{ alignItems: 'flex-end' }">
          <PdfText :style="{ color: '#47734F', fontSize: 7, letterSpacing: 1.3 }">
            INVOICE
          </PdfText>
          <PdfText :style="{ fontSize: 10, marginTop: 5 }">
            {{ invoice.number }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{
          alignItems: 'flex-end',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 42,
        }"
      >
        <PdfView :style="{ width: 305 }">
          <PdfText :style="{ color: '#47734F', fontSize: 7, letterSpacing: 1.2, marginBottom: 9 }">
            PREPARED FOR
          </PdfText>
          <PdfText :style="{ fontSize: 25, lineHeight: 1.08 }">
            {{ invoice.customer.name }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ width: 150 }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 4 }">
            Total due
          </PdfText>
          <PdfText :style="{ fontSize: 18 }">
            {{ money(total) }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{
          backgroundColor: '#F1F4F1',
          flexDirection: 'row',
          marginTop: 32,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }"
        :wrap="false"
      >
        <PdfView :style="{ width: 124 }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 4 }">
            Issued
          </PdfText>
          <PdfText :style="{ fontSize: 8.5 }">
            {{ invoice.issueDate }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ width: 124 }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 4 }">
            Due
          </PdfText>
          <PdfText :style="{ fontSize: 8.5 }">
            {{ invoice.dueDate }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ width: 124 }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 4 }">
            Purchase order
          </PdfText>
          <PdfText :style="{ fontSize: 8.5 }">
            {{ invoice.purchaseOrder }}
          </PdfText>
        </PdfView>
        <PdfView>
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 4 }">
            Currency
          </PdfText>
          <PdfText :style="{ fontSize: 8.5 }">
            {{ invoice.currency }}
          </PdfText>
        </PdfView>
      </PdfView>

      <InvoiceSection
        label="Services"
        title="Engagement summary"
      >
        <PdfView
          :style="{
            borderBottomColor: '#9EA8A1',
            borderBottomWidth: 1,
            flexDirection: 'row',
            paddingBottom: 8,
          }"
          :wrap="false"
        >
          <PdfText :style="{ color: '#758078', fontSize: 7, width: 28 }">
            #
          </PdfText>
          <PdfText :style="{ color: '#758078', fontSize: 7, width: 246 }">
            Description
          </PdfText>
          <PdfText :style="{ color: '#758078', fontSize: 7, textAlign: 'right', width: 52 }">
            Qty
          </PdfText>
          <PdfText :style="{ color: '#758078', fontSize: 7, textAlign: 'right', width: 78 }">
            Rate
          </PdfText>
          <PdfText :style="{ color: '#758078', fontSize: 7, textAlign: 'right', width: 86 }">
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
        :style="{
          alignItems: 'flex-end',
          marginTop: 20,
        }"
        :wrap="false"
      >
        <PdfView :style="{ width: 220 }">
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }">
            <PdfText :style="{ color: '#6A756D' }">
              Subtotal
            </PdfText>
            <PdfText>{{ money(subtotal) }}</PdfText>
          </PdfView>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }">
            <PdfText :style="{ color: '#6A756D' }">
              VAT {{ invoice.taxRate * 100 }}%
            </PdfText>
            <PdfText>{{ money(tax) }}</PdfText>
          </PdfView>
          <PdfView
            :style="{
              borderTopColor: '#315D3B',
              borderTopWidth: 1.5,
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 6,
              paddingTop: 10,
            }"
          >
            <PdfText :style="{ fontSize: 10 }">
              Total due
            </PdfText>
            <PdfText :style="{ fontSize: 12 }">
              {{ money(total) }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfView
        :style="{
          borderLeftColor: '#DABF5B',
          borderLeftWidth: 3,
          marginTop: 28,
          paddingLeft: 12,
        }"
        :wrap="false"
      >
        <PdfText :style="{ color: '#6A756D', fontSize: 7, marginBottom: 4 }">
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
        :style="{
          backgroundColor: '#315D3B',
          height: 9,
          left: 0,
          position: 'absolute',
          right: 0,
          top: 0,
        }"
      />

      <PdfText :style="{ color: '#47734F', fontSize: 7, letterSpacing: 1.2 }">
        PROJECT CONTEXT
      </PdfText>
      <PdfText :style="{ fontSize: 27, lineHeight: 1.08, marginTop: 10, width: 360 }">
        {{ invoice.projectBrief.title }}
      </PdfText>
      <PdfText :style="{ color: '#6A756D', fontSize: 10, lineHeight: 1.55, marginTop: 16, width: 420 }">
        {{ invoice.projectBrief.summary }}
      </PdfText>

      <PdfImage
        src="alpine.png"
        :style="{ height: 190, marginTop: 28, objectFit: 'cover', width: '100%' }"
      />

      <InvoiceSection
        label="Scope"
        title="Included deliverables"
      >
        <PdfView
          v-for="(deliverable, index) in invoice.projectBrief.deliverables"
          :key="deliverable"
          :style="{
            borderTopColor: '#DDE3DE',
            borderTopWidth: 1,
            flexDirection: 'row',
            paddingVertical: 13,
          }"
          :wrap="false"
        >
          <PdfText :style="{ color: '#47734F', fontSize: 8, width: 34 }">
            {{ String(index + 1).padStart(2, '0') }}
          </PdfText>
          <PdfText :style="{ fontSize: 9.5 }">
            {{ deliverable }}
          </PdfText>
        </PdfView>
      </InvoiceSection>

      <PdfView
        :style="{
          backgroundColor: '#F1F4F1',
          flexDirection: 'row',
          marginTop: 30,
          padding: 18,
        }"
        :wrap="false"
      >
        <PdfView :style="{ paddingRight: 24, width: '50%' }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 6 }">
            From
          </PdfText>
          <PdfText :style="{ fontSize: 9, marginBottom: 4 }">
            {{ invoice.from.name }}
          </PdfText>
          <PdfText
            v-for="line in invoice.from.address"
            :key="line"
            :style="{ color: '#6A756D', fontSize: 7.5 }"
          >
            {{ line }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ width: '50%' }">
          <PdfText :style="{ color: '#758078', fontSize: 7, marginBottom: 6 }">
            Bill to
          </PdfText>
          <PdfText :style="{ fontSize: 9, marginBottom: 4 }">
            {{ invoice.customer.name }}
          </PdfText>
          <PdfText
            v-for="line in invoice.customer.address"
            :key="line"
            :style="{ color: '#6A756D', fontSize: 7.5 }"
          >
            {{ line }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfNote>Project context supplied with invoice {{ invoice.number }}.</PdfNote>

      <PdfLink
        fixed
        href="https://nuxt.com"
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
