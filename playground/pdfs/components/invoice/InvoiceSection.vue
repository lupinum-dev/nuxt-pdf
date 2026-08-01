<script setup lang="ts">
defineProps<{
  label: string
  title: string
}>()
</script>

<template>
  <PdfView :style="{ marginTop: 28 }">
    <PdfText
      :min-presence-ahead="54"
      :style="{
        color: '#47734F',
        fontSize: 7,
        letterSpacing: 1.2,
        marginBottom: 7,
        textTransform: 'uppercase',
      }"
    >
      {{ label }}
    </PdfText>
    <PdfText
      :min-presence-ahead="42"
      :style="{
        color: '#18251D',
        fontSize: 15,
        marginBottom: 13,
      }"
    >
      {{ title }}
    </PdfText>
    <slot />
  </PdfView>
</template>
