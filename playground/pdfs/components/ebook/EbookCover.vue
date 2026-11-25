<script setup lang="ts">
import type { Ebook } from '../../../shared/ebook'
import { ebookTheme } from '../theme'
import EbookReeds from './EbookReeds.vue'

// Page 1 of the e-book: an editorial cover with the title in Cormorant, the
// reed drawing and the author. No running matter.
defineProps<{ ebook: Ebook }>()
</script>

<template>
  <PdfPage
    :size="[396, 612]"
    class="cover"
  >
    <PdfView class="cover-head">
      <PdfText class="cover-imprint">
        {{ ebook.imprint }}
      </PdfText>
      <PdfText
        class="cover-title"
        tag="h1"
      >
        {{ ebook.title }}
      </PdfText>
      <PdfView class="cover-rule" />
      <PdfText class="cover-subtitle">
        {{ ebook.subtitle }}
      </PdfText>
    </PdfView>

    <EbookReeds />

    <PdfView class="cover-foot">
      <PdfText class="cover-author">
        {{ ebook.author }}
      </PdfText>
      <PdfText class="cover-year">
        {{ ebook.year }}
      </PdfText>
    </PdfView>
  </PdfPage>
</template>

<style>
:root {
  --paper: v-bind('ebookTheme.paper');
  --ink: v-bind('ebookTheme.ink');
  --muted: v-bind('ebookTheme.muted');
  --hairline: v-bind('ebookTheme.hairline');
  --accent: v-bind('ebookTheme.accent');
  --display: v-bind('ebookTheme.display');
  --reading: v-bind('ebookTheme.reading');
}

.cover {
  hyphens: auto;
  justify-content: space-between;
  padding: 44pt 40pt 40pt;
  font-family: var(--reading);
  color: var(--ink);
  background-color: var(--paper);
}

.cover-head {
  align-items: flex-start;
}

.cover-imprint {
  font-size: 8.5pt;
  font-style: italic;
  color: var(--muted);
}

.cover-title {
  margin-top: 26pt;
  font-family: var(--display);
  font-size: 54pt;
  font-weight: 500;
  line-height: 0.98;
}

.cover-rule {
  width: 32pt;
  margin-top: 18pt;
  border-top: 1pt solid var(--accent);
}

.cover-subtitle {
  margin-top: 14pt;
  font-size: 11pt;
  font-style: italic;
  line-height: 1.45;
  color: var(--muted);
}

.cover-foot {
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
  padding-top: 12pt;
  border-top: 0.75pt solid var(--hairline);
}

.cover-author {
  font-family: var(--display);
  font-size: 17pt;
  font-weight: 600;
}

.cover-year {
  font-size: 8.5pt;
  color: var(--muted);
}
</style>
