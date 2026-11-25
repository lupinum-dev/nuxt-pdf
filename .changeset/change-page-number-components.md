---
'@lupinum/nuxt-pdf': minor
---

Change page numbers from callbacks to the components `PdfPageNumber`, `PdfPageCount` and `PdfPageRef`, and add `pages` on `fixed` nodes

Page numbers are components inside a `PdfText`: `<PdfText fixed>Page <PdfPageNumber /> of <PdfPageCount /></PdfText>`. `<PdfPageRef to="id" />` prints the page of a destination, resolved after layout. `pages` (`'all'`, `'first'`, `'continuation'` or `'not-last'`) on a `fixed` `PdfView` or `PdfText` limits the pages of its parent where it appears. New exported types: `PdfPageNumberProps`, `PdfPageCountProps`, `PdfPageRefProps` and `PdfFixedPages`. The removed `render` prop, `usePdfPageNumbers()` and a page token directly in `PdfLink` or `PdfView` fail with a hint to their replacement. In a template, the removed props fail the build, and one error lists every occurrence of the file with its line and column.

A text with a page token uses its `lineHeight` and keeps the underline or strike it inherits, and when it is longer than a page it splits over pages and columns like any text, each part with the values of its page. A page number or count keeps room for the digits of the page count, each as wide as the font's widest digit, and the number is painted into that room, also at its visual place in a right-to-left line, so it never moves a line or a page break. A `'first'` or `'continuation'` node takes room only on the pages where it shows; a `'not-last'` node takes room on every page of its parent and leaves it empty on the last.

Migration: the `render` prop of `PdfText` is removed. Put `<PdfPageNumber />` and `<PdfPageCount />` inside a `fixed` `PdfText`: `<PdfText fixed>Page <PdfPageNumber /> of <PdfPageCount /></PdfText>`. A `PdfText` inside a `fixed` `PdfView` (a footer row) also works; it needs no `fixed` of its own.

Migration: a page token is a component, not a value. Where a `render` callback built the whole line in JavaScript, keep the computed part in `{{ }}` and put the token after it: `{{ parts.join(' · ') }} · Page <PdfPageNumber />`. A token in a link goes into a text inside the link, with the link outside any other text: `<PdfLink><PdfText>Page <PdfPageNumber /></PdfText></PdfLink>`.

Migration: a `render` callback that hides content on some pages becomes `pages` on the `fixed` text. For a header hidden on page 1 (`:render="({ pageNumber }) => pageNumber > 1 ? … : ''"`), write `<PdfText fixed pages="continuation">{{ title }} · <PdfPageNumber /></PdfText>`.

Migration: `usePdfPageNumbers()` is removed. Print the page of a destination with `<PdfPageRef to="id" />` inside a `PdfText`: `<PdfText>Results <PdfPageRef to="results" /></PdfText>`.

Migration: the build names the file, line and column of a removed prop. A render error, such as invalid nesting, carries the line only in `nuxt dev`; elsewhere (a production server, `renderPdfSfc` in tests) it names the template file. Run `nuxt dev` and open the template in the `/_pdf` preview to see the line.

Migration: the error for page numbers that do not settle within `maxPasses` starts with "Page numbers did not stabilize" and shows the facts of the last pass. Update code that matches the old "Table-of-contents page numbers" text.
