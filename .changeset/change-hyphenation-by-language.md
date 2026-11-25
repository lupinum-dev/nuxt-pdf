---
'@lupinum/nuxt-pdf': minor
---

Change hyphenation to the style key `hyphens` and the document `language`, remove `hyphenationCallback` and add the layout warning `PDF_HYPHENATION_UNAVAILABLE`

Words now split only at their soft hyphens (`&shy;`) by default. The inherited style key `hyphens: 'auto'` splits long words by the hyphenation patterns of the `language` of `PdfDocument` or `definePdf`: `de-AT` uses German patterns, `en-GB` British English ones. `language` only picks the patterns. Before, every text hyphenated with American English patterns. A language without patterns gives the warning `{ code: 'PDF_HYPHENATION_UNAVAILABLE', language }` once per render when a text has `hyphens: 'auto'`. The server loads the patterns of each language on its first render. `hyphenationCallback` is removed and no prop accepts a function. Custom split rules are not supported.

Text between spaces that holds `@` or `://`, such as an e-mail address or a URL, gets no automatic hyphen. The hyphenation caches start empty after 10,000 different words, so they no longer grow with every new word a server lays out.

Migration: to keep automatic hyphenation, set `language` on `PdfDocument` or in `definePdf`, such as `language="en"`, and `hyphens: 'auto'` on the page style, such as `<PdfPage :style="{ hyphens: 'auto' }">`. Then check the line and page breaks of documents with long words or narrow columns, and set `hyphens: 'manual'` on labels that must stay whole.

Migration: `hyphenationCallback` is removed. Delete it: words stay whole unless the style sets `hyphens: 'auto'`.
