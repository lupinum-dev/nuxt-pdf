# Maintaining Nuxt PDF

This file is for Lupinum OG maintainers. Contributors use
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Sources of truth

- `package.json` owns the package name and version.
- `CHANGELOG.md` owns the release history.
- `CONFORMANCE.md` owns the tested compatibility claim.
- `pnpm-lock.yaml` owns the resolved dependency graph.
- `docs/site.json` owns the documentation identity.
- The retained `.tgz` file is the release candidate.

Do not create a release branch, a second version file, or a local publication
path.

## Prepare a release

1. Merge the version and changelog to protected `main`.
2. Confirm that `CONFORMANCE.md` describes the same version.
3. Confirm that the worktree is clean.
4. Run `pnpm release:verify`.
5. Review the package file list, checksum, license inventory, SBOM, and packed
   consumer result.
6. Push the release commit to `main`.
7. Start `release.yml` from `main` with staging enabled.
8. Download the GitHub release artifact and verify `SHA256SUMS`.
9. Download the npm stage and compare its tarball checksum.
10. Approve the npm stage with WebAuthn or another permitted second factor.
11. Run `post-publish.yml` with the exact version and approved tarball SHA-256.
12. Verify the registry version, dist-tag, provenance, and package contents.
13. Create the protected Git tag and GitHub release for the verified commit.

The workflow derives the dist-tag from the package version. A stable version
uses `latest`. A prerelease version uses the first prerelease identifier. For
example, `0.4.0-next.1` uses `next`.

Do not rebuild after the release artifact is created. The stage job must use
the retained tarball from the build job.

## Bootstrap the package

npm staged publishing requires an existing package. Use this procedure only
for the first `@lupinum/nuxt-pdf` release:

1. Run `release.yml` from protected `main` with staging disabled.
2. Download the retained release artifact.
3. Verify `SHA256SUMS` on a trusted workstation.
4. Inspect the tarball file list and packed `package.json`.
5. Publish that exact tarball with interactive WebAuthn and
   `npm publish <file>.tgz --access public --ignore-scripts`.
6. Configure the npm trusted publisher for `lupinum-dev/nuxt-pdf`,
   `release.yml`, and the `npm` environment.
7. Permit only `npm stage publish`.
8. Set package access to require 2FA and disallow tokens.
9. Revoke any npm publication token that can write this package.

Do not use this procedure again after trusted publishing is configured.

## Roll back a release

Do not unpublish a release unless npm policy and a confirmed security incident
require it.

For a defective release:

1. Move the affected dist-tag to the last known-good version with an
   interactive maintainer session.
2. Deprecate the defective version with a concise impact statement.
3. Publish a forward fix with a new version.
4. Run the full release and post-publication verification again.
5. Record the affected versions and resolution in `CHANGELOG.md`.

Stop promotion immediately when silent content loss, cross-render data access,
or a resource-policy bypass is possible. Handle the fix through the security
reporting process.

## Review dependency changes

Renovate opens grouped dependency pull requests each week. It does not merge
them automatically.

For each update:

1. Review the upstream release and provenance.
2. Check all lifecycle-script changes.
3. Keep `allowBuilds` limited to dependencies that require a build.
4. Run `pnpm check`.
5. Run raster, performance, and compatibility jobs when the engine or Nuxt
   dependency family changes.
6. Give every temporary exception a reason and a removal date.

Do not bypass the dependency release-age policy for convenience.

## Rotate or respond to a credential incident

If a GitHub or npm account may be compromised:

1. Stop all release workflows.
2. Reject pending npm stages.
3. Revoke affected sessions, tokens, and trusted-publisher bindings.
4. Review GitHub audit logs, workflow changes, releases, tags, and npm access
   history.
5. Deprecate any untrusted package version and restore the last known-good
   dist-tag.
6. Restore trusted publishing only after the source commit, workflow, and
   package artifacts are verified.
7. Record the incident and recovery evidence outside the public repository.
