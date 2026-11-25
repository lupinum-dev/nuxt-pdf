---
'@lupinum/nuxt-pdf': minor
---

Add the style keys `alignContent`, `alignSelf`, `rowGap`, `objectPosition` and `verticalAlign`, percentage font sizes and `em` lengths

- `alignContent` (`align-content`) places the lines of a wrapping container on its cross axis. `alignSelf` (`align-self`) aligns one node on its parent's cross axis. `rowGap` (`row-gap`) sets the space between the children of a column or the lines of a wrapping row; it must be 0 or more. `objectPosition` (`object-position`) places a `PdfImage` in the free space that `objectFit` leaves, as in CSS; offsets from an edge, such as `right 10pt bottom 4pt`, are not supported. All four failed with `PDF_TREE_INVALID` before.
- `verticalAlign: 'super'` and `'sub'` on a text or link inside a text raise it by a third or lower it by a fifth of the parent's font size. In rich text, `<sup>` and `<sub>` (also raw HTML in Markdown) print raised and lowered at 70 % of the text size, the `sup` and `sub` keys of `styles` change their style, and a rich text model sets the same with `verticalAlign` on a `PdfRichTextRun`.
- `fontSize: '70%'`, and `font-size: 70%` in a `<style>` block, set a share of the inherited font size, as in CSS; children inherit the points. A percentage on `PdfPage` or on SVG text fails with `PDF_TREE_INVALID`.
- `width`, the margins, the paddings, `gap`, `rowGap` and `columnGap` take an `em` length such as `'1.5em'`, a share of the node's own font size; the `<style>` block takes it on the same keys, other keys still reject `em`.
- The `PdfStyle` type now also accepts `position: 'static'`, two `gap` values and the transforms `scaleX()`, `scaleY()`, `translateX()`, `translateY()`, `skew()`, `skewX()` and `skewY()`, which a style object took at render time already.
