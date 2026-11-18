---
'@lupinum/nuxt-pdf': minor
---

Add `PdfTable` components with repeated headers and `pages` on fixed content

`PdfTable`, `PdfTableHeader`, `PdfTableRow` and `PdfTableCell` build a table whose header repeats on every page of the table; a row does not split. A column is a share (a number) or a width with a unit or a percentage (`'80pt'`, `'30%'`). A local component can render several cells, each in its own column; a cell can hold page tokens with text. A row or cell directly inside a cell fails (put a `PdfTable` in the cell), and errors name the table component. Tables have no `rowspan` or automatic borders. `pages` (`'all'`, `'first'` or `'continuation'`) on a `fixed` `PdfView` or `PdfText` limits the pages of its parent `PdfPage` or view where it appears. New exported types: `PdfTableProps`, `PdfTableHeaderProps`, `PdfTableRowProps`, `PdfTableCellProps`, `PdfTableColumn` and `PdfFixedPages`.
