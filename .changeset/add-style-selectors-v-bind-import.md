---
'@lupinum/nuxt-pdf': minor
---

Add compound and descendant selectors, `v-bind()` and `@import` to `<style>` blocks in PDF templates

`.row.total` matches an element with both classes; `.total .cell` matches a `.cell` inside a `.total` element of the same template (a descendant step does not reach into another component). A rule with more classes wins, then the order of the block, and `style` still wins over every class. Type, child, sibling, pseudo, attribute, id, universal and nesting selectors fail the build with a message that names what works.

`v-bind()` reads a script binding, an import or a prop as a whole value, such as `--ink: v-bind('theme.ink')` in `:root`. A bound `null` or `undefined` leaves the key out. A part that mixes text and `v-bind()`, `v-bind()` in an imported file, and a `v-for` alias or slot prop that hides the bound name fail the build.

`@import './theme.css'` reads the variables and rules of a local `.css` file, relative to the importing file or through a Nuxt alias such as `~~/pdfs/theme.css`. The file must lie inside the project; `nuxt dev` watches it. A standalone build accepts relative paths only, bounded by `rootDir`.

A declaration value on a later line than its property now reports the position of the value.
