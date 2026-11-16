# Decisions

A short, dated log of choices a future maintainer or agent might otherwise undo.
Add one line per decision: `Dn (YYYY-MM-DD): decision — why.` Replace a line
when a decision changes; git keeps the history.

- D1 (2026-10-06): Adopt the Lupinum OSS standard (lupinum-oss 9841872, `nuxt-module` starter) — every Lupinum repository shares one release, security and CI setup, so fixes to the standard apply everywhere. Changesets replaces changelogen and the hand-run release; the `beta` prerelease line continues in pre mode until 0.4.0.
- D2 (2026-10-06): Keep the extra CI jobs for the Node floor and newest Node, the pinned-Linux raster suite and the Windows path tests, and the packed-package consumer test (`test:packed`) — they guard behavior users rely on: supported Node versions, PDF output, Windows paths, and installing the published tarball at the lowest supported peers.
- D3 (2026-10-06): Remove `upstream-drift.yml` and the scheduled soak and compatibility runs — Renovate opens a pull request for every new `@react-pdf` version, and CI runs the conformance and raster suites on it; `test:performance` stays as a manual check.
- D4 (2026-11-15): The docs start page, README and share image (`docs/public/showcase/`, `docs/public/og.png`) show real output of the playground invoice, annual report, e-book and certificate — proof of quality is the strongest reason to try the library. Keep those four templates in English with neutral sample data (USD, no country-specific registers). After changing one of them, render its PDF with `renderPdfSfc` and `rasterizePdf` at scale 2.5 and replace its PDF and images.
