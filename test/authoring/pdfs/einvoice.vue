<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import type { EInvoice, EInvoiceProfile } from '@lupinum/nuxt-pdf'

interface Props {
  invoice: EInvoice
  profile?: EInvoiceProfile
}

definePdf<Props>({
  title: props => `Invoice ${props.invoice.number}`,
  filename: props => `invoice-${props.invoice.number}.pdf`,
})

const props = defineProps<Props>()
const totals = computeEInvoice(props.invoice)
const means = props.invoice.payment?.means
const iban = means && 'iban' in means ? means.iban : undefined
</script>

<template>
  <PdfDocument
    conformance="PDF/A-3b"
    language="en"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfFacturX
      :invoice="invoice"
      :profile="profile ?? 'EN 16931'"
    />
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView class="parties">
        <PdfView class="party">
          <PdfText class="eyebrow">
            From
          </PdfText>
          <PdfText class="strong">
            {{ invoice.seller.name }}
          </PdfText>
          <PdfText>{{ invoice.seller.address.line1 }}</PdfText>
          <PdfText>{{ invoice.seller.address.postcode }} {{ invoice.seller.address.city }}</PdfText>
          <PdfText>VAT ID {{ invoice.seller.vatId }}</PdfText>
        </PdfView>
        <PdfView class="party">
          <PdfText class="eyebrow">
            To
          </PdfText>
          <PdfText class="strong">
            {{ invoice.buyer.name }}
          </PdfText>
          <PdfText>{{ invoice.buyer.address.line1 }}</PdfText>
          <PdfText>{{ invoice.buyer.address.postcode }} {{ invoice.buyer.address.city }}</PdfText>
        </PdfView>
      </PdfView>

      <PdfText class="title">
        Invoice {{ invoice.number }}
      </PdfText>
      <PdfText class="meta">
        Issued {{ invoice.issueDate }}, due {{ invoice.payment?.dueDate }}
      </PdfText>

      <PdfTable
        :columns="[1, '54pt', '66pt', '76pt']"
      >
        <PdfTableHeader class="head">
          <PdfTableCell>Description</PdfTableCell>
          <PdfTableCell align="right">
            Qty
          </PdfTableCell>
          <PdfTableCell align="right">
            Unit price
          </PdfTableCell>
          <PdfTableCell align="right">
            Net amount
          </PdfTableCell>
        </PdfTableHeader>
        <PdfTableRow
          v-for="(line, index) in invoice.lines"
          :key="index"
          class="row"
        >
          <PdfTableCell>{{ line.name }}</PdfTableCell>
          <PdfTableCell align="right">
            {{ line.quantity }}
          </PdfTableCell>
          <PdfTableCell align="right">
            {{ line.netPrice }}
          </PdfTableCell>
          <PdfTableCell align="right">
            {{ totals.lines[index]!.netAmount }}
          </PdfTableCell>
        </PdfTableRow>
      </PdfTable>

      <PdfView class="totals">
        <PdfText>Net: {{ totals.taxBasisTotal }} {{ invoice.currency }}</PdfText>
        <PdfText
          v-for="vat in totals.vatBreakdown"
          :key="`${vat.category}-${vat.rate}`"
        >
          VAT {{ vat.rate ?? 0 }} %: {{ vat.taxAmount }} {{ invoice.currency }}
        </PdfText>
        <PdfText>Total: {{ totals.grandTotal }} {{ invoice.currency }}</PdfText>
        <PdfText class="due">
          Amount due: {{ totals.duePayable }} {{ invoice.currency }}
        </PdfText>
      </PdfView>

      <PdfText
        v-if="iban"
        class="pay"
      >
        Please pay by SEPA transfer to {{ iban }}.
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 48pt;
  font-family: Inter;
  font-size: 10pt;
  color: #1c2a30;
}
.parties {
  flex-direction: row;
  justify-content: space-between;
}
.party {
  width: 220pt;
}
.eyebrow {
  font-size: 7.5pt;
  letter-spacing: 1pt;
  text-transform: uppercase;
  color: #5b6b72;
  margin-bottom: 3pt;
}
.strong {
  font-weight: 700;
}
.title {
  margin-top: 34pt;
  font-size: 20pt;
  font-weight: 700;
}
.meta {
  margin-top: 4pt;
  margin-bottom: 18pt;
  color: #5b6b72;
}
.head {
  font-weight: 700;
  border-bottom: 1pt solid #1c2a30;
  padding-bottom: 4pt;
}
.row {
  padding: 6pt 0;
  border-bottom: 0.5pt solid #d5dde0;
}
.totals {
  margin-top: 16pt;
  align-items: flex-end;
}
.due {
  margin-top: 4pt;
  font-size: 12pt;
  font-weight: 700;
}
.pay {
  margin-top: 28pt;
  color: #5b6b72;
}
</style>
