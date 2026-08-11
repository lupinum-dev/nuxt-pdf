<p align="center">
  <img src="docs/public/logo.svg" width="128" alt="Nuxt PDF">
</p>

<h1 align="center">Nuxt PDF</h1>

<p align="center">
  Author and render PDFs with Vue components in Nuxt.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/nuxt-pdf"><img src="https://img.shields.io/npm/v/@lupinum/nuxt-pdf?color=315d3b" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/nuxt-pdf/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/nuxt-pdf/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-315d3b" alt="MIT license"></a>
</p>

> [!IMPORTANT]
> Nuxt PDF is an external alpha. Its tested behavior is stable within each
> release, but a minor release can contain documented breaking changes before
> version 1.0.

Nuxt PDF discovers Vue Single File Components in `pdfs/`. It renders these
components on the Node server through a PDF layout engine. The client bundle
does not contain the renderer or document templates.

Use Nuxt PDF for structured documents such as invoices, reports,
certificates, tickets, and labels.

Do not use Nuxt PDF to print an existing web page, display an existing PDF, or
edit and sign an existing PDF.

## Requirements

- Node.js `^22.14.0`, `^24.0.0`, or `^26.0.0`
- Nuxt `^4.4.8`
- Vue `^3.5.0`

Nuxt 3, Node 20, browser rendering, and edge rendering are outside the current
support boundary.

## Install

Install the module in a Nuxt 4 application:

```bash
pnpm add @lupinum/nuxt-pdf
```

Add the module to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
})
```

## Render a document

Create `pdfs/invoice.vue`:

```vue
<script setup lang="ts">
type InvoiceProps = {
  invoice: {
    customer: string
    number: string
    total: string
  }
}

const props = defineProps<InvoiceProps>()

definePdf<InvoiceProps>({
  title: ({ invoice }) => `Invoice ${invoice.number}`,
  filename: ({ invoice }) => `invoice-${invoice.number}.pdf`,
  sampleData: {
    invoice: {
      customer: 'Ada Lovelace',
      number: 'INV-001',
      total: 'EUR 1,250.00',
    },
  },
})
</script>

<template>
  <PdfDocument>
    <PdfPage size="A4" :style="{ fontSize: 11, padding: 48 }">
      <PdfText :style="{ fontSize: 24, marginBottom: 24 }">
        Invoice {{ props.invoice.number }}
      </PdfText>
      <PdfText>{{ props.invoice.customer }}</PdfText>
      <PdfText :style="{ marginTop: 12 }">
        Total: {{ props.invoice.total }}
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>
```

Create `server/api/invoice.get.ts`:

```ts
import { pdf } from '#pdf'

export default defineEventHandler(async () => {
  const result = await pdf.invoice.render({
    invoice: {
      customer: 'Ada Lovelace',
      number: 'INV-001',
      total: 'EUR 1,250.00',
    },
  })

  return result.response()
})
```

Start Nuxt. Open these development routes:

- `/_pdf` lists the discovered templates.
- `/_pdf/invoice` shows the document preview.
- `/api/invoice` returns the production-style PDF response.

Restart `nuxt dev` after you first enable the module. This action generates
the typed `#pdf` registry.

## Authoring model

PDF templates use typed props, interpolation, `v-if`, keyed `v-for`, slots,
and local Vue components. Nuxt PDF provides document, page, text, image, link,
note, and SVG primitives.

Templates run in an isolated Vue application on the Node server. They do not
inherit Nuxt plugins, app-level provides, browser globals, or DOM components.
Load request data before the render and pass it through typed props.

Nuxt PDF supports local images and fonts. Remote images are disabled until an
operator configures an explicit HTTPS allowlist.

Read the [documentation](https://nuxt-pdf.lupinum.com) for authoring, assets,
links, bookmarks, tables of contents, testing, and the complete API reference.
Read [CONFORMANCE.md](./CONFORMANCE.md) for the exact tested behavior and known
limitations.

## Test a document

Install the optional test dependencies:

```bash
pnpm add -D pdfjs-dist @napi-rs/canvas
```

Render the real template in a test:

```ts
import { expectPdf, renderPdfSfc } from '@lupinum/nuxt-pdf/test'

const { parsed } = await renderPdfSfc('./pdfs/invoice.vue', {
  invoice: {
    customer: 'Ada Lovelace',
    number: 'INV-001',
    total: 'EUR 1,250.00',
  },
})

expectPdf(parsed)
  .toHavePageCount(1)
  .toContainText('Invoice INV-001')
```

The test entry can also inspect links, bookmarks, page geometry, and raster
baselines.

## Develop Nuxt PDF

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

Use `pnpm docs:dev` to run the documentation site. Use
`pnpm release:verify` only for release preparation.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request.
Maintainers use [MAINTAINING.md](./MAINTAINING.md) for release and recovery
procedures.

## Support and security

- Read the [documentation](https://nuxt-pdf.lupinum.com).
- Join the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N).
- Open a [bug report](https://github.com/lupinum-dev/nuxt-pdf/issues/new?template=bug.yml)
  for a reproducible defect.
- Open a [feature request](https://github.com/lupinum-dev/nuxt-pdf/issues/new?template=feature.yml)
  before you plan a larger change.
- Follow [SECURITY.md](./SECURITY.md) for a private vulnerability report.

## License

[MIT](./LICENSE) © Lupinum OG and contributors.

Third-party attributions are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
