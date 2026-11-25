---
'@lupinum/nuxt-pdf': patch
---

Fix the page builder error for an empty view with padding or a border at the end of a page or column

A view with no content inside whose top padding and border do not fit the room left now moves whole to the next page or column. On a page with footnotes, the top edges of such a view at the page or column end now count as content of that page. Both cases failed before with "the layout of page N differs from the builder's sums".
