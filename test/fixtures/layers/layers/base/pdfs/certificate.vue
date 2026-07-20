<script setup lang="ts">
defineOptions({ name: 'BaseCertificatePdf' })

type CertificateProps = {
  recipient: string
}

const props = defineProps<CertificateProps>()

definePdf<CertificateProps>({
  sampleData: {
    recipient: 'Ada Lovelace',
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage
      size="A4"
      :style="{ padding: 48 }"
    >
      <PdfText>BASE CERTIFICATE: {{ props.recipient }}</PdfText>
    </PdfPage>
  </PdfDocument>
</template>
