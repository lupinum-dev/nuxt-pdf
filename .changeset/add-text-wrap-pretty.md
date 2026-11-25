---
'@lupinum/nuxt-pdf': minor
---

Add the style key `textWrap`: `'pretty'` avoids a very short last line and badly placed hyphens in a paragraph

It is inherited. The line breaker then prefers lines that keep the last word whole and give the last line more than one short word, at the cost of slightly looser lines. `'wrap'`, the default, breaks as before.
