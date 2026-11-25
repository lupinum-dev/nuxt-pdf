<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import type { PdfRichBlock } from '@lupinum/nuxt-pdf'

defineProps<{ html?: string, content?: readonly PdfRichBlock[] }>()

definePdf<{ html?: string, content?: readonly PdfRichBlock[] }>({
  title: 'Field notes',
  language: 'en',
})
</script>

<template>
  <PdfDocument :creation-date="new Date('2026-11-03T08:00:00Z')">
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfRichText
        v-if="html"
        :html="html"
        class="body"
        broken-images="placeholder"
        bookmarks
      />
      <PdfRichText
        v-else
        :content="content"
        class="body"
        broken-images="placeholder"
        bookmarks
      />
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 40pt;
  font-family: Lora;
  color: #2b2118;
}
.body {
  font-size: 10pt;
  line-height: 1.45;
}
</style>
