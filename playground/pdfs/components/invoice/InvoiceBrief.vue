<script setup lang="ts">
import type { InvoiceProjectBrief } from '../../../shared/invoice'
import { theme } from '../theme'
import InvoiceSection from './InvoiceSection.vue'

// Page 2 of the invoice: the project the invoiced work belongs to.
defineProps<{
  brief: InvoiceProjectBrief
  invoiceNumber: string
}>()
</script>

<template>
  <PdfView>
    <PdfView class="badge brief-badge">
      <PdfText class="badge-text">
        Project context
      </PdfText>
    </PdfView>
    <PdfText class="brief-title">
      {{ brief.title }}
    </PdfText>
    <PdfText class="brief-summary">
      {{ brief.summary }}
    </PdfText>

    <PdfImage
      src="alpine.png"
      class="brief-image"
    />

    <InvoiceSection
      label="Scope"
      title="Included deliverables"
    >
      <PdfView class="card deliverables">
        <PdfView
          v-for="(deliverable, index) in brief.deliverables"
          :key="deliverable"
          :class="index === 0 ? 'deliverable' : 'deliverable deliverable-divided'"
          :wrap="false"
        >
          <PdfView class="number-badge deliverable-number">
            <PdfText class="number-badge-text">
              {{ index + 1 }}
            </PdfText>
          </PdfView>
          <PdfText class="deliverable-name">
            {{ deliverable }}
          </PdfText>
        </PdfView>
      </PdfView>
    </InvoiceSection>

    <!-- A printed line, not a PdfNote: PDF/A does not allow the engine's notes. -->
    <PdfText class="context-note">
      Project context supplied with invoice {{ invoiceNumber }}.
    </PdfText>
  </PdfView>
</template>

<style>
@import '../theme.css';

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
}
.brief-badge {
  margin-top: 4pt;
}

.brief-title {
  hyphens: manual;
  margin-top: 12pt;
  width: 400pt;
  font-size: 26pt;
  font-weight: 600;
  letter-spacing: -0.8pt;
  line-height: 1.15;
}

.brief-summary {
  margin-top: 10pt;
  width: 420pt;
  font-size: 10pt;
  line-height: 1.55;
  color: var(--muted-foreground);
}

.brief-image {
  margin-top: 24pt;
  width: 100%;
  height: 200pt;
  border-radius: var(--radius);
  object-fit: cover;
}

.deliverables {
  padding: 0 14pt;
}

.deliverable {
  flex-direction: row;
  align-items: center;
  padding-vertical: 11pt;
}

.deliverable-divided {
  border-top: 1pt solid var(--border);
}

.deliverable-number {
  margin-right: 12pt;
}

.deliverable-name {
  font-size: 9.5pt;
  font-weight: 500;
}

.context-note {
  margin-top: 12pt;
  font-size: 7.5pt;
  color: var(--muted-foreground);
}
</style>
