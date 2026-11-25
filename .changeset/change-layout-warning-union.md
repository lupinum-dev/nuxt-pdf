---
'@lupinum/nuxt-pdf': minor
---

Change `PdfLayoutWarning` into a union told apart by `code`, and add the layout warnings of this release

`diagnostics.layoutWarnings` can hold `PDF_UNBREAKABLE_NODE_OVERFLOW` (unchanged), `PDF_TABLE_COLUMNS_TOO_NARROW`, `PDF_CONTENT_HIDDEN`, `PDF_FOOTNOTES_MOVED`, `PDF_GLYPH_MISSING`, `PDF_HYPHENATION_UNAVAILABLE` and `PDF_KEEP_IGNORED`; the render result docs list the fields of each.

`PDF_CONTENT_HIDDEN` reports content that is cut off and not drawn: each text that keeps only the lines that fit its own `height` or `maxHeight`, or that of a view around it, with the number of lines not drawn, and each absolute node that reaches below the page end, with its lines and boxes there. A block that cannot split and is cut at the page end keeps only `PDF_UNBREAKABLE_NODE_OVERFLOW`, which now also reports such a block when the page shrank it to fit, with the height it needs.

Migration: check `warning.code` before reading the fields; `nodeHeight` and `availableHeight` are only on `PDF_UNBREAKABLE_NODE_OVERFLOW`.
