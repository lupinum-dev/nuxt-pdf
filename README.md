# Nuxt PDF

Author server-rendered PDFs as ordinary Vue components inside a Nuxt
application. Nuxt PDF uses Vue for authoring and the framework-neutral React
PDF layout, font, and serialization packages for rendering; React itself is
not a production dependency.

The current release is an external alpha: still one Nuxt module, one document
tree, and one Node server renderer, with a contract that has widened from
0.1.0's core layout
primitives to SVG drawing, a multi-pass table of contents, internal links,
bookmarks, opt-in remote resources, shipped testing utilities, and enforced
render limits — each backed by an executable fixture. See
[CONFORMANCE.md](./CONFORMANCE.md) for the exact evidence and limitations behind
the compatibility claim.

## Requirements

- Node.js `^22.12.0`, `^24.11.0`, or `>=26.0.0`
- Nuxt `^4.4.8`
- Vue `^3.5.0`

Nuxt 3, Node 20, browser rendering, and edge rendering are not claimed by the
current alpha.

## Ten-minute quickstart

Install the module in an existing Nuxt 4 application:

```bash
pnpm add @lupinum/nuxt-pdf
```

Add it to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
})
```

Create `pdfs/invoice.vue` at the project root:

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
    <PdfPage
      size="A4"
      :style="{ color: '#17201b', fontSize: 11, padding: 48 }"
    >
      <PdfText :style="{ fontSize: 24, marginBottom: 24 }">
        Invoice {{ props.invoice.number }}
      </PdfText>
      <PdfText>{{ props.invoice.customer }}</PdfText>
      <PdfText :style="{ marginTop: 12 }">
        Total: {{ props.invoice.total }}
      </PdfText>
      <PdfText
        fixed
        :style="{
          bottom: 24,
          color: '#68736b',
          fontSize: 8,
          position: 'absolute',
          right: 48,
        }"
        :render="({ pageNumber, totalPages }) =>
          `Page ${pageNumber} of ${totalPages}`"
      />
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

Start Nuxt and open:

- `http://localhost:3000/_pdf` for the template index;
- `http://localhost:3000/_pdf/invoice` for the browser preview; or
- `http://localhost:3000/api/invoice` for the production-style route.

The `/_pdf` routes are registered only in development. Restart `nuxt dev`, or
run `nuxt prepare`, after first enabling the module so Nuxt writes the typed
`#pdf` registry.

## Development preview

`/_pdf` is where you live while building a document. The index lists every
template as a card with its source file, scenario count, and quick links to the
preview and the raw PDF. Each viewer page:

- offers the sample data and every named scenario as tabs that swap the embedded
  PDF, with the active one highlighted (an unknown `?scenario=` still 404s with
  the available names);
- renders a diagnostics strip for that render — duration, output size, page
  count, and layout passes — plus every warning the render emitted (in
  development these are collected for the panel; production still logs them with
  `console.warn`);
- shows a content-free error summary when a render fails while retaining the
  previous successful PDF with an explicit stale marker;
- provides separate refresh, inline raw-PDF, and download actions; and
- automatically reloads after a PDF SFC changes while preserving the active
  scenario in the current URL.

The preview is server-rendered HTML with a tiny Vite development-event listener
and is absent from production builds. It calls the template's public
`render(props)` once and embeds that exact completed result; there is no
preview-specific render path.

## Authoring model

PDF templates live in `pdfs/**/*.vue`. `pdfs/components`, `pdfs/assets`, and
`pdfs/fonts` are reserved supporting directories and are not registered as
documents.

The alpha exposes seven thin primitives:

- `PdfDocument`
- `PdfPage`
- `PdfView`
- `PdfText`
- `PdfImage`
- `PdfLink`
- `PdfNote`

Composition is normal Vue: use typed props, interpolation, `v-if`, keyed
`v-for`, local components, and slots. Styles use Nuxt PDF's framework-owned,
typed `PdfStyle` contract, not browser CSS or the upstream React PDF type
surface. Invalid nesting, DOM-only attributes, unknown props, and props used on
the wrong primitive fail early with `PDF_TREE_INVALID`.

`definePdf` accepts render metadata plus development-only preview data:

```ts
definePdf<Props>({
  title: props => `Report ${props.id}`,
  filename: props => `report-${props.id}.pdf`,
  language: 'en-GB',
  sampleData: { id: 'sample' },
  scenarios: {
    long: { id: 'long-report' },
  },
})
```

A scenario is available at `/_pdf/report?scenario=long`. Unknown scenarios
return a 404 with the available names. `sampleData` and `scenarios` live in an
internal development sidecar; the production SFC transform structurally omits
their expressions, and the public template handle never exposes them. Like
Vue's hoisted compiler macros, `definePdf()` metadata can use inline values or
imports, but not variables declared locally in `<script setup>`. Keep imported
preview-fixture modules side-effect-free so production bundlers can remove them.

## Table of contents, links, and bookmarks

Give any primitive an `id` to make it a named destination, and link to it with
`<PdfLink src="#id">`. To print the page a destination lands on, call the
auto-imported `usePdfPageNumbers()` composable — it returns a readonly, reactive
map from `id` to its 1-based page:

```vue
<script setup lang="ts">
const pageNumbers = usePdfPageNumbers()
</script>

<template>
  <PdfLink :src="`#${section.id}`">
    {{ section.title }} … {{ pageNumbers[section.id] ?? '' }}
  </PdfLink>
</template>
```

Reading the composable turns on a multi-pass layout (internal `#` links alone
stay single-pass — they resolve by name): the document is laid out repeatedly, feeding the resolved page
numbers back in, until they stabilize — an ordinary table of contents settles in
two passes. On the first pass the numbers are `undefined`, so keep a fallback.
Numbers and links always resolve to the page a section **starts** on, even when
the section spans pages. A document whose layout depends on the numbers it prints
fails with `PDF_LIMIT_EXCEEDED`; raise the cap with `definePdf({ maxPasses })`.

Add a `bookmark` (`"Title"` or `{ title, expanded }`) to any primitive to build
the PDF outline; nesting follows the component tree. `playground/pdfs/report.vue`
demonstrates the whole feature.

## Typed server registry

Nuxt generates an inspectable `#pdf` module from the discovered templates.
Property access and literal template names infer each SFC's props:

```ts
import { pdf, renderPdf } from '#pdf'

await pdf.invoice.render({ invoice })
await renderPdf('invoice', { invoice })
```

Each public template is exactly `{ key, resolveMetadata(props), render(props) }`.
The registry is server-only: do not import `#pdf` from client code. In
production, neither the engine nor template SFCs enter the client bundle, and
preview data is absent from the Nitro server artifact too.

The completed result carries the exact frozen `metadata` resolved for that
render alongside its frozen `diagnostics`; preview and application code consume
the same facts without evaluating metadata a second time.

Runtime strings require the explicit unknown-props escape hatch:

```ts
await renderPdf(templateName, untypedProps, { unsafe: true })
```

That marker does not validate the props; it only makes the loss of static
typing visible at the call site. Unknown template names still fail with
`PDF_TEMPLATE_NOT_FOUND`.

One completed render result owns immutable bytes and can be converted without
rendering the document again:

```ts
const result = await pdf.invoice.render({ invoice })

await result.toUint8Array()
await result.toBuffer()
result.diagnostics // duration, bytes, pages, passes, registered faces, warnings
await result.response({
  disposition: 'inline',
  filename: 'invoice.pdf',
})
```

`response()` always sets `content-type`, the exact `content-length`, and a
sanitized `content-disposition`. With no template filename or response override,
it safely downloads as `document.pdf`. Diagnostics contain measurements and
warnings only — never document content, props, or resource URLs.

## Local images and fonts

Place PNG or JPEG files in `pdfs/assets` and reference the path relative to
that directory:

```vue
<PdfImage
  src="brand/logo.png"
  :style="{ height: 40, objectFit: 'contain', width: 120 }"
/>
```

Place TTF or OTF files in `pdfs/fonts` and register them in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
  pdf: {
    fonts: [{
      family: 'Invoice Sans',
      src: 'InvoiceSans-Regular.ttf',
      fontWeight: 400,
      fontStyle: 'normal',
    }],
  },
})
```

Then use the family in a PDF style object:

```vue
<PdfPage :style="{ fontFamily: 'Invoice Sans' }">
```

Resources are signature-checked, size-checked, realpath-contained, and
embedded into the server build. Absolute paths, traversal, symlink escapes,
and runtime filesystem fallbacks are rejected. Remote URLs fail closed unless
you opt in with an explicit `pdf.remote.allow` allowlist (see below).

## Remote images (opt-in)

Remote fetching is off by default. Configure an `https`-only allowlist to let
the module — never the engine — fetch and embed allowlisted resources:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
  pdf: {
    remote: {
      allow: ['https://assets.example.com/pdf/'],
    },
  },
})
```

Each entry is an exact `https://host/path/` prefix. Wildcards, credentials,
fragments, and prefixes without a trailing slash are rejected. The allowlist is
re-checked on every redirect hop; byte, pixel, fan-out, concurrency, and output
caps come from `pdf.limits`; and fetches are credential-less `GET`s bounded by
the render deadline. Remote images are deduplicated only within one render.
Fonts must be local build inputs. See
[CONFORMANCE.md](./CONFORMANCE.md) for the full tested boundary.

## Testing your PDFs

The same utilities this package is tested with ship as `@lupinum/nuxt-pdf/test`,
so you can assert against your own templates with a real render — no Nuxt boot,
no snapshot guesswork. The parser and rasterizer load `pdfjs-dist` and
`@napi-rs/canvas` lazily; install them as dev dependencies of your project:

```bash
pnpm add -D pdfjs-dist @napi-rs/canvas
```

`renderPdfTemplate` mounts a component through the real pipeline (asset
resolution, font registration, single- or multi-pass layout) and returns the
bytes alongside a parsed document. `expectPdf` gives runner-agnostic assertions
that throw a `PdfAssertionError` with an actionable message on failure:

```ts
import { describe, it } from 'vitest'
import { expectPdf, renderPdfTemplate } from '@lupinum/nuxt-pdf/test'
import Invoice from './pdfs/invoice.vue'

describe('invoice.vue', () => {
  it('renders the customer, a terms link, and an outline', async () => {
    const { parsed } = await renderPdfTemplate(Invoice, { customer: 'Acme Corp' })

    expectPdf(parsed)
      .toHavePageCount(2)
      .toContainText('Invoice for Acme Corp', { page: 1 })
      .toHaveLink({ destination: 'terms', page: 1 })
      .toHaveLink({ url: 'https://example.com/' })
      .toHaveOutline([{ title: 'Terms' }])
  })
})
```

`parsePdf` also accepts a `PdfRenderResult` straight from the server registry —
`await parsePdf(await pdf.invoice.render(props))` — so route tests read naturally.

`renderPdfSfc('./pdfs/invoice.vue', props, { fonts })` compiles the real template
and nested child SFCs, discovers local images, and admits local fonts through the
same validated path as a Nuxt production build.

For pixel-level regressions, `comparePdfSnapshot` follows a reviewed-baseline
policy: it writes per-page PNG baselines into a directory when
`UPDATE_PDF_BASELINES=1` (or `{ update: true }`) is set, and otherwise compares
each page against them within a pixel threshold.

```ts
import { comparePdfSnapshot, renderPdfTemplate } from '@lupinum/nuxt-pdf/test'

const { bytes } = await renderPdfTemplate(Invoice, { customer: 'Acme Corp' })
await comparePdfSnapshot(bytes, './test/baselines/invoice')
```

Failures produce expected, actual, and diff PNGs for every changed page plus
machine-readable metrics under `reports/pdf-snapshots`. `parsePdf` also exposes
normalized page dimensions and text-run geometry for tolerant layout checks.

## Alpha boundary

Nuxt PDF is currently designed for invoices, reports, certificates, tickets,
and similar server-generated documents. The release does not include a table
engine, CSS compiler, HTML printing, DevTools studio, browser renderer,
deterministic PDF bytes, forms, signing, tagged PDF, or an independent layout
engine.

Dynamic text callbacks are synchronous and must return a string or number.
Dynamic text always renders with font-default line spacing: any `lineHeight`
reaching it — inherited or its own — is neutralized rather than rejected,
because the pinned upstream layout engine produces invalid geometry for that
combination (upstream React PDF silently drops such footers; Nuxt PDF renders
them correctly).

For the complete tested behavior and exact lower-engine versions, read
[CONFORMANCE.md](./CONFORMANCE.md) and
[CONTRACTS.md](./src/runtime/server/engine/CONTRACTS.md).

## Development

```bash
pnpm install
pnpm dev
pnpm verify
```

`pnpm verify` is the release gate: lint, types, dependency boundaries, unit and
conformance tests, Nuxt development and production fixtures, package build,
playground production build, raster baselines, tarball contents, and the fresh
application smoke test.

## License

MIT. React PDF-derived fixture attribution and bundled test-font notices are
recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
