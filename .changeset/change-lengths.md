---
'@lupinum/nuxt-pdf': minor
---

Change `px` lengths to convert exactly at the page `dpi`, and percentage heights to resolve against the parent's height, and fix lengths and sizes that were read wrongly

On a 96 dpi page, `'1px'` is 0.75 pt instead of 1 pt, and a `'0.5px'` border at 72 dpi is 0.5 pt instead of 1 pt, so hairlines no longer vanish or double; this applies in styles and in the page size. A page with a `dpi` other than 72 no longer shows larger or smaller than its size: the page writes no `UserUnit`, so `dpi` changes only `px` lengths, and `translateX(96px)` on a page with `dpi: 96` moves 72 points, as far as `width: '96px'` is wide.

A percentage `height`, `minHeight` or `maxHeight` resolves against its parent's height inside its paddings and borders before layout, so every part of a node that breaks across pages keeps the same height, and a page child's `maxHeight` now limits it. A percentage in a parent without a height fails with `PDF_TREE_INVALID`; before, it took the height of an ancestor further up.

Fixes:

- Lengths and page sizes written as `.5%`, `'+0'`, `'0e1'`, `1e2pt` or `100PT` are read as written. Before, `.5%` was read as `5%`, `'+0'` and `'0e1'` failed with `unsupported number: NaN`, and such page sizes failed the layout.
- `flexShrink: 0` and `flex: 'none'` keep a box at its size; before, the box shrank as with `flexShrink: 1`.
- An absolutely positioned `<PdfText>`, `<PdfImage>` or `<PdfSvg>` without a width gets its size, and an image without a width keeps its aspect ratio, also in a row with only a height. A node without a width inside a row gets the same size as in a column, instead of no size or a failed render.

Migration: where a length must stay a whole number of points, write it in points.

Migration: give the parent of a node with a percentage height a `height` in points, or give the node its height in points.
