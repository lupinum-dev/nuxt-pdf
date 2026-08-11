<script setup lang="ts">
import BrokenRender from './components/BrokenRender.vue'

type ProductionErrorProps = {
  message: string
}

const props = defineProps<ProductionErrorProps>()

definePdf<ProductionErrorProps>({
  title: 'Production error fixture',
  sampleData: { message: 'preview failure' },
})
</script>

<template>
  <PdfDocument>
    <PdfPage>
      <PdfText>Content before the failure.</PdfText>
      <BrokenRender :message="props.message" />
      <PdfText>Content after the failure.</PdfText>
    </PdfPage>
  </PdfDocument>
</template>
