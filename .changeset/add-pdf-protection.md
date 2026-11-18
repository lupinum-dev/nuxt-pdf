---
'@lupinum/nuxt-pdf': minor
---

Add password protection: `PdfDocument` `protection` encrypts the PDF with AES-256 (revision 6), with an open password, an owner password and reader permissions

`renderPdfTemplate`, `renderPdfSfc` and `parsePdf` take a `password` to open a protected PDF. Protection conflicts with PDF/A and `PdfFacturX` and fails with `PDF_TREE_INVALID`. A protected PDF gets new random keys on every render, so its bytes differ each time.
