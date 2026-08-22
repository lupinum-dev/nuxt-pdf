<script setup lang="ts">
/**
 * Dotted rule that fills the space between a label and a page number or price.
 * Pair it with a row using `alignItems: 'flex-end'`; the `baseline` offset
 * nudges the dots down to sit on the text baseline.
 */
defineProps<{
  /** Distance from the row baseline down to the dotted rule. */
  baseline?: number
  color: string
  /** Horizontal space between the dots and the neighbouring text. */
  gap?: number
  width?: number
}>()
</script>

<template>
  <PdfView
    :style="{
      borderBottomColor: color,
      borderBottomStyle: 'dotted',
      borderBottomWidth: width ?? 1,
      flex: 1,
      marginBottom: baseline ?? 3,
      marginHorizontal: gap ?? 7,
    }"
  />
</template>
