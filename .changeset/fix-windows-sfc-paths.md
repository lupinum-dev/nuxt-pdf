---
'@lupinum/nuxt-pdf': patch
---

Fix `loadPdfSfc` and `renderPdfSfc` from `@lupinum/nuxt-pdf/test` on Windows, which treated the absolute path of the template as a package import and loaded nothing

In development, a module on another Windows drive than the project no longer counts as a project module in the compile check of a template.
