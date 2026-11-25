# React PDF engine contracts

Nuxt PDF replaces React PDF's reconciler, renderer and PDFKit. Its layout is a port of `@react-pdf/layout`, its text engine a port of `@react-pdf/textkit`, its painter a port of `@react-pdf/render`, and its PDF file comes from its own writer. The lower engine packages it imports are fontkit and yoga-layout, and for the text engine `bidi-js`, `hyphen`, `linebreak` and `unicode-properties` (table below). This file records every non-obvious contract relied on by the compatibility kernel.

**Reference commit:** `d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`

## Pinned packages

| Package | Version | Imported symbols |
|---|---:|---|
| `fontkit` | 2.0.4 | `create` in `engine/fonts.ts` (`parseFont`); no published types, ambient module `engine/fontkit.d.ts` |
| `yoga-layout` | 3.2.1 | imported by the layout port (`layout/`); pinned exactly. Images are sized with our own header reader (`engine/image`, `readImageHeader`), the one admission uses |
| `bidi-js`, `hyphen`, `unicode-properties` | 1.0.3, 1.14.1, 1.4.1 (as `@react-pdf/textkit` 6.3.0 resolved them) | imported by the text engine (`text/itemize.ts`, `text/hyphenation.ts`, `text/compose.ts`); pinned exactly |
| `linebreak` | 1.1.0 | the UAX #14 break opportunities of the text engine (`text/words.ts`, D44); pinned exactly |

**Painter (D37).** `paint/**` is our port of the
`@react-pdf/render` 4.5.1 walk (no longer a dependency): pages, boxes, links,
destinations, notes, bookmarks, text, images, SVG and the `debug` overlay. It
paints through the `PdfWriter` seam (`pdf/writer.ts`), which our writer
implements (PDF writer contract). A paint oracle proved equal bytes on the
whole suite, the invariant harness and the raster suite before the old painter
was removed, with one difference accepted by name: the old painter joined
clip-path shape props that are numeric strings as text (`'10' + '20'`), ours
reads them as numbers (`test/paint-paths.test.ts`). The writer then replaced
PDFKit after a comparison of both on every paint audit document (D37).
The statements below that cite `render/src/…` describe the walk the painter
ports.

**Layout (D19, E1).** The runtime imports `default layoutDocument`,
`DocumentNode` and `SafeDocumentNode` from `layout/index.ts`. `layout/` is our
TypeScript port of `@react-pdf/layout` 4.6.1 (D38); the package is no longer
installed. Until the copy was removed, an oracle compared the port with the
copy (the copy plus its corrections of D19) and proved equal bytes on the
suite, the invariant harness and the raster suite, apart from two deliberate
pagination differences (`test/engine.test.ts`). The statements below that cite `@react-pdf/layout` describe the
behavior the port keeps. An upstream layout fix is ported by hand, with a test
that fails without it. The other runtime imports use package roots, with no
patches.

**Text engine (D36, E3).** `text/` is our TypeScript port of
`@react-pdf/textkit` 6.3.0; the package is no longer installed. It keeps
the D30 line-breaking rule of the copy it replaced: spaces have no shrink, a
hyphenation point has the width of its hyphen, a line wider than its box
without shrink is never a candidate (except when it is wider by at most
1e-6), and only justified lines that fit are
justified. Until the copy was removed, an oracle compared every result of the
port with the copy's own `layoutEngine` and found no difference on the suite
and the invariant harness, apart from deliberate fixes. The
layout asks the text engine for `layoutParagraphs(fragments, box, options)`
(`text/index.ts`), one fixed pipeline of direct calls in textkit's order,
or `fitParagraphs` with the same arguments, which also counts the lines
that the box's height cut off (for `PDF_CONTENT_HIDDEN`), for
`measureParagraphs` (below) and for the hyphenation patterns
(`loadHyphenation`, `patternKeyOf`). An upstream textkit fix is ported by hand, with a test that fails without it.
`measureParagraphs(fragments, options)` (`text/measure.ts`) gives the content
widths of a text in points, for automatic table columns: `maxContent`, the
widest paragraph on one line without the spaces at its start and end (the
line breaker gives them no room), and `minContent`,
the widest piece between two places where the line breaker may break, with
the hyphen it adds there. It runs the pipeline of `layoutParagraphs` up to
shaping and measures as the line breaker does, so a text laid out
`minContent` wide overflows no line and one `maxContent` wide keeps each
paragraph on one line (`test/text-layout.test.ts`). It shapes the same strings
as the layout, so the render's shaping cache serves both (`test/work-budget.test.ts`).
The widths are sums of floats: a caller that hands them to yoga as a size
rounds them up or adds a small margin.
Shaping (`text/shape.ts`) calls `font.layout(string, undefined, undefined,
undefined, 'ltr')` for an embedded font, and `layout(string)` for a standard
font. A render's font returns the same object for the same
string (`fontForRender`, engine/fonts.ts), so the layout never writes into
it: shaping copies every position, and justification adds to those copies.

## Engine upgrade drill (runbook)

These pins are deliberate. The output depends on exact behaviour of these
packages (yoga's layout, fontkit's glyphs and shaping, the Unicode line break,
bidi and hyphenation data), so every bump is decided by conformance evidence,
not by the version number. Run this drill whenever a newer stable release
appears.

**Steps**

1. Check for newer *stable* releases only:
   `npm view <pkg> dist-tags` for each of `yoga-layout`, `fontkit`,
   `linebreak`, `bidi-js`, `hyphen` and `unicode-properties`, and compare each
   `latest` tag against the pins table above. `@react-pdf/layout` and
   `@react-pdf/textkit` are not dependencies; read their releases only to find
   upstream fixes to port by hand. Ignore `beta`/`reactpdf`/other pre-release
   tags. If no `latest` exceeds its pin, record that fact and stop. The pins
   hold.
2. On branch `drill/engine-bump`, bump the pins together, then
   `pnpm install`. Bisect per-package only if the combined bump fails.
3. Run the full evidence chain and record exact results:
   - `pnpm lint`
   - `pnpm test` (including the conformance fixtures and raster baselines)
   - `pnpm typecheck`
4. Re-verify each documented contract below against the new engine source in a
   read-only checkout of the upstream source at the new version (this
   repository keeps none). Update the **Reference commit**
   and this file for any wording that changed. The contracts most likely to
   drift silently. Verify these contracts by reading the source:
   - Layout contract: `layoutDocument` still resolves fonts through the
     render's font store.
   - Dynamic text contract: dynamic-node detection still keys on the `render`
     prop that the adapter writes for page tokens; the paint call still passes `subPageNumber` and
     `subPageTotalPages`.
   - Oversized blocks: a page `size` without a height still lays the page
     out at its content height.
   - Layout purity: `resolveBookmarks` still rebuilds nodes and never changes
     its input.
   - Named destination contract: the writer's `destinations` map stays
     last-writer-wins, and the names are written sorted.

**Gates:** Every gate must pass:
`pnpm lint`, `pnpm test`, and `pnpm typecheck` (the full gate is
`pnpm verify`).

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

The Vue renderer creates this plain node shape (the one `@react-pdf/renderer` created, which the layout port reads):

```ts
type ElementNode = {
  type: string
  box: Record<string, unknown>
  style: unknown
  props: Record<string, unknown>
  children: Node[]
}

type TextInstance = {
  type: 'TEXT_INSTANCE'
  value: string
}
```

`PdfElementNode` (`runtime/renderer/types.ts`) also has the optional host-only fields `source`, `component` and `richImage`, which never become engine props or styles.

Only `DOCUMENT` is accepted as the root passed to layout. Raw text is retained only below `TEXT`, `LINK`, `TSPAN`, `NOTE`, and `FOOTNOTE`. Vue comments and fragment anchors are renderer bookkeeping and never enter `children`.

Protected by `test/renderer.test.ts` and the conformance fixture. An incompatible change will fail exact tree assertions or layout before PDF serialization.

### Closed authoring-input contract

The host-node shape matches the engine; the public input surface deliberately
does not match every upstream prop or stylesheet key. `runtime/primitives.ts`
declares each primitive once (tag, props with their checks, children, text,
destination, context) in one table, put together from one file per component
group in `runtime/primitives/`; components, the prop allowlist, nesting and
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

`layoutDocument(document, fontStore)` (`layout/index.ts`) is our own function: it accepts a `DocumentNode` and the render's font store and returns a `SafeDocumentNode`.

Layout resolves styles, assets, text, dimensions, pagination, page indices, links, and bookmarks. Nuxt PDF does not duplicate those stages.

**Style step.** `layout/styles/` is our port of `@react-pdf/stylesheet` 6.2.1,
with our own types (`Style`, `ResolvedStyle`, `Transform` in `layout/types.ts`).
Relayout during pagination resolves only the styles of nodes a page callback
returned, and only those take what their parent passes down; a resolved style
stays as it is (`resolvePageStyles`), because inheriting into it again is not a
no-op (text decorations add up, and `underline underline` is no underline):
`flatten.ts` merges style arrays, `units.ts` converts lengths to points
(`readPdfPoints` reads the point forms admission takes), and `expand.ts`
expands shorthands and parses transforms. Colours pass through as written;
the painter reads them with `readPdfColor` (`shared/color.ts`), the one colour
reader, so an alpha stays exact. A unitless `lineHeight` stays a factor
(`LineHeightFactor`) through inheritance, as in CSS; `text/fragments.ts`
multiplies it by each text's own font size. A percentage stays as written
until inheritance (`styles/inheritance.ts`) makes it points of the element's
computed font size; children inherit the points. A percentage `fontSize`
likewise becomes points of the inherited font size there, before the
`lineHeight` step, so no reader after inheritance sees a percentage. An `em`
length (admitted on `width`, the margin and padding sides, `rowGap` and
`columnGap`; `PDF_EM_STYLE_KEYS`) stays a string through expand and becomes
points of the node's computed font size in the same step, so no reader after
inheritance sees one; the page-child percent heights run after inheritance
for that reason (`layout/index.ts`), as they read the page paddings; the
`rem` base reads the page's own `fontSize`, where mount rejects one. It has
a rule only for the keys admission lets through (`shared/style-values.ts`) and
the keys the engine writes itself (SVG paint); media queries,
`transformOrigin` and the border shorthands with a width, style and colour
are gone. `objectPosition` came back as a CSS property: `expand.ts` writes
`objectPositionX` and `objectPositionY`, the keys `paint/image.ts` reads, with
the parser admission uses (`pdfObjectPositionParts`, a keyword as its
percentage, a length in points). Before the cut, every style of the suite and of the
invariant harness at CI size went through both and they were equal, keys in
order included. One
deliberate difference: an hsl() channel exactly half way between two whole
values rounds up; the package's float arithmetic could round it down
(`hsl(350, 60%, 75%)` is `#E699A6`, was `#E599A6`).

The layout result is derived and disposable. The mounted Vue tree remains the canonical pre-layout tree.

Protected by the engine integration and conformance tests. An incompatible change will fail type checking, semantic PDF assertions, or raster comparison.

### Layout purity contract (multi-pass re-layout)

The mounted tree is plain data and is admitted once (tree limits, metadata,
image and remote policy) before it reaches the engine. The engine never sees
the mounted tree itself: `toEngineDocument` (`plain-tree.ts`) copies every
element (node, props, children array) into the tree that layout reads, and
turns page tokens into the engine's callbacks. The text layout reads the
inherited style key `hyphens` and the pattern file that
`prepare/hyphenation.ts` puts on each text (`layout/text/layout.ts`).
The layout decodes admitted image bytes only: a `PdfImage` whose `src` is not
a `Buffer` fails with `PDF_ASSET_INVALID` (`layout/assets/index.ts`). It never
opens a path, URL or data URL itself.

`layoutDocument` treats its input as immutable for every node it re-parents:

- **Every pipeline step rebuilds nodes, never in place.** `layoutDocument`
  (`layout/index.ts`) runs the steps in order. Each step maps children into a
  fresh array and returns a new node (`{ ...node, updated properties }`). The
  first step to touch a node's descendants (`resolveBookmarks`, executed 3rd)
  copies the whole tree with new props objects, so pagination, dimensions, and
  text layout all mutate **copies**, never the input.
- **`box` on the input is never populated.** `resolveDimensions` builds a
  brand-new `box` object (`layout/dimensions/index.ts`) rather than writing
  into the shared one.
- **`resolveBookmarks` rebuilds the tree too.** It numbers the bookmarks into
  new props objects (`{ ref, parent, ...bookmark }`); a title alone becomes
  `{ title, fit: false, expanded: false }`. The input props keep what they had.

Every document goes through the fixed-point loop (`layoutToFixedPoint` in
`plain-tree.ts`). Each
pass rebuilds the engine tree from the plain-data tree with the facts of the
previous pass (`PlainLayoutFacts` in `plain-tree.ts`): destination pages when
the tree prints a `PdfPageRef`, and the views that must start on a new page
(see "Repeated and page-conditional content"). Vue does not render again.
Convergence is a fixed point: the facts that a layout *produces* equal the
facts that it used. A document that uses none of them stops after
**1 pass**, page-conditional nodes included (the builder knows each part's
place in its parent); one with `PdfPageRef` or a moved header needs
**2 passes**.
Non-convergence is capped at `maxPasses` (default 5) and raises
`PDF_LIMIT_EXCEEDED`; the message shows the facts the last pass was laid out
with and the different facts it produced.

Protected by `test/page-primitives.test.ts`: a structured clone renders the
same PDF and the mounted tree is deep-equal before and after layout; the
converged two-pass render is byte-identical to one layout of the final numbers,
with nested bookmarks and page-token footers in the document; documents
without page facts converge in one pass; a document that needs more passes than
`maxPasses` fails with the facts of its last pass.

### Named destination / internal link contract

A node's `id` prop becomes a PDF named destination anchored at the node's page
and `box.top` (`render/src/operations/setDestination.ts:10`, called from
`renderNode.ts` for **every** node; ours: `markPlaces` in `paint/links.ts`, which maps the box through the current matrix, so a nested node's destination is its place on the page). A `Link` whose `src` (or `href`) starts with
`#` renders as a `goTo` to that name rather than an external `link`
(`render/src/operations/setLink.ts:7,13`). pdfjs reports the resulting Link
annotation's `dest` as the raw id string.

**First-page ownership (a Nuxt-PDF divergence).** Pagination splits a node that
crosses a page boundary into a fragment on every page it touches, each keeping
`props.id`. Upstream calls `setDestination` for all of them and its NameTree (pdfkit's)
is last-writer-wins, so React PDF's destination for a page-spanning `id` points
at the section's **last** page. Nuxt PDF instead anchors every destination at the
section's **first** page, because a table-of-contents entry names where a section
*begins*. Two seams enforce this, both in `destinations.ts`:

- `extractDestinationPages` is **first-writer-wins** over the ordered page list
  (`layout.children`), so the destination-page map that the multi-pass loop feeds back (and
  the printed TOC number) is the earliest page an id appears on. An empty
  fragment (a text part with no line, or a view part with no child and no
  height) does not count when the id also appears with content: pagination
  can leave such a fragment above the page end where the content starts.
- `serializePdfLayout` (`render-document.ts`) runs `anchorDestinationsAtFirstPage`, which walks the
  final pages in order and deletes `props.id` from every fragment of an
  already-seen id, and from empty fragments counted out above, **before**
  painting, so the single surviving `markPlaces` call targets the first
  fragment with content. The NameTree entry for a click has the same target.
  This runs on the converged layout of every render and mutates only the
  derived, disposable layout.

The printed TOC number and the jump target thus share one source of truth.
Protected by `test/page-primitives.test.ts` (the page-spanning regression for
both seams) and `test/internal-links.test.ts` (non-splitting targets).

Bookmarks follow the same rule. Upstream adds an outline entry for every node
part that carries `props.bookmark`, so a bookmarked node split over three pages
had three entries. `anchorDestinationsAtFirstPage` also keeps a bookmark only on
the first part with content; the parts share the `bookmark.ref` that layout
gives each bookmarked node. Protected by the invariant harness (I14, saved case
`flow-b1-bookmark-repeated-per-page.json`).

### A run names where a nested text starts

A nested `PdfText` with an `id` or a `bookmark` gives the first fragment of its
text `style.anchors`: `{ id?, bookmark? }` of every nested text that starts
there, the outer one first (`layout/text/fragments.ts`; the outer text's own
`id` and `bookmark` stay its node's, see above). The text layout keeps them
as `run.attributes.anchors` on each run of that fragment; a run that a line
break or a font change splits keeps them on each part. The first run in
reading order that has them starts at the nested text's first glyph. The text
painter writes a nested text's `id` as a named destination at the top of the
line of that run (`renderRun`, once per document); a footnote's note number
links back to its mark this way. `extractDestinationPages` reads the same
runs, so the page map (a `PdfPageRef`, a footnote mark) has the page of that
run, not the page of the first part of the outer text: every part of a split
text keeps all of its nested texts as children. Outline entries do not read the attribute.
Protected by "anchors of nested texts" in `test/text-layout.test.ts`,
"uses the page where a nested text starts in a split paragraph" in
`test/page-primitives.test.ts`,
"places the destination of a nested text at the top of its first line" in
`test/internal-links.test.ts` (a nested text over two lines), and "prints
each note at the bottom of the page of its mark" in
`test/footnote-component.test.ts` (a mark on the second line of its
paragraph).

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

A dynamic text longer than the room splits as any text (`paginate/dynamic.ts`,
`dynamicTextCut`, from `splitText`). Its callback returns its parts, static
strings and token values told apart; the kept lines are walked against the
laid-out string, and the place where they end becomes a position in the parts
(part index, offset). The part that stays renders the parts up to it, the rest
the parts from it, with the values of its own page, so no word is lost or
printed twice when a value changes length (9 to 10). A cut inside a token
value moves to its end: the token stays whole on the page of its first glyph
(the line breaker never breaks inside a run of digits, so no document reaches
this). A part whose parts render the same again keeps its lines: the
line breaker chooses breaks for the whole paragraph, so the kept range laid
out alone could break differently and need more room. The page builder gives
page numbers and counts reserved digits, so their parts render the same
again, and paints them into the kept lines
(`relabelPageTokens`, which skips the tokens of the other parts). Protected by
`test/dynamic-split.test.ts`.

## Footnote contract

A page node may carry `notes` beside `children`: the footnote bodies of that
source page, each a `TEXT` whose `props.id` its marks name, and `noteArea`,
a `VIEW` without children (below). A mark is any run
whose `link`, cut at the first U+0000 (the tagged suffix, `markedHref`), is
`#` and the id of a note of the same page; the engine adds no run attribute.
Our own steps, no engine package:

- **Laid out once** (`layout/notes.ts`): after the page sizes, each page's
  notes become the children of its note area on a page of their own (the
  page's text styles, width and side edges, no vertical padding) that runs
  through every stage to the text layout and comes back as the page's
  measured `noteArea` and `notes`. So a note
  loads its fonts and images as the flow does, and no split lays it out
  again.
- **The fit** (`fitNotes` in `paginate/builder.ts`, for a page with notes
  only): each try fills the page to a height by sums; none lays out again.
  The height first goes down to the wrap area minus the notes of the
  references that stay, until they fit; then it goes up to the next height
  at which the fill takes more, while the notes fit. `placeNotes`
  (`paginate/notes.ts`) places them. The notes count whole, after the parts carried from
  the page before, except the last, which counts its start (`startLines`)
  and gets the room left (`splitText`, orphans and widows kept); the rest
  goes first on the next page. A page that cannot fit its notes, or that
  keeps no flow line with nothing carried, tries the splits at the line and
  box ends from the content top (a split above a line can keep a whole block
  instead, as a break at the page top that gains nothing does not happen):
  the first that keeps flow and fits, then up from it; else
  the one that keeps flow and ends highest. Such a forced page cuts its
  notes to the room, each at least one line (as `splitText` does for a text
  that never fits): a cut leaves one line for each note after it, so every
  note whose reference stays starts on the page. A page of note lines takes
  something, for the "Pagination cannot end" guard.
  - A split container reaches as low as the room the split gave it, or
    lower where a child it keeps whole does (`extentOf`).
  - A block with `wrap={false}` that moved whole to the page is unsplittable
    again for the fit when it fits the page (`unsplittableAgain`): the move
    lets only a block higher than the page split there.
  - A flow that ends below the page end holds a block higher than the page,
    which the relayout shrinks: the notes take their room at the page
    bottom, and the flow is shrunk above them (`NoteFit.shrinks`).
- **The area** is the page's `noteArea`, a view whose style is the area's
  (none: a view with no style). Its own children, if any (the feature side
  puts a short rule there), are laid out once with it and come first on
  every page part, before the notes; the engine knows nothing of what they
  draw. The notes are laid out as its children after them, so they inherit
  its text styles, at its content width. On a page
  part it is an absolute view at the page bottom, above the bottom padding,
  with the note parts as children, laid out and painted as any view: its top
  border is the rule, its top margin the least space between flow and area,
  its top padding the space under the rule, its `gap` the space between
  notes. The fit counts its own height (margins, vertical borders and
  paddings, its own children with their margins and the gap after each),
  the notes and the gaps between them. A page part without notes
  has no area.
- **The flow above the area.** The relayout of a page part with an area
  gives the page a bottom padding that ends its content area at the area top
  (or at the end of the last flow node's bottom margin, when the split keeps
  it: the margin ends at or above the split height, so no break drops it,
  and it is empty room the area may cover). So `flexGrow`, `justifyContent` and percentage heights share
  the room above the area, and no flow lies on the notes; the part the fit
  kept ends there or higher, so it fits. Absolute children keep their
  offsets against the page.
- **Marks** are read in the lines of every text the part keeps, inside
  boxes and row cells too, in reading order; two marks on one line need both
  notes.
- **Numbers per page** (`footnote-numbers.ts`). With `footnotes: 'page'` the
  adapter numbers through the document and gives each mark and note number
  `NUMBER_RESERVE_PROP`: the text fragments lay its digits out as the widest
  digit of its font. So the document paginates in one pass. On the converged
  layout `numberFootnotesByPage` numbers the marks of each page in tree order
  and relabels each run with `relabelRun` (`text/lines.ts`): the line's
  justification taken back (`Line.spread`), the run shaped again, the line
  aligned again (`Line.isLast`). It copies every node it changes, since
  pagination shares fixed nodes between pages. A tagged link without a
  description takes the text its run prints. A mark in a line with
  right-to-left text, and a number wider than its room, fail with
  `PDF_LAYOUT_ERROR`. Protected by the per-page rows of
  `test/footnote-component.test.ts` and the footnote rows of
  `test/tagged.test.ts`.
- **Page tokens in reserved digits** (`paginate/dynamic.ts`). While the page
  builder pages a document, each page number and count in a dynamic text
  takes `PageInfo.reserve` digits, and `RESERVED_DIGITS_PROP` names their
  ranges, which the text fragments lay out as the widest digit of the font.
  After paging, `relabelPageTokens` paints each page's numbers with
  `relabelRange` (`text/lines.ts`), as `relabelRun` does for footnote
  numbers; the break stays. A line with right-to-left text holds its
  characters in visual order; `logicalPlaces` (`text/reorder.ts`) maps them
  back, and each line is painted from its last place back. The reserve
  starts at an estimate
  (`pagedWithReserve`): a total with more digits pages the document again; one
  with fewer pages it once more with fewer, and keeps the wider pages when
  those outgrow their reserve. `MAX_PAGINATIONS` guards against a bug with
  `PDF_LIMIT_EXCEEDED`. A number wider than its room fails with
  `PDF_RENDER_ERROR` (a bug, see "Page check").
- **Fill warnings.** Each fill collects its warnings, and the builder prints
  those of the fill it keeps, so a fill the fit tried and dropped prints none.
- **Limits.** A page with notes and `wrap={false}` fails with
  `PDF_LAYOUT_ERROR`.

Protected by `test/footnotes.test.ts` (literal places per rule) and the
footnote row of `test/work-budget.test.ts` (`noteFits`, no extra relayout).

## Repeated and page-conditional content

**Repeat.** The page builder (`paginate/builder.ts`) places the `fixed`
children of a container in each part of it: those before its first flow
child at the top of each part (a table header), those after its last at the
bottom (a carry row). The `fixed` children of a `PdfPage` repeat on every
page it breaks into, as a head above the flow and a tail below it. Their room
is measured for each page, with that page's values, before the flow is
filled. `PdfTableHeader` relies on this (one pass).

**Orphan rule.** A view whose first part holds only its `fixed` children (a
header with no row under it) stays at the page bottom in the pass that finds
it. `toEngineDocument` gives each view with `fixed` and flow children a
layout key (`LAYOUT_KEY_PROP`, an engine prop only the adapter writes);
`findOrphanedViews` reports such a first part, and the next pass sets
`break: true` on that view, or `break: 'column'` inside a column container.
The set only grows within one render.

**Page-conditional content (`pages` on a `fixed` node).** The adapter wraps
a node with `pages` in a carrier: a style-less `fixed` view (inset 0 and
absolute when the node is absolute, so its offsets keep their reference box)
that holds the node and names its pages (`PAGES_PROP`). The builder knows on
each part whether it is its parent's first part and whether the parent goes
on, so it shows the node itself: a `first` node on the first part only, a
`continuation` node on the others, a `not-last` node on every part but the
last. A `first` or `continuation` node takes room only where it shows. A
`not-last` node takes room on every part, as the last part is known only
after it is filled; the last part leaves that room empty. No page-conditional
node needs a pass of its own. A page with `wrap={false}` decides its carriers
before its layout (`wholeCarriers`). Only `PdfView`, `PdfText`, text and
page tokens may be inside a page-conditional node; the renderer rejects
anything else.

Protected by `test/table.test.ts` (header on every page and rows once,
orphan move, continuation geometry, absolute offsets and page numbers,
parent's first page, 12 sections with a head each, content limits),
`test/running.test.ts` (carry rows) and `test/invoice-playground.test.ts`.

**Page check.** The builder sums heights and reads no position before it
chooses a break. Each page it makes is laid out once (the `relayout` seam),
and that layout is a check: each placed piece must sit where the sum put it,
within 0.01 pt, and the paint with the totals must not move the flow. Yoga
shrinks a page whose content is higher than the page, and its layout can then
agree with the sums (a node placed whole keeps no sums for its children), so
before that layout the summed boxes of the page's nodes must also end inside
its content area, read from the page's box and not from the room the fill
used, within 0.01 pt. A page cut at its end by a block higher than the page is
exempt from both. A page that fails a check, or a page number wider than the
digits it kept, fails the render with `PDF_RENDER_ERROR`, which names it a bug
in Nuxt PDF, in production too. Protected by `test/page-check.test.ts`.

**Pagination deadline.** A pagination that never ends repeats the same page
forever, and in-process the deadline is otherwise checked only between engine
stages. `DocumentNode.onPage` (`layout/types.ts`) is called once for every page
the page builder makes (`paginate/builder.ts`); `plain-tree.ts` sets it from
the render limits, in-process and in the render worker alike, and at the
deadline it throws `PDF_LIMIT_EXCEEDED`. A pagination that cannot end fails
before that with "Pagination cannot end" (two pages in a row that take nothing
from the flow). It replaced a page guard that was a getter on the `fixed`
prop of an extra node. Protected by `test/engine.test.ts` "ends pagination at
the deadline …".

**Oversized unbreakable blocks.** The page builder puts a block that cannot
wrap and is higher than the page content area on the page and only calls
`console.warn`. The page relayout at the page height
then shrinks it, and its siblings, to fit, so the final layout never shows
the overflow. `findShrinkCandidates` lists unbreakable flow blocks whose
bottom edge with margin reaches the content bottom of their page (a shrunk
block always does). On a page part with notes that is the page's own content
bottom (`CONTENT_BOTTOM_PROP`), not the raised padding above the notes, which
a block ends at without being shrunk. Only when there is one,
`measureNaturalHeights` lays the tree out once more with each `PdfPage` as
one page of its laid-out width and automatic height (`size: { width }`,
`wrap: false`), without its footnotes (such a page cannot hold them, and a
block's natural height does not depend on them), and reads their heights;
`collectLayoutWarnings` reports `PDF_UNBREAKABLE_NODE_OVERFLOW` with that
height and the source position. The PDF is serialized before this layout. The
engine tree carries a layout key on pages and unbreakable blocks for it; the
engine ignores the prop, and `test/engine.test.ts` proves the bytes equal one
layout of the tree without keys. A percentage height relative to the page
keeps the page's height in the measuring layout (`NATURAL_PAGE_HEIGHT_PROP`,
`styles/page-percent.ts`). An absolute node is never a candidate: pagination
does not place it in the flow, and its page clips it.

## SVG contract

The Vue SVG primitives create the same host nodes the engine already draws; no
engine code is involved beyond our layout port and our painter
(`paint/svg.ts`). The relied-on facts:

- **Svg is a self-contained flex leaf.** `resolveDimensions` gives an `SVG` node
  a Yoga measure function derived from its `viewBox` aspect ratio
  (`measureSvg` in `layout/dimensions/measure.ts`), so it lays out like an `Image` in normal
  page flow. `renderNode` does not recurse into SVG children. `renderSvg`
  walks the subtree itself (`render/src/primitives/renderNode.ts`). Therefore
  `SVG` is a valid child of `PAGE`/`VIEW` even though the upstream
  `layout/src/types/{view,page}.ts` child unions omit `SvgNode`. That omission
  is an incomplete advisory type, not a runtime rule; `primitives/document.ts` deliberately
  lists `PdfSvg` in `PAGE_FLOW`, the children of a page and a view, on the
  evidence of the measure function. A future
  reader must not "correct" this back to match the upstream union.
- **SVG presentation is a direct-prop contract.** `resolveSvg` keys off exact
  camelCase names (`strokeWidth`, `fillOpacity`, `stopColor`, `viewBox`) via
  `parseElementProps`, `parseSvgRootProps`, `parseDefsProps` and `pick`
  (`layout/svg/`); `transform` is a prop on SVG groups/shapes,
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
- **`url(#id)` references are scoped and fail closed.** Our
  `replaceDefinitions` (`layout/svg/index.ts`) indexes the `DEFS` subtree,
  substitutes `fill`/`clipPath` references, and then drops `DEFS`. Nuxt PDF validates before layout that an
  SVG has at most one `PdfDefs`, ids are safe and unique within that SVG, fills
  target gradients, and clip paths target `PdfClipPath`. Missing, malformed, or
  incompatible references fail with `PDF_TREE_INVALID`, so upstream's dangling
  reference fallback is intentionally unreachable. Definition ids are scoped
  per SVG and are a separate namespace from document destination ids.
- **Explicit zeroes keep their SVG meaning.** Layout parses author strings to
  numbers. The painter sets a `fillOpacity` of 0, paints no stroke when
  `strokeWidth` is 0 (PDF would draw a hairline), and keeps a gradient
  coordinate of 0; only a missing value takes the default. (The old painter
  used truthiness fallbacks, so the resolved tree was repaired before it ran.)
- **Scope exclusions.** `Marker` (and `markerStart`/`Mid`/`End`) has additional
  `resolveSvg` container logic that is intentionally not exposed; the `Defs`
  child set and prop types exclude it. `List`, `Canvas`, `ImageBackground`, and
  form primitives are also out of scope.

Protected by `test/svg-conformance.test.ts` (literal text and a reviewed raster baseline, direct SVG
text fill, and zero-value regressions) and the SVG nesting, prop-surface,
reference-scope, numeric, transform, and casing tests in
`test/renderer.test.ts`.

## PDF writer contract

The PDF file comes from our own writer (`pdf/pdf-writer.ts` and its modules, D37). It has no lower engine: fontkit gives the font programs and their subsets (Font contract), `node:zlib` the Flate streams and `node:crypto` the hashes and AES. The painter (`paint/**`) calls only the `PdfWriter` seam (`pdf/writer.ts`); `serializePdfLayout` in `render-document.ts` makes one writer per render with the document's options (`PdfWriterOptions`: version, compression, Info, language, XMP, output intent, attachments, encryption, structure plan, field fonts, page layout), paints, and reads `file()` after `end()`. Contracts the writer keeps:

- **One synchronous pass.** Every object is written when its content is known, in memory, with no callback, stream or timer; `end()` writes the document parts and the catalog, and `file()` returns the bytes. The paint checks the render deadline before each page and before `end()`, and `writeDocument` checks it once more after the file. Protected by "ends the paint at the deadline" in `test/engine.test.ts`.
- **Objects and file.** `pdf/file.ts` numbers objects in the order they are reserved, writes them in number order and fails when a reserved number is never written or written twice; a classic cross-reference table and a trailer follow. Strings are text strings: printable ASCII as it is, anything else UTF-16BE with a byte order mark (no PDFDocEncoding table). Names write `#`, the delimiters and every byte outside `!` to `~` as `#XX` in capital hex. Numbers are written with at most six decimals (`formatNumber`).
- **Reproducible bytes.** The trailer `/ID` is the MD5 of the object bodies, embedded font subsets are tagged from a hash of the font's index, PostScript name and glyph ids, and nothing reads the clock: two renders of one tree with the same `creationDate` give the same bytes. A render without `creationDate` writes the current time into `Info` and the XMP. Protected by `test/reproducible.test.ts` (five renders in parallel, the subset tags) and the document hashes in `test/pdfa.test.ts` and `test/tagged.test.ts`.
- **Navigation.** Named destinations are last-writer-wins by name; `anchorDestinationsAtFirstPage` leaves one per id (Named destination contract). The `Dests` and `EmbeddedFiles` name trees are one root node each, without `Limits`, their keys sorted by bytes: printable ASCII names by code unit, a UTF-16BE name after them (ISO 32000-1, 7.9.6). An outline entry's destination is `XYZ` at its node's left edge and top on the page (a nested node's box is relative to its parent; the writer maps it through the current matrix, as it does for links and named destinations), or `Fit`; `Count` is the number of descendants a reader shows when the entry opens, negative when it is closed (12.3.3). Protected by "sorts the names by their bytes, without Limits on the root" in `test/internal-links.test.ts` "writes each entry's left edge and the count of the entries it shows" and "points a nested entry and a nested destination at their place on the page" in `test/bookmarks.test.ts`.
- **Annotations.** A link gets the Print flag (`F 4`), as PDF/A requires, `Border [0 0 0]` and its rectangle under the current transform. A note (`PdfNote`) gets no flag and no appearance stream, so `PdfNote` fails tree validation in a PDF/A document.
- **Gradients** are shading patterns in page space. The span from the first stop to the last moves into the shading's geometry, so the first and last colours pad beyond their stops as in SVG, and a gradient of one colour is a solid fill. Stop opacities paint through a luminosity mask of the same gradient. Protected by the gradient tests in `test/paint-paths.test.ts`.
- **Images.** A JPEG is written as it is (`DCTDecode`). A PNG's image data is written with its predictor unless it has an alpha channel, palette transparency or interlacing; then `engine/image/` inflates and unfilters it and splits colour and alpha (`SMask`). A grey or RGB `tRNS` becomes a colour key mask of its 16-bit samples. Each image is embedded once per document. Protected by `test/png-images.test.ts` and the raster suite.
- **Text.** A standard font is a `Type1` font with `WinAnsiEncoding` (no encoding for Symbol and ZapfDingbats) and its glyphs named by WinAnsi code. An embedded font is a `Type0` font with `Identity-H`, a CID font, a `ToUnicode` CMap and its subset (`FontFile2`, or `FontFile3` for CFF); two faces of one font program share one subset, two programs never share one, whatever their PostScript names. The `ToUnicode` CMap maps a painted `.notdef` (glyph 0, a character no font of its text has, D40) to U+FFFD, and every other glyph to the NFC of its characters (a precomposed letter drawn for a base and a mark, B2b). The `debug` size label is set in Helvetica. Protected by "paints each file with its own glyphs" in `test/fonts.test.ts` and "sets the debug size label in Helvetica …" in `test/paint-paths.test.ts`.

Protected as a whole by PDF magic-byte, parse, metadata and text tests, the raster suite, the invariant harness and veraPDF (`pnpm test:pdfa`).

### Attachments

`PdfAttachment` files reach the writer as `attachments` (`WriterAttachment`: name, data, MIME type, description, relationship, date) and are written in `end()` as an `EmbeddedFile` stream with `Subtype` (the MIME type) and `Params` (`CreationDate`, `ModDate`, `Size`, and `CheckSum` as the 16 bytes of the MD5 digest, ISO 32000-1, Table 46), and a file specification with `F`, `UF`, `Desc`, `AFRelationship` and `EF`. The catalog lists the specifications in `AF` and by name in `EmbeddedFiles`. Both dates are the document's own `CreationDate`. Serialization runs once per render, on the converged layout, so attachments do not change the pass count. The writer takes bytes only, so no string can be read as a server file path. Protected by `test/attachment.test.ts` (byte equality through the worker, a string that names a real file path, the checksum bytes).

### PDF/A-3b

A document with `conformance="PDF/A-3b"` or a `PdfFacturX` child is made PDF/A-3b in `serializePdfLayout` with `engine/pdfa.ts`: version 1.7, the XMP packet (`pdfaid:part`, escaped values) as an uncompressed `Metadata` stream, and an output intent (`GTS_PDFA1`) with the sRGB ICC profile (`engine/srgb-profile.ts`). An attachment without `type` gets `application/octet-stream` in a PDF/A document only, as PDF/A needs a MIME `Subtype`. A document with neither takes none of these branches (`test/pdfa.test.ts`, a sha256 of a fixed document). `assertEmbeddedFonts` walks the laid-out lines of every node before the paint and fails on a run with glyphs in a standard font (`type: 'STANDARD'`), so every glyph is embedded, and on a `.notdef` glyph that stands for a character the font lacks (`missingCodePoints`, D40); dynamic text (page tokens) is laid out by `layoutDocument`, so its lines are in the layout too. Protected by the three standard-font tests and "fails under %s for characters that no font of the text has". veraPDF (`pnpm test:pdfa`, image pinned in `test/pdfa.test.ts`) is the evidence; rerun it after every change to the writer.

### Tagged PDF (PDF/UA-1, PDF/A-3a)

A document whose `conformance` holds `'PDF/UA-1'` or `'PDF/A-3a'` is tagged in `serializePdfLayout` by `engine/tagged.ts`; its XMP (`pdfuaid:part` 1, `pdfaid:conformance` A) comes from `pdfa.ts`, and it is written as PDF 1.7. A document without the claim takes none of these branches (`test/tagged.test.ts` checks the bytes of a document that uses `tag`, `alt` and `decorative` against a fixed hash). The engine adapter (`toEngineDocument`) asks the structure planner of `tagged.ts` about every node in tree order and stores the answer as the internal prop `__nuxtPdfStruct`: the element (role, parent, attributes, inline links and images) and whether the node is a leaf (paints marked content) or a container; pagination copies props to every fragment, so a split text keeps one element. Right before the paint, `prepareTagging` gives each leaf fragment a `StructureMarker` (internal prop `__nuxtPdfMark`) and returns the elements for the writer (`StructurePlan`) and the answers the painter asks for (`PaintTags`). The painter (`paint/**`) calls the writer's `beginMarked`, `beginArtifact` and `endMarked` and names the element of every annotation; `pdf/marked-content.ts` turns those events into flat marked-content sequences, MCIDs, the parent tree and the structure tree. Contracts relied on (sources: our painter `paint/**`, which ports `@react-pdf/render` 4.5.1, the layout port and our writer):

- **Paint order of a node.** `renderNode` paints `save`, clip, transform, `markPlaces` (destination and outline entry, no operator), background, borders, the node's paint function, children, `renderDebug`, `restore`. For a leaf it calls `beginMarked` (or `beginArtifact(true)` for a repeated header after its first page) before the `save` and `endMarked` after the `restore`; the writer opens a sequence lazily before its next content operator, so the leaf's marked content is its `q … Q`. With `debug` the overlay and the leaf's closing `Q` are an artifact (`beginArtifact` after the children), so the label never joins the leaf's text. Protected by "marks every painting operator as tagged content or an artifact" (each tagged block is exactly one `q … Q`, the figure's image is inside it) and "writes the debug overlay of a tagged text as an artifact" (the paragraph holds one `BT`, the overlay block after it the label's `BT` and the boxes).
- **Destinations.** `markPlaces` writes a node's string `props.id`; the marker is a prop of its own, so the author's id of the first fragment stays where `anchorDestinationsAtFirstPage` left it. Protected by the reading-order test (roles and the `split` destination on page 1).
- **Leaves.** `paintsChildren` (`paint/document.ts`) is false for `TEXT` and `SVG`: a text paints its nested texts as runs of its lines, an SVG its children, and neither calls `renderNode` for them. So marked sequences never nest. Containers (table, row, list, section, a link around blocks) get no marker. Protected by the reading-order test (a nested text is part of its paragraph).
- **Text links.** `resolveLinkSubstitution` (`layout/prepare/links.ts`) wraps the children of a `LINK` node in a new `TEXT` node when they are all text runs, or runs mixed with texts; that text has no props of ours, so such a link is a leaf and its own `save` holds the text. Protected by "writes the nested structure …" (`Link(@)` with content for the block link).
- **Annotations join their element.** In a tagged document the writer gives an annotation with an element the next parent tree key (`StructParent`), its element's text as a link's `Contents`, and an object reference (`OBJR`) under its element. Protected by "ties every link annotation to its Link element".
- **Every annotation names its element.** The painter passes the `Link` element of a link node or inline link and the `Form` element of a field (`PaintTags.element`, `PaintTags.inlineLink`) to `linkToUri`, `linkToDestination` and `field`. In a tagged document an annotation without an element fails the render with `PDF_RENDER_ERROR` ("the painter wrote an annotation without a structure element"), for example a link inside an artifact. The `Form` element is a container without marked content and carries the field's `label` as `Alt` (D32). Protected by every test that renders `structuredChildren`, "references each widget from a Form element, in reading order" and "gives each widget its parent tree key and label …" in `test/forms.test.ts`.
- **A run names its link.** `fragmentsOf` (`layout/text/fragments.ts`) copies a link's `props.href` string unchanged into `attributes.link` of every fragment inside it (an outer link wins over an inner one), and textkit keeps it on every run the fragment becomes. In a tagged document the adapter sets an inline link's `href` to the href, a NUL and the link element's index (`markedHref`); `PaintTags.inlineLink` splits it into the target and the element before the painter writes the annotation. So each `PdfLink` is its own `Link`, also next to a link with the same href. Protected by "writes each PdfLink as its own Link, also next to one with the same target" (two `Link` elements per paragraph, the targets written without the suffix) and "maps the links of a paragraph split over two pages".
- **A run's operators.** `renderRun`: colour operators, the annotation, the inline images, the leaders, the glyphs (one `q … BT … ET … Q`), then `translate` (`cm`). In a leaf that is not a figure, an inline link's marked content runs from the annotation to the end of its glyphs. Protected by "splits a paragraph around its inline links and images" (each Link block is `q … Q` with one `BT`; the paragraph part after it starts with the run's `cm`).
- **Inline images.** The writer's `inlineImage` writes one `q … Do … Q`. In a leaf that is not a figure, the painter marks each inline image as its inline `Figure` (`PaintTags.inlineImage`, in paint order), or as an artifact for a decorative image. Protected by the same test (one `Do` per Figure block, the ornament an artifact between two parts of the paragraph).
- **Leaders.** A leader's line is one `q … S … Q` with its own stroke state, its dash phase from `PdfWriter.toPage` (the page's left edge in the current user space), and in a tagged leaf `/Artifact BMC … EMC` inside the leaf's sequence; its U+FFFC glyph is drawn as a space. Protected by "writes a TOC of TOCI items, each with a Reference that holds its Link" (every stroke of the contents page an artifact).
- **The repeated header** (`PdfTableHeader`, `fixed`) is one node that the page builder puts into every part of the table, so its leaves are painted once per page with the same element. The first page's content is tagged, later pages' is `/Artifact <</Type /Pagination>> BDC`. Protected by "tags the header on its first page …".
- **Column spans from geometry.** The table components keep `colspan` to themselves (the primitive never sees it). The cells of a row are the row node's direct children, side by side; `ColSpan` is the number of column starts (the starts of all cells of the table, `box.left - box.marginLeft`) from a cell's start to the next cell's start. Protected by "tags the header on its first page …" (`ColSpan 2` on the total cell only).
- **The laid-out string of a text** (`fragmentsOfText`, `layout/text/fragments.ts`): each text instance becomes `transformText(value, instance.style.textTransform)` with the instance's resolved (inherited) style; `transformText` (`layout/text/transform.ts`, the one copy, which `tagged.ts` reads too) is `toUpperCase`, `toLowerCase`, `capitalize` (`/(^|\s)\S/g` upper-cased) or `upperfirst` (the first character upper-cased; admission rejects it since it is not CSS, so only an engine caller reaches it); a raster image in a text is U+FFFC, and so is a leader (whose source text `textSource` takes as a space); nested texts follow in order; `letterSpacing` becomes `attributes.characterSpacing` of the runs. `tagged.ts` rebuilds this string (`textSource`) to map it back to the template text for `/ActualText`. Protected by "writes the source text of transformed and letter-spaced texts as ActualText" (exact source strings for `capitalize`, `uppercase`, a nested `lowercase`, letter spacing alone and a text-only cell).
- **Lines of a text** (`text/`, as `@react-pdf/textkit` gave them): `line.string` holds the line's characters without line breaks (`\n`) and without soft hyphens, keeps trailing spaces, and ends with an added `-` where the line breaker split a word; the lines of a text are consecutive slices of the laid-out string, and `splitText` gives each page fragment a consecutive slice of the lines. `fragmentSources` walks the lines against the laid-out string under exactly these rules; a line that does not match (for example an ellipsis from `maxLines`) ends `/ActualText` for that text from there on. Protected by "writes the source text of each page's part of a split text …" (the parts of a hyphenated paragraph in capitals over several pages join to its source).
- **One writer of the content stream.** Every operator goes through the page content (`pdf/content.ts`), and the marked-content operators are written the same way right before the operator that needs them; a page's last sequence is closed before the next page and in `end()`. A new page starts with its flip transform, before any marked content of the page. A `cm` paints nothing: PDF/UA-1 (ISO 14289-1, 7.1) asks that content, the operators that paint, is tagged or an artifact, so state operators may stand outside marked content. Protected by "marks every painting operator …" (no painting operator outside marked content; two pages).
- **Page entries.** A page of a tagged document gets `Tabs /S` and its `StructParents` key. Protected by the catalog test (`/Tabs /S` and `/StructParents` once per page).
- **Parent tree keys.** Pages (`StructParents`) and annotations (`StructParent`) share one counter; `ParentTree` lists them in key order, and `ParentTreeNextKey` is the number of keys. A page's key holds the array of its MCIDs' elements, MCID n at position n. Protected by "keys the parent tree by page and annotation, and maps each MCID of a page to its element" (keys 0 to `ParentTreeNextKey` − 1, and every array entry is the element whose MCR names that page and MCID).
- **The structure tree** is written in `end()` (`writeTree`): `StructTreeRoot` with one `Document` element, the kept elements in order with their `MCR` and `OBJR` kids, `ParentTree` as a direct `<< /Nums [...] >>` and `ParentTreeNextKey`; the catalog gets `MarkInfo << /Marked true >>` as a direct dictionary. Protected by "writes the structure tree as plain dictionaries" (the exact form of `StructTreeRoot`, `MarkInfo`, every `StructElem`, its `MCR`/`OBJR` kids and an `Alt` text string).
- **Footnotes.** The adapter asks the planner for a footnote's structure (`footnoteMark`, `footnoteNote`), as the mark and the note are its own nodes, not template nodes: the mark is an inline `Reference` that holds an inline `Link` (the mark's run, `markedHref`); the note's text node is the leaf of a `P` inside a `Note` with `ID`, whose `Lbl` holds the inline `Link` back to the mark. The note is painted in the note area, after the page's flow, so its paint order says nothing about its place: `writeTree` puts a `Note` right after the element it `follows` (its `Reference`) among their parent's kids, and lists every kept element with an `ID` in the `StructTreeRoot`'s `IDTree` (a direct `<< /Names [...] >>` in ID order, PDF 32000-1 14.7.2). Protected by "writes each note as a Note with an ID right after the Reference of its mark" and the footnote fixture of the veraPDF job.
- **Figures and row headers need no engine contract of their own.** A `PdfView tag="figure"` is a container like a section; its texts, images and SVGs are leaves that paint marked content of the `Figure` (the leaf rules above). A body cell with `header` is `TH` with `A << /O /Table /Scope /Row >>`; `PdfTableCell` marks it with the internal prop `__nuxtPdfHeaderCell`, which the adapter removes before layout (`test/tagged.test.ts` "write the same bytes with and without header and figure props").
- **Strip-only TypeScript.** The worker loads engine files with type stripping, which rejects parameter properties; `StructureMarker` uses plain fields.

veraPDF `--flavour ua1` and `3a` (`pnpm test:pdfa`, fixtures in `test/fixtures/tagged-document.ts` and the form fixture in `test/pdfa.test.ts`) is the evidence; rerun it after every change to the writer.

### Forms

`PdfTextField`, `PdfCheckbox` and `PdfSelect` are laid out as the engine's `TEXT_INPUT`, `CHECKBOX` and `SELECT` nodes with our own props and `wrap: false` (`canWrap` in `layout/paginate/rules.ts` splits any node but an image, an SVG and a note without it). `engine/forms.ts` (`prepareForm`) runs before the painter when the layout holds a field. It is pure: it returns the layout to paint, the writer's `form` option (the embedded field fonts) and the field painter; a document without fields gets nothing, takes no other branch and writes the same bytes. In the paint layout every field node is a `TEXT_INPUT` named by its key, without border widths and background; the painter calls the field painter with its box under the current transform, which builds a `FieldSpec` (appearances drawn through `writer.appearance`, on before off) and calls `writer.field`. The engine's checkbox paint (`parseCheckboxOptions`, a ZapfDingbats font object and two form XObjects per box) and its option parsers never run.

The writer (`pdf/forms.ts`) makes the field fonts before the first page and writes each field:

- **Text and choice fields** are their own widget: `FT /Tx` or `/Ch` (combo, with `edit` when editable), `T`, `TU`, `Ff` (`readOnly`, `required`, `multiline`), `V` (left out when empty), `Opt`, `MaxLen`, `Q`, their own `DA` with font, size and colour, `MK` (`BG`, `BC` as 0–1 operands), `BS` and `AP /N`.
- **A checkbox** is `FT /Btn` with `V`, `DV` and `AS` as names (`/Yes` or `/Off`) and an on and an off appearance.
- **A radio group** is one parent field (`FT /Btn`, `Ff`, `T`, `V`/`DV` as names, `Kids`), written in `end()`; each option is a widget without a name of its own (`Parent`, `AS`, `AP`, `TU`, `MK`, `BS`). The paint layout names each radio node by its field name and value (separated by U+0000, which a field name cannot contain).
- **Every widget** has `Subtype /Widget`, `F 4`, `Border [0 0 0]` and `C [0 0 0]`.
- **The AcroForm** holds `Fields`, `DA` (`/F… 10 Tf 0 g` with the first field font) and `DR` with the field fonts; it has no `NeedAppearances`, so readers draw the written appearances.
- **Helvetica** comes from the standard-font metrics (`standard-font-metrics.ts`, pdfkit's AFM data): `encode(text)` gives the WinAnsi codes and unkerned widths, its ascender, descender and line height place the lines.
- **Layout values**: `node.style` after inheritance (`fontSize`, `color`, `textAlign` inherit like text), `node.box` border and padding widths (resolved lengths). The style decides whether padding was set at all.

PDF/A and PDF/UA-1 (D31): `prepareForm` gets the conformance levels and validates the field fonts, and the fields draw in the embedded field fonts instead of Helvetica. Each field font (`embeddedFieldFont` in `form-font.ts`) is a `/TrueType` font dictionary with `WinAnsiEncoding` and `Widths`, a `FontDescriptor`, and the font file as `FontFile2` (`Length1`). The font comes from the layout step: `resolveFieldFonts` asks the render's font store (`getRegisteredFonts`, `getFont(descriptor)`, `FontSource#load`, `data`) for each text and choice field, skipping the standard families the store also holds. Read from the fontkit 2.0 font (no published types; `FontProgram` in `form-font.ts`): `postscriptName`, `unitsPerEm`, `ascent`, `descent`, `lineGap`, `capHeight`, `italicAngle`, `bbox`, `directory.tables.glyf` (TrueType outlines), `cmap.tables` (a 3,1 subtable), `stream.buffer` (the whole sfnt, a WOFF2 font already decoded), `hasGlyphForCodePoint`, `glyphForCodePoint().advanceWidth`, `getGlyph(0)`. `test/forms.test.ts` ("form fields in PDF/A") and the veraPDF form case in `test/pdfa.test.ts` fail if one of these changes.

Protected by `test/forms.test.ts`: field data and rects through pdf.js, the fill round trip, the byte checks (`/V /Yes`, Helvetica in `DA` with the size, no `NeedAppearances`, no ZapfDingbats, `AP /N` on every widget), the exact appearance streams, and a pdf.js raster drawn from them.

### Encryption

A document with `protection` is encrypted with AES-256, revision 6 (ISO 32000-2, 7.6.4). `engine/protection.ts` (`createEncryption`) derives the file key from the passwords and writes the encryption dictionary (`O`, `U`, `OE`, `UE` and `Perms` as byte strings, `P`); no other cipher or revision is written. The writer (`pdf/file.ts`, `pdf/objects.ts`) encrypts every string and every stream after compression with that one key, a new random IV per string or stream (IV ‖ AES-256-CBC with PKCS#7 padding), the name-tree keys included; only the encryption dictionary is written as it is, and the trailer `/ID` stays plain. The catalog gets `Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >>`, and the file is PDF 1.7. A document without `protection` takes none of this. Protected by `test/protection.test.ts`: pdf.js opens the file with the open and the owner password and not without one, the `/Encrypt` entries and `/P` are as written, no password or metadata is readable, and an internal link resolves.

## Font contract

The font store is our own (`engine/fonts.ts`, `createPdfFontStore`, D37). A fresh store contains the standard PDF fonts (`engine/standard-fonts.ts`, metrics in `standard-font-metrics.ts`, generated from pdfkit 5.1.1's AFM data); the registered fonts are added before layout and the same store is passed to `layoutDocument`. The layout step calls `load(descriptor)` and `getFont(descriptor)` (its `data`); `resolveFieldFonts` calls `getRegisteredFonts()`. A weight needs its face: `resolveSource` takes the face registered at that weight, else a variable face whose `wght` axis holds it (`FontSource#at`), and throws `MissingFontFaceError` otherwise. A text's font stack holds only the families it names (Helvetica when it names none): a character that none of them has paints the first font's `.notdef` (D40), and a blank character that its font lacks (`isBlank` in `text/itemize.ts`: tab, bidi controls, spaces) paints no glyph (`paintedGlyphs` in `text/shape.ts`); such a space advances 0.278 em, the standard space width, and the other blank characters take no room. The standard-font metrics are those of `@react-pdf/font` 4.0.8, quirks included, so documents keep their bytes: a digest per font in `test/fonts.test.ts` ("standard font metrics") guards the metrics that were first compared, every code unit and every pair of WinAnsi codes, with `@react-pdf/font`'s `StandardFont`. Embedded fonts in our writer share a subset per font program (`fontProgramOf`), never per PostScript name.

Every render creates its own font store and its own fontkit font object per font; renders never share one. fontkit caches glyph objects per font object, and a glyph first loaded as a component of a composite glyph (the O inside Ö) is cached without its code point. A later render that reuses the font object then drops that letter (#83). Protected by the composite-glyph test in `test/isolation-stress.test.ts`. Inside one render the same cache keyed by id would also give a glyph the code points of its first lookup: every character a font lacks is glyph 0, so after hyphenation asked a font without `-` for a hyphen, a later ellipsis in that font was a hyphen in the line string. The render's font object therefore wraps `getGlyph(id, characters)`: a cached glyph whose code points differ from `characters` comes back as a new object with those code points over the cached glyph (its outline and metrics stay shared). Protected by "keeps the ellipsis after hyphenation asked the same font for a missing hyphen" in `test/text-layout.test.ts`. The render's font object also keeps the runs it shaped, by the arguments of `layout` (`fontForRender` in `fonts.ts`), so a repeated string is shaped once per render and every caller of it gets the same run. The cache freezes the run, its glyph and position arrays and each position, so a step that writes to a cached run instead of a copy throws (textkit reads a shaped run and changes only copies: shaping in `text/shape.ts` copies the positions, the painter copies the glyphs before inline images replace theirs). The glyph objects stay open: they belong to fontkit's glyph cache, which fills their metrics lazily. Protected by "hands each caller the same run, frozen down to its positions" in `test/work-budget.test.ts`. The map goes with the font object at the end of the render. The output is the same with and without it (the byte harness of 2026-11-22 over the suite); `runsShaped` in `test/work-budget.test.ts` counts the strings shaped.

The font data is parsed once per process (`engine/fonts.ts`, `parsedFonts`, one entry per registered data URL): decoding the data URL and the tables a render uses cost 20 to 35 ms per custom font and render before. Each registered `FontSource` loads once, on its first `load()`, and builds the render's font object from the parsed font (`fontForRender`). A standard font holds no render data, so one object per name serves every render of the process. Contracts relied on (fontkit 2.0, `TTFFont`):

- **Enumerable fields are font data.** `type`, `defaultLanguage`, `stream`, `variationCoords`, `_directoryPos`, `directory`, `_tables`. The render's object copies them, so it shares the stream and the decoded tables (`_tables`, fontkit's own `getVariation` shares them the same way). `_glyphs` starts empty. Reads from the shared stream set `stream.pos` and read synchronously, so interleaved renders do not disturb each other.
- **Per-object caches are not enumerable.** fontkit's `@cache` decorator stores `_layoutEngine`, `_cmapProcessor`, `_variationProcessor` and friends with `Object.defineProperty(this, key, { value })`. They are not copied and are built again per render: the layout engine creates glyphs through its own font object.
- **Table getters are own accessors bound to their object.** The constructor defines one per table with `_getTable.bind(this, table)`. The render's object uses the parsed font's getters, so a table is decoded with the parsed font as its hidden `parent` (restructure's `Struct._setup`; fontkit's `_decodeTable` passes the font that asks). Bound to the render's object, the first render's font stayed reachable from the shared `_tables`, with the strings it shaped. Protected by "keeps no font object of an earlier render alive" in `test/isolation-stress.test.ts`.
- **fontkit receives TTF or OTF bytes only.** `parseFont` decodes a WOFF2 font with our own decoder (`engine/woff2.ts`) before fontkit sees it, and `assertSfnt` refuses any other signature (WOFF2, WOFF, anything that is not `0x00010000` or `OTTO`) with `PDF_ASSET_INVALID`. fontkit 2.0.4 subsets a TrueType-flavoured WOFF2 font with the wrong data: `TTFSubset._addGlyph` reads `loca.offsets` and the raw `glyf` stream, which for a transformed WOFF2 hold the transformed streams, so the glyphs embed without outlines or the render fails. Its `WOFFFont` and `WOFF2Font` classes are no longer reached.

- **A weight of a variable font is an instance.** For a font with a `wght` axis, `parsedFontAt` takes `getVariation({ wght })` at a weight inside the axis (`FontSource#at` refuses one outside it, registered or not), once per source and weight and process (`fontInstances`, like `parsedFonts`); its other axes stay at their defaults. The instance shares the file bytes and `_tables` with the parsed font, and `variationCoords` is an enumerable field, so the render's object copies it; `_variationProcessor` and its blend cache are per-object caches built again per render. So an instance keeps the rule above: one font object per render, no shared glyph or blend cache. Its render object gets its own `createSubset` (`instance-subset.ts`): fontkit 2.0.4's `TTFSubset` fails on an instance (`encodeSimple` passes a number to restructure's `EncodeStream`), so `glyf`, `loca` and `hmtx` are written from `TTFGlyph#_getContours` (points varied with `gvar`, composites resolved into simple glyphs, no instructions) and `advanceWidth` (HVAR, or the phantom points after the contours). The layout step measures the same instance; ascent and descent come unvaried from `hhea` and `OS/2` (fontkit does not apply `MVAR`). A CFF2 variable font is refused at build time (`src/build/font-file.ts`). Protected by "variable font weights" in `test/fonts.test.ts`.

The parsed font is never laid out, painted or subset. It holds no data of a render: a render writes only to its own object and its glyphs, and to `_tables` only the font's own decoded tables. Protected by "shares the parsed … font data between renders" in `test/fonts.test.ts` (TTF, TTF- and OTF-flavoured WOFF2: separate objects, the same `head` table, the same text in two renders).

The WOFF2 decoder (`engine/woff2.ts`, W3C WOFF2 1.0) runs once per font source and process, inside `parseFont`, and at build time to check the file (`src/build/font-file.ts`; the bundle keeps the WOFF2 bytes). It reverses the `glyf`/`loca` transform (section 5.1, both `loca` formats, the bbox and overlap bitmaps) and the `hmtx` transform (section 5.4), and writes an sfnt with a sorted directory, 4-byte padding, table checksums and `head.checkSumAdjustment`. Brotli comes from `node:zlib` with `maxOutputLength` set to the decoded limit (20 MiB, `MAX_DECODED_FONT_BYTES`); the rebuilt tables are checked against the same limit as they grow, so no allocation follows a size field of the header. A collection (`ttcf`), a wrong signature or length, a table past the end of the data, inconsistent glyph counts or formats, and a decoded size over the limit fail with `PDF_ASSET_INVALID` naming the font. `DSIG` is dropped, as the WOFF2 encoder already does for transformed fonts. Protected by `test/woff2.test.ts` (every TTF/WOFF2 pair of `source-code-pro`: equal outlines, advances, boxes and tables; the outlines in `FontFile2`; hostile inputs) and invariant I20 (every used glyph of the mixed profile, which has a TrueType WOFF2 face, has an outline).

Font resolution runs *inside* the layout pipeline (`resolveAssets` calls
`fontStore.load`), so a missing family throws during `layoutDocument`. Nuxt PDF
surfaces this as a single `PDF_LAYOUT_ERROR` carrying the store's message
(`Font family not registered: <family>. Register it in \`pdf.fonts\` …`). A
family without a face in the asked style or weight throws
`MissingFontFaceError`, and `resolveAssets`, which loads the faces per node,
gives it the node and its source position: `<PdfView> at
<file>:<line>:<column> asks for <family> in fontStyle <style>, fontWeight
<weight>, but <family> has no <style> face (registered: <style> <weight>, …).
Register …`, or `… has no <style> face of weight <weight> (registered: …)`; a
variable face lists its axis as `<style> <min> to <max>` (`test/engine.test.ts`). Font
failures are deliberately **not** sub-classified into a separate error code:
both stay `PDF_LAYOUT_ERROR`, and no second traversal calls `fontStore.getFont`
per descriptor.

Protected by the local-font conformance fixture. Asset policy, path validation, and registration ownership live outside the engine and must run before layout.

## Remote resource boundary

Both of React PDF's remote fetch seams are structurally unreachable. Our code
converts every allowlisted remote image into validated bytes before layout, and
only registers build-embedded local font data URLs.

- **Image seam.** None in the layout: the asset step (`layout/assets`) reads
  the admitted bytes with `readImageHeader` (`engine/image`), which has no
  network or file path. `resolvePdfImageAssets` replaces every image source
  with validated bytes before layout, and `requireAdmittedImage`
  (`plain-tree.ts`) rejects any other `src`.
- **Font seam.** Our font store has no network path: `createPdfFontStore`
  only registers `data:font/(otf|ttf|woff2);base64,...` sources, and `parseFont`
  hands fontkit the decoded bytes (TTF or OTF); nothing fetches a font.

When `pdf.remote` is configured, `fetchRemoteResource` (`assets/remote.ts`)
accepts exact HTTPS image prefixes only, re-checks every one of at most three
redirects, sends credential-less `GET`s, and uses the render's shared deadline,
abort signal, request/concurrency limits, and byte budgets. PNG/JPEG structure
and dimensions are validated before the engine receives bytes. Remote fonts are
unconditionally rejected. The engine's own fetch code stays dead. Protected by
`test/remote.test.ts`.

## Render worker

Layout and serialization run in a worker thread from a pool
(`server/worker-render.ts` sends the requests, `server/worker-pool.ts` holds
the pool); the decision is D4 in
`internals/decisions.md`. The worker receives the admitted plain-data tree by
structured clone and imports no Vue (`test/worker-render.test.ts` walks the
import graph of `worker-entry.ts`). At the render deadline the worker is terminated,
which stops layout inside one engine step. A build that inlines dynamic imports
in production has no worker chunk and renders in-process, where the deadline is
checked between engine stages and once per page during pagination.

Image bytes arrive in the worker as `Uint8Array`; `worker-entry.ts` wraps them
as `Buffer` again without a copy, because the engine's image decoder reads
`Buffer` methods.

The engine itself is unchanged by this boundary: the same adapter output is laid
out in both places.

The worker serves a second request kind: a Markdown parse
(`{ kind: 'markdown', request: { markdown } }`, `engine/worker-protocol.ts`).
It imports comark on first use (`rich-text/markdown-parse.ts`), runs the rich
text mapping and returns the model. Both kinds take one pool path
(`runInWorker`): the FIFO wait, the hard deadline (`markdownTimeoutMs` for a
parse), the terminated and replaced worker, the failure path, and the request
count after which a worker retires. A parse has no in-process path; a build
without a worker chunk fails with `PDF_RENDER_ERROR` (D29). The Markdown
modules join the worker chunk in production (`src/build/render-worker-chunks.ts`, the worker
graph); comark stays an external import of that chunk.

## Deliberately unused contracts

- React reconciler and renderer lifecycle
- React hooks and DOM helpers
- `PDFViewer`, `PDFDownloadLink`, and `BlobProvider`
- deprecated string rendering
- arbitrary React-node dynamic render results (the one exception is the
  page-conditional carrier above: its result is built by the adapter from
  admitted views, texts and tokens, with geometry tests)
- author-supplied functions in the tree (`render`, `hyphenationCallback`)

Any proposal to use one of these requires a documented acceptance criterion and an update to this file.
