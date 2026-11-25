---
'@lupinum/nuxt-pdf': minor
---

Add e-invoices: `PdfFacturX` embeds the XML of a Factur-X or ZUGFeRD invoice, from your XML or from invoice data

`PdfFacturX` (props `xml`, `profile`, `relationship`) embeds the CII XML of a Factur-X or ZUGFeRD hybrid invoice as `factur-x.xml` (`xrechnung.xml` for `XRECHNUNG`). Its `PdfDocument` must claim `conformance="PDF/A-3b"` or `"PDF/A-3a"`; without a PDF/A-3 level, the render fails with `PDF_TREE_INVALID`. With `xml`, the application writes the XML, and Nuxt PDF checks only that it names the given profile. Its bytes count against `pdf.limits.maxTotalAttachmentBytes`.

`<PdfFacturX :invoice="invoice" profile="EN 16931" />` writes the EN 16931 CII XML from invoice data during the render, for the profiles `MINIMUM`, `BASIC WL`, `BASIC`, `EN 16931` and `XRECHNUNG`. `computeEInvoice` returns the totals the XML holds, for the template to print. `validateEInvoice` lists every broken EN 16931 or XRechnung rule with its field path, and `renderEInvoiceXml` writes an XRechnung or Factur-X XML on the server. Invalid invoice data fails with the new code `PDF_INVOICE_INVALID` and `error.issues`. The functions are available in templates without an import, from `#pdf` and from `@lupinum/nuxt-pdf/server`; the types from `@lupinum/nuxt-pdf`, with the new exported types `PdfFacturXProps`, `PdfFacturXProfile` and `PdfFacturXRelationship`.
