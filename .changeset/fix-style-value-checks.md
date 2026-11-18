---
'@lupinum/nuxt-pdf': patch
---

Fix unchecked `v-bind()` and `:style` values: the render now rejects a value that the engine cannot read correctly

A value that rendered wrong before, such as `fontSize: '1.2em'` (the text disappeared), a border color with alpha or one that the engine paints black (`'transparent'`, `'RED'`), or `false` (an internal layout error), now fails with `PDF_TREE_INVALID`; the message names the `v-bind()` expression or the `:style` key, the value and the expected form. A value that the engine reads correctly still passes, also when the `<style>` block grammar rejects it, such as `margin: '4pt 8pt'`, `width: 'auto'`, `translateX(10px)`, `flex: '1 1 auto'` or `backgroundColor: 'transparent'`.
