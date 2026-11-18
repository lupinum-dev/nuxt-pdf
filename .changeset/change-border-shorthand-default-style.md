---
'@lupinum/nuxt-pdf': minor
---

Change `border` shorthands in `<style>` blocks to accept a width and a color without a style

`border: 1pt #CCCCCC` compiles to a solid border, the style the PDF engine paints; it was a build error. Unlike in a browser, this border is painted. The shorthand writes the style, so it replaces a style that an earlier rule set. A border color with alpha still fails the build; the message now says that the engine paints it in a wrong color and points to `opacity`.

Migration: no template that built before changes. A shorthand without a style now paints a solid line instead of failing the build; write the style, such as `border: 1pt dashed #CCCCCC`, when you want another one.
