<script setup lang="ts">
defineProps<{
  description: string
  price: string
}>()
</script>

<template>
  <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between' }">
    <PdfText>{{ description }}</PdfText>
    <PdfText>{{ price }}</PdfText>
  </PdfView>
</template>
