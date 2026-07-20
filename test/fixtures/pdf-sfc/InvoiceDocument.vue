<script setup lang="ts">
import LineItem from './LineItem.vue'

declare const definePdf: (metadata: unknown) => void

type InvoiceProps = {
  customer: string
  lines: Array<{ id: string, label: string }>
}

const props = defineProps<InvoiceProps>()

definePdf({
  title: (values: InvoiceProps) => `Invoice for ${values.customer}`,
  filename: (values: InvoiceProps) => `${values.customer}.pdf`,
  language: 'en',
  sampleData: {
    customer: 'Ada',
    lines: [{ id: 'line-1', label: 'PDF compiler' }],
  },
})
</script>

<template>
  <PdfDocument :title="`Invoice for ${props.customer}`">
    <PdfPage>
      <LineItem
        v-for="line in props.lines"
        :key="line.id"
        :label="line.label"
      >
        <template #suffix>
          <PdfText>Included</PdfText>
        </template>
      </LineItem>
    </PdfPage>
  </PdfDocument>
</template>
