---
title: PDFs authored as Vue components
description: Build invoices, reports and tickets as Vue templates and render them in a Nuxt server route. No headless browser, and nothing added to the client bundle.
install: pnpm add @lupinum/nuxt-pdf
links:
  - label: Get started
    href: $docs.getting-started
  - label: View on GitHub
    href: https://github.com/lupinum-dev/nuxt-pdf
features:
  - icon: lucide:component
    title: The Vue you already know
    description: Props, v-if, v-for, slots and your own components work in templates. Layout uses a small set of components such as PdfPage and PdfText.
  - icon: lucide:server
    title: No browser needed
    description: Rendering runs in Node on your server. The PDF code never reaches the browser.
  - icon: lucide:braces
    title: Typed render calls
    description: "Each file in pdfs/ becomes pdf.<name>.render(). TypeScript knows its props, so a missing field shows up in your editor, not in production."
  - icon: lucide:list-tree
    title: Page numbers and links
    description: A table of contents gets the right page numbers. Internal links and PDF bookmarks come from your template.
  - icon: lucide:shield-check
    title: Safe images and fonts
    description: Local images and fonts are checked and bundled at build time. Remote images load only from hosts you allow.
  - icon: lucide:flask-conical
    title: Tests on real PDFs
    description: Render a template in Vitest and check its text, links and page count. Compare pages as images when the layout matters.
---

::code-group
```vue [pdfs/invoice.vue]
<script setup lang="ts">
const props = defineProps<{ invoice: { number: string; total: string } }>()

definePdf({
  title: ({ invoice }) => `Invoice ${invoice.number}`,
  filename: ({ invoice }) => `invoice-${invoice.number}.pdf`,
  sampleData: { invoice: { number: "INV-001", total: "EUR 1,250.00" } },
})
</script>

<template>
  <PdfDocument>
    <PdfPage size="A4" :style="{ padding: 48 }">
      <PdfText :style="{ fontSize: 24 }">Invoice {{ props.invoice.number }}</PdfText>
      <PdfText>Total: {{ props.invoice.total }}</PdfText>
    </PdfPage>
  </PdfDocument>
</template>
```
```ts [server/api/invoice.get.ts]
import { pdf } from "#pdf";

export default defineEventHandler(async () => {
  const result = await pdf.invoice.render({
    invoice: { number: "INV-001", total: "EUR 1,250.00" },
  });
  return result.response();
});
```
```bash [Preview]
# The template index, dev only
open http://localhost:3000/_pdf

# The browser preview with sample data and scenarios
open http://localhost:3000/_pdf/invoice

# The production-style route
open http://localhost:3000/api/invoice
```
::
