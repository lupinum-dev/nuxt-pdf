---
'@lupinum/nuxt-pdf': minor
---

Add PDF/A-3b output with `conformance` and the `PdfFacturX` component for Factur-X invoices

`conformance="PDF/A-3b"` on `PdfDocument` writes PDF 1.7 with XMP metadata, an sRGB output intent and a MIME type on every embedded file; veraPDF validates the output. Every text must use a registered font: a text in a standard PDF font fails with `PDF_TREE_INVALID` and its source position. A `PdfNote` and a `pdfVersion` other than `1.7` fail too.

`PdfFacturX` (props `xml`, `profile`, `relationship`) embeds the CII XML of a Factur-X or ZUGFeRD hybrid invoice as `factur-x.xml` (`xrechnung.xml` for `XRECHNUNG`) and makes the document PDF/A-3b. The application writes the XML; Nuxt PDF checks only that it names the given profile. Its bytes count against `pdf.limits.maxTotalAttachmentBytes`. New exported types: `PdfConformance`, `PdfFacturXProps`, `PdfFacturXProfile` and `PdfFacturXRelationship`.
