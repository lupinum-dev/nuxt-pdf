---
'@lupinum/nuxt-pdf': patch
---

Fix two renders of the same document writing different bytes

A document with a registered font, attachments or transparent images wrote other bytes on every render: the engine named font subsets at random and wrote compressed streams in the order they finished. Font subsets are now named `AAAAAA+…`, `AAAAAB+…` in order of first use and objects are written in a fixed order, so the same document with the same `creationDate` gives the same bytes, also when several renders run at the same time.
