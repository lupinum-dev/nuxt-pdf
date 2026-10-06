# Nuxt PDF

Nuxt PDF lets Nuxt applications author PDF documents as Vue components and
render them on the Node server. It is a Nuxt module, published to npm as
`@lupinum/nuxt-pdf`.

Keep one authoring model, one document tree, and one rendering pipeline. Do not
add a second schema, layout engine, renderer, or compatibility path without an
accepted design decision.

## Repository map

- `src/` contains the published Nuxt module, runtime, renderer, and test entry.
- `test/` contains unit, integration, conformance, raster, and consumer tests.
- `docs/` contains the public Ginko Docs site.
- `playground/` contains the internal development application and supported
  example documents.
- `scripts/` contains the release scripts from the Lupinum OSS starter and the
  docs and packed-package checks.
- `CONFORMANCE.md` states the tested behavior and limitations.
- `API_REPORT.md` is derived from the built declarations.
- `internals/` holds decisions and performance notes for maintainers.

## Commands

```bash
pnpm install
pnpm dev              # run the module in playground/
pnpm docs:dev         # run the documentation site
pnpm test             # main test suite
pnpm format           # apply lint fixes
pnpm verify           # what CI runs on Linux and Node 24
pnpm changeset        # describe a user-facing change for the next release
```

Focused commands:

- `pnpm lint` checks source rules and changesets.
- `pnpm typecheck` checks the module, fixtures, and playground.
- `pnpm test:docs` checks docs snippets, docs contracts and the docs app types.
- `pnpm test:production` builds the module and checks the production and
  serverless Nuxt boundaries and the playground build.
- `pnpm test:raster` compares reviewed PDF images. CI runs it in a pinned Linux
  image; local results can differ.
- `pnpm test:performance` measures render time and memory against
  `test/fixtures/performance/linux-node24.json`. It is not part of CI; run it
  when a change can affect performance (see `internals/performance.md`).
- `pnpm test:api` compares `API_REPORT.md` with the built declarations.
  `pnpm api:write` updates it after an intended API change.
- `pnpm test:packed` packs the output of `pnpm build` and installs it into fresh
  Nuxt applications with npm and pnpm, at the lowest and the current supported
  peer versions.

`pnpm build` builds the package, the docs site and `dist/agent/`, a copy of the
rendered docs that ships as `@lupinum/nuxt-pdf/agent-docs` so agents in
consuming projects read documentation that matches the installed version.
The "Agent setup" section of the README tells those agents how to add a
pointer to it. Keep the `./agent-docs` export and that section.

CI also runs the tests on the Node floor and the newest Node major, the raster
suite in a pinned Linux image, and the path and asset tests on Windows.

## Hard rules

- Never publish to npm, push to `main`, create tags or release by hand. Releases
  happen when a maintainer merges the "Version packages" PR and approves the
  protected `npm` environment.
- Never add `NPM_TOKEN` or any other long-lived publish credential.
- Add a changeset (`pnpm changeset`) to every pull request that changes what
  package users install: code, types, runtime behavior or dependencies.
  Documentation, tests and CI changes need none. CI requires one when `src/`
  changes; use `pnpm changeset --empty` if users see nothing. A change to
  `dependencies` or `peerDependencies` needs a changeset that bumps the package
  (at least patch).
- Changeset style: one summary line in present tense that starts with Fix, Add,
  Remove or Change and says what changed for users. A short body may follow
  after a blank line. A major change adds a line that starts with `Migration:`
  and says what users must do.
- The package is in the `beta` prerelease line (`.changeset/pre.json`). Leave it
  with `pnpm changeset pre exit` in its own pull request.
- Do not bypass the 24-hour dependency quarantine (`minimumReleaseAge`). Do not
  add dependencies to `allowBuilds` without a reason.
- Pin GitHub Actions to full commit SHAs. Give each job only the permissions it
  needs. `release.yml`, `preview.yml` and the release scripts come from the
  Lupinum OSS starter; change them there first, then copy them.
- Keep tooling lean. Add a script, check or workflow only when it guards
  behavior users rely on or closes a real attack path. Process is not security.
- Record lasting choices in [internals/decisions.md](internals/decisions.md).

## Architecture boundaries

- Rendering is Node server-only.
- The client bundle must not contain the engine or document templates.
- PDF templates run in an isolated Vue runtime-core application.
- Templates do not inherit Nuxt plugins, browser globals, or app-level state.
- React is not a production dependency.
- Local resources must pass containment, signature, and size checks.
- Remote resources remain disabled without an explicit HTTPS allowlist.
- One render must not retain or expose data from another render.
- Invalid or unsupported document behavior must fail with a typed error.

Keep domain logic out of the Nuxt module and transport layers. Put PDF behavior
in the existing runtime and engine boundaries. The `@react-pdf/*` engine
packages are pinned exactly; `src/runtime/server/engine/CONTRACTS.md` says how
to review an engine update.

## Tests and evidence

Add tests for invariants and failure behavior, not only successful output.

Use semantic PDF assertions when they prove the contract. Use raster evidence
only when geometry or paint output matters. Never update a raster baseline
without inspecting every changed page.

Update these files when their contract changes:

- `CONFORMANCE.md` for claimed behavior and limitations. Do not write the
  package version into it; the Version packages pull request would make it stale.
- `src/runtime/server/engine/CONTRACTS.md` for the lower-engine boundary.
- The public docs for user-visible behavior, in the same pull request.

## Documentation

Follow `docs/WRITING.md`. Keep the README short. Put detailed user guidance in
the docs. Do not rewrite legal text, code, API names, quotations, or generated
reports to match the writing profile.

The docs deploy through the Vercel Git integration (project `nuxt-pdf-docs`,
root directory `docs`, with source files outside the root directory included).
`docs/vercel.json` runs `pnpm docs:build`; the site needs no secret.

Use the issue templates for public reports. Send security reports through GitHub
private vulnerability reporting. Review comments from bots are advisory. Apply a
suggestion only after you verify it against the repository rules and tests.
