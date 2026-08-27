# Nuxt PDF 0.4.0-beta.2 conformance

Nuxt PDF claims behavioral compatibility for a deliberately small, tested
corpus. It does not claim full React PDF API or test-suite compatibility.

## Version boundary

| Layer | 0.4.0-beta.2 boundary |
|---|---|
| Node.js | `^22.14.0`, `^24.0.0`, or `^26.0.0` |
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
text updates, primitive resolution, rejection of invalid roots, and fail-closed
rejection of non-whitespace orphan text without echoing its content.

Dynamic text (page-number footers) renders at correct page-bottom geometry even
when a `lineHeight` reaches it from `PdfPage` or a nested `PdfView`
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
  page text; direct SVG `fill` is raster-proven independently rather than
  relying on page-flow `style.color`; and
- equivalent extracted page text plus a thresholded page raster comparison
  against React output and a reviewed committed baseline.

Renderer tests separately cover the SVG nesting rules: which primitives each
container accepts, `PdfSvg` as a valid child of `PdfPage` and `PdfView`, the
rejection of `PdfSvg` directly inside `PdfText`, leaf shapes staying childless,
closed per-primitive prop allowlists, required props (with numeric zero treated
as present), numeric/range/viewBox/transform validation, page-flow versus SVG
text props, `PdfTspan`'s `x`/`y`/`fill`-only boundary, and coercion of kebab-case
SVG attributes (`stroke-width`) to the camelCase prop names (`strokeWidth`) the
engine reads.

SVG presentation uses direct camelCase props; `PdfG` and shapes do not expose a
generic style prop. `PdfSvg.style` is page-flow sizing/positioning, SVG
`PdfText.style` is for text metrics, and direct `fill` controls SVG text paint.
`transform` is a direct prop on groups/shapes (unlike `PdfView`, where it is a
style key) and is limited to one to three unitless translate/rotate operations.
A `url(#id)` resolves only against the single `PdfDefs` in the same `PdfSvg`;
definition ids are safe, unique within that SVG, reusable in other SVGs, and
separate from destination ids. Missing, malformed, or incompatible fill/clip
references fail with `PDF_TREE_INVALID`.

Vue-only raster regressions additionally prove the intentional zero-value
repair at the serialization boundary: `fillOpacity: 0` is transparent,
`strokeWidth: 0` paints no PDF hairline, linear `x2: 0` stays zero, and radial
`cx`/`cy`/`fx`/`fy`/`r` zeroes stay zero after layout resolves definitions.
`strokeOpacity` paint is independently raster-proven. Not exposed within SVG:
`Marker` (`markerStart`/`markerMid`/`markerEnd`), alternate gradient coordinate
systems/transforms/inheritance, and `preserveAspectRatio` modes. SVG image files
are not supported as an image source.

### Behavioural conformance corpus

A themed corpus under `test/corpus/` renders each fixture through both React PDF
(`renderToBuffer`) and the Vue renderer from one shared, renderer-agnostic data
module, so any divergence is the renderer boundary. Claims are proven by
extracted text, per-page marker positions, laid-out box geometry, annotation and
catalog reads and, for visual claims, React/Vue raster parity plus
reviewed baselines.

**Pagination** (`test/corpus/pagination.test.ts`):

- `wrap={false}` does not paginate: the single page grows taller than A4 to hold
  all overflow (nothing clipped or dropped), and Vue's grown MediaBox equals
  React's exactly (reviewed raster baseline);
- `break` on nested wrapped Views lands each block on its own page;
- `minPresenceAhead` pushes a bottom-of-page heading onto the next page to rejoin
  its block, versus the control that strands it;
- `orphans`/`widows` split a wrapped paragraph at the same line boundary as React;
- a `fixed` header and footer repeat on every page of a multi-page flow while the
  body advances; and
- dynamic page-number footers (`{ pageNumber, totalPages }`) are correct on every
  page of a wrapped flow. A page-count-derived computed oracle proves this claim
  because React PDF diverges on dynamic-text line spacing (see the kernel note).

**Text** (`test/corpus/text.test.ts`):

- a custom `hyphenationCallback` introduces break opportunities so a long token
  wraps with trailing hyphen glyphs, versus a disabled callback that leaves it
  unbroken and overflowing;
- `letterSpacing` widens glyph advances and changes wrapping;
- `textAlign` left/center/right shifts line origins and `justify` fills interior
  lines while the last line keeps its natural advance (raster parity);
- nested style inheritance and inline `fontFamily` switching resolve the correct
  embedded font per run and inherit color across wraps (raster parity);
- German umlauts, eszett, and Latin-extended diacritics round-trip through text
  extraction; and
- `maxLines` with `textOverflow: 'ellipsis'` clamps to the line count and appends
  the ellipsis (U+2026).

**International typography** (`test/international-text.test.ts`):

- Latin Extended, Greek, and Cyrillic render and extract exactly with an
  explicitly registered covering font;
- representative Chinese/Japanese text renders, extracts, and matches a
  reviewed raster with a test-only Noto subset (experimental broader CJK claim);
- representative Arabic shapes visually, reports an RTL text run, and exposes
  the expected bidi extraction reorder (experimental);
- combining marks render correctly but extraction can detach mark association
  (experimental);
- a variable Source Code TTF renders and extracts at its default instance
  (experimental; no axis-selection API); and
- face emoji fail faithful serialization and are explicitly unsupported.

`PdfRenderDiagnostics.registeredFontFaces` reports only configured family,
weight, and style. Missing-glyph detection and family fallback chains are not
claimed.

**Images** (`test/corpus/images.test.ts`):

- JPEG file paths, base64 `data:` URLs, and `{ data, format }` buffer sources all
  decode in the lower-engine paired fixture. The public resource boundary
  accepts bundled paths, admitted byte sources, and allowlisted HTTPS images;
  it blocks `data:` URL strings on every public render path;
- explicit width+height, single-dimension aspect scaling, and percent width
  against the page content box size the laid-out box (reviewed baseline);
- `objectFit` `contain` letterboxes and `cover` crops while the box stays fixed
  (reviewed baseline); and
- an image in a `fixed` header repeats once per page.

**Styles and layout** (`test/corpus/styles.test.ts`):

`PdfStyle` is a framework-owned contract, not a re-export of the wider upstream
stylesheet types. Real TypeScript and Vue SFC negative fixtures reject unknown
keys, unsupported units/values, and invalid style-array entries; runtime props
remain independently closed because Vue fallthrough attrs can escape static
checking.

- flexbox with `row` or `column` direction, `flexGrow`, `flexBasis` and `flexShrink`,
  `justifyContent: space-between`, `alignItems: center`, and `gap`;
- percent width/height against page and nested parent boxes;
- resolved margin/padding/border on every edge and border-box offset;
- style-array flattening with `false`/`null`/`undefined` entries filtered, equal to
  the merged object form;
- `fontFamily`/`fontSize`/`color` cascading through nested Views into Text with
  own-value override; and
- `backgroundColor`, `opacity` alpha-blending, a stroked `border`, and a
  `rotate`/`scale`/`translate` `transform` that paints transformed while the layout
  box stays invariant (raster parity for the painted claims). React's own resolved
  layout tree (`onRender`) is the geometry oracle; every scenario asserts identical
  ordered boxes and an independent numeric oracle on both sides.

**Annotations, metadata, and page setup** (`test/corpus/annotations.test.ts`):

- external `https` and `mailto` `PdfLink` annotations round-trip their `url` and
  `unsafeUrl` verbatim;
- `PdfNote` renders as a `Text` sticky-note annotation carrying its contents;
- document metadata (title, author, subject, keywords, creator, producer,
  creation date, language, PDF version) round-trips through the info dictionary;
- `pdfVersion` and `pageLayout` flow into the catalog (`TwoColumnLeft`, format
  version `1.5`); and
- A4, Letter, custom `[w, h]` and `{ width, height }`, landscape, and
  `px`-with-`dpi` page sizes resolve to the same MediaBox as React and as a
  hand-computed oracle.

### Vue and Nuxt authoring

The 0.4.0-beta.2 tests verify:

- `PdfDocument`, `PdfPage`, `PdfView`, `PdfText`, `PdfImage`, `PdfLink`, and
  `PdfNote`;
- one compile-time `definePdf` definition per PDF template;
- template components with typed props and slots;
- deterministic `pdfs/**/*.vue` discovery, reserved-directory exclusion,
  nested keys, collisions, and project-over-layer precedence;
- generated typed `#pdf` access, including negative type fixtures for missing
  props, extra props, invalid props, and invalid template keys;
- framework-owned `PdfStyle` and exact primitive prop types checked through a
  real Vue SFC, plus closed per-primitive runtime allowlists that reject
  unknown, DOM/event, removed, and wrong-host props without echoing values;
- a required `src` for `PdfImage`, a required `href` for `PdfLink` (an `href`
  starting with `#` is an internal destination), and context-specific
  page-flow/SVG `PdfText` invariants;
- one completed render held behind immutable byte, buffer, and `Response`
  conversions, with exact frozen resolved metadata and one frozen, content-free
  diagnostics object shared by the public result and development preview; the
  preview calls the exact public `render(props)` path once and parks that
  completed result rather than re-evaluating metadata or using a second preview
  renderer;
- a closed public `PdfTemplate` handle containing exactly `key`,
  `resolveMetadata(props)`, and `render(props)`. It never contains the compile-time
  definition, sample data, scenarios, source path, or a preview render method;
- `definePdf` title/language precedence over `PdfDocument` fallback props,
  including reapplication after every page-number feed in a multi-pass render;
  completed `result.metadata` reports the title/language actually written into
  the PDF after that precedence, plus the resolved download filename (the
  filename is response metadata, not a PDF Info field);
- template attribution on failure: every error surfaced from a template's
  `render()` is a `NuxtPdfError` carrying `templateKey`; development renders
  also carry `templateFile` and a message prefixed with the source file
  (under `pdfs/`), while production omits that preview-only path. Invalid
  nesting fails with `PDF_TREE_INVALID`; it never returns a partial document or
  downgrades the failure to a warning. Font-resolution failures surface as a single
  `PDF_LAYOUT_ERROR` (font resolution is a layout sub-stage) whose message
  preserves React PDF's exact "Font family not registered" text rather than a
  separate font-error code;
- safe PDF response headers: bounded Unicode-safe filename sanitization, a
  default `document.pdf` attachment name, exact `content-length`, and forced PDF
  content type;
- development preview index, viewer, raw PDF, and named scenarios, backed by a
  separate internal development sidecar;
- a production Nitro route rendering through the generated registry;
- structural removal of `sampleData` and `scenarios` during production SFC
  compilation, with unique fixture canaries and preview-only API tokens rejected
  by a recursive scan of the emitted Nitro server artifact; metadata follows
  module-scope macro rules, so imports are supported while setup-local bindings
  fail compilation before they can leak or throw at runtime;
- absence of development preview behavior in production; and
- absence of React PDF engine code from the Nuxt client bundle and React
  renderer runtimes from production dependencies.

### Table of contents, internal links, and bookmarks

Nuxt PDF resolves table-of-contents page numbers with a multi-pass layout loop
and exposes it through one composable and existing props. The tested boundary:

- **`usePdfPageNumbers()`** is an auto-imported composable that returns a readonly,
  reactive `Record<string, number | undefined>` mapping each destination `id` to
  the 1-based page it finally lands on. On the first pass every entry is
  `undefined`, so templates must tolerate a missing number. The composable is
  auto-injected into a PDF SFC that uses it (verified by compiling the real
  `playground/pdfs/report.vue` and by inject/skip unit tests).
- **Activation gate.** The multi-pass loop runs only when a template calls
  `usePdfPageNumbers()` during mount. It is the only feature that consumes resolved
  page numbers. Internal `#id` links do **not** activate it: a named destination
  resolves by name in a single pass. Every other document, including a document with links,
  renders through the single-pass path at no added cost, verified by a spy
  asserting the multi-pass entry point is not called for a plain document nor for
  a link-only document whose destination still resolves. Calling
  `usePdfPageNumbers()` outside a PDF render throws instead of returning a map
  that could be mistaken for first-pass state.
- **Convergence.** The loop is a fixed point: it re-lays-out the same mounted
  tree, feeding each pass's destination-page map back through the composable, until the
  map it produces equals the map it was laid out with. After every feed the live
  tree is re-admitted. Tree limits, metadata reapplication, and image/resource
  policy run again against that exact tree. Therefore, conditional content introduced by
  page numbers cannot bypass admission. An ordinary document converges in two
  passes. A document whose layout depends on the numbers it prints (a TOC entry
  whose height changes with its page number) never converges and, after
  `maxPasses` (a validated positive integer on `definePdf`, default 5), raises a
  `PDF_LIMIT_EXCEEDED` `NuxtPdfError` attributed to the template key and file
  through the same boundary as every other render failure.
- **Named destinations resolve to a section's first page.** A node's `id` becomes
  a named destination; a `PdfLink` `href="#id"` jumps to it. When the id sits on a
  node that spans a page boundary, both the printed number and the jump target
  resolve to the section's **first** page (a deliberate divergence from React PDF,
  whose last-writer-wins destination table points at the last page). This holds on
  both render paths. Page-spanning regression fixtures verify the
  printed number and the pdfjs destination independently, through the multi-pass
  loop and through the single-pass path. The anchoring is copy-on-write, so a
  `fixed` node repeated on every page (which pagination represents as one shared
  node object) keeps its destination, anchored at its first page.
- **Internal links** are verified paired against React PDF on non-splitting
  targets (where first- and last-page resolution agree): matching `Link`
  annotations and matching named-destination pages. An internal `#id` that does
  not match any destination in the mounted document fails closed with
  `PDF_TREE_INVALID` before layout. A `PdfDocument` without at least one
  `PdfPage` likewise fails closed.
- **Bookmarks (outline).** The upstream `bookmark` prop (a string or
  `{ title, expanded }`) on `PdfPage`, `PdfView`, `PdfText`, or `PdfImage` builds a
  nested PDF outline. Verified paired against React PDF via pdfjs `getOutline`
  (React PDF is the oracle for the bookmark-to-outline mechanics), and combined with
  the multi-pass loop: two independent renders produce an identical outline, and
  the loop resets each pass's authored `bookmark` so the in-place resolution
  `resolveBookmarks` performs cannot accumulate a stale hierarchy. A fixture
  whose bookmark ancestry shifts across passes fails without the reset, and the
  snapshot is merged before every pass, so a bookmark that first appears mid-loop
  (behind a resolved page number) is captured with its authored value too.
- A **reviewed raster baseline** of a realistic report's TOC page, following the
  same `UPDATE_PDF_BASELINES` policy and thresholds as the other paired fixtures.

### Local resources

The module validates configured resources during the Nuxt build. Production
builds embed validated image bytes in the server bundle; development builds
point at the source files and re-read them per render, so an edited image
shows up without a restart. The tested boundary includes:

- PNG and JPEG extension/signature validation and source byte limits;
- TTF, OTF, and WOFF2 signature/extension/structure validation,
  registration validation, source byte limits, and source-removal rendering;
- explicit local `pdfs/assets` and `pdfs/fonts` roots;
- rejection of absolute paths, traversal, missing assets, ambiguous sources,
  unsupported URLs, and symlink escapes; and
- font rendering after its source file is removed, and image resolution from
  embedded bytes without a runtime filesystem fallback.

This is a fail-closed local-resource boundary, not a general remote-fetching
or filesystem sandbox claim.

### Opt-in remote images

Remote fetching is off by default: with `pdf.remote` absent the module performs
zero network I/O and every URL image source fails closed. Remote fonts are
unconditionally rejected. When an operator configures `pdf.remote.allow`, the
module fetches allowlisted images and converts them
to bytes before layout. The tested boundary guarantees:

- Allowlist entries are exact `https://host/path/` prefixes. `http://`, wildcard
  hosts, embedded credentials, fragments, missing trailing slashes, and
  non-matching hosts, ports, or paths are blocked. Runtime errors expose only
  scheme/host and redact the path, query, and fragment.
- Redirects are followed manually and the allowlist is re-checked on every hop
  (bounded to three), so an allowlisted host cannot redirect out of the allowlist.
- `pdf.limits` is the only source for per-image and aggregate byte/pixel caps,
  request count, concurrency, output size, and the whole-render deadline. Source
  byte caps are enforced from `Content-Length` and while streaming; fatal
  failures abort sibling requests.
- The byte signature is authoritative: a deceptive `Content-Type` cannot make
  non-image bytes validate. PNG/JPEG structure and dimensions are inspected
  before decode or engine admission; SVG stays rejected.
- Fetches are `GET` only, send no request headers, and carry no credentials; a
  per-hop timeout (default 10s) covers the body read.
- Remote images resolve at render time with per-render deduplication (a repeated
  URL is fetched once, with no cross-render cache).

These are intentional Nuxt-PDF-only guarantees. React PDF has no allowlist,
timeout, byte cap, or per-hop redirect policy, so the blocked, oversized,
redirect, timeout, and unconfigured behaviors have no React oracle; once the
policy admits bytes they take the same embedded-bytes path the local-image
conformance fixture already rasters against React. Not claimed: authenticated
fetches, request headers or bodies, cookies/credentials, remote fonts,
private-IP or DNS rebinding exceptions, and any cross-render caching.

### Render limits

Every render is bounded by the operator-overridable `pdf.limits` fields below,
enforced identically on the single-pass and multi-pass paths through one shared
pipeline (`test/limits.test.ts`). Defaults apply when a field is omitted; every
field is a positive safe integer validated at module setup.

| Field | Default | When checked |
| --- | --- | --- |
| `timeoutMs` | `30_000` | Whole public render deadline, started before metadata evaluation |
| `maxPages` | `2_000` | After each layout, before serialization |
| `maxNodes` | `50_000` | Post-mount tree walk (and after every multi-pass feed) |
| `maxTreeDepth` | `128` | Post-mount tree walk (and after every multi-pass feed) |
| `maxTextCharacters` | `2_000_000` | Post-mount tree walk (and after every multi-pass feed) |
| `maxImages` | `256` | Post-mount tree walk (and after every multi-pass feed) |
| `maxImageBytes` | `10_485_760` | Per unique image before engine admission |
| `maxTotalImageBytes` | `33_554_432` | Aggregate unique images for the render |
| `maxImagePixels` | `25_000_000` | Per unique image before engine admission |
| `maxTotalImagePixels` | `100_000_000` | Aggregate unique images for the render |
| `maxRemoteRequests` | `32` | Remote fetch accounting, including redirect hops |
| `maxRemoteConcurrency` | `4` | Simultaneous remote HTTP requests |
| `maxOutputBytes` | `67_108_864` | Completed PDF byte buffer before result handoff |

Exceeding a limit fails closed with `PDF_LIMIT_EXCEEDED`. Tree/node/text/image-count
checks are **post-mount rejection**: Vue has already mounted the tree, so they do
not create hard memory isolation before mount. Image byte/pixel and remote
accounting share one render-wide state across multi-pass feeds. `timeoutMs` is a
checked deadline polled between engine stages, not mid-step hard cancellation.

### Serverless build

The module builds under a serverless Nitro preset (`test/serverless-build.test.ts`
builds the basic fixture with `NITRO_PRESET=vercel`): the build succeeds, the
React PDF engine lands in the server function bundle, the `.vercel/output`
serverless structure is emitted, and no React renderer runtime leaks into the
bundle. This claims exactly that it **builds** under the vercel preset;
execution is verified on node-server (`test/production.test.ts`). The Vercel
runtime is not executed locally.

### Testing utilities

The verification helpers this suite runs on ship as `@lupinum/nuxt-pdf/test`.
They live in `src/test/`; repository tests import that canonical implementation
directly, and the package bundles it as the public test entry. There is one
parser, not two. Claimed:

- `parsePdf` accepts PDF bytes or a `PdfRenderResult` and returns page text,
  page count, flattened link annotations (named destination or external URL),
  and the outline via pdfjs;
- `expectPdf` runner-agnostic assertions (`toHavePageCount`, `toContainText`,
  `toHaveLink`, `toHaveOutline`) that throw a `PdfAssertionError` without a Vitest or
  jest dependency;
- `renderPdfTemplate`, which renders a Vue PDF component through the real
  registry pipeline (assets, fonts, single- or multi-pass layout) without Nuxt,
  with or without `definePdf` metadata;
- `renderPdfSfc`, which uses the production SFC compiler and resource admission
  path for a real nested `pdfs/*.vue` graph;
- `rasterizePdf` and `comparePdfSnapshot`, the reviewed per-page PNG baseline
  flow with an `UPDATE_PDF_BASELINES` update mode; and
- `pdfjs-dist` and `@napi-rs/canvas` as optional peer dependencies, loaded
  lazily with an actionable install error and absent from the module's
  production dependency graph.

Verified end-to-end against a real rendered template, including assertion
failure messages, in `test/test-utils-public.test.ts`.

## Explicitly not claimed in 0.4.0-beta.2

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
  images are claimed above. Remote fonts are not supported.
- SVG image files (as an image source), SVG `Marker`, alternate gradient
  coordinate systems/transforms/inheritance, and `preserveAspectRatio` modes.
  Radial-gradient inner radius (`fr`) is also absent because the pinned renderer
  hardcodes it to zero. SVG drawing primitives are otherwise claimed above.
- `wordSpacing` authoring. The pinned `@react-pdf/layout` + textkit pipeline does
  not apply it to wrapping or glyph advances, so Nuxt PDF leaves the no-op
  property out of `PdfStyle`. Use the verified `letterSpacing` property instead.
- Browser CSS, HTML printing, a PDF stylesheet compiler, or paged-media CSS.
- A first-class table layout engine, charts, forms, signing, editing, or PDF
  merging. A table of contents is authored from ordinary components; there is no
  TOC component or automatic heading collection.
- Bookmark destination geometry (`top`/`left`/`zoom`/`fit`) and outline click
  actions are not exposed. Bookmark titles, expanded state, and parent/child
  nesting are verified; the title hierarchy is inspected via pdfjs
  `getOutline`.
- Multi-pass resolution of anything other than destination page numbers, and
  convergence for documents whose geometry depends on the numbers they print
  (these fail closed with `PDF_LIMIT_EXCEEDED`, they are not made to converge).
- Tagged PDF, PDF/UA, archival, or other accessibility/compliance profiles.
- PDF encryption. Password and permission props are not exposed without a
  conformance fixture proving their behavior.
- Deterministic PDF bytes across operating systems or PDF viewers.
- Hard render cancellation. The `pdf.limits.timeoutMs` budget is polled between
  engine stages and passes. Upstream layout is not abortable during a step, so a
  single engine stage can overshoot it; it is a checked deadline, not mid-step
  cancellation. The thirteen `pdf.limits` fields themselves are claimed above
  under "Render limits".
- Pre-mount memory isolation. `maxNodes`, `maxTreeDepth`, `maxTextCharacters`,
  and `maxImages` reject after Vue has mounted the tree; they are not a sandbox
  that prevents allocation during mount.
- Worker isolation or cross-render concurrency guarantees.
- Visual equivalence beyond the paired fixture, pinned inputs, and tested
  raster environment.

## Verification

Run the complete repository gate with:

```bash
pnpm check
```

The most direct compatibility evidence is in `test/conformance.test.ts`.
Renderer behavior, generated types, Nuxt development and production builds,
resource policy, and dependency boundaries are protected by the remaining
tests and verification scripts. A new public compatibility claim belongs in
this document only after an executable fixture protects it.
