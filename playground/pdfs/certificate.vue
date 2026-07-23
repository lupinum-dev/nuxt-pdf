<script setup lang="ts">
import type { Certificate } from '../shared/certificate'
import { longNameCertificate, sampleCertificate } from '../shared/certificate'
import CertificateBackground from './components/certificate/CertificateBackground'
import CertificateBorder from './components/certificate/CertificateBorder'
import CertificateHeadline from './components/certificate/CertificateHeadline'
import CertificateSeal from './components/certificate/CertificateSeal'

defineOptions({ name: 'CertificatePdf' })

type CertificateProps = { certificate: Certificate }

const props = defineProps<CertificateProps>()
const certificate = props.certificate

const ink = '#1B2229'
const muted = '#6B7078'
const bronze = '#7E5F2B'

const pageStyle = {
  backgroundColor: '#FFFFFF',
  color: ink,
  fontFamily: 'Inter',
} as const

// The composition lives in one absolutely-positioned, full-page flex column so
// the decorative SVG layers never enter the flow and the page can never spill to
// a second sheet. `space-between` seats the three zones with optical rhythm.
const contentStyle = {
  alignItems: 'center',
  flexDirection: 'column',
  height: 595,
  justifyContent: 'space-between',
  left: 0,
  paddingHorizontal: 96,
  paddingVertical: 60,
  position: 'absolute',
  top: 0,
  width: 842,
} as const

const eyebrowStyle = {
  color: bronze,
  fontFamily: 'Inter',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 4,
  textAlign: 'center',
} as const

const scriptLabel = {
  color: muted,
  fontFamily: 'Lora',
  fontSize: 12,
  fontStyle: 'italic',
  textAlign: 'center',
} as const

const recipientStyle = {
  color: ink,
  fontFamily: 'Lora',
  fontSize: 40,
  fontStyle: 'italic',
  lineHeight: 1.15,
  textAlign: 'center',
} as const

const courseStyle = {
  color: ink,
  fontFamily: 'Inter',
  fontSize: 17,
  fontWeight: 600,
  lineHeight: 1.3,
  textAlign: 'center',
} as const

// Signature column: a value seated on a hairline rule with a small-caps label.
const signatureColumn = { alignItems: 'center', width: 232 } as const
const valueWell = { height: 26, justifyContent: 'flex-end' } as const
const ruleStyle = {
  borderBottomColor: '#B9AE93',
  borderBottomWidth: 0.75,
  marginTop: 6,
  width: '100%',
} as const
const columnLabel = {
  color: muted,
  fontFamily: 'Inter',
  fontSize: 7.5,
  fontWeight: 600,
  letterSpacing: 1.6,
  marginTop: 7,
  textAlign: 'center',
} as const

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
      :style="pageStyle"
    >
      <CertificateBackground :opacity="0.025" />
      <CertificateBorder />

      <PdfView :style="contentStyle">
        <!-- Crest -->
        <PdfView :style="{ alignItems: 'center' }">
          <CertificateSeal :size="80" />
          <PdfText :style="{ ...eyebrowStyle, marginTop: 16 }">
            CERTIFICATE OF COMPLETION
          </PdfText>
          <PdfView
            :style="{ alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginTop: 12 }"
          >
            <PdfView :style="{ backgroundColor: bronze, height: 0.75, width: 46 }" />
            <PdfView
              :style="{
                backgroundColor: bronze,
                height: 5,
                marginHorizontal: 7,
                transform: 'rotate(45deg)',
                width: 5,
              }"
            />
            <PdfView :style="{ backgroundColor: bronze, height: 0.75, width: 46 }" />
          </PdfView>
          <PdfText :style="{ ...eyebrowStyle, color: muted, fontSize: 8.5, letterSpacing: 2, marginTop: 12 }">
            {{ certificate.program.toUpperCase() }}
          </PdfText>
        </PdfView>

        <!-- The optical heart of the page -->
        <PdfView :style="{ alignItems: 'center', width: 640 }">
          <PdfText :style="scriptLabel">
            This certificate is proudly presented to
          </PdfText>
          <CertificateHeadline
            :sx="{ ...recipientStyle, marginTop: 14 }"
            :text="certificate.recipient"
          />
          <PdfText :style="{ ...scriptLabel, fontStyle: 'normal', fontFamily: 'Inter', fontSize: 10, marginTop: 18 }">
            in recognition of the successful completion of
          </PdfText>
          <CertificateHeadline
            :sx="{ ...courseStyle, marginTop: 9 }"
            :text="certificate.course"
          />
        </PdfView>

        <!-- Signatures -->
        <PdfView :style="{ alignItems: 'center', width: '100%' }">
          <PdfView
            :style="{ flexDirection: 'row', justifyContent: 'space-between', width: 620 }"
          >
            <PdfView :style="signatureColumn">
              <PdfView :style="valueWell">
                <PdfText :style="{ color: ink, fontFamily: 'Inter', fontSize: 12, fontWeight: 500, textAlign: 'center' }">
                  {{ certificate.date }}
                </PdfText>
              </PdfView>
              <PdfView :style="ruleStyle" />
              <PdfText :style="columnLabel">
                DATE OF COMPLETION
              </PdfText>
            </PdfView>

            <PdfView :style="signatureColumn">
              <PdfView :style="valueWell">
                <PdfText :style="{ color: ink, fontFamily: 'Lora', fontSize: 16, fontStyle: 'italic', textAlign: 'center' }">
                  {{ certificate.issuer }}
                </PdfText>
              </PdfView>
              <PdfView :style="ruleStyle" />
              <PdfText :style="columnLabel">
                {{ certificate.issuerTitle.toUpperCase() }}
              </PdfText>
            </PdfView>
          </PdfView>

          <PdfText
            :style="{ color: muted, fontFamily: 'Inter', fontSize: 7.5, letterSpacing: 1.2, marginTop: 18, textAlign: 'center' }"
          >
            CREDENTIAL ID · {{ certificate.credentialId }}
          </PdfText>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>
