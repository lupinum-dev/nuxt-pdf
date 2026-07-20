# Reviewed raster baselines

Every committed PNG here (and in the sibling fixture directories listed below)
is a reviewed page-level visual contract. The owning tests also check page
text, links, page count, and — where React PDF is a valid oracle — React/Vue
raster parity; raw PDF bytes are intentionally not snapshotted.

Regenerate a baseline only for an intentional layout change, review every
changed PNG visually, then rerun the owning test without the environment
variable. If the change alters page count, remove obsolete PNGs so exact
baseline-file assertions pass.

| Baseline location | Owning test | Regenerate with |
| --- | --- | --- |
| `./*.png` | `test/conformance.test.ts` | `UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/conformance.test.ts` |
| `./svg/` | `test/svg-conformance.test.ts` | `UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/svg-conformance.test.ts` |
| `./toc/` | `test/toc-conformance.test.ts` | `UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/toc-conformance.test.ts` |
| `./corpus/` | `test/corpus/pagination.test.ts` | `UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/corpus/pagination.test.ts` |
| `../corpus/*.png` (alongside the image fixtures) | `test/corpus/images.test.ts` | `UPDATE_PDF_BASELINES=1 pnpm exec vitest run test/corpus/images.test.ts` |
