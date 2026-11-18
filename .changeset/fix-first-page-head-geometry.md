---
'@lupinum/nuxt-pdf': minor
---

Fix the later pages of a parent with an in-flow `pages="first"` node, which left one node height empty at the bottom

The later pages are now laid out without the node, so they hold as much content as a page without it. Such a document takes one more layout pass (`diagnostics.passes`), and its page breaks and page count can change. `pages="continuation"` still leaves up to one node height free on the parent's first page; for a running head, place the node absolutely in the page padding, where it takes no flow space.

Also report `PDF_UNBREAKABLE_NODE_OVERFLOW` in `diagnostics.layoutWarnings` for a block that cannot wrap and that the engine shrank to fit the page, with the height the block needs. The PDF does not change.
