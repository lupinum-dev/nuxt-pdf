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
- Use the bug template for a reproducible defect.
- Use the proposal template for a user problem or a large change.

Ask for a minimal public reproduction before you investigate an unclear bug.
Close requests that are outside the documented product boundary. State the
reason and link to the relevant documentation.

## Daily maintenance

An assigned maintenance task includes setup, diagnosis, implementation,
independent review, routine pull requests, protected merge, post-merge checks,
and cleanup. Preserve public contracts. Changes to security or delegation need
explicit policy approval; a patch cannot authorize itself. Keep the final
protected npm publication approval with a human maintainer.

Use the Node version in `.node-version` and the package manager in `package.json`.
Run `corepack enable pnpm`, then `pnpm install --frozen-lockfile`.
`pnpm dev` prepares the module and starts the playground. Open the printed URL
and `/_pdf`. Select a template and scenario, edit its content, and check the
updated document and diagnostics. Explore a narrow screen and error recovery.
Restore temporary fixture edits and stop only the processes you started.

`pnpm build` builds the package from source. `pnpm verify` checks policy, the
full workspace audit, source, documentation, production boundaries, and one
packed-consumer certification. `pnpm release:verify` runs those checks and
retains the certified candidate. Commit source changes before retaining it.
Do not rerun aggregate children after a successful aggregate gate.

Use focused tests while editing. GitHub separately owns pinned Linux raster,
Windows, supported Node, scheduled compatibility, stress, and performance
results. A local pass does not certify those platforms. Read the required
`CI gate` for the exact reviewed commit before merging. Use a Conventional
Commit title and independent review for meaningful code, CI, and dependencies.

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
6. Wait for the exact merged commit's `ci` workflow to succeed. Start
   `release.yml` from `main` with the exact package version. The workflow
   finds the certified artifact for that commit.
7. Download the `release-candidate` artifact. Verify `SHA256SUMS`, the
   package file list, license inventory, SBOM, and packed consumer result.
8. Approve the protected `npm` environment deployment after you inspect the
   retained artifact.
9. Confirm the npm version, provenance, protected `v*` tag, GitHub Release,
    and documentation links.

The workflow derives the dist-tag from the package version. A stable version
uses `latest`. Every prerelease version uses the shared `next` tag.

Do not rebuild after the release artifact is created. The OIDC job downloads
the retained tarball. It does not check out code, install dependencies, or run
repository scripts.

The SBOM describes the locked root production graph. The license inventory
describes installed production dependencies on the certification host; optional
packages for other platforms can appear only in the SBOM. Documentation and
playground dependencies remain covered by the full workspace audit.

Packed consumers test the declared peer minima and the installed current
versions with npm and pnpm. They check application versions and report the
Vue version resolved inside Nuxt, which can differ. Scheduled compatibility
selects minimum or latest supported dependencies from the same peer manifest.

If npm already contains the same version, rerun the current workflow only when
the registry SHA-1 matches the certified tarball and npm exposes provenance.
The unprivileged verifier checks the signed npm attestation and derives the
original source commit from it. It then downloads the retained CI artifact for
that commit. It never assumes that current `main` created an older package.
The protected npm environment is skipped when the verified registry bytes
already exist. The workflow repairs a missing matching tag or GitHub Release
from the original source and retained bytes without republishing. If GitHub
rejects historical tag creation, the failed job prints the exact `gh api`
command a maintainer must run before retrying only the GitHub Release job. If the exact artifact expired,
the signed source differs, or the registry bytes differ, stop. Do not rebuild
or guess. Dispatch a new run from updated `main` after a workflow fix. Do not
rerun an old failed run because it keeps the old workflow definition.

Do not use `changelogen --release`, `--push`, or `--publish`. Those options
bypass the protected pull request, retained artifact, and trusted-publication
boundaries.

Changelogen uses the latest immutable `v*` tag as its starting point. Do not
prepare the next release until the current npm version has a matching tag and
GitHub Release.

## Roll back a defective release

Do not unpublish a release unless npm policy and a confirmed security incident
require it.

1. Stop release workflows.
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
them automatically. Keep one dependency bot. Disable Dependabot version
updates in the repository settings, but keep security alerts enabled.

For each update:

1. Review the upstream release, provenance, and lifecycle-script changes.
2. Keep `allowBuilds` limited to dependencies that require a build.
3. Run `pnpm release:verify`, which includes the full workspace audit.
4. Run raster, performance, and compatibility jobs when the engine or Nuxt
   dependency family changes.
5. Give every temporary override a reason and review date.

Do not bypass the 24-hour dependency release-age policy for convenience.

Run `pnpm check:dependencies` to check the install policy and exception expiry.
An exact exception needs an inline JSON comment with `reason`, `owner`, and
UTC `expires`, within 24 hours. Remove the exclusion and its comment at expiry.
CI checks the policy on pull requests, main pushes, and daily.

Fresh package consumers validate their generated policy before installation.
They inherit root quarantine settings and exact exceptions, without workspace
dependency overrides. npm uses a cutoff 24 hours before the install and does
not use pnpm exceptions.

## Review package size changes

Build the package, then measure it with `npm pack --ignore-scripts --dry-run --json`.
For an approved additive feature, update only `packageTarballBytes` and
`packageUnpackedBytes` in `test/fixtures/performance/linux-node24.json` from that
report. Keep the 10% regression guard. Do not replace Linux rendering metrics
with measurements from another platform. Review the packed file list and
compiler/runtime separation, then rerun `pnpm test:artifact`.

## Publish the documentation site

Vercel deploys the documentation application as the `nuxt-pdf-docs` project. `main`
is the production branch. Request a pull-request preview with `/vercel`. The
production domain is `nuxt-pdf.lupinum.com`.

The Vercel project uses `docs/` as its root. Enable **Include source files
outside of the Root Directory in the Build Step**. `docs/vercel.json` installs
the locked workspace, builds the package, recreates the documentation Nuxt
types, and then builds the site. Do not set an Output Directory override. It
does not need a repository secret. Test the same path locally with
`pnpm docs:build:vercel` before you merge. Do not set an Install Command
override. Vercel detects pnpm from the repository lockfile and installs the
workspace before it runs the committed build command.

## Audit external settings

Review the active settings in January and July, and after an ownership or
release-workflow change. The providers own the active configuration. This
section states the required policy.

GitHub must have:

- A `main` ruleset that blocks deletion and force pushes, requires linear
  history and resolved review threads, and requires the `CI gate` check.
- Squash merge as the only merge method and automatic branch deletion.
- GitHub Actions restricted to full commit-SHA references, with default
  workflow permissions read-only.
- Issues enabled for public reports, with Wikis and Discussions disabled so
  versioned repository documentation remains authoritative.
- A tag ruleset that blocks deletion and force updates for `v*` tags.
- An `npm` environment that permits only `main`, requires a maintainer review,
  and uses administrator bypass only for documented incident recovery.
- Private vulnerability reporting, secret scanning, and push protection.
- CodeQL Default Setup for JavaScript and TypeScript, plus automated security
  fixes.
- Renovate as the routine dependency updater.
- CodeRabbit in advisory mode. It must not be a required check.

npm must have:

- A trusted publisher bound to `lupinum-dev/nuxt-pdf`, `release.yml`, the
  `npm` environment, and publish permission.
- 2FA for package changes and no publication token.

Vercel must have:

- The `nuxt-pdf-docs` project bound to this repository with root `docs`.
- `main` as the production branch and pull request previews on demand.
- `nuxt-pdf.lupinum.com` as the production domain.
- No Install Command or Output Directory override.
- Basic build machines and queued builds with on-demand concurrency disabled.
  Use another machine only after review proves lower cost per successful build
  or a Basic build failure.

## Respond to a credential incident

If a GitHub or npm account may be compromised:

1. Stop all release workflows.
2. Revoke affected sessions, tokens, and trusted-publisher bindings.
3. Review GitHub audit logs, workflow changes, releases, tags, and npm access
   history.
4. Deprecate any untrusted package version and restore the last known-good
   dist-tag.
5. Restore trusted publishing only after you verify the source commit,
   workflow, and package artifacts.
6. Record the incident and recovery evidence outside the public repository.
