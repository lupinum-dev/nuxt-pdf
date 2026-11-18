---
'@lupinum/nuxt-pdf': minor
---

Change `typescript` and `vue-tsc` to optional peer dependencies and drop unused production dependencies.

`@react-pdf/primitives` is no longer installed with the module, and `h3` now uses a caret range so it shares Nuxt's copy.

Migration: projects that call `buildPdfRegistry()` from `@lupinum/nuxt-pdf/build` must install `typescript` and `vue-tsc` (`pnpm add -D typescript vue-tsc`); without them the build stops with an error that names the missing package. Nuxt projects that only use the module need nothing new.
