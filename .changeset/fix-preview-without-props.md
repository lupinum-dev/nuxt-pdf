---
'@lupinum/nuxt-pdf': patch
---

Fix the `/_pdf` preview asking for `sampleData` when a template declares no props

A template without props now previews without `sampleData`. The preview index says "no props", "sample data" or "no preview data" for each template; before, it said "sample data" for every template without scenarios. The `@import` hint for a path without `./` or an alias now names `./theme.css` and `~~/pdfs/theme.css`.
