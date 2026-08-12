# Repository instructions

## Purpose

Nuxt PDF lets Nuxt applications author PDF documents as Vue components and
render them on the Node server.

Keep one authoring model, one document tree, and one rendering pipeline. Do not
add a second schema, layout engine, renderer, or compatibility path without an
accepted design decision.

## Repository map

- `src/` contains the published Nuxt module, runtime, renderer, and test entry.
- `test/` contains unit, integration, conformance, raster, and consumer tests.
- `docs/` contains the public Ginko Docs site.
- `playground/` contains the internal development application and supported
  example documents.
- `scripts/` contains direct verification and release operations.
- `CONFORMANCE.md` states the tested behavior and limitations.
- `MAINTAINING.md` contains the human release and recovery procedure.

## Sources of truth

- `package.json` owns the package name, version, exports, and command surface.
- `pnpm-lock.yaml` owns resolved dependencies.
- `changelog.config.json` owns changelog grouping and presentation.
- `docs/site.json` owns documentation identity.
- `src/` owns runtime behavior and public types.
- `API_REPORT.md` is derived from built declarations.
- Raster and performance baselines are reviewed evidence, not editable output.

Do not hand-edit generated files under `.nuxt/`, `.output/`, `dist/`, or
`reports/`.

## Commands

Use the exact Node and pnpm versions declared by the repository.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

Use these focused commands during development:

- `pnpm format` fixes supported formatting and lint issues.
- `pnpm lint` checks source rules.
- `pnpm typecheck` checks the module, fixtures, and playground.
- `pnpm test` runs the main test suite.
- `pnpm test:production` checks the production Nuxt boundary.
- `pnpm test:serverless` checks the serverless build boundary.
- `pnpm test:raster` compares reviewed PDF images.
- `pnpm test:workflows` checks the release privilege boundaries.
- `pnpm docs:dev` runs the documentation site.
- `pnpm docs:build` builds the documentation site.
- `pnpm release:verify` creates and verifies the release candidate.

Run the smallest relevant test while you work. Run `pnpm check` before you
finish. Run `pnpm release:verify` for package or release-boundary changes.

## Branches and commits

Use a short Conventional Commit title for each pull request. The squash commit
on `main` uses that title, and Changelogen uses it to prepare release notes.

Use `<type>/<short-description>` for branch names. Examples include
`feat/pdf-bookmarks`, `fix/remote-image-timeout`, and
`chore/release-automation`.

Do not prefix a branch with an agent, model, vendor, tool, or username. Never
use prefixes such as `agent/`, `codex/`, `claude/`, `cursor/`, or `copilot/`.

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
in the existing runtime and engine boundaries.

## Tests and evidence

Add tests for invariants and failure behavior, not only successful output.

Use semantic PDF assertions when they prove the contract. Use raster evidence
only when geometry or paint output matters. Never update a raster baseline
without inspecting every changed page.

Update these files when their contract changes:

- `CONFORMANCE.md` for claimed behavior and limitations.
- `src/runtime/server/engine/CONTRACTS.md` for the lower-engine boundary.
- Public Ginko documentation for user-visible behavior.
- `CHANGELOG.md` for release-facing changes.

## Documentation

Follow `docs/WRITING.md`. Keep the README short. Put detailed user guidance in
Ginko Docs. Put maintainer operations in `MAINTAINING.md`.

Do not rewrite legal text, code, API names, quotations, or generated reports to
match the controlled-English profile.

## Publication safety

Agents must not:

- Publish an npm package.
- Approve or reject an npm stage.
- Move an npm dist-tag.
- Create or push a release tag.
- Change npm trusted-publisher settings.
- Handle, request, or store publication credentials.

Agents can prepare and verify a release artifact. A human maintainer performs
all registry approvals and external configuration.

After registry verification, only `post-publish.yml` can create the immutable
release tag and GitHub Release. Agents must not reproduce that operation
locally.

Use the issue templates for public reports. Send security reports through GitHub
private vulnerability reporting. CodeRabbit comments are advisory. Apply a
suggestion only after you verify it against the repository rules and tests.

## Change policy

Use a short branch name that describes the work, such as
`fix/font-containment`. Do not require an agent or tool prefix such as
`codex/`, `claude/`, or `cursor/`.

Prefer deletion and simplification. Do not add generic adapters, wrappers,
configuration, caches, state machines, or compatibility paths for possible
future use.

Use a hard cut for an unreleased or greenfield path. Remove the old path after
the replacement passes its tests.
