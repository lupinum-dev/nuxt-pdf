---
'@lupinum/nuxt-pdf': patch
---

Fix renders that ran until the timeout when `fixed` content leaves no room on the page, and table spans that a right margin made too narrow

A `fixed` node, or several together, at least as high as the page content area now fails at once with `PDF_LAYOUT_ERROR`; the message names the node, its source position, its height and the room on the page. When fixed content leaves less room than an SVG, image or canvas that follows, or a `fixed` node in a row leaves none, the render still runs until `timeoutMs`, now also without a render worker, and the message names the in-flow fixed content as a possible cause. A `<PdfTableCell>` that spans percentage and length columns now rejects a right margin (`margin`, `marginHorizontal`, `marginRight`) with `PDF_TREE_INVALID` instead of rendering too narrow, and a static `colspan="2"` says to bind it as `:colspan="2"`.
