<script setup lang="ts">
// The parent styles the headline with a class; it falls through to the text.
defineProps<{
  text: string
}>()
</script>

<template>
  <!-- Keep display names and course titles intact across lines. -->
  <PdfText :hyphenate="false">
    {{ text }}
  </PdfText>
</template>
