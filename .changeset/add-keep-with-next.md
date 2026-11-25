---
'@lupinum/nuxt-pdf': minor
---

Add `keepWithNext` and the layout warning `PDF_KEEP_IGNORED`, and fix two cases of `minPresenceAhead`

`keepWithNext` starts a node on the page where the next node in its container starts. Put `keep-with-next` on a heading to keep it with the first lines of its paragraph or the first row of its table, or on a `PdfTableRow` to keep it with the next row. Keeps chain, nodes that show nothing (such as an anchor view) are skipped, a keep on the last node of a view keeps that node with the node after the view (the last row of a table moves with the totals, the rest of the table stays), a keep before a node with `break` has no effect, and a keep higher than the page has no effect. On a `PdfPage`, a `fixed` node, a text inside another text, inside a row, inside a `column-reverse` container or inside a table cell it fails with `PDF_TREE_INVALID`.

`PDF_KEEP_IGNORED` reports a `keepWithNext` chain or a `minPresenceAhead` that cannot hold: the nodes that keep together are higher than the page's content area, or the node starts a page, where a move gains nothing. Pagination drops such a keep and breaks the nodes as without it. The warning comes once per chain, on the first page where the keep is dropped, and names the first node of the chain.

`minPresenceAhead` no longer counts content after a node with `break`, which starts a new page anyway, so a node before it no longer moves to the next page for it. It now also works on a node whose bottom margin is `auto`: a margin or padding that the layout computes as 0 (`auto`, `0%`) is 0 in the box.
