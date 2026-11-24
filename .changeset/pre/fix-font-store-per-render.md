---
"@lupinum/nuxt-pdf": patch
---

Fix missing letters when one server process renders several PDFs with the same embedded font

A letter that an earlier render only used inside a composite glyph, such as the O in Ö, disappeared from later renders ("Own" printed as "wn"). Each render now uses its own font store.
