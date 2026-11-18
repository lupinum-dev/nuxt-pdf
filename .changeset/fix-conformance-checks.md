---
'@lupinum/nuxt-pdf': patch
---

Fix conformance checks that let invalid PDF/A, PDF/UA and Factur-X files render or gave the wrong advice

A tagged document (`'PDF/A-3a'`, `'PDF/UA-1'`) now fails with `PDF_TREE_INVALID` when `language` is not a language tag (for example `"de_DE"`), and the `title` and `language` of `definePdf` count for the tagged checks. The Factur-X XML must be well-formed UTF-8 with a `CrossIndustryInvoice` root; the profile ID is read from the element, not from a comment or CDATA section, and character references and CDATA in it are accepted. `MINIMUM` and `BASIC WL` accept only `relationship: 'Data'`. A `creationDate` that is an Invalid Date or after the year 9999, and a `conformance` list with holes, fail with `PDF_TREE_INVALID`. A character that the registered font lacks (a tab, an emoji) and SVG text without its own `fontFamily` now get a message that names the cause.
