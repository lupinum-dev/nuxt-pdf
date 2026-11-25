---
'@lupinum/nuxt-pdf': patch
---

Fix a row that left a cell alone at a page or column end: the row now moves whole when one of its cells moves after the break by its own rules, such as a text whose orphans or widows do not fit
