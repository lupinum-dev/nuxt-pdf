<script setup lang="ts">
import type { Report } from '../../../../playground/shared/report'
import { sampleReport } from '../../../../playground/shared/report'
import { theme } from '../../../../playground/pdfs/components/theme'

defineOptions({ name: 'FieldnoteReportPdf' })

type ReportProps = { report: Report }

const props = defineProps<ReportProps>()
const report = props.report

const entries = report.sections.flatMap(section => [
  { id: section.id, title: section.title, depth: 0 },
  ...section.subsections.map(sub => ({ id: sub.id, title: sub.title, depth: 1 })),
])

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: theme.foreground,
  fontSize: 10,
  hyphens: 'auto',
  paddingBottom: 60,
  paddingHorizontal: 56,
  paddingTop: 56,
}

const footerStyle = {
  bottom: 30,
  color: theme.mutedForeground,
  fontSize: 8,
  left: 56,
  position: 'absolute',
  right: 56,
  textAlign: 'right',
} as const

const ruleBelow = { borderBottomColor: theme.border, borderBottomStyle: 'solid', borderBottomWidth: 1 } as const

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
      <PdfText :style="{ color: theme.mutedForeground, fontSize: 9, marginBottom: 10 }">
        {{ report.eyebrow }}
      </PdfText>
      <PdfText :style="{ fontSize: 28, fontWeight: 700, marginBottom: 6 }">
        {{ report.title }}
      </PdfText>
      <PdfText :style="{ color: theme.mutedForeground, fontSize: 10.5, marginBottom: 36, paddingBottom: 20, ...ruleBelow }">
        {{ report.period }}
      </PdfText>

      <PdfText :style="{ color: theme.mutedForeground, fontSize: 8.5, marginBottom: 14 }">
        Contents
      </PdfText>

      <PdfLink
        v-for="entry in entries"
        :key="entry.id"
        :href="`#${entry.id}`"
        :style="{ color: theme.foreground, marginBottom: 12, textDecoration: 'none' }"
      >
        <PdfText :style="{ marginLeft: entry.depth * 18 }">
          <PdfText :style="{ color: entry.depth ? theme.mutedForeground : theme.foreground, fontSize: entry.depth ? 10 : 11.5, fontWeight: entry.depth ? 400 : 700 }">
            {{ entry.title }}
          </PdfText>
          <PdfLeader :style="{ borderBottomColor: theme.border, borderBottomWidth: 1, marginLeft: 7, marginRight: 7 }" />
          <!-- The page each section finally lands on, resolved after layout. -->
          <PdfText :style="{ color: theme.mutedForeground, fontSize: 10, fontVariantNumeric: 'tabular-nums', fontWeight: 400 }">
            <PdfPageRef :to="entry.id" />
          </PdfText>
        </PdfText>
      </PdfLink>

      <PdfText
        fixed
        :style="footerStyle"
      >
        {{ report.author }} · <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>

    <!-- One page-flow per section; long sections span pages naturally -->
    <PdfPage
      v-for="section in report.sections"
      :key="section.id"
      size="A4"
      :style="pageStyle"
    >
      <!-- The id-bearing wrapper anchors the destination at the section start
           even when the body spans pages; subsection bookmarks nest under it
           in the outline. No `break` needed — each section already begins on
           its own PdfPage. -->
      <PdfView
        :id="section.id"
        :bookmark="{ title: section.title, expanded: true }"
      >
        <PdfView :style="{ marginBottom: 22, paddingBottom: 18, ...ruleBelow }">
          <PdfText :style="{ color: theme.mutedForeground, fontSize: 8.5, marginBottom: 8 }">
            Section
          </PdfText>
          <PdfText :style="{ fontSize: 22, fontWeight: 700, marginBottom: 8 }">
            {{ section.title }}
          </PdfText>
          <PdfText :style="{ color: theme.mutedForeground, fontSize: 11, lineHeight: 1.5 }">
            {{ section.lede }}
          </PdfText>
        </PdfView>

        <PdfView
          v-for="sub in section.subsections"
          :key="sub.id"
          :style="{ marginBottom: 18 }"
        >
          <PdfText
            :id="sub.id"
            :bookmark="sub.title"
            :min-presence-ahead="48"
            :style="{ color: theme.foreground, fontSize: 13, fontWeight: 700, marginBottom: 8 }"
          >
            {{ sub.title }}
          </PdfText>
          <PdfText
            v-for="(paragraph, index) in sub.paragraphs"
            :key="index"
            :style="{ color: '#3F3F46', fontSize: 10, lineHeight: 1.6, marginBottom: 8 }"
          >
            {{ paragraph }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="footerStyle"
      >
        {{ report.author }} · <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>
