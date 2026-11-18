---
'@lupinum/nuxt-pdf': minor
---

Add template source positions to errors, layout warnings and the development preview

In development, PDF tree errors and layout warnings carry `source` (`PdfSourcePosition`: file, line and column). The preview opens that position in the editor, shows the reason of a tree error and has a Layout boxes toggle. Production output contains no source positions. The types `PdfSourcePosition` and `PdfLayoutWarning` are exported from `#pdf`, `@lupinum/nuxt-pdf` and `@lupinum/nuxt-pdf/server`.

Fix the preview of a template whose key contains `/_pdf`.
