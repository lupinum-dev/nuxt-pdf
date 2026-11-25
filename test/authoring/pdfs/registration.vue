<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
defineProps<{ archival?: boolean }>()

definePdf<{ archival?: boolean }>({ title: 'Workshop registration', language: 'en' })
</script>

<template>
  <PdfDocument
    :conformance="archival ? 'PDF/A-3b' : undefined"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfText
        tag="h1"
        class="title"
      >
        Workshop registration
      </PdfText>

      <PdfText class="label">
        Full name
      </PdfText>
      <PdfTextField
        name="fullName"
        label="Full name"
        value="Ada Lovelace"
        required
        :max-length="60"
        class="field"
      />

      <PdfText class="label">
        Questions or wishes
      </PdfText>
      <PdfTextField
        name="notes"
        label="Questions or wishes"
        multiline
        value="Vegetarian lunch, please.&#10;Arriving by train."
        class="field notes"
      />

      <PdfText class="label">
        Session
      </PdfText>
      <PdfSelect
        name="session"
        label="Session"
        :options="['Morning', 'Afternoon', 'Full day']"
        value="Afternoon"
        class="field"
      />

      <PdfText class="label">
        Shirt size
      </PdfText>
      <PdfView class="row">
        <PdfView
          v-for="size in ['S', 'M', 'L']"
          :key="size"
          class="option"
        >
          <PdfRadio
            name="shirt"
            :value="size"
            :label="`Shirt size ${size}`"
            :checked="size === 'M'"
            class="box"
          />
          <PdfText class="option-text">
            {{ size }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView class="row option later">
        <PdfCheckbox
          name="newsletter"
          label="Send me the newsletter"
          checked
          class="box"
        />
        <PdfText class="option-text">
          Send me the newsletter
        </PdfText>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 40pt;
  font-family: Inter;
  font-size: 10pt;
  color: #1c2a30;
}
.title {
  font-size: 16pt;
  font-weight: 700;
  margin-bottom: 12pt;
}
.label {
  margin-top: 8pt;
  margin-bottom: 3pt;
  color: #5b6b72;
  font-size: 8.5pt;
}
.field {
  width: 100%;
  height: 22pt;
  padding: 4pt 5pt;
  border-width: 0.75pt;
  border-color: #9fb0b5;
  background-color: #f6f9fa;
}
.notes {
  height: 56pt;
}
.row {
  flex-direction: row;
}
.option {
  flex-direction: row;
  align-items: center;
  margin-right: 14pt;
}
.box {
  width: 11pt;
  height: 11pt;
  border-width: 0.75pt;
  border-color: #9fb0b5;
}
.later {
  margin-top: 10pt;
}
.option-text {
  margin-left: 4pt;
}
</style>
