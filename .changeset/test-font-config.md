---
'@lupinum/nuxt-pdf': patch
---

Fix `renderPdfSfc()` to use the fonts from the application's Nuxt configuration, including inherited layers, when the test passes no `fonts` option.
