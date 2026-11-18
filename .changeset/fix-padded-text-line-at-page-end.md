---
'@lupinum/nuxt-pdf': patch
---

Fix the last line of a text with a top padding or border, such as a table cell, at the end of a page: it could end below the page edge and was lost; it now moves to the next page
