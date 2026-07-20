# Vue conformance raster baselines

These two reviewed PNGs are the page-level visual contract for the pinned Vue
conformance fixture. The same test also checks page text, links, page count, and
React/Vue raster parity; raw PDF bytes are intentionally not snapshotted.

Regenerate only for an intentional layout change:

```sh
UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/conformance.test.ts
```

Review every changed PNG, then rerun the command without the environment
variable. If the intentional change alters page count, remove obsolete PNGs so
the exact baseline-file assertion passes.

The `svg/` subdirectory holds the reviewed baseline for the paired SVG fixture.
Regenerate it the same way for an intentional SVG change:

```sh
UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/svg-conformance.test.ts
```
