---
'@lupinum/nuxt-pdf': minor
---

Add template source positions to errors, layout warnings and the development preview, keep `nuxt dev` running when a template fails to compile, and fix build error positions

In development, PDF tree errors and layout warnings carry `source` (`PdfSourcePosition`: file, line and column). The preview opens that position in the editor, shows the reason of a tree error and has a Layout boxes toggle. A template or a component under `pdfs/` that fails to compile no longer stops `nuxt dev`: the preview marks the template with "Compile error" and shows the message and source position, a render of it fails with `PDF_TEMPLATE_INVALID` and `source`, and saving the fixed file renders it again. A production build still fails on the error. Adding or removing a `.vue` file under `pdfs/` rebuilds the registry without restarting Nuxt; fonts and images still restart it. Production output contains no source positions. The types `PdfSourcePosition` and `PdfLayoutWarning` are exported from `#pdf`, `@lupinum/nuxt-pdf` and `@lupinum/nuxt-pdf/server`.

Build and preview fixes:

- Template compile errors give the file line and the right column, and SFC parse errors the right column. An unknown `<Pdf…>` tag fails the build with its position and the nearest known name.
- A syntax error in an imported helper `.ts`, or a helper that imports a missing module, fails only the templates that import it in development, at the helper's position. A missing import fails `nuxt build` and the standalone build at the import in the `.vue` file, with a code frame.
- A `defineOptions()` call that is not a standalone top-level statement in `<script setup>`, such as `void defineOptions({ name: 'Invoice' })`, fails the build with its position. Before, the render failed with `PDF_RENDER_ERROR` "defineOptions is not defined".
- A tag with an uppercase letter after a hyphen, such as `<pdf-View>`, gets the same checks and source positions as `<PdfView>`.
- A folder whose name starts with two dots, such as `..shared`, is inside the project: its helper modules are checked at build time and watched in `nuxt dev`.
- The `/_pdf` preview shows Vue's message for an unresolved component, says when the template threw while rendering, and logs render failures once in the terminal. A template without props previews without `sampleData`, the index says "no props", "sample data" or "no preview data" for each template, and the preview of a template whose key contains `/_pdf` works.
