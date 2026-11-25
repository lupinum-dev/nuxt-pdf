---
'@lupinum/nuxt-pdf': minor
---

Add `PdfRichText` to print rich text from a CMS: editor HTML, a rich text model, Markdown or comark

`<PdfRichText :html="article.body" />` prints the HTML of a rich text editor (TipTap, Lexical, Quill and others) with headings, paragraphs, lists, quotes, code, rules, links, images, tables and the marks bold, italic, underline, strikethrough, code, superscript and subscript. `content` takes a rich text model instead. `parseRichTextHtml` and `validateRichText` are available in templates without an import, from `#pdf` and from `@lupinum/nuxt-pdf/server`; the model types from `@lupinum/nuxt-pdf`. `parseRichTextMarkdown(markdown)` parses Markdown with comark into the model, and the `comark` prop takes a document that comark or Nuxt Content already parsed; the `components` prop maps comark components such as `::callout{tone="tip"}` to your own Vue components.

Heading sizes (200 % to 90 % of the body size), captions, margins, paddings and the list indent are `em` lengths, so they follow the font size the rich text inherits, and a heading keeps with the first lines of what follows (`keepWithNext`). `styles` changes single elements, `bookmarks` writes headings as outline entries, and tagged documents get `H1` to `H6`, `P`, `L`, `BlockQuote`, `Link`, `Figure` and `Table`. Images (`img`, `figure` with `figcaption`, Markdown images) load by the rules of `PdfImage`; a refused image fails the render, or with `brokenImages="placeholder"` prints its alt text in a box and adds an entry to `diagnostics.imageWarnings`. Tables keep the header row, `colspan`, `rowspan` and the cell alignment.

`result.diagnostics.richTextWarnings` lists the links, attributes, tags, values, components and props of `html` and `comark` input that `PdfRichText` dropped or changed, one entry per code and name with a count; the render still succeeds. In development each entry also has a snippet of the markup and the source position of the `PdfRichText`; production diagnostics stay content-free. New types: `PdfRichTextWarning` and `PdfRichTextWarningCode`.

Input over a limit or a wrong model fails with the new code `PDF_RICH_TEXT_INVALID` and `error.issues`; Markdown is limited to 250,000 characters and to the new option `pdf.limits.markdownTimeoutMs` (default 5,000 ms), which fails with `PDF_LIMIT_EXCEEDED`. `comark` (`^0.8.1 || ^0.9.2`) is a new optional peer dependency; install it only for Markdown. Without it, `nuxt dev` and `nuxt build` print no warning about it.
