---
'@lupinum/nuxt-pdf': minor
---

Add e-invoices from invoice data: `PdfFacturX` with `invoice`, and `computeEInvoice`, `validateEInvoice` and `renderEInvoiceXml`

`<PdfFacturX :invoice="invoice" profile="EN 16931" />` writes the EN 16931 CII XML of a Factur-X (ZUGFeRD) invoice during the render, for the profiles `MINIMUM`, `BASIC WL`, `BASIC`, `EN 16931` and `XRECHNUNG`. `computeEInvoice` returns the totals the XML holds, for the template to print. `validateEInvoice` lists every broken EN 16931 or XRechnung rule with its field path, and `renderEInvoiceXml` writes an XRechnung or Factur-X XML on the server. Invalid invoice data fails with the new code `PDF_INVOICE_INVALID` and `error.issues`. The functions are available in templates without an import, from `#pdf` and from `@lupinum/nuxt-pdf/server`; the types from `@lupinum/nuxt-pdf`. `PdfFacturX` with `xml` works as before.
