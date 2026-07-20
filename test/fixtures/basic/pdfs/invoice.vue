<script setup lang="ts">
import InvoiceLine from './components/InvoiceLine.vue'

defineOptions({ name: 'PdfInvoiceTemplate' })

type InvoiceProps = {
  customer: string
  number: string
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
  sampleData: {
    customer: 'Ada Lovelace',
    number: 'INV-001',
    lines: [{
      description: 'PDF framework',
      id: 'framework',
      price: 'EUR 1,250.00',
    }],
  },
  scenarios: {
    long: {
      customer: 'Grace Hopper',
      number: 'INV-LONG',
      lines: Array.from({ length: 12 }, (_, index) => ({
        description: `Engineering line ${index + 1}`,
        id: `line-${index + 1}`,
        price: 'EUR 100.00',
      })),
    },
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage
      size="A4"
      :style="{
        color: '#17201b',
        fontFamily: 'Helvetica',
        fontSize: 11,
        gap: 16,
        padding: 48,
      }"
    >
      <PdfText :style="{ fontSize: 24, fontWeight: 700 }">
        Invoice {{ props.number }}
      </PdfText>
      <PdfText>{{ props.customer }}</PdfText>
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
