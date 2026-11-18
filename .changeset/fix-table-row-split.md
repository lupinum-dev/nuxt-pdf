---
'@lupinum/nuxt-pdf': patch
---

Fix table rows that split across pages: every cell keeps its column on both pages, a cell whose lines fit stays on its page, and a header no longer ends a page alone above a moved row

A row with a `fixed` node in it no longer runs until `timeoutMs` once the rest of the row has ended; the fixed node repeats beside the row's content on each of its pages.
