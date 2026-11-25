<script setup lang="ts">
import { theme } from '../theme'

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
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
}
.section {
  margin-top: 26pt;
}

.section-label {
  margin-bottom: 3pt;
  font-size: 7.5pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

.section-title {
  margin-bottom: 10pt;
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: -0.3pt;
  color: var(--foreground);
}
</style>
