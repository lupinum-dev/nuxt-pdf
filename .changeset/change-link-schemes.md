---
'@lupinum/nuxt-pdf': minor
---

Change `PdfLink` to accept only `#id` and absolute `http:`, `https:`, `mailto:` and `tel:` URLs as `href`, and fix link areas, link destinations and bookmarks

Any other `href` fails with `PDF_TREE_INVALID` and the message names it. Link targets often come from data, so a PDF no longer carries a `javascript:`, `file:` or `data:` URI from a template. A `PdfLink` whose target id is missing names the element, the `href` value and the id to add.

Fixes:

- The link area of an inline link covers the link's glyphs, from their ascent to their descent. Before, in a text whose line height is larger than the font's, it reached up into the line above, where a click could open the wrong link.
- A link inside Arabic or Hebrew text draws its own glyphs, not those of other characters, and its link area covers them.
- A block `PdfLink` that ends just above a page end no longer adds an empty, zero-height link area on the next page.
- A `bookmark` or an `id` on an element inside another element points at the element on the page, not above and left of it, and a link to the `id` of a nested `PdfText` has a destination, at the line where the nested text starts.
- A node that splits across pages has one outline entry, on the page where it starts, and a bookmark on a container whose first content moves to the next page points to the page where that content starts.

Migration: replace a relative `href` with an absolute URL, and remove links with other schemes or print them as text.
