<script setup lang="ts">
import type { Ebook } from '../../../shared/ebook'
import { ebookTheme } from '../theme'

// Page 2 of the e-book: the title page with the colophon at its foot. Quiet,
// no running matter.
defineProps<{ ebook: Ebook }>()
</script>

<template>
  <PdfPage
    :size="[396, 612]"
    class="title-page"
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
        {{ ebook.imprint }} · {{ ebook.year }}
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

.title-page {
  hyphens: auto;
  padding: 60pt 54pt;
  font-family: var(--reading);
  color: var(--ink);
  background-color: var(--paper);
}

.title-block {
  flex: 1;
  justify-content: center;
  align-items: center;
}

.title {
  font-family: var(--display);
  font-size: 34pt;
  font-weight: 500;
  line-height: 1.05;
  text-align: center;
}

.subtitle {
  margin-top: 10pt;
  font-size: 10.5pt;
  font-style: italic;
  line-height: 1.45;
  text-align: center;
  color: var(--muted);
}

.title-rule {
  width: 32pt;
  margin-top: 22pt;
  border-top: 1pt solid var(--accent);
}

.author {
  margin-top: 20pt;
  font-family: var(--display);
  font-size: 14pt;
  font-weight: 600;
}

.colophon {
  align-items: center;
  padding-top: 16pt;
  border-top: 0.75pt solid var(--hairline);
}

.colophon-line {
  margin-bottom: 2pt;
  font-size: 7.5pt;
  line-height: 1.55;
  text-align: center;
  color: var(--muted);
}

.colophon-imprint {
  margin-top: 8pt;
  font-size: 7.5pt;
  font-style: italic;
  color: var(--muted);
}
</style>
