---
title: PDFs authored as Vue components
description: Nuxt PDF renders PDF documents on the Nuxt server from ordinary Vue components. Typed templates, local images and fonts, links, bookmarks and test helpers.
install: pnpm add @lupinum/nuxt-pdf
links:
  - label: Get started
    href: $docs.getting-started
  - label: View on GitHub
    href: https://github.com/lupinum-dev/nuxt-pdf
features:
  - icon: lucide:component
    title: Vue authoring, PDF output
    description: Compose documents with typed props, v-if, keyed v-for, slots and local components. A small set of thin primitives maps to the layout engine.
  - icon: lucide:server
    title: Server-only rendering
    description: The engine runs on the Node server, with no client build step. React PDF runtimes stay out of the client bundle and the production dependencies.
  - icon: lucide:braces
    title: "Typed #pdf registry"
    description: "Discovered templates generate an inspectable #pdf module. Property access and literal names infer each template's props."
  - icon: lucide:list-tree
    title: Contents, links, bookmarks
    description: "A multi-pass layout resolves table-of-contents page numbers; #id links and a bookmark outline follow the component tree."
  - icon: lucide:shield-check
    title: Fail-closed resources
    description: Local images and fonts are checked and embedded at build. Remote fetching is off until you set an explicit allowlist.
  - icon: lucide:flask-conical
    title: Test with a real render
    description: "@lupinum/nuxt-pdf/test renders a template through the real pipeline and checks text, links, outline, page count and raster baselines."
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

[Quickstart]($docs.quickstart) explains each file. Nuxt PDF runs on Node.js 22 (from 22.14), 24 or 26 with Nuxt 4 ([requirements]($docs.installation)).
