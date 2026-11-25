---
'@lupinum/nuxt-pdf': patch
---

Fix a word joiner (U+2060) in a font without a glyph for it: it now keeps the text around it on one line

Before, it was removed, so a page range like `201–⁠216` could still break after the en dash. It still takes no room and paints nothing.
