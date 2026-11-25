<script setup lang="ts">
import type { PdfTableColumn } from '@lupinum/nuxt-pdf'
import type { PaperFloat, PaperTable } from '../../../shared/paper'
import { paperTheme } from '../theme'

// A table in booktabs style: the numbered caption above, a rule above and
// below the head and one at the end, no rules between rows, and a note
// below. Figures line up in tabular figures. The table floats to the top or
// the bottom of its column.
const props = defineProps<{ table: PaperTable, float: PaperFloat }>()

// The row labels take the room the value columns leave.
const columns: PdfTableColumn[] = [1, ...props.table.head.slice(1).map(() => '54pt' as const)]
</script>

<!-- Runs sit on one line: a line break inside a text would print as a space. -->
<!-- eslint-disable vue/singleline-html-element-content-newline, vue/max-attributes-per-line -->
<template>
  <PdfView :id="table.id" class="paper-table" :style="{ float }" :wrap="false">
    <PdfText class="paper-table-caption"><PdfText class="paper-table-label">{{ table.label }}</PdfText>  {{ table.caption }}</PdfText>
    <PdfTable :columns="columns">
      <PdfTableHeader class="paper-table-head">
        <PdfTableCell v-for="(cell, index) in table.head" :key="index" :align="index ? 'right' : 'left'">
          <PdfText><template v-for="(part, position) in cell" :key="position"><template v-if="typeof part === 'string'">{{ part }}</template><PdfText v-else-if="'em' in part" class="paper-table-symbol">{{ part.em }}</PdfText><PdfText v-else-if="'sup' in part" class="paper-table-sup">{{ part.sup }}</PdfText></template></PdfText>
        </PdfTableCell>
      </PdfTableHeader>
      <PdfTableRow v-for="(row, index) in table.rows" :key="row.label" :class="['paper-table-row', { 'paper-table-first': index === 0, 'paper-table-last': index === table.rows.length - 1 }]">
        <PdfTableCell header><PdfText>{{ row.label }}<PdfText v-if="row.unit" class="paper-table-unit">, {{ row.unit }}</PdfText></PdfText></PdfTableCell>
        <PdfTableCell v-for="(value, position) in row.values" :key="position" align="right">{{ value }}</PdfTableCell>
      </PdfTableRow>
    </PdfTable>
    <PdfText class="paper-table-note">{{ table.note }}</PdfText>
  </PdfView>
</template>

<style>
:root {
  --ink: v-bind('paperTheme.ink');
  --muted: v-bind('paperTheme.muted');
  --label: v-bind('paperTheme.label');
  --reading: v-bind('paperTheme.reading');
}
.paper-table {
  margin: 4pt 0 10pt;
  font-family: var(--label);
  font-size: 7.3pt;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.paper-table-caption {
  margin-bottom: 4pt;
  font-size: 7pt;
  line-height: 1.45;
  color: var(--muted);
}
.paper-table-label {
  font-weight: 600;
  color: var(--ink);
}
.paper-table-head {
  padding: 2.5pt 0;
  border-top: 0.75pt solid var(--ink);
  border-bottom: 0.5pt solid var(--ink);
  font-weight: 600;
}
/* Inter has no italic: a statistical symbol takes the reading face. */
.paper-table-symbol {
  font-family: var(--reading);
  font-style: italic;
  font-weight: 400;
}
.paper-table-sup {
  vertical-align: super;
  font-size: 70%;
}
.paper-table-row {
  padding: 1pt 0;
}
.paper-table-first {
  padding-top: 3pt;
}
.paper-table-last {
  padding-bottom: 3pt;
  border-bottom: 0.75pt solid var(--ink);
}
.paper-table-unit {
  color: var(--muted);
}
.paper-table-note {
  margin-top: 3pt;
  font-size: 6.5pt;
  line-height: 1.4;
  color: var(--muted);
}
</style>
