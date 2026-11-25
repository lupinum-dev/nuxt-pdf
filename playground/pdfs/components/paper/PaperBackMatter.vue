<script setup lang="ts">
import type { PaperBackMatter, PaperReference } from '../../../shared/paper'
import { paperTheme } from '../theme'

// What follows the discussion, in the columns: short items such as the
// funding, then the numbered reference list. Each entry has the id `ref-N`
// that the citations in the text link to. Journal names are italic, volumes
// bold.
defineProps<{ items: PaperBackMatter[], references: PaperReference[] }>()

// Word joiners around the en dash keep a page range on one line.
const range = ([first, last]: [number, number]) => `${first}\u2060–\u2060${last}`
</script>

<!-- Each entry sits on one line: a line break inside a text would print as a space. -->
<!-- eslint-disable vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
<template>
  <PdfView v-for="item in items" :id="item.id" :key="item.id" :bookmark="item.title" tag="section" class="paper-back-item">
    <PdfText tag="h2" class="paper-back-heading" :min-presence-ahead="16">{{ item.title }}</PdfText>
    <PdfText>{{ item.text }}</PdfText>
  </PdfView>
  <PdfView id="references" bookmark="References" tag="section">
    <PdfText tag="h2" class="paper-references-heading">References</PdfText>
    <PdfView tag="list">
      <PdfView v-for="(reference, index) in references" :id="`ref-${index + 1}`" :key="reference.title" tag="list-item" class="paper-reference">
        <PdfText class="paper-reference-number">{{ index + 1 }}</PdfText>
        <PdfText v-if="reference.journal" class="paper-reference-text">{{ reference.authors }} ({{ reference.year }}). {{ reference.title }}. <PdfText class="paper-reference-journal">{{ reference.journal }}</PdfText> <PdfText class="paper-reference-volume">{{ reference.volume }}</PdfText>, {{ reference.pages ? range(reference.pages) : '' }}.</PdfText>
        <PdfText v-else class="paper-reference-text">{{ reference.authors }} ({{ reference.year }}). <PdfText class="paper-reference-journal">{{ reference.title }}</PdfText>. {{ reference.publisher }}.</PdfText>
      </PdfView>
    </PdfView>
  </PdfView>
</template>

<style>
:root {
  --accent: v-bind('paperTheme.accent');
  --label: v-bind('paperTheme.label');
}
.paper-back-item {
  margin-bottom: 4pt;
  font-size: 7.3pt;
  line-height: 1.35;
}
.paper-back-heading {
  margin-top: 2pt;
  font-family: var(--label);
  font-size: 7.3pt;
  font-weight: 600;
}
.paper-references-heading {
  margin: 6pt 0 4pt;
  font-family: var(--label);
  font-size: 9pt;
  font-weight: 600;
}
.paper-reference {
  flex-direction: row;
  margin-bottom: 2.5pt;
  font-size: 7.3pt;
  line-height: 1.35;
}
.paper-reference-number {
  width: 14pt;
  color: var(--accent);
}
.paper-reference-text {
  flex: 1;
  hyphens: manual;
}
.paper-reference-journal {
  font-style: italic;
}
.paper-reference-volume {
  font-weight: 600;
}
</style>
