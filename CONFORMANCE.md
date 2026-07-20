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
- dynamic text (page-number footers) rendering at correct page-bottom geometry
  even when an ancestor `PdfPage` or `PdfView` sets `lineHeight` — matching the
  static equivalent, where upstream React PDF instead drops the footer;
- a local Roboto TTF and local PNG;
- an external link annotation; and
- equivalent extracted text, link annotations, page count, and a thresholded
  page-by-page raster comparison for this fixture.

Renderer tests separately cover insertion, removal, keyed movement, prop and
text updates, primitive resolution, rejection of invalid roots, and exclusion
of orphan text from the document tree.

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
  pathname prefix; the query string is ignored for matching but preserved for
  the fetch.
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
  merging.
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
