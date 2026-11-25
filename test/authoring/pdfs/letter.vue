<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
definePdf({ title: 'Letter to Anna Berger', language: 'en' })
</script>

<template>
  <!-- eslint-disable vue/singleline-html-element-content-newline, vue/multiline-html-element-content-newline -->
  <PdfDocument
    creator="Author test"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView class="head">
        <PdfImage
          src="logo.png"
          class="logo"
        />
        <PdfSvg
          viewBox="0 0 48 48"
          :style="{ width: 40, height: 40 }"
        >
          <PdfCircle
            cx="24"
            cy="24"
            r="22"
            fill="#1f4e5f"
          />
          <PdfPath
            d="M12 30 l12 -18 l12 18 z"
            fill="#ffffff"
          />
        </PdfSvg>
      </PdfView>

      <PdfText class="sender">
        Fieldwork Studio, Harbour Street 12, 20457 Hamburg
      </PdfText>

      <PdfView class="address">
        <PdfText>Anna Berger</PdfText>
        <PdfText>Lindenallee 7</PdfText>
        <PdfText>10115 Berlin</PdfText>
      </PdfView>

      <PdfText class="date">
        Hamburg, 3 November 2026
      </PdfText>

      <PdfText class="subject">
        Your project proposal
      </PdfText>

      <PdfText class="body">
        Dear Ms Berger,
      </PdfText>
      <PdfText class="body">
        Thank you for your time last week. We have written down the scope, the schedule and the
        price of the project in a short proposal. It covers the design, the build and two rounds
        of changes after the first review.
      </PdfText>
      <PdfText
        class="body"
        :style="{ hyphens: 'manual' }"
      >
        You can read the terms online at
        <PdfLink
          href="https://example.com/terms"
          class="link"
        >example.com/terms</PdfLink>.
        If you have a question, write to
        <PdfLink
          href="mailto:hello@example.com"
          class="link"
        >hello@example.com</PdfLink>
        and we will answer within one working day.
      </PdfText>
      <PdfText class="body">
        Kind regards
      </PdfText>
      <PdfText class="signature">
        Mara Fieldwork
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 50pt 56pt;
  font-family: Inter;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #1c2a30;
}
.head {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
.logo {
  width: 84pt;
  height: 50pt;
  object-fit: contain;
}
.sender {
  margin-top: 36pt;
  font-size: 7.5pt;
  color: #5b6b72;
  border-bottom: 0.5pt solid #9fb0b5;
  padding-bottom: 2pt;
  width: 240pt;
}
.address {
  margin-top: 8pt;
  height: 64pt;
}
.date {
  text-align: right;
  margin-top: 12pt;
}
.subject {
  font-weight: 700;
  margin-top: 24pt;
  margin-bottom: 14pt;
}
.body {
  margin-bottom: 10pt;
}
.link {
  color: #1f4e5f;
  text-decoration: underline;
}
.signature {
  margin-top: 22pt;
  font-weight: 700;
}
</style>
