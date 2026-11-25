---
'@lupinum/nuxt-pdf': minor
---

Change rendering to the package's own engine, which lays out PDFs from plain data in worker threads, and remove the `@react-pdf/*` dependencies

Layout runs in a pool of worker threads, and `pdf.limits.timeoutMs` stops a long layout. A Nitro preset that bundles the server into one file renders in-process and logs a build warning; there the deadline is checked between engine stages and once per page. A worker is replaced after 200 renders, and an idle worker that fails leaves the pool without stopping the server. A template that changes reactive state after it rendered (a timer, a late promise) no longer changes the PDF, because the tree is taken and the Vue app unmounted before the first await.

The package has its own PDF writer, painter, layout and text layout. The bytes of every document change; the pages look the same and give the same text. Two renders of one document with the same `creationDate` write the same bytes, also when several renders run at the same time: the font subset names and the file ID come from the content. Code that compares rendered bytes with a stored file needs a new stored file. An image that appears on several pages, such as a logo in a `fixed` header, is embedded once per document, not once per page. Text layout shapes each repeated string once per render, so documents with repeated figures, such as invoice tables, render faster.

Dependencies: `@react-pdf/pdfkit`, `@react-pdf/render`, `@react-pdf/layout`, `@react-pdf/font` and `@react-pdf/primitives`, and the packages only they needed, are no longer installed; the package installs `fontkit`, `yoga-layout`, `hyphen`, `bidi-js` and `unicode-properties` directly. `typescript` and `vue-tsc` change from dependencies to optional peer dependencies, and `h3` uses a caret range, so it shares Nuxt's copy.

Migration: a `ref` or other non-plain value inside a style or prop fails with `PDF_TREE_INVALID`. Pass plain values: a style object built in `<script setup>` uses `{ color: color.value }`, not `{ color }` with a `ref`.

Migration: projects that call `buildPdfRegistry()` from `@lupinum/nuxt-pdf/build` must install `typescript` and `vue-tsc` (`pnpm add -D typescript vue-tsc`); without them the build stops with an error that names the missing package. Nuxt projects that only use the module need nothing new.
