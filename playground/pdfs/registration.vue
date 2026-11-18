<script setup lang="ts">
import type { Registration } from '../shared/registration'
import { returningParticipant, sampleRegistration } from '../shared/registration'

defineOptions({ name: 'WorkshopRegistrationPdf' })

type RegistrationProps = { registration: Registration }

const props = defineProps<RegistrationProps>()
const registration = props.registration

definePdf<RegistrationProps>({
  title: ({ registration }) => `Registration: ${registration.workshop}`,
  filename: () => 'workshop-registration.pdf',
  language: 'en',
  sampleData: { registration: sampleRegistration },
  scenarios: {
    returning: { registration: returningParticipant },
  },
})
</script>

<template>
  <PdfDocument creator="Nuxt PDF" subject="Workshop registration form">
    <PdfPage size="A5" class="page">
      <PdfText class="eyebrow">
        Fieldnote Studio · Registration
      </PdfText>
      <PdfText class="title">
        {{ registration.workshop }}
      </PdfText>
      <PdfText class="meta">
        {{ registration.date }} · {{ registration.venue }}
      </PdfText>
      <PdfText class="intro">
        Fill in this form in your PDF reader, save it, and send it back to us.
      </PdfText>

      <PdfText class="label">
        Full name
      </PdfText>
      <PdfTextField
        name="fullName"
        label="Full name"
        :value="registration.participant"
        :max-length="60"
        required
        class="field"
      />

      <PdfText class="label">
        Email
      </PdfText>
      <PdfTextField name="email" label="Email" required class="field" />

      <PdfText class="label">
        Session
      </PdfText>
      <PdfSelect
        name="session"
        label="Session"
        :options="registration.sessions"
        :value="registration.sessions[0]"
        class="field"
      />

      <PdfText class="label">
        What do you want to record?
      </PdfText>
      <PdfTextField name="interests" label="What do you want to record?" multiline class="field field-tall" />

      <PdfView class="choice">
        <PdfCheckbox name="ownRecorder" label="I bring my own recorder" class="box" />
        <PdfText class="choice-text">
          I bring my own recorder
        </PdfText>
      </PdfView>
      <PdfView class="choice">
        <PdfCheckbox name="newsletter" label="Send me the studio newsletter" checked class="box" />
        <PdfText class="choice-text">
          Send me the studio newsletter
        </PdfText>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root {
  --ink: #1f2a2e;
  --muted: #6b7a7f;
  --line: #9fb0b5;
  --accent: #2f6f62;
}
.page {
  padding: 40pt 44pt;
  font-family: Inter;
  font-size: 9pt;
  color: var(--ink);
}
.eyebrow {
  font-size: 7pt;
  font-weight: 600;
  letter-spacing: 0.8pt;
  color: var(--accent);
}
.title {
  margin-top: 6pt;
  font-family: Lora;
  font-size: 18pt;
  font-weight: 700;
}
.meta {
  margin-top: 4pt;
  color: var(--muted);
}
.intro {
  margin-top: 14pt;
  margin-bottom: 6pt;
  line-height: 1.4;
}
.label {
  margin-top: 10pt;
  margin-bottom: 3pt;
  font-weight: 500;
}
.field {
  width: 100%;
  height: 20pt;
  padding: 4pt 5pt;
  border-width: 0.75pt;
  border-color: var(--line);
}
.field-tall {
  height: 64pt;
}
.choice {
  flex-direction: row;
  align-items: center;
  margin-top: 10pt;
}
.box {
  width: 10pt;
  height: 10pt;
  border-width: 0.75pt;
  border-color: var(--line);
}
.choice-text {
  margin-left: 6pt;
}
</style>
