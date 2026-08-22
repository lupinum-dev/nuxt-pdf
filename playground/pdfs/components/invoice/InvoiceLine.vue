<script setup lang="ts">
import type { InvoiceLineItem } from '../../../shared/invoice'
import { formatInvoiceMoney } from '../../../shared/invoice'
import { INVOICE_COLUMNS as columns } from './columns'

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
  <PdfView
    :style="{
      alignItems: 'flex-start',
      borderBottomColor: '#DDE3DE',
      borderBottomWidth: 1,
      flexDirection: 'row',
      minHeight: 54,
      paddingBottom: 12,
      paddingTop: 12,
    }"
    :wrap="false"
  >
    <PdfText :style="{ color: '#758078', fontSize: 8, width: columns.sequence.width }">
      {{ String(index + 1).padStart(2, '0') }}
    </PdfText>
    <PdfView :style="{ paddingRight: 16, width: columns.description.width }">
      <PdfText :style="{ color: '#18251D', fontSize: 9.5, marginBottom: 4 }">
        {{ line.description }}
      </PdfText>
      <PdfText :style="{ color: '#6A756D', fontSize: 7.5, lineHeight: 1.45 }">
        {{ line.detail }}
      </PdfText>
    </PdfView>
    <PdfText :style="{ color: '#566159', fontSize: 8.5, textAlign: 'right', width: columns.quantity.width }">
      {{ line.quantity }}
    </PdfText>
    <PdfText :style="{ color: '#566159', fontSize: 8.5, textAlign: 'right', width: columns.rate.width }">
      {{ rate }}
    </PdfText>
    <PdfText :style="{ color: '#18251D', fontSize: 8.5, textAlign: 'right', width: columns.amount.width }">
      {{ amount }}
    </PdfText>
  </PdfView>
</template>
