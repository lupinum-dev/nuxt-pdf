<script setup lang="ts">
import type { Certificate } from '../shared/certificate'
import { longNameCertificate, sampleCertificate } from '../shared/certificate'
import CertificateBackground from './components/certificate/CertificateBackground.vue'
import CertificateBorder from './components/certificate/CertificateBorder.vue'
import CertificateHeadline from './components/certificate/CertificateHeadline.vue'
import CertificateSeal from './components/certificate/CertificateSeal.vue'

defineOptions({ name: 'CertificatePdf' })

type CertificateProps = { certificate: Certificate }

const props = defineProps<CertificateProps>()
const certificate = props.certificate

definePdf<CertificateProps>({
  title: ({ certificate }) => `Certificate — ${certificate.recipient}`,
  filename: ({ certificate }) =>
    `certificate-${certificate.recipient.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  language: 'en',
  sampleData: { certificate: sampleCertificate },
  scenarios: {
    longName: { certificate: longNameCertificate },
  },
})
</script>

<template>
  <PdfDocument
    :author="certificate.program"
    creator="Nuxt PDF"
    :subject="`Certificate of Completion — ${certificate.recipient}`"
    :title="`Certificate — ${certificate.recipient}`"
  >
    <PdfPage
      size="A4"
      orientation="landscape"
      class="page"
    >
      <CertificateBackground :opacity="0.025" />
      <CertificateBorder />

      <PdfView class="content">
        <!-- Crest -->
        <PdfView class="crest">
          <CertificateSeal :size="80" />
          <PdfText class="eyebrow">
            CERTIFICATE OF COMPLETION
          </PdfText>
          <PdfView class="ornament">
            <PdfView class="ornament-rule" />
            <PdfView class="ornament-diamond" />
            <PdfView class="ornament-rule" />
          </PdfView>
          <PdfText class="program">
            {{ certificate.program.toUpperCase() }}
          </PdfText>
        </PdfView>

        <!-- The optical heart of the page -->
        <PdfView class="presentation">
          <PdfText class="script-label">
            This certificate is proudly presented to
          </PdfText>
          <CertificateHeadline
            class="recipient"
            :text="certificate.recipient"
          />
          <PdfText class="recognition">
            in recognition of the successful completion of
          </PdfText>
          <CertificateHeadline
            class="course"
            :text="certificate.course"
          />
        </PdfView>

        <!-- Signatures -->
        <PdfView class="signatures">
          <PdfView class="signature-row">
            <PdfView class="signature-column">
              <PdfView class="value-well">
                <PdfText class="date-value">
                  {{ certificate.date }}
                </PdfText>
              </PdfView>
              <PdfView class="signature-rule" />
              <PdfText class="column-label">
                DATE OF COMPLETION
              </PdfText>
            </PdfView>

            <PdfView class="signature-column">
              <PdfView class="value-well">
                <PdfText class="issuer-value">
                  {{ certificate.issuer }}
                </PdfText>
              </PdfView>
              <PdfView class="signature-rule" />
              <PdfText class="column-label">
                {{ certificate.issuerTitle.toUpperCase() }}
              </PdfText>
            </PdfView>
          </PdfView>

          <PdfText class="credential">
            CREDENTIAL ID · {{ certificate.credentialId }}
          </PdfText>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root {
  --ink: #1B2229;
  --muted: #6B7078;
  --accent: #7E5F2B;
  --font-body: Inter;
  --font-display: Lora;
}
.page {
  font-family: var(--font-body);
  background-color: #FFFFFF;
  color: var(--ink);
}

/* One absolutely positioned, full-page flex column: the decorative SVG layers
   never enter the flow and the page never spills to a second sheet.
   space-between seats the three zones with optical rhythm. */
.content {
  position: absolute;
  top: 0;
  left: 0;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  width: 842pt;
  height: 595pt;
  padding: 60pt 96pt;
}

.crest {
  align-items: center;
}

.eyebrow {
  margin-top: 16pt;
  font-family: var(--font-body);
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: 4pt;
  text-align: center;
  color: var(--accent);
}

.ornament {
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin-top: 12pt;
}

.ornament-rule {
  width: 46pt;
  height: 0.75pt;
  background-color: var(--accent);
}

.ornament-diamond {
  width: 5pt;
  height: 5pt;
  margin-horizontal: 7pt;
  transform: rotate(45deg);
  background-color: var(--accent);
}

.program {
  margin-top: 12pt;
  font-family: var(--font-body);
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 2pt;
  text-align: center;
  color: var(--muted);
}

.presentation {
  align-items: center;
  width: 640pt;
}

.script-label {
  font-family: var(--font-display);
  font-size: 12pt;
  font-style: italic;
  text-align: center;
  color: var(--muted);
}

.recipient {
  margin-top: 14pt;
  font-family: var(--font-display);
  font-size: 40pt;
  font-style: italic;
  line-height: 1.15;
  text-align: center;
  color: var(--ink);
}

.recognition {
  margin-top: 18pt;
  font-family: var(--font-body);
  font-size: 10pt;
  font-style: normal;
  text-align: center;
  color: var(--muted);
}

.course {
  margin-top: 9pt;
  font-family: var(--font-body);
  font-size: 17pt;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  color: var(--ink);
}

.signatures {
  align-items: center;
  width: 100%;
}

.signature-row {
  flex-direction: row;
  justify-content: space-between;
  width: 620pt;
}

/* A value seated on a hairline rule above a small-caps label. */
.signature-column {
  align-items: center;
  width: 232pt;
}

.value-well {
  justify-content: flex-end;
  height: 26pt;
}

.date-value {
  font-family: var(--font-body);
  font-size: 12pt;
  font-weight: 500;
  text-align: center;
  color: var(--ink);
}

.issuer-value {
  font-family: var(--font-display);
  font-size: 16pt;
  font-style: italic;
  text-align: center;
  color: var(--ink);
}

.signature-rule {
  width: 100%;
  margin-top: 6pt;
  border-bottom-width: 0.75pt;
  border-bottom-color: #B9AE93;
}

.column-label {
  margin-top: 7pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 1.6pt;
  text-align: center;
  color: var(--muted);
}

.credential {
  margin-top: 18pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  letter-spacing: 1.2pt;
  text-align: center;
  color: var(--muted);
}
</style>
