<script setup lang="ts">
import type { Ebook } from '../shared/ebook'
import { sampleEbook, shortEbook, splitLeadIn } from '../shared/ebook'
import EbookContents from './components/ebook/EbookContents.vue'
import EbookCover from './components/ebook/EbookCover.vue'
import EbookTitlePage from './components/ebook/EbookTitlePage.vue'
import { ebookTheme } from './components/theme'

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
    :conformance="['PDF/A-3a', 'PDF/UA-1']"
    creator="Nuxt PDF"
    :subject="ebook.subtitle"
  >
    <!-- 1 · Cover and 2 · title page without running matter, 3 · contents
         with the page each chapter starts on (PdfPageRef). -->
    <EbookCover :ebook="ebook" />
    <EbookTitlePage :ebook="ebook" />
    <EbookContents :ebook="ebook" />

    <!-- 4 · The body: one flow in which each chapter starts a new page. The
         running head and the chapter's foot repeat on every page. -->
    <PdfPage
      :size="[396, 612]"
      class="page body-page"
    >
      <PdfView
        fixed
        class="running-head"
      >
        <PdfText class="running-title">
          {{ ebook.title }}
        </PdfText>
        <PdfText class="running-author">
          {{ ebook.author }}
        </PdfText>
      </PdfView>

      <!-- The chapter's id and bookmark point at the page where it starts.
           flexGrow fills its last page, so the foot sits at the page bottom. -->
      <PdfView
        v-for="chapter in chapters"
        :id="chapter.id"
        :key="chapter.id"
        :break="!chapter.first"
        :bookmark="chapter.title"
        class="chapter"
        tag="section"
      >
        <!-- A fixed node repeats on every page its parent spans, so each
             chapter prints its own title next to the page number. -->
        <PdfText
          fixed
          class="running-foot"
        >
          {{ chapter.title }}   ·   <PdfPageNumber />
        </PdfText>

        <PdfView :class="['chapter-head', { 'chapter-head-following': !chapter.first }]">
          <PdfText class="chapter-label">
            Chapter {{ chapter.numeral }}
          </PdfText>
          <PdfText
            class="chapter-title"
            tag="h2"
          >
            {{ chapter.title }}
          </PdfText>
          <PdfText class="standfirst">
            {{ chapter.standfirst }}
          </PdfText>
        </PdfView>

        <!-- The first paragraph opens with a letter-spaced lead-in; one line,
             so no whitespace splits the lead-in from the text. -->
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
/* The e-book's own look (ebookTheme in components/theme.ts): Cormorant for
   the display lines, Literata for the reading text. */
:root {
  --paper: v-bind('ebookTheme.paper');
  --ink: v-bind('ebookTheme.ink');
  --muted: v-bind('ebookTheme.muted');
  --hairline: v-bind('ebookTheme.hairline');
  --accent: v-bind('ebookTheme.accent');
  --display: v-bind('ebookTheme.display');
  --reading: v-bind('ebookTheme.reading');
  --page-margin: 54pt;
}

.page {
  hyphens: auto;
  text-wrap: pretty;
  padding: 60pt var(--page-margin);
  font-family: var(--reading);
  color: var(--ink);
  background-color: var(--paper);
}

.body-page {
  padding-top: 68pt;
  padding-bottom: 62pt;
}

.running-head {
  position: absolute;
  top: 36pt;
  right: var(--page-margin);
  left: var(--page-margin);
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 7pt;
  border-bottom: 0.75pt solid var(--hairline);
}

.running-title {
  font-family: var(--display);
  font-size: 9pt;
  font-style: italic;
  font-weight: 500;
  color: var(--ink);
}

.running-author {
  font-size: 7pt;
  color: var(--muted);
}

.chapter {
  flex-grow: 1;
}

.running-foot {
  position: absolute;
  right: 0;
  bottom: -24pt;
  left: 0;
  font-size: 7.5pt;
  text-align: center;
  color: var(--muted);
}

.chapter-head {
  margin-bottom: 20pt;
  padding-bottom: 16pt;
  border-bottom: 0.75pt solid var(--hairline);
}

.chapter-head-following {
  margin-top: 4pt;
}

.chapter-label {
  margin-bottom: 6pt;
  font-family: var(--display);
  font-size: 13pt;
  font-style: italic;
  font-weight: 500;
  color: var(--accent);
}

.chapter-title {
  margin-bottom: 8pt;
  font-family: var(--display);
  font-size: 30pt;
  font-weight: 500;
  line-height: 1.05;
}

.standfirst {
  max-width: 260pt;
  font-size: 10pt;
  font-style: italic;
  line-height: 1.5;
  color: var(--muted);
}

.paragraph {
  margin-bottom: 8pt;
  font-size: 10pt;
  line-height: 1.6;
  text-align: justify;
  color: var(--ink);
}

.lead-in {
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 0.6pt;
  color: var(--ink);
}
</style>
