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

Use the bug form for a reproducible defect. Use the feature form to describe
the user problem before you propose an implementation. Ask usage questions in
the [Lupinum OSS Discord](https://discord.lupinum.com). Follow
[SECURITY.md](./SECURITY.md) for a private vulnerability report.

## Prepare the repository

Use the Node and pnpm versions in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm test
pnpm verify
```

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
or `docs: explain font loading`.

Add a changeset with `pnpm changeset` when the pull request changes what users
install: code, types, runtime behavior or dependencies. A change to
`dependencies` or `peerDependencies` needs at least a patch bump. The changelog
is built from changesets; the style rules are in [AGENTS.md](../AGENTS.md). Use
`pnpm changeset --empty` when you change `src/` but users see no difference.

Use a descriptive `<type>/<short-description>` branch name. Do not include an
AI tool, model, vendor, or username in the branch name.

Complete the pull request template. CodeRabbit can add advisory review
comments. A maintainer decides which comments require a change.

## Versioning

Nuxt PDF follows semantic versioning. Before version 1.0, a minor release can
contain a documented breaking change. After version 1.0, a breaking change
requires a major release.

A deprecation must identify the replacement and the planned removal version.
Greenfield compatibility shims are not accepted.
