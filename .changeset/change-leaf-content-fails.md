---
'@lupinum/nuxt-pdf': minor
---

Change leaf primitives to fail on content instead of dropping it

Text or an element inside `PdfImage`, an SVG shape (`PdfPath`, `PdfRect`, `PdfCircle`, `PdfEllipse`, `PdfLine`, `PdfPolyline`, `PdfPolygon`), `PdfStop` or a page token (`PdfPageNumber`, `PdfPageCount`, `PdfPageRef`) now fails with `PDF_TREE_INVALID`, such as `<PdfImage> cannot contain text.`, with the source position in development. Before, the content was dropped without a message. Whitespace and comments are not content.

Migration: remove the content from the leaf primitive, or put it next to the element.
