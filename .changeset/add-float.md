---
'@lupinum/nuxt-pdf': minor
---

Add the style key `float`: `'top'` or `'bottom'` moves a `PdfView`, `PdfImage`, `PdfSvg` or `PdfTable` to the top or the bottom of its page or column, or across all columns

A float leaves the flow at its place in the source and goes to the edge of the first page or column that reaches that place and has room for it and its notes. Floats of one side keep their source order, a float that does not fit waits for the next area, and the flow fills the room around it. A float sits in the page flow, in a column, or inside plain views (column direction, no fixed height, not a row, a link or a table). With `columnSpan: 'all'` in a column container, a float spans all columns at the top or the bottom of the container's part on the page, and the columns run on around it. In `PdfRichText`, `float` in `styles.image` floats every image and figure. A float in a view that is not plain, inside another float, in a rich text list item, or with `break`, `keepWithNext` or `minPresenceAhead` fails at mount with `PDF_TREE_INVALID`. A float higher than its page, column or sized container fails with `PDF_LAYOUT_ERROR`. A document without floats lays out as before.
