---
'@lupinum/nuxt-pdf': minor
---

Add `PdfContents`, a table of contents from the bookmarks of the document, and `PdfLeader`

Each entry is one text: the title of a bookmark, a leader and the page number at the right edge, linked to its node. `levels` sets how many outline levels it lists (default 3), `leader="none"` removes the leader, and `styles` (`page`, `title`, `leader`) changes the parts of the entries. `contents: false` in a bookmark keeps a node out of the contents. `<PdfLeader />` goes inside a `PdfText` between two parts of a line and draws a dotted, dashed or solid line on the baseline; the text after it ends at the right edge, and no line breaks at it.
