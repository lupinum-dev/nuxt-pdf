---
'@lupinum/nuxt-pdf': patch
---

Fix the outline order of bookmarks that paint out of source order: the outline now lists siblings in source order

Before, an absolute child placed by `bottom` in a view that breaks across pages printed on the view's last page and came after the bookmarks of the pages before it.
