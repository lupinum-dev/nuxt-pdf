# React PDF engine contracts

Nuxt PDF replaces React PDF's reconciler and reuses its published lower-level engine packages. This file records every non-obvious contract relied on by the compatibility kernel.

**Reference commit:** `d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`

## Pinned packages

| Package | Version | Imported symbols |
|---|---:|---|
| `@react-pdf/font` | 4.0.8 | default `FontStore` |
| `@react-pdf/layout` | 4.6.1 | default `layoutDocument`, `DocumentNode`, `SafeDocumentNode` |
| `@react-pdf/pdfkit` | 5.1.1 | default `PDFDocument` |
| `@react-pdf/primitives` | 4.3.0 | primitive string constants |
| `@react-pdf/render` | 4.5.1 | default `renderPDF` |

All runtime imports use package roots. There are no imports from unpublished source paths and no patches.

## Host node contract

The Vue renderer creates the same plain node shape as `@react-pdf/renderer`:

```ts
type ElementNode = {
  type: string
  box: Record<string, never>
  style: unknown
  props: Record<string, unknown>
  children: Node[]
}

type TextInstance = {
  type: 'TEXT_INSTANCE'
  value: string
}
```

Only `DOCUMENT` is accepted as the root passed to layout. Raw text is retained only below `TEXT`, `LINK`, `TSPAN`, and `NOTE`. Vue comments and fragment anchors are renderer bookkeeping and never enter `children`.

Protected by `test/renderer.test.ts` and the paired conformance fixture. An incompatible change will fail exact tree assertions or layout before PDF serialization.

## Layout contract

`layoutDocument(document, fontStore)` accepts a `DocumentNode` and returns a `SafeDocumentNode`. The published JavaScript pipeline forwards additional arguments to every layout step and React PDF itself passes `fontStore` as the second argument. The published declaration incorrectly exposes only the document argument, so Nuxt PDF narrows this one call through a local function signature.

Layout resolves styles, assets, text, dimensions, pagination, page indices, links, and bookmarks. Nuxt PDF does not duplicate those stages.

The layout result is derived and disposable. The mounted Vue tree remains the canonical pre-layout tree.

Protected by the engine integration and paired conformance tests. An incompatible change will fail type checking, semantic PDF assertions, or raster comparison.

### Layout purity contract (multi-pass re-layout)

The multi-pass loop (`layout-passes.ts`, used to resolve table-of-contents page
numbers) lays out the **same mounted tree repeatedly** — once per fixed-point
pass — without cloning it. That is only sound because `layoutDocument` treats its
input as immutable for every node it re-parents:

- **Every pipeline step rebuilds nodes with `Object.assign`, never in place.**
  `layoutDocument` is `asyncCompose(...)` (`layout/src/index.ts:20-38`), which
  applies steps right-to-left. Each step maps children into a fresh array and
  returns `Object.assign({}, node, { … })` — e.g. `resolveStyles.ts:49,53`,
  `resolveOrigins.ts:13`, `resolveZIndex`, `resolveDimensions.ts:229,235`. The
  first structural step to touch a node's descendants (`resolveStyles`, executed
  5th) deep-copies the whole subtree, so pagination, dimensions, and text layout
  all mutate **copies**, never the input.
- **`box` on the input is never populated.** After `resolveStyles` a copied node
  shares the original `box` reference, but `resolveDimensions` builds a brand-new
  `box` object (`resolveDimensions.ts:221,229`) rather than writing into it, so
  the mounted tree's `box` stays `{}`. Verified empirically: two full layouts of
  the same mounted document leave `page.box` an empty object.
- **The one in-place mutation is `resolveBookmarks`.** It assigns
  `child.props.bookmark = newHierarchy` on the original node's props
  (`resolveBookmarks.ts:52`), executing before `resolveStyles` copies, so it
  **does** write derived state back onto the canonical tree. `newHierarchy` is
  `{ ref, parent, ...bookmark }`: when `bookmark` is already a resolved object
  (as it is on the second pass), the spread carries the previous pass's `ref` and
  `parent` forward, so re-layout is **not** idempotent whenever a node's stable
  bookmark reference is not re-patched (a string bookmark, or a hoisted object).
  `renderDocumentMultiPass` therefore snapshots every bookmark-carrying node's
  authored `props.bookmark` before the loop and restores it before every pass
  (`layout-passes.ts` `snapshotBookmarks`/`restoreBookmarks`). resolveBookmarks
  only reassigns the reference (never mutates the object), so restoring the
  captured reference is a complete reset. Protected by `test/bookmarks.test.ts`,
  whose ancestry-shift fixture fails without the reset.

Because the mounted tree is otherwise untouched, the loop feeds each pass's
`id → page` map back through a reactive prop and our renderer **re-patches the
same node objects in place** (node identity is asserted stable across passes in
`test/toc-multipass.test.ts`); no per-pass re-mount and no structural clone are
required. Convergence is a fixed point — the map a layout *produces* equals the
map it was laid out *with* — reached in **2 passes** for an ordinary document.
Non-convergence (a TOC entry whose size depends on the number it prints) is
capped at `maxPasses` (default 5) and raises `PDF_LIMIT_EXCEEDED`.

### Named destination / internal link contract

A node's `id` prop becomes a PDF named destination anchored at the node's page
and `box.top` (`render/src/operations/setDestination.ts:10`, called from
`renderNode.ts` for **every** node). A `Link` whose `src` (or `href`) starts with
`#` renders as a `goTo` to that name rather than an external `link`
(`render/src/operations/setLink.ts:7,13`). pdfjs reports the resulting Link
annotation's `dest` as the raw id string.

**First-page ownership (a Nuxt-PDF divergence).** Pagination splits a node that
crosses a page boundary into a fragment on every page it touches, each keeping
`props.id`. Upstream calls `setDestination` for all of them and pdfkit's NameTree
is last-writer-wins, so React PDF's destination for a page-spanning `id` points
at the section's **last** page. Nuxt PDF instead anchors every destination at the
section's **first** page, because a table-of-contents entry names where a section
*begins*. Two seams enforce this, both in `render-document.ts`:

- `extractDestinationPages` is **first-writer-wins** over the ordered page list
  (`layout.children`), so the `id → page` map the multi-pass loop feeds back (and
  the printed TOC number) is the earliest page an id appears on.
- `serializePdfLayout` runs `anchorDestinationsAtFirstPage`, which walks the
  final pages in order and deletes `props.id` from every fragment of an
  already-seen id **before** painting, so the single surviving `setDestination`
  call — and therefore the NameTree entry the click jumps to — targets the first
  fragment. This runs for the single-pass and multi-pass paths alike, mutating
  only the derived, disposable layout.

The printed TOC number and the jump target thus share one source of truth.
Protected by `test/toc-multipass-attack.test.ts` (the page-spanning regression),
`test/toc-multipass.test.ts`, and `test/internal-links.test.ts` (paired with
React on non-splitting targets, where first- and last-page resolution agree).

## Dynamic text contract

Layout detects a dynamic node when the `render` key exists in its props. The Vue renderer must therefore delete nullish props instead of retaining `render: undefined`.

During pagination, layout invokes dynamic callbacks first with `pageNumber`, and later with final page and subpage totals. Its internal instance converter accepts scalar strings and numbers but assumes React-shaped objects for element results. Nuxt PDF 0.1 exposes only synchronous dynamic text callbacks returning scalar text. Vue VNodes are not supported as dynamic callback results.

**Dynamic lineHeight shield.** Before layout, `renderDocument` gives every dynamic `TEXT` node (a `render` function in its props) its own `lineHeight: ''` on the disposable mounted tree (`normalizeDynamicTextLineHeight`, replacing the `node.style` reference, never mutating the shared object). This works around an upstream non-idempotency: `lineHeight` is the only inherited property whose stylesheet transform is not a fixed point — `transformLineHeight` returns `lineHeight * fontSize` for any unitless/absolute number (`@react-pdf/stylesheet` `src/resolve/text.ts:48-67`), and pagination re-resolves dynamic nodes' already-resolved styles multiple times (`@react-pdf/layout` `resolvePagination.ts` relayout paths → `resolveStyles.ts:62-71`). Each pass re-multiplies the absolute value by `fontSize`, exploding the dynamic line box off-page. `''` is the unique value short-circuited by `transformLineHeight` (`text.ts:53 if (value === '') return value`), and `resolveInheritance`'s own-over-inherited merge (`resolveInheritance.ts:53-64`) lets the node's own `''` override the compounding ancestor value; textkit then uses the font-derived line height. This is a deliberate divergence from `@react-pdf/renderer` 4.5.1, which has the identical bug and instead drops such footers entirely. Static text is unaffected (its `lines` are frozen after the first layout) and keeps inherited `lineHeight`.

Protected by callback and page-number conformance tests, plus a geometry-equality test asserting the dynamic footer matches the static equivalent while body text keeps its inherited `lineHeight`. Expanding dynamic results requires a new explicit layout seam or an upstream change; it must not be implemented with a React-shaped compatibility object.

## SVG contract

The Vue SVG primitives create the same host nodes the engine already draws; no
engine code is involved beyond the pinned `@react-pdf/layout` and
`@react-pdf/render` packages. The relied-on facts:

- **Svg is a self-contained flex leaf.** `resolveDimensions` gives an `SVG` node
  a Yoga measure function derived from its `viewBox` aspect ratio
  (`layout/src/svg/measureSvg.ts`), so it lays out like an `Image` in normal
  page flow, and `renderNode` does not recurse into svg children — `renderSvg`
  walks the subtree itself (`render/src/primitives/renderNode.ts`). Therefore
  `SVG` is a valid child of `PAGE`/`VIEW` even though the upstream
  `layout/src/types/{view,page}.ts` child unions omit `SvgNode`. That omission
  is an incomplete advisory type, not a runtime rule; `node-ops.ts` deliberately
  adds `Svg` to `PAGE_CHILDREN` on the evidence of the measure function. A future
  reader must not "correct" this back to match the upstream union.
- **SVG props are camelCase and override style.** `resolveSvg` keys off exact
  camelCase prop names (`strokeWidth`, `fillOpacity`, `stopColor`, `viewBox`,
  `gradientTransform`) via `parseProps`/`pickStyleProps`, and merges
  `Object.assign({}, style, props)` so props win over style. `transform` is a
  *prop* on SVG nodes (parsed by `resolveSvg`), unlike `View`, where it is a
  style key. The thin SVG components coerce kebab-case attribute names to these
  camelCase keys (`compactSvgProps`) so static template attributes are not
  silently dropped; `data-`/`aria-` names are left untouched so `patchPdfProp`
  still rejects them.
- **`url(#id)` references resolve within one Svg subtree.** `getDefs` indexes
  `DEFS` children by `props.id`; `replaceDefs` substitutes matches for
  `fill`/`clipPath` `url(#id)` references and detaches the `DEFS` subtree. A
  dangling reference yields `undefined` (no fill), which differs from browsers.
- **Scope exclusions.** `Marker` (and `markerStart`/`Mid`/`End`) has additional
  `resolveSvg` container logic that is intentionally not exposed; the `Defs`
  child set and prop types exclude it. `List`, `Canvas`, `ImageBackground`, and
  form primitives are also out of scope.

Protected by `test/svg-conformance.test.ts` (semantic + raster parity against
React) and the SVG nesting/casing tests in `test/renderer.test.ts`.

## PDFKit contract

`@react-pdf/pdfkit` exports a readable `PDFDocument` constructor but publishes no TypeScript declaration. Nuxt PDF carries a narrow ambient declaration for only the constructor and readable-stream behavior it uses.

The constructor receives metadata and rendering options. `renderPDF(context, layout)` paints pages, calls `context.end()`, and returns the same readable context. Nuxt PDF must not call `end()` again.

Protected by PDF magic-byte, parse, metadata, stream completion, and stream error tests. The local declaration must grow only when a concrete call site requires another member.

## Font contract

A fresh `FontStore` contains the standard PDF fonts. Additional local fonts are registered before layout and the same store is passed to `layoutDocument`.

Font resolution runs *inside* the layout pipeline (`resolveAssets` calls
`fontStore.load`), so a missing family throws during `layoutDocument`. Nuxt PDF
surfaces this as a single `PDF_LAYOUT_ERROR` carrying React PDF's own exact
message (`Font family not registered: <family>` / `Could not resolve font for
<family>, fontWeight …`). Font failures are deliberately **not** sub-classified
into a separate error code: `@react-pdf/font` throws a plain `Error` with no
machine-readable signal, and the only way to isolate the font sub-stage would be
to walk the tree and call `fontStore.getFont` per descriptor — duplicating the
`resolveAssets` traversal this file forbids. The precise family is already named
in the preserved message, so no re-classification is needed.

Protected by the local-font conformance fixture. Asset policy, path validation, and registration ownership live outside the engine and must run before layout.

## Remote resource boundary

Both of React PDF's remote fetch seams are structurally unreachable under every
configuration, because our code converts any remote URL into embedded bytes (an
image `{data, format}` buffer) or a `data:font/...` URL **before** layout or the
font store runs.

- **Image seam.** `@react-pdf/image` `resolve.ts` `fetchRemoteFile` calls global
  `fetch(src.uri, {method, headers, body, credentials})` and reads
  `response.arrayBuffer()` with no allowlist, timeout, byte cap, or redirect
  control, selected by `resolveImageFromUrl` for any non-`file:` URL. Our
  `resolvePdfImageAssets` replaces every image source with a validated buffer,
  so layout always takes the `resolveImageFromData` branch and never reaches
  `fetchRemoteFile`.
- **Font seam.** `@react-pdf/font` `font-source.ts` `fetchFont` calls global
  `fetch(src, options)` when `isUrl(this.src)` is true. Our `createPdfFontStore`
  only registers `data:font/(otf|ttf);base64,...` sources, so `FontSource._load`
  always takes the data-URL branch and never reaches `fetchFont`.

When `pdf.remote` is configured, the fetching is done by our own
`fetchRemoteResource` (`assets/remote.ts`): https-only allowlist match re-checked
on every manual redirect hop, `GET` with no headers/credentials, a per-hop
`AbortController` timeout, and a streamed byte cap. It returns raw bytes that the
image or font caller validates with the same signature checks as local assets.
Remote images are resolved at render time (their `src` is a dynamic prop);
remote fonts are resolved at build time inside `bundlePdfFonts`, keeping the
render path zero-network. The engine's own fetch code stays dead. Protected by
`test/remote.test.ts`.

## Deliberately unused contracts

- React reconciler and renderer lifecycle
- React hooks and DOM helpers
- `PDFViewer`, `PDFDownloadLink`, and `BlobProvider`
- deprecated string rendering
- private PDFKit page-mode mutation
- arbitrary React-node dynamic render results

Any proposal to use one of these requires a documented acceptance criterion and an update to this file.
