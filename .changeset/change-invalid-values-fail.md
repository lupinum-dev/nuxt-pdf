---
'@lupinum/nuxt-pdf': minor
---

Change invalid values that rendered before into `PDF_TREE_INVALID` errors, and name the element in every tree validation message

These values now fail: a negative `width`, `height`, minimum or maximum size, `flexBasis`, `flexGrow`, `flexShrink`, `gap`, padding, border width or radius, `fontSize` or `lineHeight`, and an `opacity` outside 0 to 1, in a style object, a `v-bind()` value and the `<style>` block (build time); a `bookmark` that is not a title or `{ title, expanded }`; a `title`, `author`, `subject`, `keywords`, `creator`, `producer` or `language` that is not a string; a `pdfVersion`, `pageLayout`, page `orientation`, SVG `strokeLinecap` or `strokeLinejoin` outside its listed values; `widows` or `orphans` that are not positive whole numbers; and an SVG `d` or `points` that is not a string. Margins, insets, `letterSpacing` and transforms may still be negative.

Messages now name the element and its `id`, such as `<PdfText id="intro">`, the prop or style key and the wrong value (cut at 40 characters, never a password or node text). A duplicate `id` names both elements and the id.

Migration: correct each value the new error names. Where a negative size or padding moved an element, use 0 and a negative margin instead.
