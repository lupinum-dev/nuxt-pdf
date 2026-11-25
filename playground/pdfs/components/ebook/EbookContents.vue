<script setup lang="ts">
import type { Ebook } from '../../../shared/ebook'
import { ebookTheme } from '../theme'

// Page 3 of the e-book: the contents, with roman numerals, dot leaders and
// the page on which each chapter starts, resolved after layout. Each entry
// links to its chapter.
defineProps<{ ebook: Ebook }>()
</script>

<template>
  <PdfPage
    :size="[396, 612]"
    class="contents-page"
  >
    <PdfText
      class="contents-label"
      tag="h2"
    >
      Contents
    </PdfText>

    <!-- A list of links: each item holds its link, as a link holds no list. -->
    <PdfView tag="list">
      <PdfView
        v-for="chapter in ebook.chapters"
        :key="chapter.id"
        tag="list-item"
      >
        <PdfLink
          :href="`#${chapter.id}`"
          class="toc-link"
        >
          <PdfView class="toc-row">
            <PdfText class="toc-numeral">
              {{ chapter.numeral }}
            </PdfText>
            <PdfText class="toc-entry">
              <PdfText class="toc-title">
                {{ chapter.title }}
              </PdfText>
              <PdfLeader :style="{ borderBottomColor: ebookTheme.hairline, borderBottomWidth: 0.75, marginLeft: 8, marginRight: 8 }" />
              <PdfText class="toc-page">
                <PdfPageRef :to="chapter.id" />
              </PdfText>
            </PdfText>
          </PdfView>
        </PdfLink>
      </PdfView>
    </PdfView>
  </PdfPage>
</template>

<style>
:root {
  --paper: v-bind('ebookTheme.paper');
  --ink: v-bind('ebookTheme.ink');
  --muted: v-bind('ebookTheme.muted');
  --accent: v-bind('ebookTheme.accent');
  --display: v-bind('ebookTheme.display');
  --reading: v-bind('ebookTheme.reading');
}

.contents-page {
  hyphens: auto;
  padding: 60pt 54pt;
  font-family: var(--reading);
  color: var(--ink);
  background-color: var(--paper);
}

.contents-label {
  margin-bottom: 26pt;
  font-family: var(--display);
  font-size: 30pt;
  font-weight: 500;
}

.toc-link {
  margin-bottom: 16pt;
  text-decoration: none;
  color: var(--ink);
}

.toc-row {
  flex-direction: row;
  align-items: baseline;
}

.toc-numeral {
  width: 30pt;
  font-family: var(--display);
  font-size: 13pt;
  font-style: italic;
  font-weight: 500;
  color: var(--accent);
}

/* The title, the leader and the page number: one text beside the numeral. */
.toc-entry {
  flex: 1;
  font-size: 10pt;
}

.toc-title {
  font-family: var(--display);
  font-size: 14pt;
  font-weight: 600;
  color: var(--ink);
}

.toc-page {
  font-size: 9.5pt;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
