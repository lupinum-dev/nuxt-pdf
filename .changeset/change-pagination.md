---
'@lupinum/nuxt-pdf': minor
---

Change how documents break into pages: each page holds the content that its measured height fits, and a layout that pagination cannot print right fails with a typed error

A page that would print wrong fails with `PDF_RENDER_ERROR`. Such an error is a bug in Nuxt PDF; please report it with the template. A view, text or column container with a `height` or `maxHeight` moves whole to the next page when it crosses the page end and fits the content area; a higher one splits, and with `maxHeight` its parts keep its height in total. An absolute node takes no room and prints with the first part of its parent, or with the last part when `bottom` alone places it; in a row that breaks, the same holds for the row's parts. An absolute node without `top` and `bottom` under `justifyContent` `center`, `space-around` or `space-evenly` prints centered in the first part of its parent. A relative `top` or `bottom` moves the node in every part, not the content around it. `flexGrow` outside a row and `justifyContent` on a column or page share the room that each page leaves. A row cell with `alignSelf` or `alignItems` other than `stretch` breaks where its place in the whole row puts its lines, and each part of the row aligns it again. A `wrap={false}` page beside pages that split stays one page, with its own page number and the total. `fixed={false}` works as its default: such a node follows `break` and `wrap={false}` like any other.

A node's own bottom margin never moves it to the next page: a block that fits on the page or in a column stays there and loses its bottom margin at the break, as in CSS, instead of moving and leaving the space empty. With `minPresenceAhead` the margin still counts. A view whose first page would hold only its `fixed` children, such as a repeated header alone at the page bottom, starts on the next page.

These layouts now fail instead of printing wrong:

- A `PdfPage` with `flexWrap` lost lines when its content passed the page end, and a wrapping view with a height higher than a page wrapped its children into other lines on each page. Both fail with a typed error. A column without a height keeps one flex line, so `flexWrap` changes nothing in how it breaks.
- A row with `flexWrap` breaks between its flex lines, and a line that crosses the page end splits as a row; the rest of a split line starts at the page top without the row gap, and an absolute child without insets keeps its place in the whole row. A `fixed` item in such a row fails with `PDF_LAYOUT_ERROR` when the row breaks.
- A `fixed` node between flow content, on a page or in a view, fails with `PDF_LAYOUT_ERROR`, also in a one-page document. On a page that ended before such a node, the content of that page was squeezed to make room for it, and its lines overlapped. A fixed cell of a row, and a fixed node inside a `fixed` or `wrap={false}` view, keep working.
- A `break` that cannot start a page fails with `PDF_TREE_INVALID`: inside a row (`flexDirection` `row` or `row-reverse`), inside a table row or cell, inside a `fixed` node or inside a node with `wrap={false}`, where it was ignored without a message. The message names the element, the ancestor that prevents the break and what to do. A `break` on the row, the table row or the `wrap={false}` node itself still works, and a `break` inside a view that fits on the page now starts a new page; before, it was ignored.

Migration: remove `flexWrap` from a `PdfPage`, and give a wrapping view a height that fits on a page, or none. For text in columns, use a `PdfView` with `columnCount`; for a grid, use a `PdfView` with `flexDirection: 'row'` and `flexWrap`.

Migration: put a `fixed` item of a wrapping row before the row, in a `PdfView` that holds both.

Migration: move a fixed node before the flow for a header, or after it for a footer.

Migration: move each `break` that cannot start a page to the row or `PdfTableRow` that holds the node, remove `wrap={false}` from the ancestor, or remove the `break`.

Migration: a view whose first page would hold only its `fixed` children starts on the next page. Check page breaks of views with `fixed` children.
