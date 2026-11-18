---
'@lupinum/nuxt-pdf': minor
---

Add compile errors in the development preview, and pick up added or removed templates without a restart

In `nuxt dev`, a template or a component under `pdfs/` that fails to compile no longer stops the server. The preview marks the template with "Compile error" and shows the message and the source position; a render of it fails with `PDF_TEMPLATE_INVALID` and `source`. Save the fixed file and the preview renders it again. A production build still fails on the error. Adding or removing a `.vue` file under `pdfs/` rebuilds the registry without restarting Nuxt; fonts and images still restart it.

Fix `buildPdfRegistry`, which bounded a style `@import` by the working directory instead of `rootDir`.
