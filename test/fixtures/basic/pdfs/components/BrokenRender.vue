<script setup lang="ts">
const props = defineProps<{ message: string }>()

throw new Error(props.message)
</script>

<template>
  <PdfText>This content must never reach a PDF.</PdfText>
</template>
