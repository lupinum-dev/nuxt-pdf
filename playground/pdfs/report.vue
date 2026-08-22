<script setup lang="ts">
import type { Report } from '../shared/report'
import { sampleReport } from '../shared/report'
import DotLeader from './components/common/DotLeader.vue'

defineOptions({ name: 'FieldnoteReportPdf' })

type ReportProps = { report: Report }

const props = defineProps<ReportProps>()
const report = props.report

// Auto-imported. Reading it turns on the multi-pass layout loop: the table of
// contents below prints the page each section finally lands on. On the first
// pass every number is undefined, so each entry falls back to a blank.
const pageNumbers = usePdfPageNumbers()

const entries = report.sections.flatMap(section => [
  { id: section.id, title: section.title, depth: 0 },
  ...section.subsections.map(sub => ({ id: sub.id, title: sub.title, depth: 1 })),
])

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: '#18251D',
  fontSize: 10,
  paddingBottom: 56,
  paddingHorizontal: 52,
  paddingTop: 52,
}

const footerStyle = {
  bottom: 28,
  color: '#758078',
  fontSize: 8,
  left: 52,
  position: 'absolute',
  right: 52,
  textAlign: 'right',
} as const

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
      :style="pageStyle"
    >
      <PdfView
        fixed
        :style="{ backgroundColor: '#315D3B', height: 8, left: 0, position: 'absolute', right: 0, top: 0 }"
      />

      <PdfText :style="{ color: '#47734F', fontSize: 8, letterSpacing: 1.4, marginBottom: 8 }">
        {{ report.eyebrow }}
      </PdfText>
      <PdfText :style="{ fontSize: 26, marginBottom: 4 }">
        {{ report.title }}
      </PdfText>
      <PdfText :style="{ color: '#6A756D', fontSize: 10, marginBottom: 34 }">
        {{ report.period }}
      </PdfText>

      <PdfText :style="{ color: '#47734F', fontSize: 8, letterSpacing: 1.2, marginBottom: 14 }">
        CONTENTS
      </PdfText>

      <PdfLink
        v-for="entry in entries"
        :key="entry.id"
        :href="`#${entry.id}`"
        :style="{ color: '#18251D', marginBottom: 11, textDecoration: 'none' }"
      >
        <PdfView :style="{ alignItems: 'flex-end', flexDirection: 'row', marginLeft: entry.depth * 18 }">
          <PdfText :style="{ color: entry.depth ? '#4A554E' : '#18251D', fontSize: entry.depth ? 10 : 11.5 }">
            {{ entry.title }}
          </PdfText>
          <DotLeader
            :baseline="3"
            :gap="7"
            color="#CDD5CF"
          />
          <PdfText :style="{ color: '#4A554E', fontSize: 10 }">
            {{ pageNumbers[entry.id] ?? '' }}
          </PdfText>
        </PdfView>
      </PdfLink>

      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${report.author} · ${pageNumber} / ${totalPages}`"
        :style="footerStyle"
      />
    </PdfPage>

    <!-- One page-flow per section; long sections span pages naturally -->
    <PdfPage
      v-for="section in report.sections"
      :key="section.id"
      size="A4"
      :style="pageStyle"
    >
      <PdfView
        fixed
        :style="{ backgroundColor: '#315D3B', height: 8, left: 0, position: 'absolute', right: 0, top: 0 }"
      />

      <!-- The id-bearing wrapper anchors the destination at the section start
           even when the body spans pages; subsection bookmarks nest under it
           in the outline. No `break` needed — each section already begins on
           its own PdfPage. -->
      <PdfView
        :id="section.id"
        :bookmark="{ title: section.title, expanded: true }"
      >
        <PdfView :style="{ marginBottom: 18 }">
          <PdfText :style="{ color: '#47734F', fontSize: 8, letterSpacing: 1.2, marginBottom: 6 }">
            SECTION
          </PdfText>
          <PdfText :style="{ fontSize: 22, marginBottom: 8 }">
            {{ section.title }}
          </PdfText>
          <PdfText :style="{ color: '#6A756D', fontSize: 10.5, lineHeight: 1.5 }">
            {{ section.lede }}
          </PdfText>
        </PdfView>

        <PdfView
          v-for="sub in section.subsections"
          :key="sub.id"
          :style="{ marginBottom: 16 }"
        >
          <PdfText
            :id="sub.id"
            :bookmark="sub.title"
            :min-presence-ahead="48"
            :style="{ color: '#315D3B', fontSize: 13, marginBottom: 8 }"
          >
            {{ sub.title }}
          </PdfText>
          <PdfText
            v-for="(paragraph, index) in sub.paragraphs"
            :key="index"
            :style="{ color: '#2A362E', fontSize: 10, lineHeight: 1.55, marginBottom: 7 }"
          >
            {{ paragraph }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${report.author} · ${pageNumber} / ${totalPages}`"
        :style="footerStyle"
      />
    </PdfPage>
  </PdfDocument>
</template>
