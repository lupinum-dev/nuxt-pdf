# Contributing

Nuxt PDF has one Vue authoring tree and one React PDF engine pipeline. Changes
should simplify that path, preserve server-only rendering, and prove behavior
with semantic or visual evidence.

## Development

Use the Node and pnpm versions declared in `package.json`, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm test
```

Before submitting a change, run the scoped tests and lint for the files you
touched. Release-boundary changes also require `pnpm verify`.

## Change policy

- Add tests for invariants and failure behavior, not only successful output.
- Update `CONTRACTS.md`, `CONFORMANCE.md`, and public docs when a contract moves.
- Do not add compatibility aliases, a second document schema, backend adapters,
  HTML printing, generic tables, or a second layout engine.
- Do not update raster baselines without visually reviewing every changed page.
- Keep fixtures free of customer data, credentials, private URLs, and licensed
  fonts that cannot be redistributed.

Commits use a focused conventional prefix such as `fix(runtime):`,
`feat(test):`, `docs:`, or `ci:`.

## Versioning and deprecation

Published releases follow semantic versioning. Before 1.0, documented breaking
changes are allowed in a minor release and are recorded in the changelog. From
1.0 onward, removals require a major release. Deprecations must name the direct
replacement and an intended removal version; greenfield compatibility shims are
not accepted.
