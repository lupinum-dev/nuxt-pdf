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
- Remote images or fonts, redirects, host allowlists, or authenticated fetches.
- SVG image files or SVG drawing primitives.
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
