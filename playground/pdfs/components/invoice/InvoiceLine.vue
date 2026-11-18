<script setup lang="ts">
import type { InvoiceLineItem } from '../../../shared/invoice'
import { formatInvoiceMoney } from '../../../shared/invoice'

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
    <PdfTableCell
      align="right"
      class="line-figure"
    >
      {{ line.quantity }}
    </PdfTableCell>
    <PdfTableCell
      align="right"
      class="line-figure"
    >
      {{ rate }}
    </PdfTableCell>
    <PdfTableCell
      align="right"
      class="line-amount"
    >
      {{ amount }}
    </PdfTableCell>
  </PdfTableRow>
</template>

<style>
.line {
  align-items: flex-start;
  min-height: 54pt;
  padding-top: 12pt;
  padding-bottom: 12pt;
  border-bottom-width: 1pt;
  border-bottom-color: #DDE3DE;
}

.line-number {
  font-size: 8pt;
  color: #758078;
}

.line-description-cell {
  padding-right: 16pt;
}

.line-description {
  margin-bottom: 4pt;
  font-size: 9.5pt;
  color: #18251D;
}

.line-detail {
  font-size: 7.5pt;
  line-height: 1.45;
  color: #6A756D;
}

.line-figure {
  font-size: 8.5pt;
  color: #566159;
}

.line-amount {
  font-size: 8.5pt;
  color: #18251D;
}
</style>
