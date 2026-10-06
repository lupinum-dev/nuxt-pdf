# Decisions

A short, dated log of choices a future maintainer or agent might otherwise undo.
Add one line per decision: `Dn (YYYY-MM-DD): decision — why.` Replace a line
when a decision changes; git keeps the history.

- D1 (2026-10-06): Adopt the Lupinum OSS standard (lupinum-oss 9841872, `nuxt-module` starter) — every Lupinum repository shares one release, security and CI setup, so fixes to the standard apply everywhere. Changesets replaces changelogen and the hand-run release; the `beta` prerelease line continues in pre mode until 0.4.0.
- D2 (2026-10-06): Keep the extra CI jobs for the Node floor and newest Node, the pinned-Linux raster suite and the Windows path tests, and the packed-package consumer test (`test:packed`) — they guard behavior users rely on: supported Node versions, PDF output, Windows paths, and installing the published tarball at the lowest supported peers.
- D3 (2026-10-06): Remove `upstream-drift.yml` and the scheduled soak and compatibility runs — Renovate opens a pull request for every new `@react-pdf` version, and CI runs the conformance and raster suites on it; `test:performance` stays as a manual check.
