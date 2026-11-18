<script setup lang="ts">
defineProps<{
  /** Pages of this PdfPage that show the running head: from page 2 of the document on. */
  headPages: 'all' | 'continuation'
  invoiceNumber: string
  footerHref: string
  footerLabel: string
}>()
</script>

<template>
  <!-- One A4 page of invoice.vue with its repeating chrome: a top bar, a running head,
       a footer link and the page counter. A class set on <InvoicePage> applies to the PdfPage. -->
  <PdfPage size="A4">
    <PdfView
      fixed
      class="top-bar"
    />
    <PdfText
      fixed
      :pages="headPages"
      class="running-head"
    >
      Invoice {{ invoiceNumber }} · Page <PdfPageNumber />
    </PdfText>

    <slot />

    <PdfLink
      fixed
      :href="footerHref"
      class="footer-link"
    >
      {{ footerLabel }}
    </PdfLink>
    <PdfText
      fixed
      class="footer-page"
    >
      Page <PdfPageNumber /> / <PdfPageCount />
    </PdfText>
  </PdfPage>
</template>

<style>
/* Variables are local to a file: these repeat the values of invoice.vue. */
:root {
  --muted: #758078;
  --page-margin: 48pt;
}
.top-bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 9pt;
  background-color: #315D3B;
}

.running-head {
  position: absolute;
  top: 24pt;
  right: var(--page-margin);
  left: var(--page-margin);
  font-size: 7pt;
  text-align: right;
  color: var(--muted);
}

.footer-link {
  position: absolute;
  bottom: 24pt;
  left: var(--page-margin);
  font-size: 7pt;
  text-decoration: none;
  color: var(--muted);
}

.footer-page {
  position: absolute;
  right: var(--page-margin);
  bottom: 24pt;
  left: var(--page-margin);
  font-size: 7pt;
  text-align: right;
  color: var(--muted);
}
</style>
