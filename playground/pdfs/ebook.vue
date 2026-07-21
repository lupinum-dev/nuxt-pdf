<script setup lang="ts">
import type { Ebook } from '../shared/ebook'
import { sampleEbook, shortEbook, splitLeadIn } from '../shared/ebook'

defineOptions({ name: 'EbookPdf' })

type EbookProps = { ebook: Ebook }

const props = defineProps<EbookProps>()
const ebook = props.ebook

// Auto-imported. Reading it turns on the multi-pass layout loop: every chapter
// anchor's resolved page flows back here, feeding BOTH the Contents dot-leaders
// and the chapter-aware running foot below. On the first pass the map is empty,
// so the Contents fall back to blanks and the foot to the opening chapter.
const pageNumbers = usePdfPageNumbers()

// The showcase move: derive the CURRENT chapter for any page from the resolved
// start-page map. The running foot's :render closes over this, so the same one
// callback prints the right chapter on every page it repeats onto — the chapter
// is read from measured pagination, never hard-coded per page.
const chapterAt = (pageNumber: number): Ebook['chapters'][number] => {
  let current = ebook.chapters[0]!
  for (const chapter of ebook.chapters) {
    const start = pageNumbers[chapter.id]
    if (typeof start === 'number' && start <= pageNumber) current = chapter
  }
  return current
}

// Precompute the small-caps lead-in split (first four words, uppercased) and the
// remaining body once per chapter, so the template stays declarative.
const chapters = ebook.chapters.map((chapter, index) => ({
  ...chapter,
  first: index === 0,
  lead: splitLeadIn(chapter.paragraphs[0] ?? ''),
  body: chapter.paragraphs.slice(1),
}))

const ink = '#1A2026'
const softInk = '#5A636A'
const accent = '#3E5C5A'
const numeralTint = '#D6DDD8'
const coverInk = '#141A1E'
const coverPaper = '#E8E4DA'
const coverGold = '#B8A06A'

// A stand of thin reeds for the cover mark — ruled strokes, no clip art.
const reeds = [
  { x: 10, top: 30 },
  { x: 22, top: 12 },
  { x: 34, top: 24 },
  { x: 46, top: 6 },
  { x: 58, top: 20 },
  { x: 70, top: 34 },
  { x: 82, top: 16 },
  { x: 94, top: 28 },
]

const contentPage = {
  backgroundColor: '#FFFFFF',
  color: ink,
  paddingBottom: 60,
  paddingHorizontal: 58,
  paddingTop: 60,
} as const

const chapterPage = {
  ...contentPage,
  paddingBottom: 62,
  paddingTop: 68,
} as const

const bodyStyle = {
  color: ink,
  fontFamily: 'Lora',
  fontSize: 10.5,
  lineHeight: 1.62,
  marginBottom: 9,
  orphans: 2,
  textAlign: 'left',
  widows: 2,
} as const

const leadStyle = {
  color: ink,
  fontFamily: 'Inter',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: 1.4,
} as const

definePdf<EbookProps>({
  title: ({ ebook }) => ebook.title,
  filename: ({ ebook }) => `${ebook.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  language: 'en',
  sampleData: { ebook: sampleEbook },
  scenarios: {
    short: { ebook: shortEbook },
  },
})
</script>

<template>
  <PdfDocument
    :author="ebook.author"
    creator="Nuxt PDF"
    :subject="ebook.subtitle"
    :title="ebook.title"
    page-mode="useOutlines"
  >
    <!-- 1 · Cover — full-bleed deep ink, no running matter -->
    <PdfPage
      :size="[396, 612]"
      :style="{ backgroundColor: coverInk, color: coverPaper, padding: 0 }"
    >
      <PdfView
        :style="{
          flex: 1,
          justifyContent: 'space-between',
          paddingHorizontal: 54,
          paddingVertical: 64,
        }"
      >
        <PdfView :style="{ alignItems: 'flex-start' }">
          <PdfText
            :style="{
              color: coverGold,
              fontFamily: 'Inter',
              fontSize: 8,
              fontWeight: 600,
              letterSpacing: 2.6,
            }"
          >
            {{ ebook.imprint.toUpperCase() }}
          </PdfText>
          <PdfView :style="{ backgroundColor: coverGold, height: 0.75, marginTop: 14, width: 54 }" />
        </PdfView>

        <PdfView>
          <PdfText
            :style="{
              color: coverPaper,
              fontFamily: 'Lora',
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: -0.5,
              lineHeight: 1.02,
            }"
          >
            {{ ebook.title }}
          </PdfText>
          <PdfText
            :style="{
              color: coverPaper,
              fontFamily: 'Lora',
              fontSize: 14,
              fontStyle: 'italic',
              marginTop: 16,
              opacity: 0.82,
            }"
          >
            {{ ebook.subtitle }}
          </PdfText>
        </PdfView>

        <PdfView
          :style="{
            alignItems: 'flex-end',
            flexDirection: 'row',
            justifyContent: 'space-between',
          }"
        >
          <PdfView>
            <PdfText
              :style="{
                color: coverGold,
                fontFamily: 'Inter',
                fontSize: 7.5,
                fontWeight: 500,
                letterSpacing: 1.8,
                marginBottom: 6,
              }"
            >
              WRITTEN BY
            </PdfText>
            <PdfText :style="{ color: coverPaper, fontFamily: 'Lora', fontSize: 15 }">
              {{ ebook.author }}
            </PdfText>
          </PdfView>

          <PdfSvg
            :style="{ height: 88, width: 104 }"
            viewBox="0 0 104 88"
          >
            <PdfLine
              v-for="reed in reeds"
              :key="reed.x"
              :x1="reed.x"
              :y1="reed.top"
              :x2="reed.x"
              y2="62"
              :stroke="coverPaper"
              stroke-width="0.75"
              stroke-linecap="round"
            />
            <PdfCircle
              v-for="reed in reeds"
              :key="`h-${reed.x}`"
              :cx="reed.x"
              :cy="reed.top"
              r="1.4"
              :fill="coverGold"
            />
            <PdfLine
              x1="0"
              y1="62"
              x2="104"
              y2="62"
              :stroke="coverGold"
              stroke-width="0.75"
            />
            <PdfLine
              v-for="reed in reeds"
              :key="`r-${reed.x}`"
              :x1="reed.x"
              y1="62"
              :x2="reed.x"
              :y2="62 + (62 - reed.top) * 0.32"
              :stroke="coverPaper"
              stroke-width="0.4"
              stroke-opacity="0.35"
              stroke-linecap="round"
            />
          </PdfSvg>
        </PdfView>
      </PdfView>
    </PdfPage>

    <!-- 2 · Title page + colophon — quiet, no running matter -->
    <PdfPage
      :size="[396, 612]"
      :style="contentPage"
    >
      <PdfView :style="{ flex: 1, justifyContent: 'center' }">
        <PdfText
          :style="{ color: ink, fontFamily: 'Lora', fontSize: 30, fontWeight: 700, lineHeight: 1.08 }"
        >
          {{ ebook.title }}
        </PdfText>
        <PdfText
          :style="{ color: softInk, fontFamily: 'Lora', fontSize: 12.5, fontStyle: 'italic', marginTop: 10 }"
        >
          {{ ebook.subtitle }}
        </PdfText>
        <PdfView :style="{ backgroundColor: accent, height: 0.75, marginTop: 20, width: 40 }" />
        <PdfText
          :style="{ color: ink, fontFamily: 'Inter', fontSize: 10, fontWeight: 500, letterSpacing: 0.4, marginTop: 20 }"
        >
          {{ ebook.author }}
        </PdfText>
      </PdfView>

      <PdfView :style="{ borderTopColor: '#E2E5E1', borderTopWidth: 0.75, paddingTop: 16 }">
        <PdfText
          v-for="(line, index) in ebook.colophon"
          :key="index"
          :style="{ color: softInk, fontFamily: 'Inter', fontSize: 7.5, lineHeight: 1.55, marginBottom: 2 }"
        >
          {{ line }}
        </PdfText>
        <PdfText
          :style="{ color: '#93999A', fontFamily: 'Inter', fontSize: 7.5, letterSpacing: 1.4, marginTop: 8 }"
        >
          {{ ebook.imprint.toUpperCase() }} · {{ ebook.year }}
        </PdfText>
      </PdfView>
    </PdfPage>

    <!-- 3 · Contents — roman-quiet, dot leaders, resolved page numbers, links -->
    <PdfPage
      :size="[396, 612]"
      :style="contentPage"
    >
      <PdfText
        :style="{ color: accent, fontFamily: 'Inter', fontSize: 8, fontWeight: 600, letterSpacing: 2.4, marginBottom: 6 }"
      >
        CONTENTS
      </PdfText>
      <PdfView :style="{ backgroundColor: '#E2E5E1', height: 0.75, marginBottom: 26 }" />

      <PdfLink
        v-for="chapter in ebook.chapters"
        :key="chapter.id"
        :src="`#${chapter.id}`"
        :style="{ color: ink, marginBottom: 20, textDecoration: 'none' }"
      >
        <PdfView :style="{ alignItems: 'flex-end', flexDirection: 'row' }">
          <PdfText
            :style="{ color: accent, fontFamily: 'Lora', fontSize: 10, fontStyle: 'italic', width: 26 }"
          >
            {{ chapter.numeral }}
          </PdfText>
          <PdfText :style="{ color: ink, fontFamily: 'Lora', fontSize: 12.5 }">
            {{ chapter.title }}
          </PdfText>
          <PdfView
            :style="{
              borderBottomColor: '#C9CFCB',
              borderBottomStyle: 'dotted',
              borderBottomWidth: 0.75,
              flex: 1,
              marginBottom: 3.5,
              marginHorizontal: 8,
            }"
          />
          <PdfText :style="{ color: softInk, fontFamily: 'Inter', fontSize: 10 }">
            {{ pageNumbers[chapter.id] ?? '' }}
          </PdfText>
        </PdfView>
      </PdfLink>
    </PdfPage>

    <!-- 4 · The book body — one continuous flow; chapters break to a fresh page.
         The running header (book identity) and the chapter-aware foot repeat per
         page of this single PdfPage. -->
    <PdfPage
      :size="[396, 612]"
      :style="chapterPage"
    >
      <!-- running header: static book identity -->
      <PdfView
        fixed
        :style="{
          alignItems: 'baseline',
          borderBottomColor: '#EAEDEA',
          borderBottomWidth: 0.5,
          flexDirection: 'row',
          justifyContent: 'space-between',
          left: 58,
          paddingBottom: 8,
          position: 'absolute',
          right: 58,
          top: 38,
        }"
      >
        <PdfText :style="{ color: '#9AA0A0', fontFamily: 'Inter', fontSize: 6.5, fontWeight: 600, letterSpacing: 1.8 }">
          {{ ebook.title.toUpperCase() }}
        </PdfText>
        <PdfText :style="{ color: '#9AA0A0', fontFamily: 'Inter', fontSize: 6.5, letterSpacing: 1.2 }">
          {{ ebook.author }}
        </PdfText>
      </PdfView>

      <!-- Each chapter's id/bookmark wrapper anchors the destination + outline
           entry at its true start page, even after the body flows across pages.
           The resolved page of this id is what the Contents and the foot read. -->
      <PdfView
        v-for="chapter in chapters"
        :id="chapter.id"
        :key="chapter.id"
        :break="!chapter.first"
        :bookmark="chapter.title"
        :min-presence-ahead="150"
      >
        <PdfView :style="{ marginBottom: 22, marginTop: chapter.first ? 0 : 4 }">
          <PdfText
            :style="{
              color: numeralTint,
              fontFamily: 'Lora',
              fontSize: 74,
              fontWeight: 700,
              lineHeight: 1,
              marginBottom: 2,
            }"
          >
            {{ chapter.numeral }}
          </PdfText>
          <PdfText
            :style="{
              color: accent,
              fontFamily: 'Inter',
              fontSize: 7.5,
              fontWeight: 600,
              letterSpacing: 2,
              marginBottom: 7,
            }"
          >
            CHAPTER {{ chapter.numeral }}
          </PdfText>
          <PdfText
            :style="{
              color: ink,
              fontFamily: 'Lora',
              fontSize: 21,
              fontWeight: 700,
              lineHeight: 1.12,
              marginBottom: 8,
            }"
          >
            {{ chapter.title }}
          </PdfText>
          <PdfText
            :style="{
              color: softInk,
              fontFamily: 'Lora',
              fontSize: 11,
              fontStyle: 'italic',
              lineHeight: 1.4,
              maxWidth: 250,
            }"
          >
            {{ chapter.standfirst }}
          </PdfText>
          <PdfView :style="{ backgroundColor: accent, height: 0.75, marginTop: 16, width: 44 }" />
        </PdfView>

        <!-- First paragraph carries the small-caps lead-in (letterSpacing, not a
             fake drop cap — the engine keeps the baseline). Kept on one line so
             no stray whitespace splits the lead-in from the body run. -->
        <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
        <PdfText :style="bodyStyle"><PdfText :style="leadStyle">{{ chapter.lead.lead }}</PdfText>{{ chapter.lead.rest }}</PdfText>

        <PdfText
          v-for="(paragraph, index) in chapter.body"
          :key="index"
          :style="bodyStyle"
        >
          {{ paragraph }}
        </PdfText>
      </PdfView>

      <!-- chapter-aware running foot: current chapter title next to the folio,
           both derived from the resolved page map via chapterAt(). -->
      <PdfText
        fixed
        :render="({ pageNumber }) => `${chapterAt(pageNumber).title}   ·   ${pageNumber}`"
        :style="{
          bottom: 38,
          color: softInk,
          fontFamily: 'Inter',
          fontSize: 8,
          left: 58,
          letterSpacing: 0.6,
          position: 'absolute',
          right: 58,
          textAlign: 'center',
        }"
      />
    </PdfPage>
  </PdfDocument>
</template>
