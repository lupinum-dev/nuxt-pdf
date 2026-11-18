# React PDF engine contracts

Nuxt PDF replaces React PDF's reconciler and reuses its published lower-level engine packages. This file records every non-obvious contract relied on by the compatibility kernel.

**Reference commit:** `d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`

## Pinned packages

| Package | Version | Imported symbols |
|---|---:|---|
| `@react-pdf/font` | 4.0.8 | default `FontStore` |
| `@react-pdf/layout` | 4.6.1 | devDependency: the source of our copy in `layout/` (below); the runtime does not import the package |
| `@react-pdf/pdfkit` | 5.1.1 | default `PDFDocument` |
| `@react-pdf/render` | 4.5.1 | default `renderPDF` |
| `@react-pdf/fns`, `image`, `primitives`, `stylesheet`, `textkit`, `types`, `emoji-regex-xs`, `yoga-layout` | as `@react-pdf/layout` 4.6.1 resolves them | imported by the copy only; pinned exactly |

**Layout copy (D19).** `layout/index.js` and `index.d.ts` are `@react-pdf/layout`
4.6.1 `lib/` plus the exact string edits listed in `scripts/vendor-layout.mjs`
(each with its reason; they fix lost text, endless pagination and a page-number
text painted twice, see `internals/harness-r1/causes.md`). The runtime imports
`default layoutDocument`, `DocumentNode` and `SafeDocumentNode` from it. Never
edit the copy by hand: `pnpm vendor:layout` writes it, and `pnpm lint` runs
`node scripts/vendor-layout.mjs --check`, which fails when the committed copy
differs from upstream plus the edits. The other runtime imports use package
roots, with no patches.

## Engine upgrade drill (runbook)

These pins are deliberate. React PDF ships no semver guarantee for the
lower-level engine packages, so every bump is decided by conformance evidence,
not by the version number. Run this drill whenever a newer stable release
appears.

**Steps**

1. Check for newer *stable* releases only:
   `npm view <pkg> dist-tags` for each of `@react-pdf/layout`, `render`, `font`,
   `pdfkit`. Compare each `latest` tag against the pins table
   above. Ignore `beta`/`reactpdf`/other pre-release tags. If no `latest`
   exceeds its pin, record that fact and stop. The pins hold.
2. On branch `drill/engine-bump`, bump the pins together (keep
   `@react-pdf/renderer` aligned with `render`), then `pnpm install`. Bisect
   per-package only if the combined bump fails. For `@react-pdf/layout`: set
   the copy's runtime dependencies to the versions the new layout resolves,
   put the new file hashes into `UPSTREAM_SHA256` in
   `scripts/vendor-layout.mjs`, and run `pnpm vendor:layout`. An edit whose
   anchor no longer matches exactly once stops the script and names the edit:
   read what changed upstream there, then adapt or drop the edit (an upstream
   fix can make it unnecessary).
3. Run the full evidence chain and record exact results:
   - `pnpm lint`
   - `pnpm test` (including the paired conformance fixtures and raster
     baselines)
   - `pnpm typecheck`
4. Re-verify each documented contract below against the new engine source in the
   read-only reference checkout (`react-pdf/`). Update the **Reference commit**
   and this file for any wording that changed. The contracts most likely to
   drift silently. Verify these contracts by reading the source:
   - Layout contract: `layoutDocument(document, fontStore)` still forwards
     `fontStore` as the second argument.
   - Dynamic text contract: dynamic-node detection still keys on the `render`
     prop that the adapter writes for page tokens and the page-conditional
     carrier; the paint call still passes `subPageNumber` and
     `subPageTotalPages`.
   - Oversized blocks: `splitNodes` still keeps an unbreakable block higher
     than the page on the page, and a page `size` without a height still lays
     the page out at its content height.
   - Layout purity: `transformLineHeight('')` still returns the fixed-point
     sentinel; `resolveBookmarks` still mutates in place; pagination still
     shares the same node object for fixed nodes across pages.
   - Named destination contract: `setDestination` / `NameTree` last-write-wins
     behavior is unchanged.

**Gates:** Every gate must pass:
`pnpm lint`, `pnpm test`, and `pnpm typecheck` (the release gate is
`pnpm release:verify`).

**Raster baselines:** A changed raster diff is *expected* upgrade evidence, not
an automatic failure. Inspect each failing baseline visually and classify:
- *benign drift* (sub-pixel antialiasing, identical layout): update the
  baseline and note it in the merge commit;
- *rendering regression* (moved, missing, or reflowed content): treat it as a failed
  gate.

**Decision rule**

- If all gates pass and every contract is verified, **merge** the bump to `main`
  with the updated pins table, Reference commit, and CONFORMANCE.md version
  table.
- If a gate fails or the fix is not small, **revert**
  (delete the branch), keep the pins, and record in this file precisely *what*
  broke and *which contract caught it*. A revert with a recorded cause is a
  successful drill.

**Drill log**

- **2026-07-21:** All five `latest` dist-tags equaled the current pins
  (`layout` 4.6.1, `render` 4.5.1, `font` 4.0.8, `pdfkit` 5.1.1, `primitives`
  4.3.0). Only pre-release `2.0.0-beta.*` tags and pdfkit's legacy `reactpdf`
  0.8.5 were newer, and neither is a stable upgrade. No bump. Pins hold.

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

### Closed authoring-input contract

The host-node shape matches the engine; the public input surface deliberately
does not match every upstream prop or stylesheet key. `runtime/primitives.ts`
declares each primitive once (tag, props with their checks, children, text,
destination, context) in one table; components, the prop allowlist, nesting and
per-prop checks are derived from it. `runtime/authoring.ts` holds the style
vocabulary. Both are Vue-free and shared by components, the renderer and the
engine; the host-node model remains internal to `runtime/renderer/types.ts`.
`PdfStyle` is owned by Nuxt PDF and lists only the value shapes and units
covered by this repository's fixtures. Primitive props are likewise closed:
`patchPdfProp` uses the table's exact per-primitive allowlist, which does not
compile unless it matches the exported prop types, then the complete-tree
validator checks cross-prop and context invariants. This catches
Vue fallthrough attributes that TypeScript cannot reliably exclude. Unknown
props, DOM/event attributes, props on the wrong primitive, both/neither image
sources, both/neither link targets, and page-flow/SVG text branch violations all
fail with `PDF_TREE_INVALID`; none reach layout as best-effort passthroughs.

`PdfImage` therefore has exactly one of `src`/`source`, and `PdfLink` exactly one
of `href`/`src`. SVG `PdfText` requires `x` and `y`, uses direct `fill` for paint,
and rejects page-flow-only props. `PdfTspan` accepts only `x`, `y`, and `fill`.
`PdfG` and shapes accept their direct presentation props but no generic `style`;
`PdfSvg.style` remains page-flow sizing/positioning, while SVG text style is for
text metrics rather than SVG paint.

Protected by the real Vue SFC/type fixtures and renderer invalid-tree tests. A
new public prop or style key requires types, runtime admission, invariant tests,
and conformance evidence together; there is no compatibility passthrough.

## Layout contract

`layoutDocument(document, fontStore)` accepts a `DocumentNode` and returns a `SafeDocumentNode`. The published JavaScript pipeline forwards additional arguments to every layout step and React PDF itself passes `fontStore` as the second argument. The published declaration incorrectly exposes only the document argument, so Nuxt PDF narrows this one call through a local function signature.

Layout resolves styles, assets, text, dimensions, pagination, page indices, links, and bookmarks. Nuxt PDF does not duplicate those stages.

The layout result is derived and disposable. The mounted Vue tree remains the canonical pre-layout tree.

Protected by the engine integration and paired conformance tests. An incompatible change will fail type checking, semantic PDF assertions, or raster comparison.

### Layout purity contract (multi-pass re-layout)

The mounted tree is plain data and is admitted once (tree limits, metadata,
image and remote policy) before it reaches the engine. The engine never sees
the mounted tree itself: `toEngineDocument` (`plain-tree.ts`) copies every
element (node, props, children array) into the tree that layout reads, and
turns page tokens and `hyphenate: false` into the engine's callbacks.

`layoutDocument` treats its input as immutable for every node it re-parents:

- **Every pipeline step rebuilds nodes with `Object.assign`, never in place.**
  `layoutDocument` is `asyncCompose(...)` (`layout/src/index.ts:20-38`), which
  applies steps right-to-left. Each step maps children into a fresh array and
  returns `Object.assign({}, node, { updated properties })`. See `resolveStyles.ts:49,53`,
  `resolveOrigins.ts:13`, `resolveZIndex`, `resolveDimensions.ts:229,235`. The
  first structural step to touch a node's descendants (`resolveStyles`, executed
  5th) deep-copies the whole subtree, so pagination, dimensions, and text layout
  all mutate **copies**, never the input.
- **`box` on the input is never populated.** `resolveDimensions` builds a
  brand-new `box` object (`resolveDimensions.ts:221,229`) rather than writing
  into the shared one.
- **The one in-place mutation is `resolveBookmarks`.** It assigns
  `child.props.bookmark = newHierarchy` on its input node's props
  (`resolveBookmarks.ts:52`), before `resolveStyles` copies. `newHierarchy` is
  `{ ref, parent, ...bookmark }`, so laying the same props out twice carries
  the first pass's `ref` and `parent` forward. Because `toEngineDocument` gives
  each pass its own props objects, the write lands on that pass's copy and
  never reaches the next pass or the mounted tree.

Every document goes through the fixed-point loop (`layout-passes.ts`). Each
pass rebuilds the engine tree from the plain-data tree with the facts of the
previous pass (`PlainLayoutFacts` in `plain-tree.ts`): destination pages when
the tree prints a `PdfPageRef`, the views that must start on a new page, and
the first pages of `pages="first"` parents (see "Repeated and page-conditional
content"). Vue does not render again.
Convergence is a fixed point: the facts that a layout *produces* equal the
facts that it used (first pages need only the same keys, see below). A
document that uses none of them stops after **1 pass**, also with a
`continuation` node, an absolute page-conditional node, or one that only
touches the last page (its carrier learns the parent's first page within the
pass); one with `PdfPageRef`, a moved header or an in-flow `first` node on a
parent that spans pages needs **2 passes**.
Non-convergence is capped at `maxPasses` (default 5) and raises
`PDF_LIMIT_EXCEEDED`; the message shows the facts the last pass was laid out
with and the different facts it produced.

Protected by `test/page-primitives.test.ts`: a structured clone renders the
same PDF and the mounted tree is deep-equal before and after layout; the
converged two-pass render is byte-identical to one layout of the final numbers,
with nested bookmarks and page-token footers in the document.
`test/layout-passes.test.ts` covers non-convergence and the one-pass case.

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
  (`layout.children`), so the destination-page map that the multi-pass loop feeds back (and
  the printed TOC number) is the earliest page an id appears on. An empty
  fragment (a text part with no line, or a view part with no child and no
  height) does not count when the id also appears with content: pagination
  can leave such a fragment above the page end where the content starts.
- `serializePdfLayout` runs `anchorDestinationsAtFirstPage`, which walks the
  final pages in order and deletes `props.id` from every fragment of an
  already-seen id, and from empty fragments counted out above, **before**
  painting, so the single surviving `setDestination` call targets the first
  fragment with content. The NameTree entry for a click has the same target.
  This runs on the converged layout of every render and mutates only the
  derived, disposable layout.

The printed TOC number and the jump target thus share one source of truth.
Protected by `test/page-primitives.test.ts` (the page-spanning regression for
both seams) and `test/internal-links.test.ts` (paired with React on
non-splitting targets, where first- and last-page resolution agree).

Bookmarks follow the same rule. Upstream adds an outline entry for every node
part that carries `props.bookmark`, so a bookmarked node split over three pages
had three entries. `anchorDestinationsAtFirstPage` also keeps a bookmark only on
the first part with content; the parts share the `bookmark.ref` that layout
gives each bookmarked node. Protected by the invariant harness (I14, saved case
`flow-b1-bookmark-repeated-per-page.json`).

## Dynamic text contract

Layout detects a dynamic node when the `render` key exists in its props. No
author passes a function: `PdfPageNumber` and `PdfPageCount` are token nodes in
the plain-data tree, and `toEngineDocument` turns a `PdfText` that holds them
into a dynamic text whose `render` callback prints the tokens and the static
text around them. Such a text cannot contain other elements, and it cannot be
nested in another `PdfText` (the parent's lines are fixed before the per-page
callback runs); both fail with `PDF_TREE_INVALID`.

During pagination, layout invokes dynamic callbacks first with `pageNumber`, and
later with final page and subpage totals. The first result for `PdfPageCount`
is empty and only sizes the text.

**Dynamic lineHeight shield.** Before each layout pass, `layoutPdfTree` gives every
dynamic `TEXT` node its own `lineHeight: ''` on that pass's engine tree. A dynamic
node has a `render` function in its props, written by `toEngineDocument`.
`normalizeDynamicTextLineHeight` replaces the `node.style` reference and does
not mutate the shared object.

This behavior works around an upstream non-idempotency. `lineHeight` is the only
inherited property whose stylesheet transform is not a fixed point.
`transformLineHeight` returns `lineHeight * fontSize` for any unitless or absolute
number. See `@react-pdf/stylesheet` at `src/resolve/text.ts:48-67`. Pagination
resolves the styles of dynamic nodes more than once. See `@react-pdf/layout`,
`resolvePagination.ts`, and `resolveStyles.ts:62-71`. Each pass multiplies the
absolute value by `fontSize` again. The dynamic line box can then leave the page.

The value `''` stops `transformLineHeight`. See `text.ts:53`. The inheritance
merge lets the node's own `''` override the changing ancestor value. See
`resolveInheritance.ts:53-64`. Textkit then uses the font-derived line height.
This behavior differs from `@react-pdf/renderer` 4.5.1, which has the same defect
and drops these footers. Static text is not affected because its lines are fixed
after the first layout. Static text keeps its inherited `lineHeight`.

Protected by page-token conformance tests, plus a geometry-equality test asserting the dynamic footer matches the static equivalent while body text keeps its inherited `lineHeight`. Expanding dynamic results requires a new explicit layout seam or an upstream change; it must not be implemented with a React-shaped compatibility object.

## Repeated and page-conditional content

**Repeat.** `splitNodes` (`@react-pdf/layout`, `resolvePagination`) pushes every
`fixed` child of a node it splits into **both** halves. A `fixed` node therefore
appears on every page of its parent: every page a `PdfPage` breaks into, or every
fragment of a split view. `PdfTableHeader` relies on this (one pass; 500 rows
cost 0.90× the same table with the header printed once).

**Orphan rule.** Upstream drops a fragment only when it has zero children, so a
view whose first fragment holds only its `fixed` children (a header with no row
under it) stays at the page bottom. `toEngineDocument` gives each view with
`fixed` and flow children a layout key (`LAYOUT_KEY_PROP`, an engine prop only
the adapter writes); `findOrphanedViews` reports such a first fragment, and the
next pass sets `break: true` on that view. The set only grows within one render.

**Page-conditional content (`pages` on a `fixed` node).** The engine cannot change
a node's own box per page, but it replaces the children of a node that has a
`render` prop with that callback's result on every page (`resolveDynamicNodes`).
The adapter wraps a node with `pages="first"` or `"continuation"` in a carrier:
a style-less `fixed` view (inset 0 and absolute when the node is absolute, so its
offsets keep their reference box) whose `render` returns the node, as an element
built from admitted plain data, on the pages where it appears and nothing
elsewhere. The parent's first page needs no earlier pass. Pagination calls
`render` in two rounds (`resolvePagination`): a sizing call without
`totalPages` once per page while it splits the page, on the whole rest of the
document (`splitPage` → `resolveDynamicPage`, so also inside parents that
start on a later page), and a paint call with `totalPages` once per final page,
in page order, on the fragments of that page only (`resolvePageIndices`). The
carrier repeats in every fragment of its parent, so its first paint call is
the parent's first page; a `first` node is painted there only, a
`continuation` node everywhere else. In the sizing call the carrier returns
the node, except where a `first` node's parent started on an earlier page
(see "Stale page height"): inside a parent that has not started the node lies
below the page break and changes nothing on the page. The carrier keeps the node as its
static child, so layout loads its fonts before pagination. Only `PdfView`, `PdfText`, text and page
tokens may be inside, because upstream lays a `render` result out without its
asset, link and SVG stages (`relayoutPage`); the renderer rejects anything else.

**Stale page height.** After a split, upstream lays the next page out once with
an automatic height and then, for dynamic content, again with that height fixed
(`resolveDynamicPage` keeps `page.box.height`). Content that grows between the
two would make yoga shrink the page's children to the old height (every line on
that page about 1% shorter). `flexShrink: 0` cannot prevent it: `setFlexShrink`
reads `value || 1`. So a sizing result may shrink from one page to the next but
never grow, and a paint result is never larger than the sizing result of its
page. A page where an in-flow node is sized but not painted breaks as if the
node were there (its content ends up to one node height earlier), and the paint
relayout moves the content up, so the node takes no space on the painted page.

- **`first` node: fixed by a layout fact.** The carrier reports its parent's
  first page (its first paint call) when a later page of the parent that is not
  the last page of its `PdfPage` was sized but not painted (the paint call
  reads `subPageNumber` and `subPageTotalPages`; on the last page nothing was
  pushed to a next page). The next pass's sizing call leaves the node out on
  every page after that one: the result only shrinks, and the later pages lay
  out like the document without the node. Cost: one pass.
- **`continuation` node: not fixable at this boundary.** Leaving it out of the
  sizing call on the parent's first page P means the rest of the document is
  measured without it, and page P+1 is laid out at that height with the node
  added: the result grows and every line on P+1 is squeezed (measured: 68
  lines at a 10.70 pt pitch instead of 66 at 11.0 pt). So the node is always
  sized and P keeps the gap. A fix needs an upstream seam that lets the sizing
  call differ between the current page and the measured rest.
- **Guards.** First pages need only the same keys to converge: a parent that
  an earlier parent moved to an earlier page leaves at most the pass-1 gap on
  the pages in between. A parent that moved to a later page is painted where
  it was not sized; the carrier reports that, the pass is not serialized and
  the first pages turn off for the render (`sizeEveryPage`). They also turn
  off when a pass finds an orphan break: in a document with many parents each
  pass with first pages moves where parents end and finds new orphans (12
  sections: 7 passes). Breaks found in a pass laid out with first pages are
  dropped then, so the loop continues exactly as without first pages, at most
  one pass later.

Protected by `test/table.test.ts` (header on every page and rows once, orphan
move, continuation geometry equal to an always-shown node on page 2 and to no
node on page 1, absolute offsets and page numbers, parent's first page,
first-page head without a gap on page 2, 12 sections with a head each
converging in 2 passes, content limits), `test/layout-passes.test.ts` (every
later page of a first-page head equal to the document without it) and
`test/invoice-playground.test.ts`.

**Page guard.** `splitNodes` (`@react-pdf/layout`) checks every child of the
content it splits with `isFixed`, which reads `node.props.fixed`; for each
child before the break it also filters the children after it with `isFixed`.
Pagination passes the page's children on by reference, and the steps between
pages copy nodes with `Object.assign`, which keeps the same `props` object.
So a getter on `props.fixed` of the last child of a page runs at least once
for every page pagination makes. Fixed content that leaves less room than
the next block that cannot break (an `SVG`, image or canvas: `getWrap` is
false for them whatever `wrap` says) repeats the same page forever. In-process,
where the deadline is otherwise checked only after layout, the page guard in
`plain-tree.ts` is an absolute, empty view with such a getter; it ends that
loop at the deadline with a typed error. A `render` prop would also be called
per page, but `resolveDynamicPage` then lays out the rest of the document
again on every page (60 % longer for a 289-page document). The render worker
runs no guard: there the accessor at the hot `isFixed` read cost about 20 % of
a render (measured; in-process nothing measurable), and the worker is
terminated at the deadline anyway. Protected by `test/engine.test.ts` "ends
pagination at the deadline when …" (without the guard the render loops
forever) and "writes the same bytes with the page guard as without it", and
`test/worker-render.test.ts` "names in-flow fixed content when a render in
the worker times out".

**Oversized unbreakable blocks.** `splitNodes` puts a block that cannot wrap
and is higher than the page content area on the page and only calls
`console.warn` (`warnUnavailableSpace`). The page relayout at the page height
then shrinks it, and its siblings, to fit, so the final layout never shows
the overflow. `findShrinkCandidates` lists unbreakable flow blocks whose
bottom edge with margin reaches the content bottom of their page (a shrunk
block always does). Only when there is one, `measureNaturalHeights` lays the
tree out once more with each `PdfPage` as one page of its laid-out width and
automatic height (`size: { width }`, `wrap: false`) and reads their heights;
`collectLayoutWarnings` reports `PDF_UNBREAKABLE_NODE_OVERFLOW` with that
height and the source position. The PDF is serialized before this layout. The
engine tree carries a layout key on pages and unbreakable blocks for it; the
engine ignores the prop, and `test/engine.test.ts` proves the bytes equal one
layout of the tree without keys. A percentage height relative to the page has
no page height in the measuring layout.

## SVG contract

The Vue SVG primitives create the same host nodes the engine already draws; no
engine code is involved beyond the pinned `@react-pdf/layout` and
`@react-pdf/render` packages. The relied-on facts:

- **Svg is a self-contained flex leaf.** `resolveDimensions` gives an `SVG` node
  a Yoga measure function derived from its `viewBox` aspect ratio
  (`layout/src/svg/measureSvg.ts`), so it lays out like an `Image` in normal
  page flow. `renderNode` does not recurse into SVG children. `renderSvg`
  walks the subtree itself (`render/src/primitives/renderNode.ts`). Therefore
  `SVG` is a valid child of `PAGE`/`VIEW` even though the upstream
  `layout/src/types/{view,page}.ts` child unions omit `SvgNode`. That omission
  is an incomplete advisory type, not a runtime rule; `node-ops.ts` deliberately
  adds `Svg` to `PAGE_CHILDREN` on the evidence of the measure function. A future
  reader must not "correct" this back to match the upstream union.
- **SVG presentation is a direct-prop contract.** `resolveSvg` keys off exact
  camelCase names (`strokeWidth`, `fillOpacity`, `stopColor`, `viewBox`) via
  `parseProps`/`pickStyleProps`; `transform` is a prop on SVG groups/shapes,
  unlike `View`, where it is a style key. Although upstream internally merges a
  node's style and props, Nuxt PDF does not expose generic style on `PdfG`,
  shapes, or `PdfTspan`, so that merge is not public precedence behavior. The
  thin components coerce kebab-case template attributes to camelCase
  (`compactProps`); `data-`/`aria-` names stay untouched so `patchPdfProp`
  rejects them.
- **The numeric surface is parsed and validated before layout.** Geometry is a
  finite number/numeric string, plus percentages only for `PdfSvgLength` props;
  stroke width excludes percentages. Dimensions/radii are non-negative,
  opacities and stops stay in their unit intervals, `viewBox` has four finite
  numbers with positive dimensions, and transforms are one to three unitless
  `translate`/`rotate` operations. This is narrower than arbitrary browser SVG
  syntax by design.
- **`url(#id)` references are scoped and fail closed.** Upstream `getDefs`
  indexes a `DEFS` subtree, `replaceDefs` substitutes `fill`/`clipPath`
  references, and then detaches `DEFS`. Nuxt PDF validates before layout that an
  SVG has at most one `PdfDefs`, ids are safe and unique within that SVG, fills
  target gradients, and clip paths target `PdfClipPath`. Missing, malformed, or
  incompatible references fail with `PDF_TREE_INVALID`, so upstream's dangling
  reference fallback is intentionally unreachable. Definition ids are scoped
  per SVG and are a separate namespace from document destination ids.
- **Resolved explicit zeroes are repaired before paint.** Layout parses author
  strings to numbers and resolves a gradient reference into `node.props.fill`;
  the pinned renderer then uses truthiness fallbacks that lose some numeric
  zeroes. `serializePdfLayout` walks the disposable resolved tree immediately
  before `renderPDF`: `fillOpacity: 0` becomes the truthy numeric string `'0'`;
  `strokeWidth: 0` clears the stroke so PDFKit cannot interpret width zero as a
  hairline; linear-gradient `x2` and radial-gradient `cx`/`cy`/`fx`/`fy`/`r`
  zeroes become `'0'` on the resolved definition object. Under the closed
  object-bounding-box gradient contract the renderer coerces those strings back
  to numeric zero at use, preserving authored SVG semantics.
- **Scope exclusions.** `Marker` (and `markerStart`/`Mid`/`End`) has additional
  `resolveSvg` container logic that is intentionally not exposed; the `Defs`
  child set and prop types exclude it. `List`, `Canvas`, `ImageBackground`, and
  form primitives are also out of scope.

Protected by `test/svg-conformance.test.ts` (semantic/raster parity, direct SVG
text fill, and zero-value regressions) and the SVG nesting, prop-surface,
reference-scope, numeric, transform, and casing tests in
`test/renderer.test.ts`.

## PDFKit contract

`@react-pdf/pdfkit` exports a readable `PDFDocument` constructor but publishes no TypeScript declaration. Nuxt PDF carries a narrow ambient declaration for only the constructor, readable-stream behavior and `file()` it uses.

The constructor receives metadata and rendering options. `renderPDF(context, layout)` paints pages, calls `context.end()`, and returns the same readable context. Nuxt PDF must not call `end()` again.

Protected by PDF magic-byte, parse, metadata, stream completion, and stream error tests. The local declaration must grow only when a concrete call site requires another member.

### Attachments

`PdfAttachment` files are embedded with `context.file(buffer, { name, type, description, relationship, creationDate, modifiedDate })`, once per attachment, in `serializePdfLayout` between `createContext` and `renderPDF` (`renderPDF` ends the document, so nothing can be added after it). Serialization runs once per render, on the converged layout, so attachments do not change the pass count. Both dates are the document's own `CreationDate`, so the output stays as deterministic as the metadata. Always pass a `Buffer` that wraps the bytes (`Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)`): `file()` reads a string as a server file path with `fs.readFileSync` (or as a data URL), and a plain `Uint8Array` falls through to that same branch, so passing anything else could embed a server file. The ambient declaration types `src` as `Buffer` for this reason. Protected by `test/attachment.test.ts` (byte equality through the worker, and a string that names a real file path).

### PDF/A-3b

A document with `conformance="PDF/A-3b"` or a `PdfFacturX` child is made PDF/A-3b in `serializePdfLayout` by `engine/pdfa.ts`. A document with neither takes none of these branches and writes the same bytes as before (`test/pdfa.test.ts`, a sha256 of a fixed document). Contracts relied on:

- **PDF version.** `pdfVersion: '1.7'` in the constructor writes `%PDF-1.7`. `endMetadata` writes the catalog `Metadata` stream only when the version is not 1.3.
- **`metadata` (internal).** `end()` calls `endMetadata()`, which appends the engine's own Info XML to `this.metadata` (unescaped, and with `Creator` as `pdf:Producer`) and then writes `metadata.getXML()` uncompressed. Nuxt PDF replaces `context.metadata` with an object that ignores the append and returns its own escaped XMP packet. If an engine update renames the field or stops reading it, the XMP test fails (no `pdfaid:part`).
- **`_root` (internal) and `ref()`.** The output intent is a `ref()` object put into `context._root.data.OutputIntents` before `renderPDF` ends the catalog. The ICC profile stream is a `ref({ N: 3 })` ended with a `Buffer`. Protected by the `/OutputIntents` assertion in `test/pdfa.test.ts`.
- **Standard font marker.** The painter uses the first font of `run.attributes.font`, and a standard PDF font (not embedded) has `type: 'STANDARD'` and `fullName`. `assertEmbeddedFonts` walks the laid-out lines of every node before the paint and fails on a run with glyphs in such a font. Dynamic text (page tokens) is laid out by `layoutDocument`, so its lines are in the layout too. Protected by the three standard-font tests.
- **Annotations.** The engine gives a `Link` annotation the Print flag (`F 4`), as PDF/A requires. A `Text` annotation (`PdfNote`) gets no flag and no appearance stream, so `PdfNote` fails tree validation in a PDF/A document.
- **Embedded files.** `file()` writes `F`, `UF`, `AFRelationship`, the catalog `AF` and `Params/ModDate`. PDF/A needs a MIME `Subtype` too, so an attachment without `type` gets `application/octet-stream` in a PDF/A document only.

The fork's built-in `subset: 'PDF/A-3b'` option is not used: it throws `ReferenceError: __dirname is not defined` and the package ships no ICC profile. veraPDF (`pnpm test:pdfa`, image pinned in `test/pdfa.test.ts`) is the evidence; rerun it after every engine update.

### Tagged PDF (PDF/UA-1, PDF/A-3a)

A document whose `conformance` holds `'PDF/UA-1'` or `'PDF/A-3a'` is tagged in `serializePdfLayout` by `engine/tagged.ts`; its XMP (`pdfuaid:part` 1, `pdfaid:conformance` A) comes from `pdfa.ts`, and it is written as PDF 1.7. A document without the claim takes none of these branches (`test/tagged.test.ts` checks the bytes of a document that uses `tag`, `alt` and `decorative` against the pre-phase-14 hash). The engine adapter (`toEngineDocument`) asks the structure planner of `tagged.ts` about every node in tree order and stores the answer as the internal prop `__nuxtPdfStruct`: the element (role, parent, attributes, inline links and images) and whether the node is a leaf (paints marked content) or a container; pagination copies props to every fragment, so a split text keeps one element. Contracts relied on (pinned sources: `@react-pdf/render` `lib/index.js`, `@react-pdf/pdfkit` `lib/pdfkit.js`):

- **Paint order of a node.** `renderNode` paints `save`, clip, transform, background, borders, the node's paint function, children, `setDestination`, `renderDebug`, `restore`; every step in between pairs its own `save`/`restore`. So when `setDestination` calls `addNamedDestination`, the innermost open `save` is the node's own, and only `renderDebug` paints between the marker and the node's `restore`. `tagged.ts` writes that range of a leaf (the debug boxes and size label of `debug`, with the leaf's closing `Q`) as an artifact, so the label never joins the leaf's text; without `debug` the range is the `Q` alone and stays in the leaf's sequence. Protected by "marks every operator as tagged content or an artifact" (each tagged block is exactly one `q … Q`, the figure's image is inside it) and "writes the debug overlay of a tagged text as an artifact" (the paragraph holds one `BT`, the overlay block after it the label's `BT` and the boxes).
- **`setDestination` passes `node.props.id` unchanged** (it checks `'id' in node.props` and `node.box`), and nothing else in `renderPDF` reads `props.id`. The id of a fragment becomes a `StructureMarker` object right before the paint; our `addNamedDestination` turns it into marked content and passes the author's id of the first fragment on to the real method. Protected by the reading-order test (roles and the `split` destination on page 1).
- **Leaves.** `isRecursiveNode` is false for `TEXT` and `SVG`: a text paints its nested texts as runs of its lines, an SVG its children, and neither calls `renderNode` for them. So marked sequences never nest. Containers (table, row, list, section, a link around blocks) get no marker. Protected by the reading-order test (a nested text is part of its paragraph).
- **Text links.** `transformLink` (`@react-pdf/layout`) wraps the children of a `LINK` node in a new `TEXT` node when they are all text runs, or runs mixed with texts; that text has no props of ours, so such a link is a leaf and its own `save` holds the text. Protected by "writes the nested structure …" (`Link(@)` with content for the block link).
- **Annotations are written at once.** `link(x, y, w, h, url, options)` and `goTo(x, y, w, h, name, options)` pass `options` to `annotate`, which adds `Rect` from the current transform, makes a `ref`, pushes it to `page.annotations` and ends it at once. So `StructParent` and `Contents` go in through `options` (our `link`/`goTo` wraps), and the object reference reads `page.annotations.at(-1)` right after the call. Protected by "ties every link annotation to its Link element".
- **Annotation order.** `renderNode` calls `setLink` (`ctx.link`/`ctx.goTo` with `props.src` or `props.href`) for a `LINK` node with a box before its children; `renderRun` calls them once for every run with `glyphs`, `positions`, a font and `attributes.link` (layout writes `null` or `undefined` outside links), before the run's glyphs. `planAnnotations` walks each laid-out page the same way, so each annotation's element is known before it is written; a mismatch fails the render with `PDF_RENDER_ERROR` ("the engine painted an annotation the structure plan did not expect"). Protected by every test that renders `structuredChildren` (they throw on a mismatch).
- **A run names its link.** `getFragments` (`@react-pdf/layout`) copies a link's `props.href` string unchanged into `attributes.link` of every fragment inside it (an outer link wins over an inner one), textkit keeps it on every run the fragment becomes, and `renderRun` passes it to `ctx.link`, or to `ctx.goTo` without its `#` when it starts with `#`. In a tagged document the adapter sets an inline link's `href` to the href, a NUL and the link element's index (`markedHref`); `planAnnotations` reads the element from the run, and our `link`/`goTo` wraps strip the suffix before pdfkit writes the target. So each `PdfLink` is its own `Link`, also next to a link with the same href. Protected by "writes each PdfLink as its own Link, also next to one with the same target" (two `Link` elements per paragraph, the targets written without the suffix) and "maps the links of a paragraph split over two pages".
- **A run's operators.** `renderRun`: colour operators, the annotation, `renderAttachments` (one `q … Q` with the inline images), `_renderGlyphs` (one `q … BT … ET … Q`), then `translate` (`cm`). An inline link's marked content runs from the annotation to the end of the first group at the next depth that holds `BT`. Protected by "splits a paragraph around its inline links and images" (each Link block is `q … Q` with one `BT`; the paragraph part after it starts with the run's `cm`).
- **Inline images.** `renderAttachment` paints an image in a text with `ctx.image`, which writes one `q … Do … Q`; no other `image` call happens inside a text. Our `image` wrap records the range; it becomes the inline `Figure` (or an artifact for a decorative image). Protected by the same test (one `Do` per Figure block, the ornament an artifact between two parts of the paragraph).
- **The repeated header** (`PdfTableHeader`, `fixed`) is one node that `splitNodes` puts into every fragment of the table, so its leaves are painted once per page with the same element. The first page's content is tagged, later pages' is `/Artifact <</Type /Pagination>> BDC`. Protected by "tags the header on its first page …".
- **Column spans from geometry.** The table components keep `colspan` to themselves (the primitive never sees it). The cells of a row are the row node's direct children, side by side; `ColSpan` is the number of column starts (the starts of all cells of the table, `box.left - box.marginLeft`) from a cell's start to the next cell's start. Protected by "tags the header on its first page …" (`ColSpan 2` on the total cell only).
- **The laid-out string of a text** (`@react-pdf/layout` `getFragments`): each text instance becomes `transformText(value, instance.style.textTransform)` with the instance's resolved (inherited) style; `transformText` is `toUpperCase`, `toLowerCase`, `@react-pdf/fns` `capitalize` (`/(^|\s)\S/g` upper-cased) or `upperFirst`; a raster image in a text is U+FFFC; nested texts follow in order; `letterSpacing` becomes `attributes.characterSpacing` of the runs. `tagged.ts` rebuilds this string (`textSource`) to map it back to the template text for `/ActualText`. Protected by "writes the source text of transformed and letter-spaced texts as ActualText" (exact source strings for `capitalize`, `uppercase`, a nested `lowercase`, letter spacing alone and a text-only cell).
- **Lines of a text** (`@react-pdf/textkit`): `line.string` holds the line's characters without line breaks (`\n`) and without soft hyphens, keeps trailing spaces, and ends with an added `-` where the line breaker split a word; the lines of a text are consecutive slices of the laid-out string, and `splitText` gives each page fragment a consecutive slice of the lines. `fragmentSources` walks the lines against the laid-out string under exactly these rules; a line that does not match (for example an ellipsis from `maxLines`) ends `/ActualText` for that text from there on. Protected by "writes the source text of each page's part of a split text …" (the parts of a hyphenated paragraph in capitals over several pages join to its source).
- **One writer of the content stream.** Every operator goes through `addContent(data)` → `page.write`; `save`/`restore` call `this.addContent`. We keep a page's operators in a list and write them with `page.write` when the page ends: in `addPage` (before the next page) and in `end()`, both called through `this`, so wrapping them on the instance is enough. `addPage` itself writes the page's flip transform through `addContent`, after it has set the new `page`. Protected by "marks every operator …" (no operator outside marked content; two pages).
- **`page.dictionary.data`** is written when the page ends, so `Tabs /S` and `StructParents` set at our flush reach the file. Protected by the catalog test (`/Tabs /S` and `/StructParents` once per page).
- **Parent tree keys.** Pages (`StructParents`) and annotations (`StructParent`) share one counter; `ParentTree` lists them in key order, and `ParentTreeNextKey` is the number of keys. A page's key holds the array of its MCIDs' elements, MCID n at position n. Protected by "keys the parent tree by page and annotation, and maps each MCID of a page to its element" (keys 0 to `ParentTreeNextKey` − 1, and every array entry is the element whose MCR names that page and MCID).
- **`end()` → `endMarkings()`** ends `_root.data.StructTreeRoot` and `_root.data.MarkInfo` when present (and the empty `structChildren`). Both are `ref()` objects we create in our `end` wrapper and do not end ourselves; the elements we end. If an engine update stops ending them, the document never finishes and every tagged test times out; if it ends them twice, pdfjs cannot read the tree.
- **Plain dictionaries.** `PDFObject.convert` writes JS objects, arrays, numbers, names (JS strings), `String` objects (PDF text strings) and references. `ParentTree` is a direct `<< /Nums [...] >>`, so pdfkit's `PDFNumberTree` (which `convert` does not recognise) is never used, and we do not pass `tagged: true` to the constructor (it would create one). Protected by "writes the structure tree as plain dictionaries" (the exact form of `StructTreeRoot`, `MarkInfo`, every `StructElem`, its `MCR`/`OBJR` kids and an `Alt` text string).
- **Figures and row headers need no engine contract of their own.** A `PdfView tag="figure"` is a container like a section; its texts, images and SVGs are leaves that paint marked content of the `Figure` (the leaf rules above). A body cell with `header` is `TH` with `A << /O /Table /Scope /Row >>`; `PdfTableCell` marks it with the internal prop `__nuxtPdfHeaderCell`, which the adapter removes before layout (`test/tagged.test.ts` "write the same bytes with and without header and figure props").
- **Strip-only TypeScript.** The worker loads engine files with type stripping, which rejects parameter properties; `StructureMarker` uses plain fields.

veraPDF `--flavour ua1` and `3a` (`pnpm test:pdfa`, fixtures in `test/fixtures/tagged-document.ts`) is the evidence; rerun it after every engine update.

### Reproducible output

Two renders of the same tree with the same `creationDate` write the same bytes. `engine/reproducible.ts` wraps `ref` and `openImage` on our document instance, right after the constructor, for every render. Without it pdfkit varies in three places: a random six-letter subset tag per embedded font (`Math.random`, "generate a random tag"); compressed streams written when their asynchronous zlib deflate ends, so their order follows the thread pool; and PNGs with an alpha channel, `tRNS` transparency or interlacing, inflated asynchronously, whose callback creates the soft mask object (its number) and writes it and the image. The file is written as: synchronous objects in `end()` order, then the compressed streams in `end()` order, then the image callbacks in embed order, then the xref. This is the order an unloaded process mostly produced before, so documents whose writes finished in that order keep their bytes (the `test/pdfa.test.ts` and `test/tagged.test.ts` hashes did not change). Contracts relied on (`@react-pdf/pdfkit` `lib/pdfkit.js`, `png-js` 2.0.0):

- **`ref()` is the only constructor of `PDFReference`**, and pdfkit calls it through `this.document` / `this`, so the instance wrap sees every object, including fonts, images, pages and attachments. The constructor's own objects (catalog, `Pages`, `Names`) are created before the wrap; none of them is a compressed stream.
- **`finalize` is an own property**, bound in the `PDFReference` constructor. An uncompressed `end()` calls `this.finalize()`; `initDeflate` (on the first compressed `_write`) registers `this.finalize` as the deflate's `end` listener. So replacing it right after `ref()` returns catches both paths. **`deflate` is `null`** until that first compressed write; after `end()`, a non-null `deflate` means the object is written later. Protected by "gives every reference an own finalize …" in `test/reproducible.test.ts`.
- **The subset tag is written only as `FontName` (descriptor) and `BaseFont` (CID font, Type0 font)**, each read by `finalize` from `data`. The Type0 dictionary is `font.ref()`, created through `document.ref()`, its `data` replaced before `end()`. We rename `^[A-Z]{6}\+` in those two keys at finalize time to `AAAAAA`, `AAAAAB`, … in order of first appearance. Protected by "names font subsets …" (exactly two tags in the file, six names).
- **Painting is synchronous** (`renderPDF` ends the document in the same call; see "PDFKit contract"), so every compressed stream has been ended before the first deflate or inflate callback runs; the stream queue is complete when the first callback arrives.
- **`openImage(src)` is called through the instance** for every new image: by `renderImage` (`ctx.openImage`) and by `image()` (`this.openImage`, inline images and image buffers). It returns the `PNGImage`; its `image` is the png-js decoder, and `embed` calls `image.decodePixels(fn)` once, synchronously, for an image that needs decoding, with `fn` run after an asynchronous `inflate`. We wrap `decodePixels` on that decoder. A JPEG has no `image`. Protected by "opens a PNG with a png-js decoder …" (the callback is asynchronous and gets the pixels) and "writes streams in end() order and image callbacks in embed order".
- **The trailer `/ID`** is an MD5 of the `Info` values and `CreationDate` (`PDFSecurity.generateFileID`), so it is fixed by the metadata. A render without `creationDate` uses the current time and is not reproducible.

If an engine update breaks one of these, "the same tree gives the same bytes" in `test/reproducible.test.ts` fails (five renders in parallel).

### Forms

`PdfTextField`, `PdfCheckbox` and `PdfSelect` are laid out as the engine's `TEXT_INPUT`, `CHECKBOX` and `SELECT` nodes with our own props and `wrap: false` (the layout splits any node not in `NON_WRAP_TYPES` without it). `engine/forms.ts` (`prepareForm`) runs before `renderPDF` when the layout holds a field and returns the layout to paint; a document without fields gets its layout back, takes no other branch and writes the same bytes. In the paint layout every field node is a `TEXT_INPUT` without border widths and background: its paint function (`renderTextInput`) only calls `formText(name, left, top, width, height, …)` under the current transform, and Nuxt PDF writes the field. The engine's checkbox paint (`parseCheckboxOptions`, a ZapfDingbats font object and two form XObjects per box) and its option parsers never run.

Replaced or wrapped on the document instance (`@react-pdf/pdfkit` `lib/pdfkit.js`, `@react-pdf/render` `lib/index.js`):

- **`formAnnotation(name, type, x, y, w, h, options)` (internal)** is what `formText` calls through `this`; it calls `_fieldDict`, sets `Subtype /Widget` and `F 4`, and calls `annotate` with the box. Our replacement ignores the engine's `type` and `options` and calls the original with the pdfkit type of our field (`text`, `checkbox`, `combo`) and options built from our props: flags (`readOnly`, `required`, `multiline`, `edit`), `value`/`defaultValue` (which `VALUE_MAP` turns into `V`/`DV`), `select` (`Opt`), `MaxLen`, `Q`, `TU`, `MK` (`BG`, `BC`, already as 0–1 operands, so `_resolveColors` is not used), `BS`, `DA`, `AS` and `AP`.
- **`_resolveFont(options)` (internal)** would replace a field's `DA` and `DR` with the paint font of the moment. We replace it with the identity; each text and choice field has its own `DA` with Helvetica, its size and colour.
- **`_fieldDict(name, type, options)` (internal)** runs `_resolveStrings`, which turns the checkbox `V`/`DV` strings into text strings. Our wrap turns them back into JS strings, which `PDFObject.convert` writes as names (`/Yes`).
- **`initForm()` (internal)** creates the AcroForm with `this._font` in `DA` and `DR` and `NeedAppearances true`. We call it after `font('Helvetica')`, delete `NeedAppearances` and set `DA` to `10 Tf`. The render functions call it only when `_root.data.AcroForm` is missing.

Still used as they are:

- **`font('Helvetica')` and `_font`**: a `StandardFont` with pdfkit's AFM data. Its `encode(text)` gives the WinAnsi codes (hex) and unkerned glyph widths (`advanceWidth`), `ascender`/`descender` and `lineHeight(size, true)` place the lines. Nuxt PDF has no width table of its own. The font object is written once (`embed`) as `/BaseFont /Helvetica /Encoding /WinAnsiEncoding`.
- **`_normalizeColor`** turns the resolved style colours into operands, as for page paint.
- **`ref()` and `PDFReference#end(buffer)`** write each appearance stream as a form XObject, deflated when the document compresses and encrypted by `finalize` when it is protected. We pass a `Buffer` (the stream is ASCII); a string chunk would get a newline appended.
- **`annotate`** writes `Rect` from the box under the current transform, `Border [0 0 0]` (ignored by readers when `BS` is present) and `C [0 0 0]` (unused by widgets). It also adds a capitalized copy of every key and keeps the lowercase one; every key we pass is either capitalized or removed by `_fieldDict` (flags, `value`), so no lowercase key is written (asserted).
- **Layout values**: `node.style` after inheritance (`fontSize`, `color`, `textAlign` inherit like text), `node.box` border and padding widths (resolved lengths). The style decides whether padding was set at all.

Protected by `test/forms.test.ts`: field data and rects through pdf.js, the fill round trip, the byte checks (`/V /Yes`, Helvetica in `DA` with the size, no `NeedAppearances`, no ZapfDingbats, `AP /N` on every widget, no lowercase key), the exact appearance streams, and a pdf.js raster drawn from them. If an engine update changes one of these members, those tests fail.

### Encryption

A document with `protection` is encrypted by `engine/protection.ts` with AES-256, revision 6 (ISO 32000-2, 7.6.4). pdfkit's own `PDFSecurity` writes AES-256 only as revision 5 (`pdfVersion: '1.7ext3'`), which ISO 32000-2 deprecates and whose password check is one SHA-256; Nuxt PDF never passes `userPassword`, `ownerPassword` or `permissions` to the constructor, so pdfkit's handler stays `null` and never writes RC4, AES-128 or revision 5. `protectDocument` runs right after the constructor, before `makeOutputReproducible` and before any object is ended. A document without `protection` takes none of this and writes the same bytes as before. Contracts relied on (`@react-pdf/pdfkit` `lib/pdfkit.js`):

- **`_security` (internal).** The constructor sets it from `PDFSecurity.create`, which returns `null` without passwords. Nuxt PDF replaces it with an object of three members, typed as `PDFSecurityHandler` in the ambient declaration.
- **`getEncryptFn(id, gen)`.** `PDFReference#finalize` calls it once per object when `_security` is set, passes the stream bytes (after the deflate) through the returned function, and passes the function to `PDFObject.convert`, which applies it to every `String` object and `Date` value in the dictionary. JS strings (names), numbers, references and `Buffer` values (hex strings) are not encrypted. Revision 6 uses one file key for every object, so `id` and `gen` are ignored; each call encrypts with a new random IV (IV ‖ AES-256-CBC with PKCS#7 padding).
- **`dictionary` and `end()`.** `end()` calls `_security.end()` after the catalog; our `end()` ends `dictionary`, a `ref()` whose `O`, `U`, `OE`, `UE` and `Perms` are `Buffer`s, so they are written as hex and never encrypted. `_finalize` writes it as the trailer's `/Encrypt`.
- **The trailer `/ID`** stays the MD5 of the metadata (`PDFSecurity.generateFileID`); revision 6 does not use it.
- **Version and extension.** `pdfVersion: '1.7'` writes `%PDF-1.7`; `protectDocument` adds `Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >>` to `_root.data`, which `end()` writes.

Protected by `test/protection.test.ts`: pdf.js opens the file with the open and the owner password and not without one, and the `/Encrypt` entries and `/P` are as written. If an engine update stops calling `getEncryptFn` (content written in clear) or stops writing `/Encrypt`, the open tests fail.

## Font contract

A fresh `FontStore` contains the standard PDF fonts. Additional local fonts are registered before layout and the same store is passed to `layoutDocument`.

Every render creates its own `FontStore`; renders never share one. fontkit caches glyph objects per parsed font, and a glyph first loaded as a component of a composite glyph (the O inside Ö) is cached without its code point. A later render that reuses the store then drops that letter. A fresh store per render costs no measurable time, because fontkit parses tables lazily. Protected by the composite-glyph test in `test/isolation-stress.test.ts`.

Font resolution runs *inside* the layout pipeline (`resolveAssets` calls
`fontStore.load`), so a missing family throws during `layoutDocument`. Nuxt PDF
surfaces this as a single `PDF_LAYOUT_ERROR` carrying React PDF's own exact
message (`Font family not registered: <family>` / `Could not resolve font for
<family>, fontWeight <weight>`). Font failures are deliberately **not** sub-classified
into a separate error code: `@react-pdf/font` throws a plain `Error` with no
machine-readable signal, and the only way to isolate the font sub-stage would be
to walk the tree and call `fontStore.getFont` per descriptor. This would duplicate the
`resolveAssets` traversal this file forbids. The precise family is already named
in the preserved message, so no re-classification is needed.

Protected by the local-font conformance fixture. Asset policy, path validation, and registration ownership live outside the engine and must run before layout.

## Remote resource boundary

Both of React PDF's remote fetch seams are structurally unreachable. Our code
converts every allowlisted remote image into validated bytes before layout, and
only registers build-embedded local font data URLs.

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

When `pdf.remote` is configured, `fetchRemoteResource` (`assets/remote.ts`)
accepts exact HTTPS image prefixes only, re-checks every one of at most three
redirects, sends credential-less `GET`s, and uses the render's shared deadline,
abort signal, request/concurrency limits, and byte budgets. PNG/JPEG structure
and dimensions are validated before the engine receives bytes. Remote fonts are
unconditionally rejected. The engine's own fetch code stays dead. Protected by
`test/remote.test.ts`.

## Render worker

Layout and serialization run in a worker thread from a pool
(`server/worker-render.ts`); the decision is "Render worker" in
`internals/decisions.md`. The worker receives the admitted plain-data tree by
structured clone and imports no Vue (`test/worker-render.test.ts` walks the
import graph of `worker-entry.ts`). At the render deadline the worker is terminated,
which stops layout inside one engine step. A build that inlines dynamic imports
in production has no worker chunk and renders in-process, where the deadline is
checked between engine stages only.

Image bytes arrive in the worker as `Uint8Array`; `worker-entry.ts` wraps them
as `Buffer` again without a copy, because the engine's image decoder reads
`Buffer` methods.

The engine itself is unchanged by this boundary: the same adapter output is laid
out in both places.

## Deliberately unused contracts

- React reconciler and renderer lifecycle
- React hooks and DOM helpers
- `PDFViewer`, `PDFDownloadLink`, and `BlobProvider`
- deprecated string rendering
- private PDFKit page-mode mutation
- arbitrary React-node dynamic render results (the one exception is the
  page-conditional carrier above: its result is built by the adapter from
  admitted views, texts and tokens, with geometry tests)
- author-supplied functions in the tree (`render`, `hyphenationCallback`)

Any proposal to use one of these requires a documented acceptance criterion and an update to this file.
