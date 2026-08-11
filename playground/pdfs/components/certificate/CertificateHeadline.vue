<script setup lang="ts">
import type { PdfStyleValue } from '@lupinum/nuxt-pdf'

defineProps<{
  sx: PdfStyleValue
  text: string
}>()

// Keep display names and course titles intact across lines. PDF component props
// use ordinary Vue kebab-case in SFC templates and normalize at the renderer edge.
const keepWhole = (word: string): string[] => [word]
</script>

<template>
  <PdfText
    :hyphenation-callback="keepWhole"
    :style="sx"
  >
    {{ text }}
  </PdfText>
</template>
