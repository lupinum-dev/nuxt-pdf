# Reviewed raster baselines

Every committed PNG below this directory is a reviewed page-level visual
contract. The owning tests also check page text, links, and page count. When
React PDF is a valid oracle, the tests check React/Vue raster parity. Raw PDF bytes are
intentionally not snapshotted.

Regenerate a baseline only for an intentional layout change, review every
changed PNG visually, then rerun the owning test without the environment
variable. If the change alters page count, remove obsolete PNGs so exact
baseline-file assertions pass.

Locate the owning test from the baseline directory name before regenerating it,
for example:

```sh
rg "fixtures/baselines/<name>" test
```

Then run only that test with `UPDATE_PDF_BASELINES=1`, review the changed PNGs,
and rerun it without the environment variable.
