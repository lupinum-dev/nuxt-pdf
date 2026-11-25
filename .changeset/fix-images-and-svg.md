---
'@lupinum/nuxt-pdf': patch
---

Fix images and SVGs that drew over their border, in the wrong place or not at all

- An image or SVG is drawn inside its border and padding; before, an SVG's view box was scaled to the whole box and ran past its right and bottom edges. A `PdfText` with a border width starts its lines inside the border.
- An image that the PDF cannot show fails with `PDF_ASSET_INVALID` instead of drawing nothing or a broken image: bytes that do not decode as an image or decode without a size, a palette PNG without a palette, a JPEG with two frame headers, a JPEG with a component count other than 1, 3 or 4, and a `PdfImage` whose source was not admitted.
- An image higher than the page with a margin of `'auto'` or `'0%'` is scaled to the page instead of drawn 0 pt high.
- A repeated remote image URL counts once toward `maxTotalImageBytes` and `maxTotalImagePixels`. An image with request options is refused also when the same URL appears in another image.
- SVG clip paths clip shapes with string coordinates (`x="10"`), which clipped nothing, and resolve lengths such as `width="50%"`, which failed the render, like the lengths of drawn shapes.
- A radial SVG gradient with a focal point (`fx`, `fy`) starts at the focus, and a gradient fill no longer writes a fill operator without a path.
- An SVG `viewBox` with spaces around its numbers is no longer ignored.
- The `PdfObjectFit` type has `fill`, `none` and `scale-down` next to `contain` and `cover`, the values the runtime already accepted.
