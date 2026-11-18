<script setup lang="ts">
import type { Report } from '../shared/report'
import { sampleReport } from '../shared/report'
import DotLeader from './components/common/DotLeader.vue'

defineOptions({ name: 'FieldnoteReportPdf' })

type ReportProps = { report: Report }

const props = defineProps<ReportProps>()
const report = props.report

const entries = report.sections.flatMap(section => [
  { id: section.id, title: section.title, depth: 0 },
  ...section.subsections.map(sub => ({ id: sub.id, title: sub.title, depth: 1 })),
])

definePdf<ReportProps>({
  title: ({ report }) => report.title,
  filename: ({ report }) => `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  language: 'en',
  sampleData: { report: sampleReport },
})
</script>

<template>
  <PdfDocument
    :author="report.author"
    creator="Nuxt PDF"
    :subject="report.title"
  >
    <!-- Contents -->
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView
        fixed
        class="top-bar"
      />

      <PdfText class="eyebrow">
        {{ report.eyebrow }}
      </PdfText>
      <PdfText class="title">
        {{ report.title }}
      </PdfText>
      <PdfText class="period">
        {{ report.period }}
      </PdfText>

      <PdfText class="label contents-label">
        CONTENTS
      </PdfText>

      <PdfLink
        v-for="entry in entries"
        :key="entry.id"
        :href="`#${entry.id}`"
        class="toc-link"
      >
        <PdfView
          class="toc-row"
          :style="{ marginLeft: entry.depth * 18 }"
        >
          <PdfText :class="['toc-title', { 'toc-subtitle': entry.depth > 0 }]">
            {{ entry.title }}
          </PdfText>
          <DotLeader
            :baseline="3"
            :gap="7"
            color="#CDD5CF"
          />
          <!-- The page each section finally lands on, resolved after layout. -->
          <PdfText class="toc-page">
            <PdfPageRef :to="entry.id" />
          </PdfText>
        </PdfView>
      </PdfLink>

      <PdfText
        fixed
        class="footer"
      >
        {{ report.author }} · <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>

    <!-- One page-flow per section; long sections span pages naturally -->
    <PdfPage
      v-for="section in report.sections"
      :key="section.id"
      size="A4"
      class="page"
    >
      <PdfView
        fixed
        class="top-bar"
      />

      <!-- The id-bearing wrapper anchors the destination at the section start
           even when the body spans pages; subsection bookmarks nest under it
           in the outline. No `break` needed — each section already begins on
           its own PdfPage. -->
      <PdfView
        :id="section.id"
        :bookmark="{ title: section.title, expanded: true }"
      >
        <PdfView class="section-head">
          <PdfText class="label">
            SECTION
          </PdfText>
          <PdfText class="section-title">
            {{ section.title }}
          </PdfText>
          <PdfText class="lede">
            {{ section.lede }}
          </PdfText>
        </PdfView>

        <PdfView
          v-for="sub in section.subsections"
          :key="sub.id"
          class="subsection"
        >
          <PdfText
            :id="sub.id"
            :bookmark="sub.title"
            :min-presence-ahead="48"
            class="subsection-title"
          >
            {{ sub.title }}
          </PdfText>
          <PdfText
            v-for="(paragraph, index) in sub.paragraphs"
            :key="index"
            class="paragraph"
          >
            {{ paragraph }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer"
      >
        {{ report.author }} · <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root {
  --ink: #18251D;
  --page-margin: 52pt;
}
.page {
  background-color: #FFFFFF;
  color: var(--ink);
  font-size: 10pt;
  padding: var(--page-margin) var(--page-margin) 56pt;
}

.top-bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 8pt;
  background-color: #315D3B;
}

.eyebrow {
  color: #47734F;
  font-size: 8pt;
  letter-spacing: 1.4pt;
  margin-bottom: 8pt;
}

.title {
  font-size: 26pt;
  margin-bottom: 4pt;
}

.period {
  color: #6A756D;
  font-size: 10pt;
  margin-bottom: 34pt;
}

/* Spaced labels above the contents and above each section title. */
.label {
  color: #47734F;
  font-size: 8pt;
  letter-spacing: 1.2pt;
  margin-bottom: 6pt;
}

.contents-label {
  margin-bottom: 14pt;
}

.toc-link {
  color: var(--ink);
  margin-bottom: 11pt;
  text-decoration: none;
}

.toc-row {
  flex-direction: row;
  align-items: flex-end;
}

.toc-title {
  color: var(--ink);
  font-size: 11.5pt;
}

/* Later in the file than .toc-title, so it wins on subsection rows. */
.toc-subtitle,
.toc-page {
  color: #4A554E;
  font-size: 10pt;
}

.section-head {
  margin-bottom: 18pt;
}

.section-title {
  font-size: 22pt;
  margin-bottom: 8pt;
}

.lede {
  color: #6A756D;
  font-size: 10.5pt;
  line-height: 1.5;
}

.subsection {
  margin-bottom: 16pt;
}

.subsection-title {
  color: #315D3B;
  font-size: 13pt;
  margin-bottom: 8pt;
}

.paragraph {
  color: #2A362E;
  font-size: 10pt;
  line-height: 1.55;
  margin-bottom: 7pt;
}

.footer {
  position: absolute;
  right: var(--page-margin);
  bottom: 28pt;
  left: var(--page-margin);
  color: #758078;
  font-size: 8pt;
  text-align: right;
}
</style>
