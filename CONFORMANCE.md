# Nuxt PDF conformance

Nuxt PDF claims behavioral compatibility for a deliberately small, tested
corpus. It does not claim full React PDF API or test-suite compatibility.

## Version boundary

| Layer | Tested boundary |
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

### Standalone registry

`test/standalone-build.test.ts` compiles the production registry and removes
template, font, and image sources before rendering. It checks custom fonts,
Unicode, embedded images, long text, pagination, equivalent extracted content,
and concurrent prop isolation. Plain NodeNext TypeScript checks inferred inline
and imported props without Vue source. Invalid resources, render limits, failed
build preservation, and generated-directory ownership have focused tests. A
render of the generated registry starts exactly one render worker (counted in a
child process), and a style `@import` resolves inside `rootDir` and fails when
it leaves it.

This is local Node evidence, not a deployed Convex or serverless certification.
Largest-realistic-document sizing, cold/warm timing, and platform memory limits
remain application deployment checks. The existing Nitro path is unchanged.

### Compatibility kernel

The paired React/Vue fixture verifies:

- the Vue renderer produces the node contract consumed directly by layout;
- ordinary Vue components, props, slots, conditionals, and keyed lists;
- A4 layout, normal text flow, explicit page breaking, and two output pages;
- fixed content repeated across pages;
- `PdfPageNumber` and `PdfPageCount` tokens printed as per-page text;
- a local Roboto TTF and local PNG;
- an external link annotation; and
- equivalent extracted text, link annotations, page count, and a thresholded
  page-by-page raster comparison for this fixture.

Renderer tests separately cover insertion, removal, keyed movement, prop and
text updates, primitive resolution, rejection of invalid roots, and fail-closed
rejection of non-whitespace orphan text without echoing its content.

Dynamic text (page-token footers) renders at correct page-bottom geometry even
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
rejection of `PdfSvg` directly inside `PdfText`, text or an element inside a
leaf shape failing with its name and source position,
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
- a `break` on a node with only `fixed` content before it on its page is
  ignored, so it adds no empty page, also on the first node of a `PdfPage`.
  React PDF adds an empty page there; we differ on purpose (D20 in
  `internals/decisions.md`;
  `test/invariants/regressions/flow-g2-page-starts-with-break-adds-empty-page.json`);
- `minPresenceAhead` pushes a bottom-of-page heading onto the next page to rejoin
  its block, versus the control that strands it;
- `orphans`/`widows` split a wrapped paragraph at the same line boundary as React;
- a `fixed` header and footer repeat on every page of a multi-page flow while the
  body advances; and
- page-token footers (`PdfPageNumber` and `PdfPageCount` inside a `fixed`
  `PdfText`) are correct on every page of a wrapped flow. A page-count-derived computed oracle proves this claim
  because React PDF diverges on dynamic-text line spacing (see the kernel note).

**Text** (`test/corpus/text.test.ts`):

- the default hyphenation breaks a long token with trailing hyphen glyphs,
  versus `hyphenate: false`, which keeps every word whole so the token stays
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
- an image in a `fixed` header repeats once per page, and its bytes are
  embedded once per document (`test/server-runtime.test.ts`).

**Styles and layout** (`test/corpus/styles.test.ts`):

`PdfStyle` is a framework-owned contract, not a re-export of the wider upstream
stylesheet types. Real TypeScript and Vue SFC negative fixtures reject unknown
keys, unsupported units/values, and invalid style-array entries; runtime props
remain independently closed because Vue fallthrough attrs can escape static
checking.

A style value must keep the sign rule of its key (`PDF_STYLE_SIGNS`): sizes,
paddings, border widths and radii, gaps, flex factors, `fontSize` and
`lineHeight` are 0 or more, `opacity` is from 0 to 1, and margins, insets,
`letterSpacing` and transforms may be negative. One function checks it for
`:style`, `v-bind()` and the `<style>` block (build time). `flex` and
`maxLines` have no sign rule. Every `PDF_TREE_INVALID` message of the tree
validation names the element (with its `id`), the prop or style key and the
wrong value, cut at 40 characters, and never a password or node text
(`test/renderer.test.ts`, "tree validation messages"); the invariant harness
checks each of its fault kinds against the message of its own check
(`internals/harness-r1/h4-invalid-limits.md`).

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

The tests verify:

- `PdfDocument`, `PdfPage`, `PdfView`, `PdfText`, `PdfImage`, `PdfLink`, and
  `PdfNote`;
- plain `<style>` blocks in PDF templates and their local components
  (`test/pdf-style.test.ts`): class, compound (`.a.b`) and descendant
  (`.a .b`) selectors, compiled at build time to `PdfStyle` objects;
  shorthands (`margin`, `padding`, `border`, `border-*`, `border-width`,
  `border-radius`, `flex`, `margin-horizontal` and similar) expand to the
  longhands the engine reads, with units kept; `border` without a style
  writes `solid`, the style the engine paints. A rule with more classes in
  its matching selector wins, then stylesheet order, and `style` wins over
  every class (asserted on a rendered PDF). A descendant step matches the
  classed elements that enclose the element in the template of the same file,
  also through a dynamic `:class`; it does not reach into another component.
  A class applies in the file that wrote it, reaches the root of a local
  component and slot content. `<style scoped>`, invalid CSS, a type,
  child, sibling, pseudo, attribute, id, universal or nesting selector, an
  at-rule other than `@import`, a nested rule, `!important`, an unsupported
  property or value, a border color with alpha (the engine paints it in a
  wrong color), and a static class or a literal `:class` name that the file
  does not define fail the build with file, line and column; an unknown
  dynamic class fails the render with `PDF_TREE_INVALID`. File-local
  variables (`:root { --name: value }`, `var(--name)`) are substituted at
  build time like literal values, also inside shorthands and through other
  variables; an unknown variable, a `var()` fallback, a cycle, a variable
  outside `:root`, and a property inside `:root` fail the build. `v-bind()`
  reads a script binding, an import or a prop at render time, as a whole
  value of a declaration or a `:root` variable, also inside box and `border`
  shorthands; a bound `null` or `undefined` leaves the key out; a part that
  mixes text and `v-bind()`, an ambiguous shorthand, a `v-bind()` in an
  imported file, and a `v-for` alias or slot prop that hides the bound name
  fail the build. `@import` of a local `.css` file (relative or through a Nuxt
  alias, `test/module.test.ts`) adds its variables and rules before the
  importing file's; a URL, media or layer, an import after a rule, a missing
  file, a file outside the project directory and a cycle fail the build with
  the imported file's position; the bundler watches each imported file. A
  class that reaches a primitive outside a compiled template fails with
  `PDF_TREE_INVALID` (`test/renderer.test.ts`);
- `PdfTable`, `PdfTableHeader`, `PdfTableRow`, and `PdfTableCell`
  (`test/table.test.ts`, `test/invoice-playground.test.ts`): the header repeats
  at the top of every page of the table, every row prints once and in order,
  cells take their column and alignment, also when a cell sits inside a local
  component, and invalid tables fail with `PDF_TREE_INVALID`. `colspan` makes
  a cell as wide as the columns it covers (shares and fixed widths summed;
  `pt`, `in`, `mm` and `cm` converted to points), also in the header on every
  page, asserted from text positions; a row counts covered columns; a
  `colspan` that is not a whole number from 1 and a span over lengths in units
  that cannot be added fail. A table whose
  first page would hold only its header starts on the next page instead (the
  orphan rule; it applies to any view whose first fragment would hold only its
  `fixed` children). A row does not split across pages unless it sets `wrap`;
  a row that splits keeps every cell in its column on both pages, a row with
  fewer cells than columns leaves the rest empty at their width, and a cell's
  padding does not move a share column (invariant I9 on generated tables,
  `test/invariants/`);
- `pages` on `fixed` `PdfView` and flow `PdfText` (`test/table.test.ts`):
  `'all'`, `'first'` (first page of the parent only) and `'continuation'`
  (every later page of the parent). With an in-flow `'first'` node, the later
  pages of the parent are laid out like the document without the node, line
  by line (`test/layout-passes.test.ts`), at the cost of one more layout pass.
  With `'continuation'`, page 1 of the parent paints as if the node were
  absent, but its content can break up to one node height earlier, because
  the engine measures the rest of the document with the node present. An
  absolute node takes no flow space on any page. An absolute node keeps its
  offsets and can print page tokens. Invalid `pages` use (without `fixed`,
  nested, or with other content than views, texts and tokens) fails with
  `PDF_TREE_INVALID`;
- the layout warning `PDF_UNBREAKABLE_NODE_OVERFLOW` (`test/engine.test.ts`)
  for a block that cannot wrap and is higher than the usable page height, also
  when the engine shrank it to fit; the warning then reports the height the
  block needs. The PDF does not change;
- `PdfAttachment` (`test/attachment.test.ts`): a direct child of `PdfDocument`
  embeds string content (as UTF-8) or byte content as an embedded file with its
  name, MIME type, description and relationship (`Unspecified` by default);
  pdfjs reads the bytes back unchanged. String data that looks like a file path
  is embedded as that text; no file is read. The total size is bounded by
  `pdf.limits.maxTotalAttachmentBytes`. An attachment alone claims no
  e-invoice profile; see [PDF/A-3b and Factur-X](#pdfa-3b-and-factur-x);
- leaf primitives (`test/renderer.test.ts`): text or an element inside
  `PdfImage`, an SVG shape, `PdfStop`, a page token, `PdfAttachment` or
  `PdfFacturX` fails with `PDF_TREE_INVALID`, the leaf's name and the source
  position; whitespace and comments are accepted;
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
  applied to the mounted tree before validation, so the tagged checks see them;
  completed `result.metadata` reports the title/language actually written into
  the PDF after that precedence, plus the resolved download filename (the
  filename is response metadata, not a PDF Info field);
- template attribution on failure: every error surfaced from a template's
  `render()` is a `NuxtPdfError` carrying `templateKey`; development renders
  also carry `templateFile` and a message prefixed with the source file
  (under `pdfs/`), while production omits that preview-only path. In
  development, a tree error about one node and a layout warning also carry
  `source` (file, line and column of the template element); output compiled
  without the development option contains no position and no file path
  (`test/pdf-sfc-plugin.test.ts`). The preview links that position to the
  editor, shows the reason of a tree error, and draws the engine's layout boxes
  only behind its toggle (`test/server-runtime.test.ts`). In `nuxt dev`, a
  template or component that fails to compile keeps the server running: the
  preview shows the compiler message and position, a render gets
  `PDF_TEMPLATE_INVALID` with `source`, and a fixed file renders without a
  restart; a production build still fails (`test/module.test.ts`,
  `test/build.test.ts`). A missing module import and an invalid `definePdf`
  value still stop the development server. Adding or removing a template
  under `pdfs/` rebuilds the registry without a Nuxt restart. Invalid
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
- development guards for every global PDF component, including Nuxt
  auto-import misuse outside a PDF template;
- watched template rebuilds and whole-viewer refreshes that keep the selected
  scenario and replace document bytes with their matching diagnostics;
- a production Nitro route rendering through the generated registry;
- structural removal of `sampleData` and `scenarios` during production SFC
  compilation, with unique fixture canaries and preview-only API tokens rejected
  by a recursive scan of the emitted Nitro server artifact; metadata follows
  module-scope macro rules, so imports are supported while setup-local bindings
  fail compilation before they can leak or throw at runtime;
- absence of development preview behavior in production; and
- absence of React PDF engine code from the Nuxt client bundle and React
  renderer runtimes from production dependencies.

### PDF/A-3b and Factur-X

`conformance="PDF/A-3b"` on `PdfDocument`, or a `PdfFacturX` element, makes the
render write PDF 1.7, one escaped XMP packet with the PDF/A identification and
the document metadata, an sRGB output intent with an ICC profile built from
the published sRGB constants, and a MIME type on every embedded file
(`test/pdfa.test.ts`). A document with neither keeps its bytes (hash compared
with the engine before the change).

Evidence: veraPDF 1.30.4 (`verapdf/cli`, pinned by digest), flavour 3b,
reports PASS for two documents, run by `pnpm test:pdfa` and the CI job
`pdfa`. One holds registered-font text with umlauts, a fixed running head
with page numbers, an RGBA PNG, an external link, a table with a repeated
header over two pages, and a typed and an untyped attachment; the other is a
`PdfFacturX` invoice with the `EN 16931` profile and a synthetic CII file. A
document without a claim fails the same validator (negative control). The
playground invoice (`playground/pdfs/invoice.vue`) passes it too; that run is
manual, not part of CI.

`PdfFacturX` embeds the XML as `factur-x.xml` (`xrechnung.xml` for
`XRECHNUNG`) with MIME type `text/xml`, the relationship `Data` for `MINIMUM`
and `BASIC WL` and `Alternative` otherwise, and the Factur-X XMP extension
schema (`INVOICE`, file name, version `1.0`, profile). Fails with
`PDF_TREE_INVALID`: a text in a standard (not embedded) font, with its source
position, and a message that names the characters when the text asks for a
registered font that lacks them (the engine paints those in Helvetica), or
says that SVG text does not inherit `fontFamily` from the page; a
`pdfVersion` other than `1.7`; a `PdfNote` (no printable appearance); a
missing or unknown profile; XML that a linear scan finds not well-formed
(unclosed or crossed tags, text or a second element outside the root, an
unterminated comment, CDATA section or processing instruction, an unknown
entity, a DOCTYPE) or not UTF-8; a root element other than
`CrossIndustryInvoice`; a profile ID (BT-24, the element
`GuidelineSpecifiedDocumentContextParameter/ID`, not a comment or CDATA
section) that is missing or names another profile; a relationship other than
`Data`, `Alternative` or `Source`, or other than `Data` for `MINIMUM` and
`BASIC WL` (Factur-X 1.07.2, section 6.2.2); a second `PdfFacturX`; and a
`PdfAttachment` with the Factur-X file name. Any document fails for a
`creationDate` that is an Invalid Date or has a UTC year outside 0 to 9999.

### E-invoices: EN 16931, Factur-X and XRechnung

`computeEInvoice`, `validateEInvoice` and `renderEInvoiceXml` work on one
`EInvoice` object. `PdfFacturX` with `invoice` writes the CII XML for its
profile during the render, on the main thread before the attachment budget is
checked, so the written bytes count toward `maxTotalAttachmentBytes`
(`test/einvoice/component.test.ts`). Amounts are exact decimals (scaled
integers, never binary floating point); the VAT of each category is rounded
once on its total (`test/einvoice/compute.test.ts`, `decimal.test.ts`).

Profiles written from data: `MINIMUM`, `BASIC WL`, `BASIC`, `EN 16931` and
`XRECHNUNG` (XRechnung 3.0, CII syntax). `EXTENDED` with `invoice` fails with
`PDF_TREE_INVALID`; so do both or neither of `invoice` and `xml`, and an
`invoice` that is not an object. Invalid invoice data, a malformed value as
well as a broken EN 16931 or XRechnung rule, fails with `PDF_INVOICE_INVALID`
and `issues` (rule, field path, message) from `renderEInvoiceXml`,
`computeEInvoice` and a render, on the worker and the in-process path
(`test/einvoice/component.test.ts`, `test/worker-render.test.ts`). The rule
cases break one rule each and expect its rule ID and field path
(`test/einvoice/rule-cases.ts`, `validate.test.ts`); 52 of them also run through a validator (28 in
Mustang, 24 in KoSIT), which must report the same rule.

Evidence: `pnpm test:einvoice` (not part of `pnpm verify` or CI; it needs Java
17 and the validator files, checked by SHA-256) runs Mustang CLI 2.26.0 and
the KoSIT validator 1.6.3 with the XRechnung 3.0.2 validator configuration
2026-08-31. Both accept the XML of the fixed invoices in every profile
(KoSIT: `XRECHNUNG`) and of 40 generated invoices (fixed seed) over domestic
rates, zero and exempt lines, reverse charge, intra-community supply, export,
outside scope, allowances, charges, credit notes and every payment means.
Mustang accepts a rendered Factur-X PDF (PDF/A-3b part and XML) for each of
the five profiles and one with XML passed in `xml`. Faults put into valid
output must be rejected: XML faults by both validators, and three PDF faults
by Mustang (an invalid ConformanceLevel, a renamed XML file, a PDF/A part
other than 3). The harness requires every summary of a Mustang report to be
valid, because Mustang 2.26.0 can report a PDF as valid with exit code 0 when
its PDF part is invalid.

Limits: the validators do not check that a line net amount equals quantity ×
price (with the price base quantity); the unit tests of `computeEInvoice`
check it. Mustang does not compare the profile in the XMP metadata with the
profile of the XML; Nuxt PDF writes both from one `profile` and checks the
profile ID of XML passed in `xml`.

### Tagged PDF: PDF/UA-1 and PDF/A-3a

`conformance` on `PdfDocument` takes `'PDF/A-3b'`, `'PDF/A-3a'`, `'PDF/UA-1'`,
or a list of them with at most one PDF/A level. `'PDF/UA-1'` and `'PDF/A-3a'`
write a tagged PDF (`test/tagged.test.ts`): PDF 1.7, `MarkInfo` `Marked true`,
a structure tree read back with pdfjs, catalog `Lang`, `DisplayDocTitle`
(PDF/UA-1), `Tabs /S` on every page, and one XMP packet with `pdfuaid:part` 1
and/or `pdfaid:conformance` A. Every content-stream operator is inside marked
content or an artifact.

The structure follows the tree in template order: page-flow `PdfText` is `P`
or `H1` to `H6` (`tag`), with nested texts, inline links, inline images and page
tokens part of the paragraph; `PdfImage` and `PdfSvg` with `alt` are `Figure`;
`PdfView` `tag` writes `Sect`, `L`, `LI` > `LBody`, `BlockQuote`, `Caption`
or `Figure`; a `figure` view is one `Figure` with its `alt`, whose texts,
images and SVGs are its marked content and whose `caption` view is a
`Caption` inside it; `PdfTable` is `Table` > `TR` > `TH` (scope column) / `TD`,
with `ColSpan` from `colspan`, and a body cell with `header` is `TH` with
scope row; `PdfLink` is `Link` with an object reference to each of its
annotations, which carry `StructParent` and `Contents`; each `PdfLink` is its
own `Link`, also next to a link with the same `href`. A paragraph split
across pages is one element. A text with `textTransform` or a non-zero
`letterSpacing` carries its template text as `/ActualText` on its marked
content, one part per page, where that text can be found exactly. `fixed` and `decorative` content, page and view
backgrounds and borders, the boxes and size label of `debug`, and the repeats
of a table header after the page where the table starts
(`/Artifact <</Type /Pagination>>`) are artifacts. A
document without a tagged level keeps its bytes, also with `tag`, `alt` and
`decorative` set (hash compared), and with `header` and a `figure` view (bytes
compared with the same document without them).

Fails with `PDF_TREE_INVALID` and the source position: no `title`
(PDF/UA-1); no `language`, or one that is not a well-formed language tag
(RFC 5646 syntax; the registry is not consulted); an image or SVG without `alt` or `decorative`; an
empty `alt`; a first heading other than `h1`; a skipped heading level; a text
in a standard font; a `list-item` outside a `list`, or other content in a
`list`; a `PdfLink` in a `fixed` or `decorative` node; a `PdfNote`; two PDF/A
levels; `tag` on a nested `PdfText`; a `figure` view without `alt` or
`decorative`; a `PdfLink`, a `PdfTable`, or a `tag` inside a figure outside
its caption; a `PdfTable` or a `tag` inside a `PdfLink` around blocks. In every document: `alt` on a `PdfView` without `tag="figure"`,
and a `header` on `PdfTableCell` that is not a boolean. An annotation that the structure plan did
not predict (an engine change) fails closed with `PDF_RENDER_ERROR`.

Evidence: veraPDF 1.30.4 (`verapdf/cli`, pinned by digest) reports PASS with
the flavours `ua1`, `3a` and `3b`, run by `pnpm test:pdfa` and the CI job
`pdfa`, for three fixtures (`test/fixtures/tagged-document.ts`), each with
several claims: one with headings, a paragraph split over two pages, a
figure, a decorative image and a fixed running head (`ua1`; `ua1` and `3b`);
one with a section, inline and block links (external and internal), a list, a
quotation, a figure with a caption, an inline image, and a table over two pages
with a repeated header and a `colspan` cell (`ua1`; `ua1` and `3b`; `3a`;
`3a` and `ua1`); one with `ActualText` on capitals and letter spacing (also on
each page's part of a split paragraph), a figure view with its caption, a
decorative figure, and row headers (`ua1`; `3a` and `ua1`). The playground annual report (`playground/pdfs/annual-report.vue`,
`['PDF/A-3a', 'PDF/UA-1']`) passes `ua1` and `3a` for both of its scenarios;
that run is manual, not part of CI, and `test/annual-playground.test.ts`
checks its headings, figures with their captions, lists, table, row headers
and `ActualText` with pdfjs and the raw content streams.

Limits: veraPDF checks the machine rules of PDF/UA-1 only. Whether alt texts,
link texts and the reading order make sense is a human check that no test
makes. No screen reader and no other checker (such as Acrobat's) was used. A
`PdfTableHeader` with `pages` is an artifact, so such a table has no header row
in its structure; untested. `ActualText` is not written for a text with an
inline link or image, nor for a part of a text whose template text cannot be
found exactly (`ß` becomes `SS` in capitals, a text cut by `maxLines`);
pdf.js and poppler ignore `ActualText` in text extraction. A `caption` view
next to a table is not part of the table.

### Reproducible output

Two renders of the same document with the same `creationDate` write the same
bytes, also with registered fonts, attachments, transparent images and tagged
PDF, and also when several renders run at the same time
(`test/reproducible.test.ts`). Without `creationDate` a render takes the
current time and its bytes differ. A protected PDF (`protection`) is the
exception: each render uses a new random file key, salts and IVs, as the
standard requires, so its bytes differ while its text is the same
(`test/protection.test.ts`).

### Form fields

`PdfTextField`, `PdfCheckbox` and `PdfSelect` write AcroForm text, checkbox and
combo-box fields with their own appearance streams, in documents without a
PDF/A or tagged level. `test/forms.test.ts` proves with pdf.js: each field's
type, name, value, choices, `TU` (`label`) and flags (`readOnly`, `required`,
`multiLine`, `maxLen`); a widget `rect` equal to the laid-out box within
0.01 pt, also inside nested padded views and on page 2; a field that does not
fit moves to the next page whole; one field per name (`getFieldObjects`); a
fill round trip (values set through pdf.js's `annotationStorage`,
`saveDocument()`, the saved file parsed again) for a text field, a checkbox and
a select; a checkbox `V` and `DV` written as names; widget dictionaries without
lowercase keys; the form in a protected PDF with `fillingForms`/`annotating`
off in `/P`, its appearance streams encrypted and drawn with the password; no
AcroForm in a document without fields; and the typed `PDF_TREE_INVALID` errors
for every field rule.

Appearances: the AcroForm has no `NeedAppearances` and the file no ZapfDingbats
font. Every widget has `AP /N`; a text or choice field's `DA` names Helvetica
with the field's size and colour, `textAlign` is also written as `Q`, and `MK`
and `BS` carry the background, border colour and width. The tests compare whole
appearance streams with values computed from the Helvetica metrics: border and
background, `/Tx BMC … EMC`, the clip to the content box, the font size and
colour, a single-line baseline centred vertically, left, centred and
right-aligned values, multi-line values broken at the box width and at their
own line breaks, `(`, `)` and `\` escaped and `ä ö ü ß €` as WinAnsi bytes, an
empty value without text, size and colour inherited from a parent view, and a
checkbox with exactly an empty `Off` state and a vector cross in its export
state. A pdf.js raster drawn from those streams (no value in its storage) shows
a centred value at the computed place and size, a long value clipped at its
content box, and the cross only in the checked box; the field border and
background are not painted on the page. `test/registration-playground.test.ts`
renders the playground form from its SFC, field sizes and padding from the
`<style>` block.

### Password protection

`PdfDocument` `protection` writes the standard security handler with AES-256,
revision 6 (ISO 32000-2, 7.6.4): `/V 5 /R 6 /Length 256`, crypt filter
`/AESV3` for strings and streams, `/O`, `/U`, `/OE`, `/UE`, `/Perms` and `/P`,
in a PDF 1.7 file whose catalog declares Adobe extension level 8. No other
cipher (RC4, AES-128, AES-256 revision 5) is written. `test/protection.test.ts`
proves with pdf.js that the PDF does not open without a password (pdf.js
`PasswordException` code 1) or with a wrong one (code 2), and opens with the
open password and with the owner password; that an owner-only PDF opens
without a password; the written `/P` and pdf.js's own reading of it for five
`allow` sets; the layout of the decrypted `/Perms`; that neither password nor
the metadata appear in readable form in the file; that PDF/UA-1 with
protection renders; and the typed `PDF_TREE_INVALID` errors for a missing,
empty, equal or non-normalized password, a password over 127 bytes, unknown
keys, `fillingForms: false` with `annotating` allowed, `pdfVersion` other
than `'1.7'`, PDF/A, `PdfFacturX`, and PDF/UA-1 with
`extractingForAccessibility: false`. No error message, cause, stack or log
line of a failing render contains a password, on the worker and in-process
paths. A password that SASLprep (RFC 4013) would change is rejected, so the
key does not depend on whether a reader applies SASLprep.

### Table of contents, internal links, and bookmarks

Nuxt PDF resolves table-of-contents page numbers with a multi-pass layout loop.
Vue mounts the template once; the loop re-runs layout only. The tested boundary:

- **`PdfPageRef`** (inside a `PdfText`) prints the 1-based page on which the
  destination `to` finally lands. **`PdfPageNumber`** and **`PdfPageCount`**
  print the current page and the page count. All three are plain-data tokens in
  the mounted tree; the engine adapter turns them into per-page text. A
  `PdfPageRef` prints, and its link jumps to, the page of the target's first
  line, also when pagination leaves an empty part of the target (no line) at
  the bottom of the page before; an empty `PdfView` with the `id` is a target
  of its own (`test/page-primitives.test.ts`). The printed number joins the
  text before it into one word, so `:hyphenate="false"` keeps both whole. Function
  props (`render`, `hyphenationCallback`) are removed. In a template they fail
  the build with a hint to `PdfPageNumber` and `PdfPageCount` or
  `:hyphenate="false"`. In a render function they fail with
  `PDF_TREE_INVALID` and the same hint.
- **Pass count.** Every document runs the loop. Plain documents, documents with
  page-token footers and link-only documents converge in one pass; a named
  destination resolves by name (`test/page-primitives.test.ts`,
  `test/layout-passes.test.ts`). Page-conditional `fixed` content (`pages`)
  needs no extra pass, also with a `pages` head in each of many sections
  (`test/table.test.ts`). A `PdfPageRef`, or a view that the orphan rule moves
  to the next page, needs one more pass.
- **Convergence.** The loop is a fixed point: each pass lays out a fresh engine
  copy of the same admitted tree with the destination-page map of the previous
  pass, until the map it produces equals the map it was laid out with. Tree
  limits, metadata and image/resource policy run once, on the mounted tree; the
  passes cannot add content. The tree is taken, validated and the Vue app
  unmounted in one step before the first await, so a template that changes
  state later (a timer, a late promise) does not change the PDF
  (`test/server-runtime.test.ts`). An ordinary document converges in two passes and
  is byte-identical to one layout of the final numbers. A document whose layout
  depends on the numbers it prints (a TOC entry whose height changes with its
  page number) never converges and, after `maxPasses` (a validated positive
  integer on `definePdf`, default 5), raises a `PDF_LIMIT_EXCEEDED`
  `NuxtPdfError` attributed to the template key and file through the same
  boundary as every other render failure. The message shows the page facts the
  last pass was laid out with and the different facts it produced
  (`test/layout-passes.test.ts`).
- **Named destinations resolve to a section's first page.** A node's `id` becomes
  a named destination; a `PdfLink` `href="#id"` jumps to it. When the id sits on a
  node that spans a page boundary, both the printed number and the jump target
  resolve to the section's **first** page (a deliberate divergence from React PDF,
  whose last-writer-wins destination table points at the last page). Page-spanning regression fixtures verify the
  printed number and the pdfjs destination independently. The anchoring is copy-on-write, so a
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
  the multi-pass loop: each pass lays out its own copy of the props, so the
  in-place write of `resolveBookmarks` cannot carry a stale hierarchy into the
  next pass, and the converged render is byte-identical to a single layout with
  nested bookmarks. A bookmarked node that splits across pages has one entry,
  at its first page with content (React PDF adds one per page; invariant I14,
  `test/invariants/`).
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
- independent image validation across roots and after same-size,
  same-timestamp development edits;
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
- `pdf.limits` is the only source for the per-render image byte and pixel
  totals, the request count, and the whole-render deadline. Remote requests run
  at most four at a time. Source
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

Every render is bounded by the operator-overridable `pdf.limits` fields below
(`test/limits.test.ts`). Defaults apply when a field is omitted; every field is
a positive safe integer validated at module setup. A removed field fails
module setup with a message that says what to set instead.

| Field | Default | When checked |
| --- | --- | --- |
| `timeoutMs` | `30_000` | Whole public render deadline, started before metadata evaluation |
| `maxPages` | `2_000` | After each layout, before serialization |
| `maxNodes` | `50_000` | Post-mount tree walk |
| `maxTotalImageBytes` | `33_554_432` | Sum of the unique images of the render, before engine admission |
| `maxTotalImagePixels` | `100_000_000` | Sum of decoded pixels of the unique images of the render |
| `maxRemoteRequests` | `32` | Remote fetch accounting, including redirect hops |
| `maxTotalAttachmentBytes` | `33_554_432` | Sum of the `PdfAttachment` content and the `PdfFacturX` XML of the render, before the worker boundary (`test/attachment.test.ts`, `test/pdfa.test.ts`) |

Remote requests run at most four at a time. Exceeding a limit fails closed with
`PDF_LIMIT_EXCEEDED`. The node check is **post-mount rejection**: Vue has
already mounted the tree, so it does not create hard memory isolation before
mount.

### Render worker

Layout and serialization run in a worker thread (`test/worker-render.test.ts`):

- At `timeoutMs` the worker is terminated, so the deadline holds inside one
  engine step; the next render gets a fresh worker. A render worker starts
  with a 1024 MB heap cap (configured; no test exhausts it).
- The deadline covers layout and serialization, not the Vue render.
  Synchronous template code, such as an endless loop in `setup`, blocks the
  server process and no timeout stops it (documented, not tested).
- The pool keeps at most `min(4, availableParallelism() - 1)` warm workers and
  at least one. Further renders wait in a FIFO queue; the wait counts against
  their deadline. Idle workers do not keep the process alive. An idle worker
  that emits an error leaves the pool; the process keeps running.
- A worker is replaced after 200 renders, so engine caches (such as the
  hyphenation cache) do not keep data of earlier renders without bound. The
  test checks the replacement with a limit of one render.
- An error from the worker keeps its code, message, stack and cause.
- The worker imports no Vue. It receives only the admitted plain-data tree, so
  one render cannot read data from another.
- A Nitro preset that bundles the server into one file has no worker chunk.
  Such a build logs one warning and renders in-process; the deadline is then
  checked between engine stages only. In-process and worker output are
  identical.

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

## Explicitly not claimed

- Full React PDF component, hook, browser-helper, or test-suite parity.
- React runtime compatibility, React-shaped dynamic callbacks, or any author
  function in the document tree.
- A `lineHeight` multiplier applied to page tokens. Token text renders with
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
- Browser CSS, HTML printing, or paged-media CSS. The `<style>` block accepts
  class selectors and `PdfStyle` properties only: no element, child, sibling,
  attribute or pseudo selectors, no at-rules other than `@import`, no media
  queries, and no border colors with alpha. Descendant selectors match within
  one file's template, not across components.
- A table layout engine beyond the `PdfTable` components: no row spans and no
  column widths measured from content. Charts, signing, editing, or PDF merging. A table of contents is authored from ordinary components; there is no
  TOC component or automatic heading collection.
- Bookmark destination geometry (`top`/`left`/`zoom`/`fit`) and outline click
  actions are not exposed. Bookmark titles, expanded state, and parent/child
  nesting are verified; the title hierarchy is inspected via pdfjs
  `getOutline`.
- Multi-pass resolution of anything other than destination page numbers, and
  convergence for documents whose geometry depends on the numbers they print
  (these fail closed with `PDF_LIMIT_EXCEEDED`, they are not made to converge).
- Accessibility beyond the machine rules of PDF/UA-1: no screen reader, no
  other accessibility checker, and no human review of alt texts, link texts or
  reading order is part of the evidence. PDF/UA-2, WCAG, `PdfNote` and links in
  running content in a tagged document, and table captions are not claimed.
  PDF/A is claimed for part 3, levels b and a only, with veraPDF as the
  evidence; no viewer was tested.
- The content of Factur-X XML that the author passes with `xml`. Nuxt PDF
  checks that it is well-formed, has a `CrossIndustryInvoice` root and names
  the profile; the scan does not check namespaces or the CII schema.
- For e-invoices written from data: UBL output, writing the `EXTENDED`
  profile, IBAN checksums, that an identifier (VAT ID, Leitweg-ID, GLN)
  exists, and EN 16931 fields that `EInvoice` does not have. The validators
  run in `pnpm test:einvoice`, not in CI.
- Form fields beyond the first two slices. The appearance streams use the
  standard font Helvetica, not embedded, so field values and options are
  WinAnsi only and a reader substitutes its own Helvetica-compatible font.
  Radio groups, list boxes, push buttons, field hierarchies, form scripts and
  submit actions, rounded or dashed field borders, `justify` in a field, an
  automatic font size, and fields in PDF/A or tagged documents are not
  offered. pdf.js is the only reader in the tests; Acrobat, PDFium and Preview
  are not checked, nor how a reader draws a value after the user edits it.
- Encryption other than AES-256 revision 6, public-key (certificate)
  security, unencrypted metadata, and PDF/A with encryption. Readers honour
  the permission flags; the encryption does not enforce them. pdf.js is the
  only reader in the tests; Acrobat's check of `/Perms` is not run. A
  password your own template code prints (for example in a Vue prop warning
  of your own component) is outside the redaction.
- Equal PDF bytes across Nuxt PDF versions, engine updates, Node.js versions or
  operating systems. Equal bytes are tested for repeated renders in one
  environment.
- Hard render cancellation in a build that renders in-process (a preset that
  bundles the server into one file). There the `timeoutMs` budget is polled
  between engine stages, and one stage can overshoot it.
- Pre-mount memory isolation. `maxNodes` rejects after Vue has mounted the
  tree; it is not a sandbox that prevents allocation during mount. Vue mounting
  runs on the main thread.
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
