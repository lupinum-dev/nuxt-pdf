<script setup lang="ts">
import type { Ebook } from '../shared/ebook'
import { sampleEbook, shortEbook, splitLeadIn } from '../shared/ebook'
import DotLeader from './components/common/DotLeader.vue'

defineOptions({ name: 'EbookPdf' })

type EbookProps = { ebook: Ebook }

const props = defineProps<EbookProps>()
const ebook = props.ebook

// Precompute the small-caps lead-in split (first four words, uppercased) and the
// remaining body once per chapter, so the template stays declarative.
const chapters = ebook.chapters.map((chapter, index) => ({
  ...chapter,
  first: index === 0,
  lead: splitLeadIn(chapter.paragraphs[0] ?? ''),
  body: chapter.paragraphs.slice(1),
}))

// Cover colours for the reed mark; the styles carry the same literals.
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
  >
    <!-- 1 · Cover — full-bleed deep ink, no running matter -->
    <PdfPage
      :size="[396, 612]"
      class="cover"
    >
      <PdfView class="cover-body">
        <PdfView class="cover-head">
          <PdfText class="cover-imprint">
            {{ ebook.imprint.toUpperCase() }}
          </PdfText>
          <PdfView class="cover-rule" />
        </PdfView>

        <PdfView>
          <PdfText class="cover-title">
            {{ ebook.title }}
          </PdfText>
          <PdfText class="cover-subtitle">
            {{ ebook.subtitle }}
          </PdfText>
        </PdfView>

        <PdfView class="cover-foot">
          <PdfView>
            <PdfText class="cover-byline">
              WRITTEN BY
            </PdfText>
            <PdfText class="cover-author">
              {{ ebook.author }}
            </PdfText>
          </PdfView>

          <PdfSvg
            class="cover-mark"
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
      class="page"
    >
      <PdfView class="title-block">
        <PdfText class="title">
          {{ ebook.title }}
        </PdfText>
        <PdfText class="subtitle">
          {{ ebook.subtitle }}
        </PdfText>
        <PdfView class="title-rule" />
        <PdfText class="author">
          {{ ebook.author }}
        </PdfText>
      </PdfView>

      <PdfView class="colophon">
        <PdfText
          v-for="(line, index) in ebook.colophon"
          :key="index"
          class="colophon-line"
        >
          {{ line }}
        </PdfText>
        <PdfText class="colophon-imprint">
          {{ ebook.imprint.toUpperCase() }} · {{ ebook.year }}
        </PdfText>
      </PdfView>
    </PdfPage>

    <!-- 3 · Contents — roman-quiet, dot leaders, resolved page numbers, links -->
    <PdfPage
      :size="[396, 612]"
      class="page"
    >
      <PdfText class="contents-label">
        CONTENTS
      </PdfText>
      <PdfView class="contents-rule" />

      <PdfLink
        v-for="chapter in ebook.chapters"
        :key="chapter.id"
        :href="`#${chapter.id}`"
        class="toc-link"
      >
        <PdfView class="toc-row">
          <PdfText class="toc-numeral">
            {{ chapter.numeral }}
          </PdfText>
          <PdfText class="toc-title">
            {{ chapter.title }}
          </PdfText>
          <DotLeader
            :baseline="3.5"
            :gap="8"
            color="#C9CFCB"
            :width="0.75"
          />
          <!-- The page where the chapter starts, resolved after layout. -->
          <PdfText class="toc-page">
            <PdfPageRef :to="chapter.id" />
          </PdfText>
        </PdfView>
      </PdfLink>
    </PdfPage>

    <!-- 4 · The book body — one continuous flow; chapters break to a fresh page.
         The running header (book identity) and the chapter-aware foot repeat per
         page of this single PdfPage. -->
    <PdfPage
      :size="[396, 612]"
      class="page body-page"
    >
      <!-- running header: static book identity -->
      <PdfView
        fixed
        class="running-head"
      >
        <PdfText class="running-title">
          {{ ebook.title.toUpperCase() }}
        </PdfText>
        <PdfText class="running-author">
          {{ ebook.author }}
        </PdfText>
      </PdfView>

      <!-- Each chapter's id/bookmark wrapper anchors the destination + outline
           entry at its true start page, even after the body flows across pages.
           Every body page holds one chapter, and flexGrow lets the chapter fill
           its last page too, so the foot inside it sits at the page bottom. -->
      <PdfView
        v-for="chapter in chapters"
        :id="chapter.id"
        :key="chapter.id"
        :break="!chapter.first"
        :bookmark="chapter.title"
        :min-presence-ahead="150"
        class="chapter"
      >
        <!-- chapter-aware running foot: a fixed element repeats on every page
             its parent spans, so each chapter prints its own title next to the
             folio. 24 pt below the chapter box is 38 pt above the page edge. -->
        <PdfText
          fixed
          class="running-foot"
        >
          {{ chapter.title }}   ·   <PdfPageNumber />
        </PdfText>

        <PdfView :class="['chapter-head', { 'chapter-head-following': !chapter.first }]">
          <PdfText class="chapter-numeral">
            {{ chapter.numeral }}
          </PdfText>
          <PdfText class="chapter-label">
            CHAPTER {{ chapter.numeral }}
          </PdfText>
          <PdfText class="chapter-title">
            {{ chapter.title }}
          </PdfText>
          <PdfText class="standfirst">
            {{ chapter.standfirst }}
          </PdfText>
          <PdfView class="chapter-rule" />
        </PdfView>

        <!-- First paragraph carries the small-caps lead-in (letterSpacing, not a
             fake drop cap — the engine keeps the baseline). Kept on one line so
             no stray whitespace splits the lead-in from the body run. -->
        <!-- eslint-disable-next-line vue/max-attributes-per-line, vue/singleline-html-element-content-newline -->
        <PdfText class="paragraph" :orphans="2" :widows="2"><PdfText class="lead-in">{{ chapter.lead.lead }}</PdfText>{{ chapter.lead.rest }}</PdfText>

        <PdfText
          v-for="(paragraph, index) in chapter.body"
          :key="index"
          :orphans="2"
          class="paragraph"
          :widows="2"
        >
          {{ paragraph }}
        </PdfText>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root {
  --ink: #1A2026;
  --muted: #5A636A;
  --accent: #3E5C5A;
  --cover-paper: #E8E4DA;
  --cover-gold: #B8A06A;
  --font-body: Inter;
  --font-display: Lora;
  --page-margin: 58pt;
}
.cover {
  padding: 0;
  color: var(--cover-paper);
  background-color: #141A1E;
}

.cover-body {
  flex: 1;
  justify-content: space-between;
  padding: 64pt 54pt;
}

.cover-head {
  align-items: flex-start;
}

.cover-imprint {
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 2.6pt;
  color: var(--cover-gold);
}

.cover-rule {
  margin-top: 14pt;
  width: 54pt;
  height: 0.75pt;
  background-color: var(--cover-gold);
}

.cover-title {
  font-family: var(--font-display);
  font-size: 52pt;
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.5pt;
  color: var(--cover-paper);
}

.cover-subtitle {
  margin-top: 16pt;
  font-family: var(--font-display);
  font-size: 14pt;
  font-style: italic;
  color: var(--cover-paper);
  opacity: 0.82;
}

.cover-foot {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
}

.cover-byline {
  margin-bottom: 6pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  font-weight: 500;
  letter-spacing: 1.8pt;
  color: var(--cover-gold);
}

.cover-author {
  font-family: var(--font-display);
  font-size: 15pt;
  color: var(--cover-paper);
}

.cover-mark {
  width: 104pt;
  height: 88pt;
}

.page {
  padding: 60pt var(--page-margin);
  color: var(--ink);
  background-color: #FFFFFF;
}

.title-block {
  flex: 1;
  justify-content: center;
}

.title {
  font-family: var(--font-display);
  font-size: 30pt;
  font-weight: 700;
  line-height: 1.08;
  color: var(--ink);
}

.subtitle {
  margin-top: 10pt;
  font-family: var(--font-display);
  font-size: 12.5pt;
  font-style: italic;
  color: var(--muted);
}

.title-rule {
  margin-top: 20pt;
  width: 40pt;
  height: 0.75pt;
  background-color: var(--accent);
}

.author {
  margin-top: 20pt;
  font-family: var(--font-body);
  font-size: 10pt;
  font-weight: 500;
  letter-spacing: 0.4pt;
  color: var(--ink);
}

.colophon {
  padding-top: 16pt;
  border-top-width: 0.75pt;
  border-top-color: #E2E5E1;
}

.colophon-line {
  margin-bottom: 2pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  line-height: 1.55;
  color: var(--muted);
}

.colophon-imprint {
  margin-top: 8pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  letter-spacing: 1.4pt;
  color: #93999A;
}

.contents-label {
  margin-bottom: 6pt;
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 2.4pt;
  color: var(--accent);
}

.contents-rule {
  margin-bottom: 26pt;
  height: 0.75pt;
  background-color: #E2E5E1;
}

.toc-link {
  margin-bottom: 20pt;
  text-decoration: none;
  color: var(--ink);
}

.toc-row {
  flex-direction: row;
  align-items: flex-end;
}

.toc-numeral {
  width: 26pt;
  font-family: var(--font-display);
  font-size: 10pt;
  font-style: italic;
  color: var(--accent);
}

.toc-title {
  font-family: var(--font-display);
  font-size: 12.5pt;
  color: var(--ink);
}

.toc-page {
  font-family: var(--font-body);
  font-size: 10pt;
  color: var(--muted);
}

.body-page {
  padding-top: 68pt;
  padding-bottom: 62pt;
}

.running-head {
  position: absolute;
  top: 38pt;
  right: var(--page-margin);
  left: var(--page-margin);
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 8pt;
  border-bottom-width: 0.5pt;
  border-bottom-color: #EAEDEA;
}

.running-title {
  font-family: var(--font-body);
  font-size: 6.5pt;
  font-weight: 600;
  letter-spacing: 1.8pt;
  color: #9AA0A0;
}

.running-author {
  font-family: var(--font-body);
  font-size: 6.5pt;
  letter-spacing: 1.2pt;
  color: #9AA0A0;
}

.chapter {
  flex-grow: 1;
}

.running-foot {
  position: absolute;
  right: 0;
  bottom: -24pt;
  left: 0;
  font-family: var(--font-body);
  font-size: 8pt;
  letter-spacing: 0.6pt;
  text-align: center;
  color: var(--muted);
}

.chapter-head {
  margin-bottom: 22pt;
}

.chapter-head-following {
  margin-top: 4pt;
}

.chapter-numeral {
  margin-bottom: 2pt;
  font-family: var(--font-display);
  font-size: 74pt;
  font-weight: 700;
  line-height: 1;
  color: #D6DDD8;
}

.chapter-label {
  margin-bottom: 7pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 2pt;
  color: var(--accent);
}

.chapter-title {
  margin-bottom: 8pt;
  font-family: var(--font-display);
  font-size: 21pt;
  font-weight: 700;
  line-height: 1.12;
  color: var(--ink);
}

.standfirst {
  max-width: 250pt;
  font-family: var(--font-display);
  font-size: 11pt;
  font-style: italic;
  line-height: 1.4;
  color: var(--muted);
}

.chapter-rule {
  margin-top: 16pt;
  width: 44pt;
  height: 0.75pt;
  background-color: var(--accent);
}

.paragraph {
  margin-bottom: 9pt;
  font-family: var(--font-display);
  font-size: 10.5pt;
  line-height: 1.62;
  text-align: left;
  color: var(--ink);
}

.lead-in {
  font-family: var(--font-body);
  font-size: 9.5pt;
  font-weight: 600;
  letter-spacing: 1.4pt;
  color: var(--ink);
}
</style>
