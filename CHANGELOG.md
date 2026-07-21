# Changelog

All notable changes to `@lupinum/nuxt-pdf` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- One canonical `pdf.limits` budget covering tree nodes/depth/text, pages,
  image count/source bytes/decoded pixels, remote request count/concurrency,
  the whole-render deadline, and completed output bytes.
- Structural PNG/JPEG dimension validation before engine admission, aggregate
  per-render image accounting, atomic output-cap failure, and fatal sibling
  request cancellation.

### Breaking changes

- `pdf.remote` now permits images only and contains only `allow` plus
  `timeoutMs`. Move former `maxImageBytes` configuration to
  `pdf.limits.maxImageBytes`; remote fonts must become local `pdfs/fonts`
  inputs.
- Allowlist entries must be exact `https://host/path/` prefixes. Wildcard hosts
  and prefixes without a trailing slash are rejected. Redirects are capped at
  three hops.

## 0.2.0

The contract widens from 0.1.0's core layout primitives to vector graphics, a
table of contents, internal links, bookmarks, opt-in remote resources, shipped
testing utilities, and enforced render limits — each backed by an executable
conformance fixture. Everything is additive: no 0.1.0 public API changed.

### Added

- **SVG drawing primitives.** `PdfSvg`, `PdfG`, `PdfPath`, `PdfRect`,
  `PdfCircle`, `PdfEllipse`, `PdfLine`, `PdfPolyline`, `PdfPolygon`, `PdfDefs`,
  `PdfClipPath`, `PdfLinearGradient`, `PdfRadialGradient`, `PdfStop`, and
  `PdfTspan`, with enforced nesting rules and `url(#id)` def references. Verified
  by a paired React/Vue raster fixture.
- **Table of contents via `usePdfPageNumbers()`.** An auto-imported composable
  returning a readonly, reactive `id → 1-based page` map. Reading it activates a
  fixed-point multi-pass layout that converges (an ordinary TOC settles in two
  passes); a document whose geometry depends on the numbers it prints fails
  closed with `PDF_LIMIT_EXCEEDED`.
- **Internal `#id` links and bookmarks.** Any primitive `id` becomes a named
  destination reachable with `<PdfLink src="#id">`; a `bookmark` prop builds a
  nested PDF outline following the component tree. Internal links stay
  single-pass (they resolve by name).
- **Opt-in remote images and fonts.** Off by default. `pdf.remote.allow`
  configures an explicit `https`-only host + path-prefix allowlist enforced by
  the module (never the engine) with per-hop redirect re-checks, byte caps,
  signature validation, and timeouts; admitted bytes take the same embedded path
  as local assets.
- **`@lupinum/nuxt-pdf/test` utilities.** The helpers this package is tested with
  now ship: `renderPdfTemplate`, `parsePdf`, `expectPdf`, `rasterizePdf`, and
  `comparePdfSnapshot` (reviewed-baseline policy). `pdfjs-dist` and
  `@napi-rs/canvas` are new **optional** peer dependencies, loaded lazily only by
  this entry.
- **Render limits.** Every render is bounded by `pdf.limits.maxPages` (default
  2000) and `pdf.limits.timeoutMs` (default 30000), validated at setup and
  enforced on both the single- and multi-pass paths; breaches fail with
  `PDF_LIMIT_EXCEEDED`. Defaults apply even with no `pdf.limits` configured.
- **`NuxtPdfError` and `PDF_ERROR_CODES`** exported from `#pdf`, and
  template-attributed errors: every failure from a template's `render()` carries
  `templateKey`/`templateFile` and a message prefixed with the source file.
- **Development preview workbench** at `/_pdf`: scenario tabs, a per-render
  diagnostics strip (duration, size, page count, layout passes, warnings), and a
  readable error panel. Server-rendered, absent from production builds.
- **Documentation site** under `docs/` and a `playground/pdfs/report.vue`
  demonstrating the TOC, bookmarks, and page numbers end to end.
- **Serverless build proof.** The module is verified to build under the Vercel
  Nitro preset (execution remains verified on node-server).

### Improvements (deliberate divergences from React PDF)

- **Dynamic-text line spacing.** Page-number footers now render at correct
  page-bottom geometry even when a `lineHeight` reaches the dynamic node
  (inherited, percentage, or its own). Upstream React PDF produces invalid
  geometry for that combination and silently drops such footers; Nuxt PDF
  neutralizes the un-carryable `lineHeight` and renders them.
- **Named-destination anchoring.** Internal links and TOC page numbers resolve to
  the **first** page a section starts on, even when the section spans pages.
  React PDF's last-writer-wins destination table points at the last page; Nuxt
  PDF anchors at the first, copy-on-write so a `fixed` node repeated across pages
  keeps its first-page destination.

### Breaking changes

One type-level narrowing: the `bookmark` prop is no longer **typed** on
`PdfLink` and `PdfNote`. It was never tested or claimed there, and outline
entries are verified only on `PdfPage`/`PdfView`/`PdfText`/`PdfImage`, so the
types now match the tested contract. Runtime behavior is unchanged.

Everything else in the 0.1.0 public surface — module options, `#pdf` registry,
components, and `definePdf` — is unchanged; every 0.2.0 addition is opt-in.
`pdfjs-dist` and `@napi-rs/canvas` are added only as **optional** peer
dependencies for the new `/test` entry.

## 0.1.0

Initial external alpha: one Nuxt module, one Vue document tree, one Node server
renderer over exact-pinned React PDF engine packages, and a small set of tested
layout primitives (`PdfDocument`, `PdfPage`, `PdfView`, `PdfText`, `PdfImage`,
`PdfLink`, `PdfNote`) with local image and font embedding and a typed `#pdf`
server registry.
