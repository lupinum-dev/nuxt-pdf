# Release and rollback

`package.json` is the only version source. `CHANGELOG.md` and `CONFORMANCE.md`
must describe that exact version before a release candidate is built.

## Release candidate

1. Run `pnpm verify` from a clean worktree.
2. Review all canonical PDF rasters and CI artifacts.
3. Start the release workflow in dry-run mode and inspect its tarball, SBOM,
   license inventory, and checksums.
4. Obtain human approval for licensed-font comparisons and the Luis plus
   independent-application beta evidence.
5. Authorize trusted publishing to the `next` tag. Never publish from a local
   credential-bearing npm configuration.
6. Run the post-publish smoke workflow against the exact registry version.
7. After the RC soak, promote the already-tested version to `latest`.

The Git tag, npm version, tarball checksum, provenance statement, and SBOM form
one release record. Published tarballs are immutable and must never be replaced.

## Rollback

Do not unpublish a release except where npm policy and a confirmed security
incident require it. For a defective release:

1. Move `latest` back to the last known-good version.
2. Mark the defective version deprecated with a concise impact statement.
3. Publish a forward fix with a new version and rerun the full release gate.
4. Record the incident and affected versions in the changelog.

If silent content loss, cross-render contamination, or a policy bypass is
possible, stop promotion immediately and treat the fix as security-sensitive.
