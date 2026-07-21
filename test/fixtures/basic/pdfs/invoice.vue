<script setup lang="ts">
import InvoiceLine from './components/InvoiceLine.vue'
import {
  invoicePreviewSample,
  invoicePreviewScenarios,
} from './invoice.preview'

defineOptions({ name: 'PdfInvoiceTemplate' })

type InvoiceProps = {
  customer: string
  number: string
  previewOnlyCanary?: string
  lines: Array<{
    description: string
    id: string
    price: string
  }>
}

const props = defineProps<InvoiceProps>()

definePdf<InvoiceProps>({
  title: invoice => `Invoice ${invoice.number}`,
  filename: invoice => `invoice-${invoice.number}.pdf`,
  language: 'en-GB',
  sampleData: invoicePreviewSample,
  scenarios: invoicePreviewScenarios,
})
</script>

<template>
  <PdfDocument>
    <PdfPage
      size="A4"
      :style="{
        color: '#17201b',
        fontFamily: 'Invoice Sans',
        fontSize: 11,
        gap: 16,
        padding: 48,
      }"
    >
      <PdfText :style="{ fontSize: 24, fontWeight: 700 }">
        Invoice {{ props.number }}
      </PdfText>
      <PdfText>{{ props.customer }}</PdfText>
      <PdfImage
        src="sample.png"
        :style="{ height: 24, objectFit: 'contain', width: 24 }"
      />
      <InvoiceLine
        v-for="line in props.lines"
        :key="line.id"
        :description="line.description"
        :price="line.price"
      />
      <PdfText
        fixed
        :style="{ bottom: 24, position: 'absolute', right: 48 }"
        :render="({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`"
      />
    </PdfPage>
  </PdfDocument>
</template>
