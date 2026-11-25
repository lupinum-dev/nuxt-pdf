<script setup lang="ts">
import type { Certificate } from '../shared/certificate'
import { longNameCertificate, sampleCertificate } from '../shared/certificate'
import CertificateSeal from './components/certificate/CertificateSeal.vue'
import { certificateTheme } from './components/theme'

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
  >
    <PdfPage
      size="A4"
      orientation="landscape"
      class="page"
    >
      <!-- One thin frame inside the paper margin; the seal and title at the
           top, the name in the middle, the signature lines at the bottom. -->
      <PdfView class="frame">
        <PdfView class="masthead">
          <CertificateSeal :monogram="certificate.program.charAt(0)" />
          <PdfText class="program">
            {{ certificate.program }}
          </PdfText>
          <PdfText class="kind">
            Certificate of completion
          </PdfText>
        </PdfView>

        <PdfView class="presentation">
          <PdfText class="lead">
            This certificate is presented to
          </PdfText>
          <PdfText class="recipient">
            {{ certificate.recipient }}
          </PdfText>
          <PdfView class="rule" />
          <PdfText class="lead">
            for the successful completion of
          </PdfText>
          <PdfText class="course">
            {{ certificate.course }}
          </PdfText>
        </PdfView>

        <PdfView class="details">
          <PdfView class="detail">
            <PdfText class="detail-value">
              {{ certificate.date }}
            </PdfText>
            <PdfText class="detail-label">
              Date of completion
            </PdfText>
          </PdfView>
          <PdfView class="detail">
            <PdfText class="detail-value">
              {{ certificate.issuer }}
            </PdfText>
            <PdfText class="detail-label">
              {{ certificate.issuerTitle }}
            </PdfText>
          </PdfView>
          <PdfView class="detail">
            <PdfText class="detail-value tabular">
              {{ certificate.credentialId }}
            </PdfText>
            <PdfText class="detail-label">
              Credential ID
            </PdfText>
          </PdfView>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The certificate's own look (certificateTheme in components/theme.ts). */
:root {
  --paper: v-bind('certificateTheme.paper');
  --ink: v-bind('certificateTheme.ink');
  --muted: v-bind('certificateTheme.muted');
  --hairline: v-bind('certificateTheme.hairline');
  --accent: v-bind('certificateTheme.accent');
  --display: v-bind('certificateTheme.display');
  --reading: v-bind('certificateTheme.reading');
}

.page {
  hyphens: manual;
  padding: 26pt;
  font-family: var(--reading);
  background-color: var(--paper);
  color: var(--ink);
}

/* A fixed height keeps the page to one sheet whatever the name's length. */
.frame {
  align-items: center;
  justify-content: space-between;
  height: 543pt;
  padding: 34pt 72pt 36pt;
  border: 0.75pt solid var(--accent);
}

.masthead {
  align-items: center;
}

.program {
  margin-top: 12pt;
  font-size: 9.5pt;
  font-weight: 600;
}

.kind {
  margin-top: 2pt;
  font-family: var(--display);
  font-size: 17pt;
  font-style: italic;
  font-weight: 500;
  color: var(--accent);
}

.presentation {
  align-items: center;
  width: 620pt;
}

.lead {
  font-size: 10.5pt;
  font-style: italic;
  color: var(--muted);
}

.recipient {
  margin-top: 6pt;
  font-family: var(--display);
  font-size: 50pt;
  font-weight: 500;
  line-height: 1.05;
  text-align: center;
}

.rule {
  width: 36pt;
  margin: 16pt 0 14pt;
  border-top: 0.75pt solid var(--accent);
}

.course {
  margin-top: 4pt;
  font-family: var(--display);
  font-size: 22pt;
  font-weight: 600;
  line-height: 1.15;
  text-align: center;
}

.details {
  flex-direction: row;
  justify-content: space-between;
  width: 100%;
}

.detail {
  align-items: center;
  width: 180pt;
}

.detail-value {
  width: 100%;
  padding-bottom: 6pt;
  border-bottom: 0.75pt solid var(--hairline);
  font-size: 10.5pt;
  text-align: center;
}

.tabular {
  font-variant-numeric: tabular-nums;
}

.detail-label {
  margin-top: 5pt;
  font-size: 8pt;
  color: var(--muted);
}
</style>
