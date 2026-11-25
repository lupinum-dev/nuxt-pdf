<script setup lang="ts">
import type { Report } from '../shared/report'
import { sampleReport } from '../shared/report'
import { theme } from './components/theme'

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
        Contents
      </PdfText>

      <PdfLink
        v-for="entry in entries"
        :key="entry.id"
        :href="`#${entry.id}`"
        class="toc-link"
      >
        <PdfText :style="{ marginLeft: entry.depth * 18 }">
          <PdfText :class="['toc-title', { 'toc-subtitle': entry.depth > 0 }]">
            {{ entry.title }}
          </PdfText>
          <PdfLeader :style="{ borderBottomColor: theme.border, borderBottomWidth: 1, marginLeft: 7, marginRight: 7 }" />
          <!-- The page each section finally lands on, resolved after layout. -->
          <PdfText class="toc-page">
            <PdfPageRef :to="entry.id" />
          </PdfText>
        </PdfText>
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
            Section
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
/* Built-in Helvetica only, in the shared zinc colours (components/theme.ts).
   The style-object twin in test/fixtures mirrors every value here. */
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
  --border: v-bind('theme.border');
  --page-margin: 56pt;
}
.page {
  hyphens: auto;
  background-color: #FFFFFF;
  color: var(--foreground);
  font-size: 10pt;
  padding: var(--page-margin) var(--page-margin) 60pt;
}

.eyebrow {
  color: var(--muted-foreground);
  font-size: 9pt;
  margin-bottom: 10pt;
}

.title {
  font-size: 28pt;
  font-weight: 700;
  margin-bottom: 6pt;
}

.period {
  color: var(--muted-foreground);
  font-size: 10.5pt;
  margin-bottom: 36pt;
  padding-bottom: 20pt;
  border-bottom: 1pt solid var(--border);
}

/* Muted labels above the contents and above each section title. */
.label {
  color: var(--muted-foreground);
  font-size: 8.5pt;
  margin-bottom: 8pt;
}

.contents-label {
  margin-bottom: 14pt;
}

.toc-link {
  color: var(--foreground);
  margin-bottom: 12pt;
  text-decoration: none;
}

.toc-title {
  color: var(--foreground);
  font-size: 11.5pt;
  font-weight: 700;
}

/* Later in the file than .toc-title, so it wins on subsection rows. */
.toc-subtitle,
.toc-page {
  color: var(--muted-foreground);
  font-size: 10pt;
  font-weight: 400;
}

/* Page numbers line up in their column. Helvetica's digits already share one
   width; the rule keeps them aligned with a registered font too. */
.toc-page {
  font-variant-numeric: tabular-nums;
}

.section-head {
  margin-bottom: 22pt;
  padding-bottom: 18pt;
  border-bottom: 1pt solid var(--border);
}

.section-title {
  font-size: 22pt;
  font-weight: 700;
  margin-bottom: 8pt;
}

.lede {
  color: var(--muted-foreground);
  font-size: 11pt;
  line-height: 1.5;
}

.subsection {
  margin-bottom: 18pt;
}

.subsection-title {
  color: var(--foreground);
  font-size: 13pt;
  font-weight: 700;
  margin-bottom: 8pt;
}

.paragraph {
  color: #3F3F46;
  font-size: 10pt;
  line-height: 1.6;
  margin-bottom: 8pt;
}

.footer {
  position: absolute;
  right: var(--page-margin);
  bottom: 30pt;
  left: var(--page-margin);
  color: var(--muted-foreground);
  font-size: 8pt;
  text-align: right;
}
</style>
