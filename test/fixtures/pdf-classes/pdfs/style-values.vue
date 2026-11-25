<script setup lang="ts">
const props = defineProps<{ style: Record<string, unknown> }>()

definePdf({ title: 'Style values' })
</script>

<template>
  <PdfDocument>
    <PdfPage>
      <PdfText :style="props.style">
        Styled
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>
