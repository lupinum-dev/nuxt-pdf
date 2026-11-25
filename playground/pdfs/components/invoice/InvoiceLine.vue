<script setup lang="ts">
import type { InvoiceLineItem } from '../../../shared/invoice'
import { formatInvoiceMoney } from '../../../shared/invoice'
import { theme } from '../theme'

const props = defineProps<{
  currency: string
  index: number
  line: InvoiceLineItem
}>()

const amount = formatInvoiceMoney(
  props.line.quantity * props.line.unitPrice,
  props.currency,
)
const rate = formatInvoiceMoney(props.line.unitPrice, props.currency)
</script>

<template>
  <!-- One row of the PdfTable in invoice.vue; it takes its columns from there. -->
  <PdfTableRow class="line">
    <PdfTableCell class="line-number">
      {{ String(index + 1).padStart(2, '0') }}
    </PdfTableCell>
    <PdfTableCell class="line-description-cell">
      <PdfText class="line-description">
        {{ line.description }}
      </PdfText>
      <PdfText class="line-detail">
        {{ line.detail }}
      </PdfText>
    </PdfTableCell>
    <PdfTableCell class="line-figure">
      {{ line.quantity }}
    </PdfTableCell>
    <PdfTableCell class="line-figure">
      {{ rate }}
    </PdfTableCell>
    <PdfTableCell class="line-amount">
      {{ amount }}
    </PdfTableCell>
  </PdfTableRow>
</template>

<style>
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
  --border: v-bind('theme.border');
}
/* A divider above every row: the first one parts the rows from the header,
   and the card around the table closes the last one. */
.line {
  align-items: flex-start;
  min-height: 44pt;
  padding-top: 10pt;
  padding-bottom: 10pt;
  border-top: 1pt solid var(--border);
}

.line-number {
  font-size: 8pt;
  color: var(--muted-foreground);
}

.line-description-cell {
  padding-right: 16pt;
}

.line-description {
  margin-bottom: 3pt;
  font-size: 9pt;
  font-weight: 500;
  color: var(--foreground);
}

.line-detail {
  font-size: 7.5pt;
  line-height: 1.45;
  color: var(--muted-foreground);
}

.line-figure {
  font-size: 8.5pt;
  color: var(--muted-foreground);
}

.line-amount {
  font-size: 8.5pt;
  font-weight: 500;
  color: var(--foreground);
}
</style>
