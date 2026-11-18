---
'@lupinum/nuxt-pdf': minor
---

Add `colspan` to `PdfTableCell`

A cell with `:colspan="2"` is as wide as the columns it covers: their shares and fixed widths add up, and `pt`, `in`, `mm` and `cm` convert to points. It works in `PdfTableHeader` too. A row now counts the columns its cells cover, so the error for a row that is too wide reads `<PdfTableRow> needs 4 columns (counting colspan), but its <PdfTable> declares 3.` A `colspan` that is not a whole number from 1, and a span over lengths in units that cannot be added (`px`, `rem`, `vw`, `vh` with another unit), fail with `PDF_TREE_INVALID`. `rowspan` is not supported.
