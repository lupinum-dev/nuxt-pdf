---
'@lupinum/nuxt-pdf': patch
---

Fix compile error positions and messages, and keep `nuxt dev` up when a helper module that a template imports fails

Template compile errors now give the file line and the right column, and SFC parse errors the right column. A syntax error in an imported helper `.ts`, or a helper that imports a missing module, fails only the templates that import it in development, at the helper's position. A missing import fails `nuxt build` and the standalone build at the import in the `.vue` file, with a code frame. An unknown `<Pdf…>` tag fails the build with its position and the nearest known name. The `/_pdf` preview shows Vue's message for an unresolved component, says when the template threw while rendering, and logs render failures once in the terminal.
