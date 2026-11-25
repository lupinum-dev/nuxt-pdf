<script setup lang="ts">
import type { PdfRichTextStyles } from '@lupinum/nuxt-pdf'
import type { Article } from '../shared/article'
import { sampleArticle } from '../shared/article'
import ArticleCallout from './components/article/ArticleCallout.vue'
import { articleTheme } from './components/theme'

defineOptions({ name: 'JournalArticlePdf' })

type ArticleProps = { article: Article }

const props = defineProps<ArticleProps>()
const article = props.article

// The comark components a Markdown body may name (`::callout`).
const components = { callout: ArticleCallout }

// Serif headings in Cormorant, quotes as a pull quote in its italic, and the
// journal's colours for code, links and rules. Literata is registered up to
// weight 600, so bold text uses it. Everything else follows the body text set
// by the `body` class.
const styles: PdfRichTextStyles = {
  h2: { fontFamily: articleTheme.display, fontWeight: 600 },
  h3: { fontFamily: articleTheme.display, fontWeight: 600 },
  strong: { fontWeight: 600 },
  quote: {
    fontFamily: articleTheme.display,
    fontStyle: 'italic',
    fontWeight: 500,
    fontSize: 13,
    lineHeight: 1.35,
    borderLeftWidth: 1.5,
    borderLeftColor: articleTheme.accent,
    color: articleTheme.ink,
  },
  code: { backgroundColor: articleTheme.tint },
  codeBlock: { backgroundColor: articleTheme.tint, borderRadius: 3, padding: 8 },
  link: { color: articleTheme.accent },
  rule: { borderTopWidth: 0.75, borderTopColor: articleTheme.hairline },
  caption: { fontStyle: 'italic', color: articleTheme.muted },
}

definePdf<ArticleProps>({
  title: ({ article }) => article.title,
  filename: () => 'journal-article.pdf',
  language: 'en',
  sampleData: { article: sampleArticle },
})
</script>

<template>
  <PdfDocument
    creator="Nuxt PDF"
    subject="Fieldnote Studio journal"
  >
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfText class="kicker">
        Fieldnote Studio · Journal
      </PdfText>
      <PdfText
        tag="h1"
        class="title"
      >
        {{ article.title }}
      </PdfText>
      <PdfText class="meta">
        {{ article.author }} · {{ article.published }}
      </PdfText>
      <PdfRichText
        class="body"
        :html="article.body"
        :content="article.content"
        :components="components"
        :styles="styles"
        bookmarks
      />
      <PdfText
        fixed
        class="folio"
      >
        Fieldnote Studio journal · <PdfPageNumber />
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The article's own look (articleTheme in components/theme.ts). */
:root {
  --paper: v-bind('articleTheme.paper');
  --ink: v-bind('articleTheme.ink');
  --muted: v-bind('articleTheme.muted');
  --hairline: v-bind('articleTheme.hairline');
  --accent: v-bind('articleTheme.accent');
  --display: v-bind('articleTheme.display');
  --reading: v-bind('articleTheme.reading');
}
.page {
  hyphens: auto;
  text-wrap: pretty;
  padding: 40pt 40pt 52pt;
  font-family: var(--reading);
  background-color: var(--paper);
  color: var(--ink);
}
.kicker {
  font-size: 7.5pt;
  font-weight: 600;
  color: var(--accent);
}
.title {
  margin-top: 8pt;
  font-family: var(--display);
  font-size: 27pt;
  font-weight: 600;
  line-height: 1.05;
}
.meta {
  margin-top: 8pt;
  margin-bottom: 16pt;
  padding-bottom: 12pt;
  border-bottom: 0.75pt solid var(--hairline);
  font-size: 8pt;
  font-style: italic;
  color: var(--muted);
}
.body {
  font-size: 9.5pt;
  line-height: 1.6;
}
.folio {
  position: absolute;
  bottom: 24pt;
  left: 40pt;
  font-size: 7pt;
  color: var(--muted);
}
</style>
