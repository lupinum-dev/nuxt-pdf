---
'@lupinum/nuxt-pdf': minor
---

Change rendering to one plain-data path that lays out PDFs in a worker thread, with page tokens instead of page-number callbacks

Add `PdfPageNumber`, `PdfPageCount` and `PdfPageRef`, with the exported types `PdfPageNumberProps`, `PdfPageCountProps` and `PdfPageRefProps`. Layout runs in a pool of worker threads, and `pdf.limits.timeoutMs` stops a long layout. A Nitro preset that bundles the server into one file renders in-process and logs a build warning; there the deadline is checked between engine stages only. A worker is replaced after 200 renders, and an idle worker that fails leaves the pool without stopping the server. The error for page numbers that do not settle shows the facts of the last pass. The removed `render` prop, `hyphenationCallback`, a page token directly in `PdfLink` or `PdfView` and `usePdfPageNumbers()` fail with a hint to their replacement. In a template, the removed props fail the build: one error lists every occurrence of the file with its line and column.

Fix a template that changes reactive state after it rendered (a timer, a late promise): the PDF no longer changes, because the tree is taken and the Vue app unmounted before the first await. A `PdfImage` whose source was not admitted fails with `PDF_ASSET_INVALID`.

Fix an image that appears on several pages, such as a logo in a `fixed` header: it is embedded once per document, not once per page.

Migration: the `render` prop of `PdfText` is removed. Put `<PdfPageNumber />` and `<PdfPageCount />` inside a `fixed` `PdfText`: `<PdfText fixed>Page <PdfPageNumber /> of <PdfPageCount /></PdfText>`. A `PdfText` inside a `fixed` `PdfView` (a footer row) also works; it needs no `fixed` of its own.

Migration: a page token is a component, not a value. Where a `render` callback built the whole line in JavaScript, keep the computed part in `{{ }}` and put the token after it: `{{ parts.join(' · ') }} · Page <PdfPageNumber />`. A token in a link goes into a text inside the link, with the link outside any other text: `<PdfLink><PdfText>Page <PdfPageNumber /></PdfText></PdfLink>`.

Migration: the build names the file, line and column of a removed prop. A render error, such as invalid nesting, carries the line only in `nuxt dev`; elsewhere (a production server, `renderPdfSfc` in tests) it names the template file. Run `nuxt dev` and open the template in the `/_pdf` preview to see the line.

Migration: a `render` callback that hides content on some pages becomes `pages` on the `fixed` text. For a header hidden on page 1 (`:render="({ pageNumber }) => pageNumber > 1 ? … : ''"`), write `<PdfText fixed pages="continuation">{{ title }} · <PdfPageNumber /></PdfText>`.

Migration: `usePdfPageNumbers()` is removed. Print the page of a destination with `<PdfPageRef to="id" />` inside a `PdfText`: `<PdfText>Results <PdfPageRef to="results" /></PdfText>`. The number is resolved after layout.

Migration: `hyphenationCallback` is removed, and no prop accepts a function. Use `:hyphenate="false"` to keep words whole: `<PdfText :hyphenate="false">…</PdfText>`. Custom split rules are not supported.

Migration: a `ref` or other non-plain value inside a style or prop fails with `PDF_TREE_INVALID`. Pass plain values: a style object built in `<script setup>` uses `{ color: color.value }`, not `{ color }` with a `ref`.

Migration: `pdf.limits` has no per-image caps any more. Remove `maxImageBytes` and `maxImagePixels`; `maxTotalImageBytes` (default 32 MiB) and `maxTotalImagePixels` (default 100,000,000) keep their meaning, the budget for all images of one render, so keep them or set them to the budget of a whole document. Remove `maxTreeDepth`, `maxTextCharacters`, `maxImages`, `maxRemoteConcurrency` and `maxOutputBytes`; remote requests run at most four at a time. Each removed key fails module setup with a message that says what to set instead. The seven options are `timeoutMs`, `maxPages`, `maxNodes`, `maxTotalImageBytes`, `maxTotalImagePixels`, `maxRemoteRequests` and `maxTotalAttachmentBytes`.

Migration: a view whose first page would hold only its `fixed` children (for example a repeated header alone at the page bottom) starts on the next page. Check page breaks of views with `fixed` children.

Migration: the error for page numbers that do not settle within `maxPasses` starts with "Page numbers did not stabilize". Update code that matches the old "Table-of-contents page numbers" text.
