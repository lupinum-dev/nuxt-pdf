# Maintaining Nuxt PDF

This file is for Lupinum OG maintainers. Contributors use
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Sources of truth

- `package.json` owns the package name and version.
- `CHANGELOG.md` owns the release history.
- `CONFORMANCE.md` owns the tested compatibility claim.
- `pnpm-lock.yaml` owns the resolved dependency graph.
- `docs/site.json` owns the documentation identity.
- `changelog.config.json` owns changelog grouping and presentation.
- The retained `.tgz` file is the release candidate.
- GitHub, npm, and Vercel own their active external settings.

Do not create a long-lived release branch, a second version file, or a local
publication path.

## Triage feedback

Use one route for each request:

- Send a vulnerability to GitHub private vulnerability reporting.
- Send a conduct report to `info@lupinum.com`.
- Send usage questions to the Lupinum OSS Discord.
- Use the bug form for a reproducible defect.
- Use the feature form for a user problem or a large change.

Ask for a minimal public reproduction before you investigate an unclear bug.
Close requests that are outside the documented product boundary. State the
reason and link to the relevant documentation.

## Ship a small change

1. Create a short branch from current `main`.
2. Change one concern.
3. Run the smallest relevant test while you work.
4. Run `pnpm check` before you finish.
5. Open a pull request with a Conventional Commit title.
6. Resolve review threads and required checks.
7. Squash the pull request into `main`.

An issue is optional for a small defect or documentation correction. Use an
issue first when the expected behavior is not clear.

## Plan a large change

Open an issue before you write code. Define the user problem, the public
contract, the risks, and the acceptance criteria. Confirm that the change
fits the existing authoring model and rendering pipeline.

Split the work into focused pull requests that are safe to merge. Do not keep
old and new implementations active at the same time. Use a hard cut when the
new path passes its tests.

## Review a pull request

Check the behavior, tests, documentation, compatibility, and release impact.
Treat CodeRabbit as an advisory reviewer. A CodeRabbit comment is not a
required check and does not replace maintainer judgment.

Use the pull request title as the future squash commit title. Do not merge if
any required check is missing, pending, or failing.

## Update public documentation

Keep `README.md` short. Put installation, first use, support links, and the
main product boundary in the README. Put detailed user guidance in Ginko Docs.
Put maintainer operations in this file.

Follow `docs/WRITING.md`. Run `pnpm test:docs` and `pnpm docs:build` after a
documentation change.

## Prepare a release

1. Create a release preparation branch from protected `main`.
2. Run `pnpm release:prepare`. Changelogen infers the next version from the
   Conventional Commit history. It updates `package.json` and `CHANGELOG.md`.
3. Review the version and changelog. Update `CONFORMANCE.md` for the same
   version.
4. Run `pnpm release:verify`.
5. Open and merge the release preparation pull request.
6. Start `release.yml` from `main` with staging enabled.
7. Record the release workflow run ID from its GitHub Actions URL.
8. Download the `npm-release-evidence` artifact. Verify `SHA256SUMS`, the
   package file list, license inventory, SBOM, and packed consumer result.
9. Review the npm stage and compare its downloaded tarball with the retained
   tarball.
10. Approve the npm stage with WebAuthn or another permitted second factor.
11. Start `post-publish.yml` with the release workflow run ID. Run it before
    the 14-day release artifact expires.
12. Confirm the npm version, provenance, protected `v*` tag, GitHub Release,
    and documentation links.

Use these npm stage commands from a trusted workstation:

```bash
npm stage list @lupinum/nuxt-pdf
npm stage view <stage-id>
npm stage download <stage-id>
npm stage approve <stage-id>
```

Use `npm stage reject <stage-id>` when the content, version, or dist-tag is
wrong. Approval and rejection require a human second factor.

The workflow derives the dist-tag from the package version. A stable version
uses `latest`. A prerelease version uses its first prerelease identifier. For
example, `0.4.0-next.1` uses `next`.

Do not rebuild after the release artifact is created. The OIDC job downloads
the retained tarball. It does not check out code, install dependencies, or run
repository scripts.

Do not use `changelogen --release`, `--push`, or `--publish`. Those options
bypass the protected pull request, retained artifact, and staged publication
boundaries.

Changelogen uses the latest immutable `v*` tag as its starting point. Do not
prepare the next release until the current npm version has a matching tag and
GitHub Release.

## Bootstrap the package

npm staged publishing requires an existing package. Use this procedure only
for the first release of a new Lupinum package:

1. Run the repository release workflow from protected `main` with staging
   disabled.
2. Download and verify the retained release artifact on a trusted workstation.
3. Inspect the tarball file list and packed `package.json`.
4. Publish that exact tarball with interactive WebAuthn:
   `npm publish <file>.tgz --access public --ignore-scripts`.
5. Configure the npm trusted publisher for the exact organization,
   repository, release workflow filename, and `npm` environment.
6. Permit only `npm stage publish`.
7. Require 2FA for package changes and disallow publication tokens.
8. Revoke any token that can publish the package.

Do not use this procedure after trusted publishing is active.

## Roll back a defective release

Do not unpublish a release unless npm policy and a confirmed security incident
require it.

1. Stop release workflows and reject any pending stage.
2. Identify the bad version and the last known-good version.
3. Move `latest` to the known-good version:
   `npm dist-tag add @lupinum/nuxt-pdf@<good-version> latest`.
4. Deprecate the bad version:
   `npm deprecate @lupinum/nuxt-pdf@<bad-version> "Use <good-version> while we prepare a fix."`.
5. Publish a forward fix with a new version.
6. Record the affected versions and resolution in `CHANGELOG.md`.

Stop promotion when silent content loss, cross-render data access, or a
resource-policy bypass is possible. Handle the fix through the security report
process.

## Review dependency changes

Renovate opens grouped dependency pull requests each week. It does not merge
them automatically. Dependabot version and security updates remain disabled
so that one bot owns dependency pull requests.

For each update:

1. Review the upstream release, provenance, and lifecycle-script changes.
2. Keep `allowBuilds` limited to dependencies that require a build.
3. Run `pnpm check`.
4. Run raster, performance, and compatibility jobs when the engine or Nuxt
   dependency family changes.
5. Give every temporary override a reason and review date.

Do not bypass the three-day dependency release-age policy for convenience.

## Publish the documentation site

Vercel deploys the `docs/` workspace as the `nuxt-pdf-docs` project. `main`
is the production branch. Pull requests receive preview deployments. The
production domain is `nuxt-pdf.lupinum.com`.

The project uses the Nuxt framework preset and `docs` as its root directory.
It does not need a repository secret. Test documentation locally with
`pnpm docs:build` before you merge.

## Audit external settings

Review the active settings in January and July, and after an ownership or
release-workflow change. The providers own the active configuration. This
section states the required policy.

GitHub must have:

- A `main` ruleset that blocks deletion and force pushes, requires linear
  history and resolved review threads, and requires all eight CI jobs.
- Squash merge as the only merge method and automatic branch deletion.
- A tag ruleset that blocks deletion and force updates for `v*` tags.
- An `npm` environment that permits only `main`, requires a maintainer review,
  and does not permit administrator bypass.
- Private vulnerability reporting, secret scanning, and push protection.
- CodeRabbit in advisory mode. It must not be a required check.

npm must have:

- A trusted publisher bound to `lupinum-dev/nuxt-pdf`, `release.yml`, the
  `npm` environment, and stage-only publication.
- 2FA for package changes and no publication token.

Vercel must have:

- The `nuxt-pdf-docs` project bound to this repository with root `docs`.
- `main` as the production branch and pull request previews enabled.
- `nuxt-pdf.lupinum.com` as the production domain.

## Respond to a credential incident

If a GitHub or npm account may be compromised:

1. Stop all release workflows.
2. Reject pending npm stages.
3. Revoke affected sessions, tokens, and trusted-publisher bindings.
4. Review GitHub audit logs, workflow changes, releases, tags, and npm access
   history.
5. Deprecate any untrusted package version and restore the last known-good
   dist-tag.
6. Restore trusted publishing only after you verify the source commit,
   workflow, and package artifacts.
7. Record the incident and recovery evidence outside the public repository.
