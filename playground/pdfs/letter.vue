<script setup lang="ts">
import type { Letter } from '../shared/letter'
import { sampleLetter } from '../shared/letter'
import { theme } from './components/theme'

defineOptions({ name: 'BusinessLetterPdf' })

type LetterProps = { letter: Letter }

const props = defineProps<LetterProps>()
const letter = props.letter

// The address lines in the window, in postal order.
const addressLines = [
  letter.recipient.name,
  letter.recipient.attention,
  letter.recipient.street,
  letter.recipient.city,
  letter.recipient.country,
].filter(line => line !== undefined)

definePdf<LetterProps>({
  title: ({ letter }) => letter.subject,
  filename: () => 'letter.pdf',
  language: 'en',
  sampleData: { letter: sampleLetter },
})
</script>

<template>
  <PdfDocument
    creator="Nuxt PDF"
    subject="Business letter"
  >
    <PdfPage
      size="A4"
      class="page"
    >
      <!-- Letterhead: the 45 mm above the address field. -->
      <PdfView class="letterhead">
        <PdfSvg
          width="24"
          height="24"
          view-box="0 0 22 22"
          class="mark"
          decorative
        >
          <PdfRect
            x="0"
            y="0"
            width="22"
            height="22"
            rx="6"
            :fill="theme.primary"
          />
          <PdfPath
            d="M6 15 C 8 8, 13 6, 17 6 C 16 11, 12 15, 6 15 Z"
            fill="#FFFFFF"
          />
        </PdfSvg>
        <PdfView>
          <PdfText class="brand">
            {{ letter.sender.name }}
          </PdfText>
          <PdfText class="brand-line">
            Landscape architects
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- Address field of a DL window envelope, DIN 5008 form B:
           20 mm from the left, 45 mm from the top, 85 × 45 mm. -->
      <PdfView class="address-field">
        <PdfView class="return-zone">
          <PdfText class="return-line">
            {{ letter.sender.name }} · {{ letter.sender.street }} · {{ letter.sender.city }}
          </PdfText>
        </PdfView>
        <PdfView class="address-zone">
          <PdfText
            v-for="line in addressLines"
            :key="line"
            class="address-line"
          >
            {{ line }}
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- Information block, beside the address field. -->
      <PdfView class="info-block">
        <PdfView
          v-for="reference in letter.references"
          :key="reference.label"
          class="info-row"
        >
          <PdfText class="info-label">
            {{ reference.label }}
          </PdfText>
          <PdfText class="info-value">
            {{ reference.value }}
          </PdfText>
        </PdfView>
        <PdfView class="info-row info-date">
          <PdfText class="info-label">
            Date
          </PdfText>
          <PdfText class="info-value">
            {{ letter.date }}
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- Fold marks at 105 mm and 210 mm, the hole mark at 148.5 mm. -->
      <PdfView
        class="mark-fold mark-fold-1"
        decorative
      />
      <PdfView
        class="mark-hole"
        decorative
      />
      <PdfView
        class="mark-fold mark-fold-2"
        decorative
      />

      <PdfText class="subject">
        {{ letter.subject }}
      </PdfText>
      <PdfText class="salutation">
        {{ letter.salutation }}
      </PdfText>
      <PdfText
        v-for="(paragraph, index) in letter.paragraphs"
        :key="index"
        class="paragraph"
      >
        {{ paragraph }}
      </PdfText>

      <PdfView
        class="signature"
        :wrap="false"
      >
        <PdfText>{{ letter.closing }}</PdfText>
        <PdfSvg
          width="110"
          height="34"
          view-box="0 0 110 34"
          class="signature-ink"
          decorative
        >
          <PdfPath
            d="M4 24 C 10 6, 16 6, 14 22 C 13 30, 22 12, 28 14 C 33 16, 30 26, 36 22 C 42 18, 44 10, 48 12 C 52 14, 48 26, 56 24 C 64 22, 66 14, 72 16 C 78 18, 76 26, 84 22 C 90 19, 96 16, 106 17"
            :stroke="theme.accent"
            stroke-width="1.4"
            fill="none"
          />
        </PdfSvg>
        <PdfText class="signer">
          {{ letter.signer.name }}
        </PdfText>
        <PdfText class="signer-role">
          {{ letter.signer.role }}
        </PdfText>
      </PdfView>

      <PdfText class="enclosure">
        Enclosures: planting plan, estimate
      </PdfText>

      <PdfView
        fixed
        class="footer"
      >
        <PdfView class="footer-column">
          <PdfText>{{ letter.sender.name }}</PdfText>
          <PdfText>{{ letter.sender.street }}</PdfText>
          <PdfText>{{ letter.sender.city }}</PdfText>
        </PdfView>
        <PdfView class="footer-column">
          <PdfText>{{ letter.sender.phone }}</PdfText>
          <PdfText>{{ letter.sender.email }}</PdfText>
          <PdfText>{{ letter.sender.web }}</PdfText>
        </PdfView>
        <PdfView class="footer-column">
          <PdfText>IBAN {{ letter.sender.iban }}</PdfText>
          <PdfText>VAT ID {{ letter.sender.vatId }}</PdfText>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The shared colours (components/theme.ts). */
:root {
  --ink: v-bind('theme.foreground');
  --muted: v-bind('theme.mutedForeground');
  --rule: v-bind('theme.border');
}
/* The text block: 25 mm left, 20 mm right; it starts below the address field. */
.page {
  hyphens: auto;
  padding: 98mm 20mm 32mm 25mm;
  font-family: Inter;
  font-size: 10pt;
  line-height: 1.45;
  color: var(--ink);
}
.letterhead {
  position: absolute;
  top: 16mm;
  right: 20mm;
  flex-direction: row;
  align-items: center;
}
.mark {
  margin-right: 8pt;
}
.brand {
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: -0.3pt;
  line-height: 1.15;
}
.brand-line {
  font-size: 7.5pt;
  color: var(--muted);
}
.address-field {
  position: absolute;
  top: 45mm;
  left: 20mm;
  width: 85mm;
  height: 45mm;
  padding-left: 5mm;
}
/* Return address and notes: the top 17.7 mm of the field. */
.return-zone {
  height: 17.7mm;
  justify-content: flex-end;
  padding-bottom: 2mm;
}
.return-line {
  font-size: 6.5pt;
  color: var(--muted);
}
/* The address itself: the lower 27.3 mm. */
.address-zone {
  height: 27.3mm;
}
.address-line {
  line-height: 1.3;
}
.info-block {
  position: absolute;
  top: 50mm;
  left: 125mm;
  width: 75mm;
  font-size: 8pt;
}
.info-row {
  flex-direction: row;
  margin-bottom: 1.5pt;
}
.info-date {
  margin-top: 6pt;
}
.info-label {
  width: 26mm;
  color: var(--muted);
}
.info-value {
  flex: 1;
}
.mark-fold,
.mark-hole {
  position: absolute;
  left: 5mm;
  border-top: 1pt solid var(--rule);
}
.mark-fold {
  width: 5mm;
}
.mark-fold-1 {
  top: 105mm;
}
.mark-fold-2 {
  top: 210mm;
}
.mark-hole {
  top: 148.5mm;
  width: 8mm;
}
.subject {
  font-size: 12pt;
  font-weight: 600;
  letter-spacing: -0.2pt;
  margin-bottom: 16pt;
}
.salutation {
  margin-bottom: 8pt;
}
.paragraph {
  margin-bottom: 8pt;
}
.signature {
  margin-top: 6pt;
}
.signature-ink {
  margin-top: 4pt;
  margin-bottom: 2pt;
}
.signer {
  font-weight: 600;
}
.signer-role {
  color: var(--muted);
}
.enclosure {
  margin-top: 18pt;
  font-size: 8.5pt;
  color: var(--muted);
}
.footer {
  position: absolute;
  bottom: 12mm;
  left: 25mm;
  right: 20mm;
  flex-direction: row;
  padding-top: 6pt;
  border-top: 1pt solid var(--rule);
  font-size: 7pt;
  line-height: 1.4;
  color: var(--muted);
}
.footer-column {
  flex: 1;
}
</style>
