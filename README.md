<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/icon-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/public/icon-light.svg">
    <img src="docs/public/icon-light.svg" width="128" alt="Nuxt PDF icon">
  </picture>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/public/wordmark-light.svg">
    <img src="docs/public/wordmark-light.svg" width="256" alt="Nuxt PDF">
  </picture>
</h1>

<p align="center">
  Author and render PDFs with Vue components in Nuxt.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/nuxt-pdf"><img src="https://img.shields.io/npm/v/@lupinum/nuxt-pdf?color=00DC82" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/nuxt-pdf/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/nuxt-pdf/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-00DC82" alt="MIT license"></a>
  <a href="https://discord.lupinum.com"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord" alt="Discord"></a>
  <a href="https://deepwiki.com/lupinum-dev/nuxt-pdf"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
</p>

> [!IMPORTANT]
> Nuxt PDF is in public beta. Its tested behavior is stable within each
> release, but a minor release can contain documented breaking changes before
> version 1.0.

## Why use Nuxt PDF?

Nuxt PDF discovers Vue Single File Components in `pdfs/`. It renders these
components on the Node server through a PDF layout engine. The client bundle
does not contain the renderer or document templates.

This approach gives you typed document props, reusable Vue components, stable
server output, and PDF-specific test helpers in one Nuxt module.

## When to use it

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

## Installation

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

## Quick start

Create `pdfs/invoice.vue`:

```vue [pdfs/invoice.vue]
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
  language: 'en-GB',
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

Start Nuxt:

```bash
pnpm dev
```

Download the PDF from a second terminal:

```bash
curl -o invoice.pdf http://localhost:3000/api/invoice
```

Open these development routes:

- `/_pdf` lists the discovered templates.
- `/_pdf/invoice` shows the document preview.
- `/api/invoice` returns the production-style PDF response.

Nuxt PDF regenerates the typed `#pdf` registry whenever templates change. If
your editor still shows `#pdf` as untyped, run `nuxt prepare` once to refresh
the generated types.

## Agent setup

`@lupinum/nuxt-pdf` ships its documentation inside the package for coding
agents such as Claude Code, Codex and Cursor. The pages match the installed
version, so an agent does not follow the website for a different version.

To set it up, give your coding agent this task:

```text
Set up @lupinum/nuxt-pdf for coding agents as described under "Agent setup" in its README.
```

### Steps for the agent

1. Find `node_modules/@lupinum/nuxt-pdf/dist/agent/AGENTS.md`. Look in the
   directory of the project that depends on `@lupinum/nuxt-pdf` first, then
   in its parent directories up to the repository root (workspaces can hoist
   packages). Read it; it lists the documentation pages.
2. Add the section below to the project's agent instructions: `AGENTS.md`, or
   `CLAUDE.md` if the project has only that file. If it has neither, create
   `AGENTS.md`. Write the path relative to the repository root, through
   `node_modules/@lupinum/nuxt-pdf` (for example
   `apps/web/node_modules/@lupinum/nuxt-pdf/...` in a workspace). Never write
   a resolved path such as `node_modules/.pnpm/...`: it contains the version and
   breaks after an upgrade. If a section for `@lupinum/nuxt-pdf` already
   exists, leave it as it is.

   Use the path you found in place of the sample path:

   ```md
   ## @lupinum/nuxt-pdf

   Before you change code that uses @lupinum/nuxt-pdf, read
   `node_modules/@lupinum/nuxt-pdf/dist/agent/AGENTS.md` and the pages it
   lists. They document the installed version. Prefer them over what you
   remember about this package and over the website.
   ```

3. Do not copy the documentation into the project and do not install a skill.
   The section points into the installed package, so it stays correct after
   every upgrade or downgrade.

If the file does not exist, the installed version has no packaged
documentation. Read the package README and its TypeScript types instead.

## Discord

Join the Lupinum OSS community to discuss Nuxt PDF, ask questions, and share
what you build.

<p align="center">
  <a href="https://discord.lupinum.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/public/discord-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/public/discord-light.svg">
      <img src="docs/public/discord-light.svg" width="500" alt="Join the Lupinum OSS Discord">
    </picture>
  </a>
</p>

## How it works

PDF templates use typed props, interpolation, `v-if`, keyed `v-for`, slots,
and local Vue components. Nuxt PDF provides document, page, text, image, link,
note, and SVG primitives.

Templates run in an isolated Vue application on the Node server. They do not
inherit Nuxt plugins, app-level provides, browser globals, or DOM components.
Load request data before the render and pass it through typed props.

Nuxt PDF supports local images and fonts. Remote images are disabled until an
operator configures an explicit HTTPS allowlist.

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

## Documentation

Read the [Nuxt PDF documentation](https://nuxt-pdf.lupinum.com) for authoring,
assets, links, bookmarks, tables of contents, testing, and the complete API
reference. Read [CONFORMANCE.md](./CONFORMANCE.md) for the exact tested behavior
and known limitations.

Coding agents should start with
[`/llms.txt`](https://nuxt-pdf.lupinum.com/llms.txt). It links to concise raw
Markdown for common tasks, reference pages, errors, and compatibility evidence.

## Contributing and development

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm verify
```

Use `pnpm docs:dev` to run the documentation site. `pnpm verify` runs the same
checks as CI.

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before you open a pull request.

## Support and security

- Read the [documentation](https://nuxt-pdf.lupinum.com).
- Join the [Lupinum OSS Discord](https://discord.lupinum.com).
- Open a [bug report](https://github.com/lupinum-dev/nuxt-pdf/issues/new?template=bug.yml)
  for a reproducible defect.
- Open a [feature request](https://github.com/lupinum-dev/nuxt-pdf/issues/new?template=feature.yml)
  before you plan a larger change.
- Follow [SECURITY.md](.github/SECURITY.md) for a private vulnerability report.

## License

[MIT](./LICENSE) © Lupinum OG and contributors.

Third-party attributions are in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
