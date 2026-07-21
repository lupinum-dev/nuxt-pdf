<script setup lang="ts">
import QRCode from 'qrcode'
import type { LupinumInvoice } from '../shared/lupinum-invoice'
import {
  buildEpcQrPayload,
  formatLupinumDate,
  formatLupinumMoney,
  formatLupinumQuantity,
  longLupinumInvoice,
  lupinumInvoiceDueDate,
  lupinumInvoiceLineDetail,
  lupinumInvoiceLineTotal,
  lupinumInvoiceTotals,
  resolveLupinumInvoiceCopy,
  sampleLupinumInvoice,
} from '../shared/lupinum-invoice'

defineOptions({ name: 'LupinumInvoicePdf' })

type LupinumInvoiceProps = {
  invoice: LupinumInvoice
}

const props = defineProps<LupinumInvoiceProps>()
const invoice = props.invoice
const copy = resolveLupinumInvoiceCopy(invoice)
const totals = lupinumInvoiceTotals(invoice)
const dueDate = lupinumInvoiceDueDate(invoice)
const money = (value: number, sign = false) => formatLupinumMoney(value, invoice.locale, { sign })
const date = (value: string) => formatLupinumDate(value, invoice.locale)
const qrPayload = buildEpcQrPayload(invoice, totals.total)
const vatPercent = formatLupinumQuantity(invoice.vatRate * 100, invoice.locale)
const qr = QRCode.create(qrPayload, { errorCorrectionLevel: 'M' })
const qrQuietZone = 1
const qrViewBoxSize = qr.modules.size + qrQuietZone * 2
const qrPath = Array.from({ length: qr.modules.size }, (_, row) => {
  const runs: string[] = []
  let start = -1
  for (let column = 0; column <= qr.modules.size; column += 1) {
    const dark = column < qr.modules.size && qr.modules.get(row, column)
    if (dark && start < 0) start = column
    if (!dark && start >= 0) {
      runs.push(`M${start + qrQuietZone} ${row + qrQuietZone}h${column - start}v1H${start + qrQuietZone}z`)
      start = -1
    }
  }
  return runs.join('')
}).join('')

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: '#404040',
  fontFamily: 'Lupinum Sans',
  fontSize: 9.65,
  fontWeight: 300,
  lineHeight: 1.3,
  paddingBottom: 58,
  paddingHorizontal: 42,
  paddingTop: 85,
}

const labelStyle = {
  fontSize: 8.7,
  fontWeight: 700,
  letterSpacing: 0.65,
  textTransform: 'uppercase' as const,
}

definePdf<LupinumInvoiceProps>({
  title: ({ invoice }) => `Rechnung ${invoice.number}`,
  filename: ({ invoice }) => `${invoice.number}.pdf`,
  language: 'de-AT',
  sampleData: { invoice: sampleLupinumInvoice },
  scenarios: {
    long: { invoice: longLupinumInvoice },
  },
})
</script>

<template>
  <PdfDocument
    :author="invoice.company.name"
    creator="Nuxt PDF"
    :subject="`${copy.documentLabel} ${invoice.number}`"
    :title="`${copy.documentLabel} ${invoice.number}`"
  >
    <PdfPage
      size="A4"
      :style="pageStyle"
    >
      <PdfText
        fixed
        :style="{
          color: '#090909',
          fontSize: 6,
          fontWeight: 700,
          left: 452,
          letterSpacing: 1.3,
          position: 'absolute',
          right: 42,
          textAlign: 'right',
          top: 16,
        }"
      >
        {{ copy.documentLabel }} {{ invoice.number }}
      </PdfText>

      <PdfView
        fixed
        :style="{
          borderTopColor: '#000914',
          borderTopWidth: 0.55,
          bottom: 40,
          left: 42,
          position: 'absolute',
          right: 42,
        }"
      />
      <PdfLink
        fixed
        :href="invoice.company.contact.websiteUrl"
        :style="{
          bottom: 23.3,
          color: '#090909',
          fontSize: 7.8,
          left: 50,
          letterSpacing: 1.1,
          position: 'absolute',
          textDecoration: 'underline',
        }"
      >
        {{ invoice.company.contact.website }}
      </PdfLink>
      <PdfLink
        fixed
        :href="`mailto:${invoice.company.contact.email}`"
        :style="{
          bottom: 23.3,
          color: '#090909',
          fontSize: 7.8,
          left: 148,
          letterSpacing: 1.1,
          position: 'absolute',
          textDecoration: 'underline',
        }"
      >
        {{ invoice.company.contact.email }}
      </PdfLink>
      <PdfLink
        fixed
        :href="`tel:${invoice.company.contact.phone.replaceAll(' ', '')}`"
        :style="{
          bottom: 23.3,
          color: '#090909',
          fontSize: 7.8,
          left: 247,
          letterSpacing: 1.1,
          position: 'absolute',
          textDecoration: 'underline',
        }"
      >
        {{ invoice.company.contact.phone }}
      </PdfLink>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `Seite ${pageNumber} / ${totalPages}`"
        :style="{
          bottom: 26,
          color: '#090909',
          fontSize: 6.7,
          fontWeight: 700,
          letterSpacing: 1.1,
          position: 'absolute',
          right: 51,
        }"
      />

      <PdfView
        :style="{
          alignItems: 'flex-start',
          flexDirection: 'row',
          justifyContent: 'space-between',
          minHeight: 63,
        }"
        :wrap="false"
      >
        <PdfView :style="{ paddingTop: 1, width: 172 }">
          <PdfText :style="{ fontSize: 9.65, fontWeight: 300, marginBottom: 3 }">
            {{ invoice.company.name }}
          </PdfText>
          <PdfText>{{ invoice.company.address }}</PdfText>
          <PdfText>{{ invoice.company.postalCity }}</PdfText>
          <PdfText
            v-if="invoice.company.vatId"
            :style="{ marginTop: 3 }"
          >
            U-ID: {{ invoice.company.vatId }}
          </PdfText>
        </PdfView>
        <PdfImage
          src="lupinum-logo.png"
          :style="{ height: 35.4, objectFit: 'contain', width: 147 }"
        />
      </PdfView>

      <PdfView
        :style="{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 17,
        }"
        :wrap="false"
      >
        <PdfView :style="{ width: 250 }">
          <PdfText :style="{ ...labelStyle, marginBottom: 8 }">
            {{ copy.customerLabel }}
          </PdfText>
          <PdfText :style="{ fontSize: 9.65, fontWeight: 300, marginBottom: 3 }">
            {{ invoice.customer.name }}
          </PdfText>
          <PdfText>{{ invoice.customer.address }}</PdfText>
          <PdfText>{{ invoice.customer.postalCity }}</PdfText>
          <PdfText
            v-if="invoice.customer.vatId"
            :style="{ marginTop: 3 }"
          >
            U-ID: {{ invoice.customer.vatId }}
          </PdfText>
        </PdfView>
        <PdfView :style="{ fontSize: 9.4, width: 244 }">
          <PdfText :style="{ ...labelStyle, marginBottom: 8 }">
            {{ copy.detailsLabel }}
          </PdfText>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }">
            <PdfText>{{ copy.invoiceNumberLabel }}</PdfText>
            <PdfText :style="{ color: '#000913', fontFamily: 'Lupinum Mono', fontSize: 12, fontWeight: 600 }">
              {{ invoice.number }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }">
            <PdfText>{{ copy.invoiceDateLabel }}</PdfText>
            <PdfText :style="{ color: '#000913', fontFamily: 'Lupinum Mono', fontSize: 12 }">
              {{ date(invoice.issueDate) }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between' }">
            <PdfText>{{ copy.dueDateLabel }}</PdfText>
            <PdfText :style="{ color: '#000913', fontFamily: 'Lupinum Mono', fontSize: 12 }">
              {{ date(dueDate) }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfText :style="{ color: '#000913', fontSize: 18, fontWeight: 700, marginTop: 23, textTransform: 'uppercase' }">
        {{ copy.documentLabel }} {{ invoice.number }}
      </PdfText>
      <PdfText :style="{ fontSize: 9.65, marginTop: 19.3 }">
        {{ invoice.intro }}
      </PdfText>

      <PdfView
        :style="{
          borderColor: '#DDE4ED',
          borderWidth: 1,
          marginTop: 15,
        }"
      >
        <PdfView
          :style="{
            backgroundColor: '#F7F9FB',
            borderBottomColor: '#DDE4ED',
            borderBottomWidth: 0.55,
            flexDirection: 'row',
            height: 22,
            paddingHorizontal: 15,
            paddingTop: 7,
          }"
          :wrap="false"
        >
          <PdfText :style="{ color: '#61738D', fontSize: 8, fontWeight: 500, letterSpacing: 2.3, textTransform: 'uppercase', width: 407 }">
            {{ copy.servicesLabel }}
          </PdfText>
        </PdfView>
        <PdfView
          v-for="(line, index) in invoice.lines"
          :key="line.id"
          :style="{
            borderBottomColor: index === invoice.lines.length - 1 ? 'transparent' : '#DDE4ED',
            borderBottomWidth: index === invoice.lines.length - 1 ? 0 : 0.55,
            flexDirection: 'row',
            minHeight: 41,
            paddingBottom: 3.3,
            paddingHorizontal: 15,
            paddingTop: 8.7,
          }"
          :wrap="false"
        >
          <PdfText :style="{ color: '#45556C', fontSize: 10.5, fontWeight: 500, marginLeft: 6, marginTop: 1.3, width: 28 }">
            {{ index + 1 }}
          </PdfText>
          <PdfView :style="{ paddingRight: 16, width: 350 }">
            <PdfText :style="{ color: '#000913', fontSize: 9.3, fontWeight: 500, letterSpacing: 0.6, lineHeight: 1.18 }">
              {{ line.title }}
            </PdfText>
            <PdfText
              v-if="lupinumInvoiceLineDetail(line, invoice.locale)"
              :style="{ color: '#61738D', fontSize: 9, fontWeight: 300, lineHeight: 1.15, marginTop: 6 }"
            >
              {{ lupinumInvoiceLineDetail(line, invoice.locale) }}
            </PdfText>
          </PdfView>
          <PdfText
            :style="{
              color: '#0E162B',
              fontFamily: 'Lupinum Mono',
              fontSize: 10,
              fontWeight: 400,
              letterSpacing: 0.25,
              marginTop: -1.3,
              textAlign: 'right',
              width: 97,
            }"
          >
            {{ money(lupinumInvoiceLineTotal(line)) }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :min-presence-ahead="110"
        :style="{ alignItems: 'flex-end', marginTop: 10, paddingRight: 3 }"
        :wrap="false"
      >
        <PdfView :style="{ width: 216 }">
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 3 }">
            <PdfText :style="{ color: '#45556C', fontSize: 10.7 }">
              {{ totals.discount ? copy.subtotalLabel : copy.netLabel }}
            </PdfText>
            <PdfText :style="{ color: '#0E162B', fontFamily: 'Lupinum Mono', fontSize: 10, letterSpacing: 0.25 }">
              {{ money(totals.discount ? totals.subtotal : totals.net) }}
            </PdfText>
          </PdfView>
          <PdfView
            v-if="totals.discount"
            :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 3 }"
          >
            <PdfText :style="{ color: '#45556C', fontSize: 10.7 }">
              {{ invoice.discount?.label ?? 'Rabatt' }}
            </PdfText>
            <PdfText :style="{ color: '#0E162B', fontFamily: 'Lupinum Mono', fontSize: 10, letterSpacing: 0.25 }">
              {{ money(-totals.discount) }}
            </PdfText>
          </PdfView>
          <PdfView
            v-if="totals.discount"
            :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 3 }"
          >
            <PdfText :style="{ color: '#45556C', fontSize: 10.7 }">
              {{ copy.netLabel }}
            </PdfText>
            <PdfText :style="{ color: '#0E162B', fontFamily: 'Lupinum Mono', fontSize: 10, letterSpacing: 0.25 }">
              {{ money(totals.net) }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 15, paddingVertical: 3 }">
            <PdfText :style="{ color: '#45556C', fontSize: 10.7 }">
              + {{ vatPercent }}% {{ copy.vatLabel }}
            </PdfText>
            <PdfText :style="{ color: '#0E162B', fontFamily: 'Lupinum Mono', fontSize: 10, letterSpacing: 0.25 }">
              {{ money(totals.vat, true) }}
            </PdfText>
          </PdfView>
          <PdfView
            :style="{
              borderTopColor: '#B6C2D3',
              borderTopWidth: 0.55,
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginHorizontal: 6,
              marginTop: 2,
              paddingBottom: 6,
              paddingHorizontal: 9,
              paddingTop: 7,
            }"
          >
            <PdfText :style="{ color: '#0E162B', fontSize: 10, fontWeight: 700 }">
              {{ copy.totalLabel }}
            </PdfText>
            <PdfText :style="{ color: '#0E162B', fontFamily: 'Lupinum Mono', fontSize: 10, fontWeight: 700, letterSpacing: 0.25 }">
              {{ money(totals.total) }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ backgroundColor: '#E3FCF9', height: 6, marginHorizontal: 6 }" />
        </PdfView>
      </PdfView>

      <PdfView
        :min-presence-ahead="202"
        :style="{ marginTop: 22 }"
        :wrap="false"
      >
        <PdfText :style="{ fontSize: 9.65, marginBottom: 8 }">
          {{ copy.paymentLeadBeforeDays }} <PdfText :style="{ fontWeight: 700 }">
            {{ invoice.dueDays }} Tagen
          </PdfText> {{ copy.paymentLeadAfterDays }}
        </PdfText>
        <PdfView
          :style="{
            borderColor: '#DDE4ED',
            borderWidth: 0.55,
            flexDirection: 'row',
            height: 92,
            justifyContent: 'space-between',
            paddingHorizontal: 17,
            paddingVertical: 8,
          }"
        >
          <PdfView :style="{ color: '#314157', justifyContent: 'center', width: 392 }">
            <PdfView
              v-for="(entry, entryIndex) in [
                [copy.accountHolderLabel, invoice.payment.accountHolder],
                [copy.ibanLabel, invoice.payment.iban],
                [copy.bicLabel, invoice.payment.bic],
                [copy.referenceLabel, invoice.number],
              ]"
              :key="entry[0]"
              :style="{ flexDirection: 'row', marginBottom: entryIndex === 3 ? 0 : 7.5 }"
            >
              <PdfText :style="{ fontSize: 8.7, fontWeight: 300, marginLeft: -2, width: 118 }">
                {{ entry[0] }}
              </PdfText>
              <PdfText :style="{ fontSize: 10.5, fontWeight: 300 }">
                {{ entry[1] }}
              </PdfText>
            </PdfView>
          </PdfView>
          <PdfView :style="{ alignItems: 'flex-end', justifyContent: 'center', width: 76 }">
            <PdfSvg
              :viewBox="`0 0 ${qrViewBoxSize} ${qrViewBoxSize}`"
              :style="{ height: 66, width: 66 }"
            >
              <PdfPath
                :d="qrPath"
                fill="#000914"
              />
            </PdfSvg>
          </PdfView>
        </PdfView>

        <PdfView
          :style="{
            borderColor: '#DDE4ED',
            borderWidth: 0.55,
            flexDirection: 'row',
            height: 71,
            justifyContent: 'space-between',
            marginTop: 7,
            paddingHorizontal: 17,
            paddingTop: 13,
          }"
        >
          <PdfView>
            <PdfText :style="{ fontSize: 9.65, fontWeight: 300 }">
              {{ copy.thankYou }}
            </PdfText>
            <PdfText :style="{ fontSize: 9.65, marginTop: 4 }">
              {{ copy.greeting }}
            </PdfText>
            <PdfText :style="{ fontSize: 8.7, fontWeight: 500, letterSpacing: 0.5, marginTop: 2 }">
              {{ copy.signature }}
            </PdfText>
          </PdfView>
          <PdfView :style="{ alignItems: 'flex-end', paddingTop: 4, width: 115 }">
            <PdfText
              v-for="line in copy.qrCaption"
              :key="line"
              :style="{ color: '#61738D', fontSize: 9, lineHeight: 1.1, textAlign: 'right' }"
            >
              {{ line }}
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>
