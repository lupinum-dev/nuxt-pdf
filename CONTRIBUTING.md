# Contributing

## Read this first

Nuxt PDF currently accepts limited contributions. You can open an issue or a
pull request, but Lupinum OG can close or defer work that does not fit the
current product direction.

We are most likely to accept:

- Small bug fixes.
- Reliability and performance fixes.
- Focused documentation corrections.
- Maintenance that reduces complexity.

Open an issue before you start a feature, a breaking change, or a large
refactor. This step helps you prevent work that the project cannot accept.

## Prepare the repository

Use the Node and pnpm versions in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm test
```

Run `pnpm check` before you submit a pull request. Run
`pnpm release:verify` when you change package metadata, exports, release
scripts, or release workflows.

## Keep the change focused

- Put one concern in each pull request.
- Explain what changed and why it is necessary.
- Add tests for invariants and failure behavior.
- Update public documentation when user behavior changes.
- Add before-and-after images for a visual change.
- Add a short video for motion or interaction changes.
- Do not update raster baselines until you inspect every changed page.
- Keep fixtures free of customer data, credentials, private URLs, and
  restricted fonts.

Do not add a second document schema, a second layout engine, HTML printing,
generic adapters, or compatibility aliases without an accepted design issue.

Use a focused Conventional Commit title for the pull request, for example
`fix(runtime): reject invalid images`, `feat(test): add bookmark assertions`,
`docs: explain font loading`, or `ci: verify release notes`. The repository
uses the squash commit title to generate its changelog.

Use a descriptive `<type>/<short-description>` branch name. Do not include an
AI tool, model, vendor, or username in the branch name.

## Versioning

Nuxt PDF follows semantic versioning. Before version 1.0, a minor release can
contain a documented breaking change. After version 1.0, a breaking change
requires a major release.

A deprecation must identify the replacement and the planned removal version.
Greenfield compatibility shims are not accepted.
