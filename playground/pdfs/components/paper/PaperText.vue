<script setup lang="ts">
import type { PaperInline } from '../../../shared/paper'
import { paperTheme } from '../theme'

// One paragraph of the paper, from its runs: plain text, italics, sub- and
// superscripts, citations linked to the reference list, and figure and table
// labels linked to their captions.
defineProps<{ parts: PaperInline[] }>()
</script>

<!-- Each run sits on one line: a line break inside a text would print as a space. -->
<!-- eslint-disable vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
<template>
  <PdfText class="paper-paragraph" :orphans="2" :widows="2">
    <template v-for="(part, index) in parts" :key="index">
      <template v-if="typeof part === 'string'">{{ part }}</template>
      <PdfText v-else-if="'em' in part" class="paper-em">{{ part.em }}</PdfText>
      <PdfText v-else-if="'sub' in part" class="paper-sub">{{ part.sub }}</PdfText>
      <PdfText v-else-if="'sup' in part" class="paper-sup">{{ part.sup }}</PdfText>
      <template v-else-if="'cite' in part">[<template v-for="(number, position) in part.cite" :key="number">{{ position ? ', ' : '' }}<PdfLink :href="`#ref-${number}`" class="paper-link">{{ number }}</PdfLink></template>]</template>
      <PdfLink v-else :href="`#${part.ref}`" class="paper-link">{{ part.label }}</PdfLink>
    </template>
  </PdfText>
</template>

<style>
:root {
  --accent: v-bind('paperTheme.accent');
}
.paper-paragraph {
  margin-bottom: 4pt;
  text-align: justify;
}
.paper-em {
  font-style: italic;
}
.paper-sub {
  vertical-align: sub;
  font-size: 70%;
}
.paper-sup {
  vertical-align: super;
  font-size: 70%;
}
.paper-link {
  text-decoration: none;
  color: var(--accent);
}
</style>
