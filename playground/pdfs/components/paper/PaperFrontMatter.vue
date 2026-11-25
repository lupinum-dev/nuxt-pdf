<script setup lang="ts">
import type { Paper } from '../../../shared/paper'
import { paperTheme } from '../theme'
import PaperText from './PaperText.vue'

// The full-width top of the first page: the journal masthead with the
// citation, the title, the authors with their affiliation markers, and the
// abstract at two thirds of the width beside the article information.
const props = defineProps<{ paper: Paper }>()

// "Lindqvist A, Reyes T, Okafor M": family name and first initial.
const citedAuthors = props.paper.authors.map((author) => {
  const names = author.name.split(' ')
  return `${names.at(-1)} ${names[0]!.charAt(0)}`
}).join(', ')
</script>

<!-- Runs with markers sit on one line: a line break inside a text would print as a space. -->
<!-- eslint-disable vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
<template>
  <PdfView>
    <PdfView class="paper-masthead">
      <PdfText class="paper-journal">{{ paper.journal }}</PdfText>
      <PdfText class="paper-issue">{{ paper.kind }} · Vol. {{ paper.volume }} · {{ paper.year }} · {{ paper.article }}</PdfText>
    </PdfView>
    <PdfText class="paper-cite"><PdfText class="paper-label">Cite as</PdfText>  {{ citedAuthors }} ({{ paper.year }}). {{ paper.title }}. {{ paper.journal }} {{ paper.volume }}, {{ paper.article }}.</PdfText>

    <PdfText tag="h1" class="paper-title">{{ paper.title }}</PdfText>
    <PdfText class="paper-authors">
      <template v-for="(author, index) in paper.authors" :key="author.name">{{ index ? ', ' : '' }}{{ author.name }}<PdfText class="paper-marker">{{ author.affiliations.join(',') }}</PdfText></template>
    </PdfText>
    <PdfText v-for="(affiliation, index) in paper.affiliations" :key="affiliation" class="paper-affiliation"><PdfText class="paper-marker">{{ index + 1 }}</PdfText> {{ affiliation }}</PdfText>

    <PdfView class="paper-summary">
      <PdfView class="paper-abstract">
        <PdfText tag="h2" class="paper-label paper-abstract-heading">Abstract</PdfText>
        <PaperText :parts="paper.abstract" />
      </PdfView>
      <PdfView class="paper-info">
        <PdfText tag="h2" class="paper-label paper-info-heading">Article info</PdfText>
        <PdfText v-for="entry in paper.history" :key="entry.label">{{ entry.label }} {{ entry.date }}</PdfText>
        <PdfText class="paper-label paper-info-label">Correspondence</PdfText>
        <PdfText>{{ paper.correspondence }}</PdfText>
        <PdfText class="paper-label paper-info-label">Keywords</PdfText>
        <PdfText v-for="keyword in paper.keywords" :key="keyword">{{ keyword }}</PdfText>
        <PdfText class="paper-licence">{{ paper.licence }}</PdfText>
      </PdfView>
    </PdfView>
  </PdfView>
</template>

<style>
:root {
  --ink: v-bind('paperTheme.ink');
  --muted: v-bind('paperTheme.muted');
  --hairline: v-bind('paperTheme.hairline');
  --accent: v-bind('paperTheme.accent');
  --label: v-bind('paperTheme.label');
}
.paper-masthead {
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 5pt;
  border-bottom: 0.75pt solid var(--ink);
}
.paper-journal {
  font-size: 12pt;
  font-weight: 600;
  color: var(--accent);
}
.paper-issue {
  font-family: var(--label);
  font-size: 6.8pt;
  color: var(--ink);
}
.paper-cite {
  margin-top: 4pt;
  font-family: var(--label);
  font-size: 6.5pt;
  line-height: 1.45;
  color: var(--muted);
}
.paper-label {
  font-family: var(--label);
  font-weight: 600;
  color: var(--ink);
}
.paper-title {
  margin: 22pt 0 9pt;
  font-size: 18pt;
  font-weight: 600;
  line-height: 1.2;
}
.paper-authors {
  margin-bottom: 4pt;
  font-size: 10pt;
}
.paper-marker {
  vertical-align: super;
  font-size: 70%;
}
.paper-affiliation {
  font-family: var(--label);
  font-size: 6.8pt;
  line-height: 1.45;
  color: var(--muted);
}
.paper-summary {
  flex-direction: row;
  margin: 14pt 0 16pt;
  padding: 10pt 0 8pt;
  border-top: 0.75pt solid var(--ink);
  border-bottom: 0.5pt solid var(--hairline);
}
.paper-abstract {
  flex: 2;
  font-size: 8.6pt;
  line-height: 1.42;
}
.paper-abstract-heading {
  margin-bottom: 3pt;
  font-size: 7.5pt;
  color: var(--accent);
}
.paper-info {
  flex: 1;
  margin-left: 18pt;
  padding-left: 10pt;
  border-left: 0.5pt solid var(--hairline);
  font-family: var(--label);
  font-size: 6.5pt;
  line-height: 1.5;
  color: var(--muted);
}
.paper-info-heading {
  margin-bottom: 3pt;
  font-size: 7.5pt;
  color: var(--accent);
}
.paper-info-label {
  margin-top: 6pt;
}
.paper-licence {
  margin-top: 8pt;
}
</style>
