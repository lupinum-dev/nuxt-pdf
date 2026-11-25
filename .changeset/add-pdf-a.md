---
'@lupinum/nuxt-pdf': minor
---

Add PDF/A-3b output with `conformance` on `PdfDocument`

`conformance="PDF/A-3b"` writes PDF 1.7 with XMP metadata, an sRGB output intent and a MIME type on every embedded file; veraPDF validates the output. Every text must use a registered font: a text in a standard PDF font fails with `PDF_TREE_INVALID` and its source position. A `PdfNote` and a `pdfVersion` other than `1.7` fail too. New exported type: `PdfConformance`.
