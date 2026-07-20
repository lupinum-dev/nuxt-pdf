<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <PdfView>
    <PdfText>{{ label }}</PdfText>
    <slot name="suffix" />
  </PdfView>
</template>
