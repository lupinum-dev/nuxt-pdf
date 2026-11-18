---
'@lupinum/nuxt-pdf': minor
---

Add `<style>` blocks with class selectors and file-local variables to PDF templates

Plain `<style>` blocks compile at build time to `PdfStyle` objects. `class` and `:class` work on primitives and local components; `style` wins over classes. Variables are declared in `:root { --name: value }` and read with `var(--name)`. Lengths take the units of style objects (`pt`, `px`, `in`, `mm`, `cm`, `rem`, `vh`, `vw`, `%`); colors are hex (`#rgb` to `#rrggbbaa`), names and the `rgb()`/`hsl()` forms the engine reads, and a border color must be opaque. An unsupported selector, property, unit or color, and a `class` on `<template>` or `<slot>`, fail the build with file, line and column. A class on a local component with several root elements fails the render. `postcss` is a new direct dependency (`@vue/compiler-sfc` already installs it).
