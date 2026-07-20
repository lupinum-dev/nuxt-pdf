<script setup lang="ts">
defineOptions({ name: 'ProjectInvoicePdf' })

type InvoiceProps = {
  projectMessage: string
}

const props = defineProps<InvoiceProps>()

definePdf<InvoiceProps>({
  sampleData: {
    projectMessage: 'Project-layer invoice',
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage
      size="A4"
      :style="{ padding: 48 }"
    >
      <PdfText>PROJECT OVERRIDE: {{ props.projectMessage }}</PdfText>
    </PdfPage>
  </PdfDocument>
</template>
