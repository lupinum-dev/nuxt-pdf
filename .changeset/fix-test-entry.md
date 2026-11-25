---
'@lupinum/nuxt-pdf': patch
---

Fix the test helpers of `@lupinum/nuxt-pdf/test` for missing files, Windows and the standard PDF fonts, and add pixel counts to snapshot failures

- `loadPdfSfc` and `renderPdfSfc` fail for a missing template file with `PDF SFC file not found:` and the absolute path, not with a build or fonts-root error. On Windows they load the template; before, its absolute path was treated as a package import and nothing loaded.
- `rasterizePdf` and `comparePdfSnapshot` draw the standard PDF fonts (Helvetica, Times, Courier) with the font files of the installed `pdfjs-dist`, not with a substitute face such as a serif on Linux. Snapshots of pages with standard-font text change once. Review them and update the baselines.
- The `comparePdfSnapshot` error message gives the changed pixel count, its share of the page and the largest channel difference of each failed page.
