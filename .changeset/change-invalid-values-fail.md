---
'@lupinum/nuxt-pdf': minor
---

Change invalid values and content that rendered wrongly or silently into `PDF_TREE_INVALID` errors, and name the element in every tree validation message

These values now fail: a negative `width`, `height`, minimum or maximum size, `flexBasis`, `flexGrow`, `flexShrink`, `gap`, padding, border width or radius, `fontSize` or `lineHeight`; a `fontSize` or `lineHeight` of 0 (it printed 12 pt and gave the normal line height; leave a text out with `v-if` to hide it); an `opacity` outside 0 to 1; a percentage `gap`; a `fontWeight` name such as `constructor`; a `bookmark` that is not a title or `{ title, expanded }`; a `title`, `author`, `subject`, `keywords`, `creator`, `producer` or `language` that is not a string; a `pdfVersion`, `pageLayout`, page `orientation`, SVG `strokeLinecap` or `strokeLinejoin` outside its listed values; `widows`, `orphans` or `maxLines` that are not positive whole numbers; a negative number in the `flex` shorthand; a `PdfLink` `hitSlop` that is not an object of `top`, `right`, `bottom` or `left` set to numbers of 0 or more; an SVG `fill`, `stroke` or `stopColor`, or the `fill` of SVG text, that is not a color (`none` also passes for a shape's `fill` and `stroke`); an SVG `d` or `points` that is not a string; an SVG `transform` operation not written in lower case, such as `Translate(10)`; and a `:style` value that the engine cannot read correctly, such as `fontSize: '1.2em'` (the text disappeared) or `'currentColor'` (painted black). Margins, insets, `letterSpacing` and transforms may still be negative.

These templates now fail too:

- Text or an element inside `PdfImage`, an SVG shape (`PdfPath`, `PdfRect`, `PdfCircle`, `PdfEllipse`, `PdfLine`, `PdfPolyline`, `PdfPolygon`) or `PdfStop`, such as `<PdfImage> cannot contain text.`, with the source position in development. Before, the content was dropped without a message. Whitespace and comments are not content.
- `textTransform: 'upperfirst'`. It is not CSS, and the type did not include it. The message names `capitalize` and the difference.
- `title` or `language` set both in `definePdf` and on `PdfDocument`; the message names both places. Before, the `definePdf` value silently replaced the `PdfDocument` prop. Now `resolveMetadata(props)` and `result.metadata` give the same value whenever `definePdf` sets it.
- An unknown primitive from a render function, such as `h('FOO')`, fails with `PDF_TREE_INVALID` instead of `PDF_RENDER_ERROR`; the message stays `Unknown PDF primitive "FOO".`

Messages now name the element and its `id`, such as `<PdfText id="intro">`, the prop or style key and the wrong value (cut at 40 characters, never a password or node text). A duplicate `id` names both elements and the id. A wrong `PdfPage` size given as width and height names the wrong part, such as `Got width -1.` or `Got height "0pt".`, and a page-flow prop on SVG text names the prop: `SVG <PdfText> does not accept the page-flow text prop "fixed".`

Migration: correct each value the new error names. Where a negative size or padding moved an element, use 0 and a negative margin instead.

Migration: remove the content from the leaf primitive, or put it next to the element.

Migration: use `textTransform: 'capitalize'` to raise the first letter of every word, or write the first letter of the text in upper case.

Migration: remove `title` or `language` from `PdfDocument` when `definePdf` sets it, or from `definePdf` when only the template has the data.
