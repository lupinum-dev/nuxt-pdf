<script setup lang="ts">
type InvoiceProps = {
  baseMessage: string
}

const props = defineProps<InvoiceProps>()

definePdf<InvoiceProps>({
  sampleData: {
    baseMessage: 'Base-layer invoice',
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage size="A4" :style="{ padding: 48 }">
      <PdfText>BASE INVOICE: {{ props.baseMessage }}</PdfText>
    </PdfPage>
  </PdfDocument>
</template>
