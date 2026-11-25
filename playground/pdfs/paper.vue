<script setup lang="ts">
import type { Paper } from '../shared/paper'
import { samplePaper } from '../shared/paper'
import PaperFigureBars from './components/paper/PaperFigureBars.vue'
import PaperFigureScatter from './components/paper/PaperFigureScatter.vue'
import PaperBackMatter from './components/paper/PaperBackMatter.vue'
import PaperFrontMatter from './components/paper/PaperFrontMatter.vue'
import PaperTable from './components/paper/PaperTable.vue'
import PaperText from './components/paper/PaperText.vue'
import { paperTheme } from './components/theme'

defineOptions({ name: 'ResearchPaperPdf' })

type PaperProps = { paper: Paper }

const props = defineProps<PaperProps>()
const paper = props.paper

definePdf<PaperProps>({
  title: ({ paper }) => paper.title,
  filename: () => 'research-paper.pdf',
  language: 'en',
  sampleData: { paper: samplePaper },
})
</script>

<!-- eslint-disable vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
<template>
  <PdfDocument
    :author="paper.authors.map(author => author.name).join(', ')"
    :conformance="['PDF/A-3a', 'PDF/UA-1']"
    creator="Nuxt PDF"
    :subject="paper.journal"
  >
    <PdfPage size="A4" class="page">
      <!-- The first page has the masthead; the running head starts on page 2. -->
      <PdfView fixed pages="continuation" class="running-head">
        <PdfText>{{ paper.shortTitle }}</PdfText>
        <PdfText>{{ paper.journal }} {{ paper.volume }} ({{ paper.year }}) {{ paper.article }} · <PdfPageNumber /></PdfText>
      </PdfView>

      <PaperFrontMatter :paper="paper" />

      <!-- Two columns, balanced where they end. Each section is a bookmark; a
           heading keeps 40 pt of its section below it. Figures and tables
           float to the top or the bottom of a column. -->
      <PdfView class="body">
        <PdfView v-for="section in paper.sections" :id="section.id" :key="section.id" :bookmark="section.title" tag="section">
          <PdfText tag="h2" class="heading" :min-presence-ahead="40"><PdfText class="number">{{ section.number }}</PdfText> {{ section.title }}</PdfText>
          <template v-for="(block, index) in section.blocks" :key="index">
            <PdfText v-if="block.kind === 'h3'" tag="h3" class="subheading" :min-presence-ahead="30">{{ block.title }}</PdfText>
            <PaperText v-else-if="block.kind === 'p'" :parts="block.parts" />
            <PaperTable v-else-if="block.kind === 'table'" :table="block.table" :float="block.float" />
            <PaperFigureBars v-else-if="block.figure === 'bars'" :species="paper.species" :float="block.float" />
            <PaperFigureScatter v-else :sites="paper.sites" :float="block.float" />
          </template>
        </PdfView>
        <PaperBackMatter :items="paper.backMatter" :references="paper.references" />
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The paper's own look (paperTheme in components/theme.ts). */
:root {
  --ink: v-bind('paperTheme.ink');
  --muted: v-bind('paperTheme.muted');
  --hairline: v-bind('paperTheme.hairline');
  --accent: v-bind('paperTheme.accent');
  --reading: v-bind('paperTheme.reading');
  --label: v-bind('paperTheme.label');
}
.page {
  hyphens: auto;
  text-wrap: pretty;
  padding: 52pt 54pt 50pt;
  font-family: var(--reading);
  font-size: 8.2pt;
  line-height: 1.36;
  color: var(--ink);
}
.running-head {
  position: absolute;
  top: 28pt;
  right: 54pt;
  left: 54pt;
  flex-direction: row;
  justify-content: space-between;
  padding-bottom: 6pt;
  border-bottom: 0.5pt solid var(--hairline);
  font-family: var(--label);
  font-size: 6.5pt;
  color: var(--muted);
}
.body {
  columns: 2;
  column-gap: 18pt;
}
.heading {
  margin: 6pt 0 4pt;
  font-family: var(--label);
  font-size: 9pt;
  font-weight: 600;
}
.number {
  color: var(--accent);
}
.subheading {
  margin: 2pt 0 1pt;
  font-style: italic;
}
</style>
