<script setup lang="ts">
// A comark component of the journal: `::callout{tone="tip"}` in the Markdown.
// PdfRichText passes the props and the rendered content in the default slot.
import { articleTheme } from '../theme'

defineProps<{
  tone?: string
}>()
</script>

<template>
  <!-- A margin note of the journal: an accent rule and a small label. -->
  <PdfView class="callout">
    <PdfText class="callout-label">
      {{ tone === 'warning' ? 'Watch out' : 'Field tip' }}
    </PdfText>
    <slot />
  </PdfView>
</template>

<style>
:root {
  --accent: v-bind('articleTheme.accent');
  --reading: v-bind('articleTheme.reading');
}
.callout {
  margin-bottom: 8pt;
  padding: 2pt 0 2pt 11pt;
  border-left: 1.5pt solid var(--accent);
}
.callout-label {
  margin-bottom: 2pt;
  font-family: var(--reading);
  font-size: 7.5pt;
  font-weight: 600;
  color: var(--accent);
}
</style>
