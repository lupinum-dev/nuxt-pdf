<script setup lang="ts">
defineProps<{
  label: string
  title: string
}>()
</script>

<template>
  <PdfView class="section">
    <PdfText
      :min-presence-ahead="54"
      class="section-label"
    >
      {{ label }}
    </PdfText>
    <PdfText
      :min-presence-ahead="42"
      class="section-title"
    >
      {{ title }}
    </PdfText>
    <slot />
  </PdfView>
</template>

<style>
.section {
  margin-top: 28pt;
}

.section-label {
  margin-bottom: 7pt;
  font-size: 7pt;
  letter-spacing: 1.2pt;
  text-transform: uppercase;
  color: #47734F;
}

.section-title {
  margin-bottom: 13pt;
  font-size: 15pt;
  color: #18251D;
}
</style>
