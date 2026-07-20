# Nuxt PDF 0.1.0 conformance

Nuxt PDF claims behavioral compatibility for a deliberately small, tested
corpus. It does not claim full React PDF API or test-suite compatibility.

## Version boundary

| Layer | 0.1.0 boundary |
|---|---|
| Node.js | `^22.12.0`, `^24.11.0`, or `>=26.0.0` |
| Nuxt | `^4.4.8` |
| Vue | `^3.5.0` |
| React PDF reference | commit `d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6` |
| `@react-pdf/font` | `4.0.8` |
| `@react-pdf/layout` | `4.6.1` |
| `@react-pdf/pdfkit` | `5.1.1` |
| `@react-pdf/primitives` | `4.3.0` |
| `@react-pdf/render` | `4.5.1` |

The engine packages are exact pins. Compatibility must be re-evaluated when
any of them changes.

## Verified corpus

### Compatibility kernel

The paired React/Vue fixture verifies:

- the Vue renderer produces the node contract consumed directly by layout;
- ordinary Vue components, props, slots, conditionals, and keyed lists;
- A4 layout, normal text flow, explicit page breaking, and two output pages;
- fixed content repeated across pages;
- synchronous dynamic text returning scalar page-number and page-total text;
- a local Roboto TTF and local PNG;
- an external link annotation; and
- equivalent extracted text, link annotations, page count, and a thresholded
  page-by-page raster comparison for this fixture.

Renderer tests separately cover insertion, removal, keyed movement, prop and
text updates, primitive resolution, rejection of invalid roots, and exclusion
of orphan text from the document tree.

Dynamic text (page-number footers) renders at correct page-bottom geometry even
when a `lineHeight` reaches it — inherited from `PdfPage` or nested `PdfView`
chains, given as a percentage, or set on the dynamic node itself. This is a
deliberate divergence from upstream React PDF, which drops such footers, so it
is verified by Vue-only engine tests (`test/engine.test.ts`) against the
equivalent static-text geometry, not by the paired React fixture.

### SVG drawing primitives

A second paired React/Vue fixture (`test/svg-conformance.test.ts`) draws through
the same layout and render engine and verifies:

- `PdfSvg`, `PdfG`, `PdfPath`, `PdfRect`, `PdfCircle`, `PdfEllipse`, `PdfLine`,
  `PdfPolyline`, `PdfPolygon`, `PdfDefs`, `PdfClipPath`, `PdfLinearGradient`,
  `PdfRadialGradient`, `PdfStop`, and `PdfTspan`;
- `PdfSvg` as a flex leaf in normal page flow, measured from its `viewBox`
  aspect ratio, alongside paragraph text;
- basic shapes with numeric coercion and the `rx`/`ry` mutual default on rects;
- a `PdfG` `transform` (translate + rotate) with presentation inheritance
  (`fill` set on the group cascading to child shapes);
- a `PdfDefs` `PdfLinearGradient` referenced by `fill="url(#id)"`, proving def
  indexing and `url()` substitution;
- a `PdfDefs` `PdfClipPath` referenced by `clipPath="url(#id)"`;
- SVG text: a `PdfSvg` `PdfText` with `x`/`y` and two `PdfTspan` children,
  proving tspan joining and x-chaining, with its content preserved as extracted
  page text; and
- equivalent extracted page text plus a thresholded page raster comparison
  against React output and a reviewed committed baseline.

Renderer tests separately cover the SVG nesting rules: which primitives each
container accepts, `PdfSvg` as a valid child of `PdfPage` and `PdfView`, the
rejection of `PdfSvg` directly inside `PdfText`, leaf shapes staying childless,
and coercion of kebab-case SVG attributes (`stroke-width`) to the camelCase
prop names (`strokeWidth`) the engine reads.

SVG props are camelCase and, on SVG nodes, override `style`; `transform` is a
prop on SVG primitives (unlike `PdfView`, where it is a style key). A `url(#id)`
reference resolves only against a `PdfDefs` child in the same `PdfSvg` subtree;
a dangling reference yields no fill, which differs from browser SVG. Not claimed
within SVG: `Marker` (`markerStart`/`markerMid`/`markerEnd`), non-default
`gradientUnits` and `preserveAspectRatio` beyond the tested defaults, and SVG
image files as an image source.

### Vue and Nuxt authoring

The 0.1.0 tests verify:

- `PdfDocument`, `PdfPage`, `PdfView`, `PdfText`, `PdfImage`, `PdfLink`, and
  `PdfNote`;
- one compile-time `definePdf` definition per PDF template;
- template components with typed props and slots;
- deterministic `pdfs/**/*.vue` discovery, reserved-directory exclusion,
  nested keys, collisions, and project-over-layer precedence;
- generated typed `#pdf` access, including negative type fixtures for missing
  props, extra props, invalid props, and invalid template keys;
- one render execution shared by byte, buffer, stream, and `Response`
  conversions;
- template attribution on failure: every error surfaced from a template's
  `render()` is a `NuxtPdfError` carrying `templateKey` and `templateFile` and a
  message prefixed with the template name and source file (`pdfs/…`), and
  invalid-nesting warnings emitted during that render are prefixed with the same
  template context. Font-resolution failures surface as a single
  `PDF_LAYOUT_ERROR` (font resolution is a layout sub-stage) whose message
  preserves React PDF's exact "Font family not registered" text rather than a
  separate font-error code;
- safe PDF response headers and filename sanitization;
- development preview index, viewer, raw PDF, and named scenarios;
- a production Nitro route rendering through the generated registry;
- absence of development preview behavior in production; and
- absence of React PDF engine code from the Nuxt client bundle and React
  renderer runtimes from production dependencies.

### Table of contents, internal links, and bookmarks

Nuxt PDF resolves table-of-contents page numbers with a multi-pass layout loop
and exposes it through one composable and existing props. The tested boundary:

- **`usePdfPageNumbers()`** — an auto-imported composable returning a readonly,
  reactive `Record<string, number | undefined>` mapping each destination `id` to
  the 1-based page it finally lands on. On the first pass every entry is
  `undefined`, so templates must tolerate a missing number. The composable is
  auto-injected into a PDF SFC that uses it (verified by compiling the real
  `playground/pdfs/report.vue` and by inject/skip unit tests).
- **Activation gate.** The multi-pass loop runs only when a template calls
  `usePdfPageNumbers()` during mount — the only feature that consumes resolved
  page numbers. Internal `#id` links do **not** activate it: a named destination
  resolves by name in a single pass. Every other document — links included —
  renders through the single-pass path at no added cost, verified by a spy
  asserting the multi-pass entry point is not called for a plain document nor for
  a link-only document whose destination still resolves. Calling
  `usePdfPageNumbers()` outside a PDF render throws instead of returning a map
  that could be mistaken for first-pass state.
- **Convergence.** The loop is a fixed point: it re-lays-out the same mounted
  tree, feeding each pass's `id → page` map back through the composable, until the
  map it produces equals the map it was laid out with. An ordinary document
  converges in two passes. A document whose layout depends on the numbers it
  prints (a TOC entry whose height changes with its page number) never converges
  and, after `maxPasses` (a validated positive integer on `definePdf`, default 5),
  raises a `PDF_LIMIT_EXCEEDED` `NuxtPdfError` attributed to the template key and
  file through the same boundary as every other render failure.
- **Named destinations resolve to a section's first page.** A node's `id` becomes
  a named destination; a `PdfLink` `src="#id"` jumps to it. When the id sits on a
  node that spans a page boundary, both the printed number and the jump target
  resolve to the section's **first** page (a deliberate divergence from React PDF,
  whose last-writer-wins destination table points at the last page). This holds on
  both render paths — verified by page-spanning regression fixtures asserting the
  printed number and the pdfjs destination independently, through the multi-pass
  loop and through the single-pass path. The anchoring is copy-on-write, so a
  `fixed` node repeated on every page (which pagination represents as one shared
  node object) keeps its destination, anchored at its first page.
- **Internal links** are verified paired against React PDF on non-splitting
  targets (where first- and last-page resolution agree): matching `Link`
  annotations and matching named-destination pages.
- **Bookmarks (outline).** The upstream `bookmark` prop (a string or
  `{ title, expanded, … }`) on `PdfPage`/`PdfView`/`PdfText`/`PdfImage` builds a
  nested PDF outline. Verified paired against React PDF via pdfjs `getOutline`
  (React PDF is the oracle for the bookmark→outline mechanics), and combined with
  the multi-pass loop: two independent renders produce an identical outline, and
  the loop resets each pass's authored `bookmark` so the in-place resolution
  `resolveBookmarks` performs cannot accumulate a stale hierarchy — a fixture
  whose bookmark ancestry shifts across passes fails without the reset, and the
  snapshot is merged before every pass, so a bookmark that first appears mid-loop
  (behind a resolved page number) is captured with its authored value too.
- A **reviewed raster baseline** of a realistic report's TOC page, following the
  same `UPDATE_PDF_BASELINES` policy and thresholds as the other paired fixtures.

### Local resources

The module validates and embeds configured resources during the Nuxt build.
The tested boundary includes:

- PNG and JPEG extension/signature validation and source byte limits;
- TTF and OTF signature validation, registration validation, and source byte
  limits;
- explicit local `pdfs/assets` and `pdfs/fonts` roots;
- rejection of absolute paths, traversal, missing assets, ambiguous sources,
  unsupported URLs, and symlink escapes; and
- font rendering after its source file is removed, and image resolution from
  embedded bytes without a runtime filesystem fallback.

This is a fail-closed local-resource boundary, not a general remote-fetching
or filesystem sandbox claim.

### Opt-in remote resources

Remote fetching is off by default: with `pdf.remote` absent the module performs
zero network I/O and every URL image or font source fails closed, exactly as in
0.1.0. When an operator configures `pdf.remote.allow`, the module — never React
PDF's engine — fetches allowlisted resources and converts them to the same
embedded form as local assets before layout or the font store sees a URL. The
tested boundary guarantees:

- `https://` only; `http://`, embedded credentials, and non-matching hosts,
  ports, or path prefixes are blocked. An allowlist entry is an explicit host
  (or a single leading `*.` subdomain wildcard on a registrable domain) plus a
  pathname prefix; prefixes match only on path-segment boundaries, and the query
  string is ignored for matching but preserved for the fetch. Wildcards on the
  most common public suffixes (`*.co.uk`, `*.github.io`, …) are rejected at
  setup; the list is deliberately non-exhaustive and the allowlist remains the
  operator's trust decision. Error messages redact query strings.
- Redirects are followed manually and the allowlist is re-checked on every hop
  (bounded to five), so an allowlisted host cannot redirect out of the allowlist.
- Byte caps reuse the local image (10MB) and font (5MB) limits and are enforced
  from `Content-Length` and while streaming a body with no `Content-Length`; the
  stream is aborted the moment the cap is exceeded.
- The byte signature is authoritative: a deceptive `Content-Type` cannot make
  non-image or non-font bytes validate (PNG/JPEG for images, TTF/OTF for fonts;
  SVG and font collections stay rejected).
- Fetches are `GET` only, send no request headers, and carry no credentials; a
  per-hop timeout (default 10s) covers the body read.
- Remote images resolve at render time with per-render deduplication (a repeated
  URL is fetched once, with no cross-render cache); remote fonts resolve at build
  time and embed as the same `data:font/...` URL as local fonts, keeping the
  render path zero-network.

These are intentional Nuxt-PDF-only guarantees. React PDF has no allowlist,
timeout, byte cap, or per-hop redirect policy, so the blocked, oversized,
redirect, timeout, and unconfigured behaviors have no React oracle; once the
policy admits bytes they take the same embedded-bytes path the local-image
conformance fixture already rasters against React. Not claimed: authenticated
fetches, request headers or bodies, cookies/credentials, private-IP or DNS
rebinding protection beyond the allowlist, and any cross-render caching.

## Explicitly not claimed in 0.1.0

- Full React PDF component, hook, browser-helper, or test-suite parity.
- React runtime compatibility or React-shaped dynamic callback results.
- Asynchronous dynamic text; callbacks return only scalar text or numbers.
- A `lineHeight` multiplier applied to dynamic text. Dynamic text renders with
  font-default line spacing regardless of an inherited or explicit `lineHeight`;
  the multiplier is intentionally not applied, because the upstream engine
  re-resolves dynamic-node styles during pagination and cannot carry an absolute
  `lineHeight` through. Static `PdfText` honors `lineHeight` normally.
- Browser-side or edge-runtime rendering. The engine is Node server-only.
- Nuxt 3, Node 20, or versions outside the table above.
- Authenticated remote fetches, request headers/bodies, credentialed requests,
  proxies, or private-IP/DNS-rebinding protection. Opt-in allowlisted remote
  images and fonts are claimed above under "Opt-in remote resources".
- SVG image files (as an image source), SVG `Marker`, and non-default
  `gradientUnits`/`preserveAspectRatio`. SVG drawing primitives are otherwise
  claimed above.
- Browser CSS, HTML printing, a PDF stylesheet compiler, or paged-media CSS.
- A first-class table layout engine, charts, forms, signing, editing, or PDF
  merging. A table of contents is authored from ordinary components; there is no
  TOC component or automatic heading collection.
- Bookmark destination geometry (`top`/`left`/`zoom`/`fit`) and outline click
  actions beyond title text and parent/child nesting; the outline is verified by
  its title hierarchy via pdfjs `getOutline`.
- Multi-pass resolution of anything other than destination page numbers, and
  convergence for documents whose geometry depends on the numbers they print
  (these fail closed with `PDF_LIMIT_EXCEEDED`, they are not made to converge).
- Tagged PDF, PDF/UA, archival, or other accessibility/compliance profiles.
- Deterministic PDF bytes across operating systems or PDF viewers.
- Hard render cancellation, worker isolation, concurrency guarantees, output
  byte limits, decoded-pixel limits, or maximum-page enforcement.
- Visual equivalence beyond the paired fixture, pinned inputs, and tested
  raster environment.

## Verification

Run the complete repository gate with:

```bash
pnpm verify
```

The most direct compatibility evidence is in `test/conformance.test.ts`.
Renderer behavior, generated types, Nuxt development and production builds,
resource policy, and dependency boundaries are protected by the remaining
tests and verification scripts. A new public compatibility claim belongs in
this document only after an executable fixture protects it.
