---
'@lupinum/nuxt-pdf': patch
---

Fix page breaks that lost text, did not end or painted a page number twice

Text is no longer lost when a box with top padding inside another box lands at the end of a page. A forced `break` inside a box on a page with `fixed` content no longer makes pagination run until `timeoutMs`. A text with a page number that starts at the end of a page is no longer painted on two pages. A `break` on the first element of a page no longer adds an empty page before it. A page with a page number no longer squeezes the text on it, so a last line no longer runs into the bottom padding of the page. `PdfPageRef` no longer prints the page before its target when the target starts at the top of a page, and no longer gets a hyphen between the text before it and the number. Nuxt PDF now ships its own corrected copy of the React PDF layout step; its runtime dependencies are installed directly.
