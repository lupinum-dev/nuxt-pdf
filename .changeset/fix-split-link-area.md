---
'@lupinum/nuxt-pdf': patch
---

Fix an empty, zero-height link area on the next page when a block PdfLink ends just above a page end

The same applies to any view without a height or min height: when its content ends on a page and only its bottom padding, border or margin crosses the page end, the next page no longer gets an empty part of it (or only its fixed children, such as a table header).
