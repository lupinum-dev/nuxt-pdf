<script setup lang="ts">
import type { Registration } from '../shared/registration'
import { experienceLevels, returningParticipant, sampleRegistration } from '../shared/registration'
import { theme } from './components/theme'

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
  <PdfDocument
    creator="Nuxt PDF"
    subject="Workshop registration form"
  >
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfView class="badge">
        <PdfText class="badge-text">
          Fieldnote Studio · Registration
        </PdfText>
      </PdfView>
      <PdfText class="title">
        {{ registration.workshop }}
      </PdfText>
      <PdfText class="meta">
        {{ registration.date }} · {{ registration.venue }}
      </PdfText>
      <PdfText class="intro">
        Fill in this form in your PDF reader, save it, and send it back to us.
      </PdfText>

      <!-- Form fields have square borders, so each field sits without a
           border in a rounded box, as a shadcn Input. -->
      <PdfText class="field-label">
        Full name
      </PdfText>
      <PdfView class="input">
        <PdfTextField
          name="fullName"
          label="Full name"
          :value="registration.participant"
          :max-length="60"
          required
          class="field"
        />
      </PdfView>

      <PdfText class="field-label">
        Email
      </PdfText>
      <PdfView class="input">
        <PdfTextField
          name="email"
          label="Email"
          required
          class="field"
        />
      </PdfView>

      <PdfText class="field-label">
        Session
      </PdfText>
      <PdfView class="input">
        <PdfSelect
          name="session"
          label="Session"
          :options="registration.sessions"
          :value="registration.sessions[0]"
          class="field"
        />
      </PdfView>

      <PdfText class="field-label">
        What do you want to record?
      </PdfText>
      <PdfView class="input">
        <PdfTextField
          name="interests"
          label="What do you want to record?"
          multiline
          class="field field-tall"
        />
      </PdfView>

      <PdfText class="field-label">
        Recording experience
      </PdfText>
      <PdfView class="options">
        <PdfView
          v-for="level in experienceLevels"
          :key="level.value"
          class="option"
        >
          <PdfRadio
            name="experience"
            :value="level.value"
            :label="level.label"
            :checked="registration.experience === level.value"
            class="radio"
          />
          <PdfText class="choice-text">
            {{ level.label }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView class="choices">
        <PdfView class="choice">
          <PdfView class="checkbox">
            <PdfCheckbox
              name="ownRecorder"
              label="I bring my own recorder"
              class="box"
            />
          </PdfView>
          <PdfText class="choice-text">
            I bring my own recorder
          </PdfText>
        </PdfView>
        <PdfView class="choice">
          <PdfView class="checkbox">
            <PdfCheckbox
              name="newsletter"
              label="Send me the studio newsletter"
              checked
              class="box"
            />
          </PdfView>
          <PdfText class="choice-text">
            Send me the studio newsletter
          </PdfText>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
@import './components/theme.css';

/* The shared colours and radii (components/theme.ts). */
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
  --border: v-bind('theme.border');
  --muted: v-bind('theme.muted');
  --accent: v-bind('theme.accent');
  --accent-soft: v-bind('theme.accentSoft');
  --accent-border: v-bind('theme.accentBorder');
  --radius: v-bind('theme.radius');
  --radius-small: v-bind('theme.radiusSmall');
  --control-border: #D4D4D8;
}
.page {
  hyphens: auto;
  padding: 40pt 44pt;
  font-family: Inter;
  font-size: 9pt;
  color: var(--foreground);
}
.title {
  margin-top: 12pt;
  font-size: 18pt;
  font-weight: 600;
  letter-spacing: -0.5pt;
}
.meta {
  margin-top: 3pt;
  color: var(--muted-foreground);
}
.intro {
  margin-top: 14pt;
  margin-bottom: 4pt;
  padding-top: 12pt;
  border-top: 1pt solid var(--border);
  line-height: 1.45;
  color: var(--muted-foreground);
}
.field-label {
  margin-top: 11pt;
  margin-bottom: 4pt;
  font-weight: 500;
}
/* The rounded box around a field: a shadcn Input. */
.input {
  border: 1pt solid var(--control-border);
  border-radius: 6pt;
}
.field {
  width: 100%;
  height: 20pt;
  padding: 4pt 7pt;
}
.field-tall {
  height: 60pt;
}
.choices {
  margin-top: 4pt;
}
.choice {
  flex-direction: row;
  align-items: center;
  margin-top: 8pt;
}
.checkbox {
  border: 1pt solid var(--control-border);
  border-radius: 3pt;
}
.box {
  width: 10pt;
  height: 10pt;
}
.choice-text {
  margin-left: 6pt;
}
.options {
  flex-direction: row;
}
.option {
  flex-direction: row;
  align-items: center;
  margin-right: 18pt;
}
.radio {
  width: 11pt;
  height: 11pt;
  padding: 2.5pt;
  border-width: 1pt;
  border-color: var(--control-border);
}
</style>
