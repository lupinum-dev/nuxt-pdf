<script setup lang="ts">
defineProps<{
  label: string
  title: string
}>()
</script>

<template>
  <PdfView :style="{ marginTop: 26 }">
    <PdfText
      :min-presence-ahead="54"
      :style="{
        color: '#3E6B48',
        fontSize: 7,
        fontWeight: 700,
        letterSpacing: 1.4,
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
        fontFamily: 'Lora',
        fontSize: 16,
        fontWeight: 600,
        marginBottom: 12,
      }"
    >
      {{ title }}
    </PdfText>
    <slot />
  </PdfView>
</template>
