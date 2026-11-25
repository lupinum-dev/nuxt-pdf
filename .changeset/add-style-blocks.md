---
'@lupinum/nuxt-pdf': minor
---

Add `<style>` blocks to PDF templates, with classes, file-local variables, `v-bind()` and `@import`

Plain `<style>` blocks compile at build time to `PdfStyle` objects. `class` and `:class` work on primitives and local components; `style` wins over classes. Variables are declared in `:root { --name: value }` and read with `var(--name)`. `.row.total` matches an element with both classes; `.total .cell` matches a `.cell` inside a `.total` element of the same template; a rule with more classes wins, then the order of the block. `v-bind()` reads a script binding, an import or a prop as a whole value. `@import './theme.css'` reads the variables and rules of a local `.css` file, relative to the importing file or through a Nuxt alias; the file must lie inside the project, and `nuxt dev` watches it. A `border` shorthand takes a width and a color without a style and paints it solid, unlike in a browser; `gap` takes one or two lengths. Lengths take the units of style objects; colors are hex, names and the `rgb()`, `hsl()` and `hwb()` forms. An unsupported selector, property, unit or color, and a `class` on `<template>` or `<slot>`, fail the build with file, line and column. `postcss` is a new direct dependency.
