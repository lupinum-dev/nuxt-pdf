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
| `fontkit` | `2.0.4` |
| `yoga-layout` | `3.2.1` |
| `@react-pdf/layout`, `@react-pdf/render`, `@react-pdf/textkit` | `4.6.1`, `4.5.1`, `6.3.0`, ported to TypeScript; not dependencies |
| `bidi-js`, `hyphen`, `unicode-properties` | `1.0.3`, `1.14.1`, `1.4.1` |

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

The kernel fixture (`test/conformance.test.ts`) verifies:

- the Vue renderer produces the node contract consumed directly by layout;
- ordinary Vue components, props, slots, conditionals, and keyed lists;
- A4 layout, normal text flow, explicit page breaking, and two output pages;
- fixed content repeated across pages;
- `PdfPageNumber` and `PdfPageCount` tokens printed as per-page text;
- a local Roboto TTF and local PNG;
- an external link annotation; and
- its extracted text, link annotation, page count, and a thresholded
  page-by-page comparison with reviewed raster baselines; page 1 keeps
  `readable` whole, since its ragged lines stretch at their ends (D42).

Renderer tests separately cover insertion, removal, keyed movement, prop and
text updates, primitive resolution, rejection of invalid roots, and fail-closed
rejection of non-whitespace orphan text without echoing its content.

Dynamic text (page-token footers) takes its `lineHeight` as static text does,
whether it reaches it from `PdfPage` or a nested `PdfView` chain, given as a
percentage, or set on the dynamic node itself, and lands at the geometry of the
same static text. Upstream React PDF drops such footers; engine tests
(`test/engine.test.ts`) verify ours against the equivalent static-text
geometry.

While pages are made, a `PdfPageNumber` or `PdfPageCount` takes as many
digits as the document's page count, each as wide as the widest digit of its
font. After paging, the real number is painted into that room and the line is
placed again by the text's alignment; its line breaks stay. So a number never
moves a line break or a page break, and in a left-aligned text the words after
a short number close up to it. In a line with right-to-left text the number
is painted at its visual place (`test/page-primitives.test.ts`, "paints page
numbers in a right-to-left line at their visual places"), and in a
right-to-left override (U+202E) with its digits reversed, as the bidi
algorithm shows them (`test/dynamic-split.test.ts`). The room is as
wide on every page, so a line can break earlier than it would around the
real number: on page 8 of 23 pages, a number keeps room for two digits.
Pages are made first with an
estimate of the page count's digits. With too few digits they are made again
with the count's digits (`test/page-primitives.test.ts`). With too many they
are valid, since each number is painted inside its room, and they are made
once more with fewer digits; when those pages then need more digits than
they kept, the pages with the wider room stay. So no document fails over its
page count (`test/page-builder.test.ts`).

A text with a page token that is longer than the room splits over pages and
columns like static text: every word is printed once, in order, and each part
prints the page number of its own page, also where the number grows from 9
to 10 (`test/dynamic-split.test.ts`). A `PdfPageCount` in such a text takes
its reserved room too and prints the page count.

### SVG drawing primitives

The SVG fixture (`test/svg-conformance.test.ts`) draws through the same layout
and render engine and verifies:

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
- its literal extracted page text and a thresholded comparison with a
  reviewed committed baseline.

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

A themed corpus under `test/corpus/` renders each fixture through the Vue
renderer. Claims are proven by literal extracted text, per-page marker
positions, laid-out box geometry (hand-computed boxes and the reviewed box
file `test/fixtures/corpus/styles-boxes.json`), annotation and catalog reads
and, for visual claims, reviewed raster baselines. Until 2026-11-22 each
fixture also rendered through React PDF as an oracle; the literal values are
the output both gave then.

**Pagination** (`test/corpus/pagination.test.ts`):

The page builder makes the pages of every document: views, texts, links,
images, SVGs, notes, form fields, rows and tables, footnotes and column
containers, with `fixed` nodes before and after the flow (a footer written
last), absolute nodes and relative `top` and `bottom`. It is the only
pagination. Each page it makes is laid out once more as a check: a page whose
layout differs from the builder's sums, or whose summed flow ends below its
content area, fails with `PDF_RENDER_ERROR`, which names it a bug in Nuxt
PDF, in production too (`test/page-check.test.ts`). A `PdfNote` is a leaf
with a box of its own, as an image: it never splits and moves whole to the
next page when it crosses the page end (`test/engine.test.ts`, "a note on the
page builder"). A `fixed` text
with page tokens inside a view or a row cell repeats in each part with the
values of its page (`test/dynamic-split.test.ts`, "a fixed text with page
tokens inside a view"). A container with
`flexDirection: 'column-reverse'` (a page too) breaks in the order it draws
its children, the last child first, and each part keeps its children in
template order for the structure and the paint order; a `row-reverse` row
breaks as a row (`test/engine.test.ts`, "reverse directions on the page
builder"). An absolute node takes no
room and never splits: it prints with the first part of its parent (the view
around it, a row, or the page) when `top` places it or no vertical offset
does (centered there under `justifyContent` `center`, `space-around` or
`space-evenly`), and with the last part when `bottom` alone places it, or no
vertical offset in a column with `justifyContent: 'flex-end'` or in a row
that aligns it to its end; an absolute `fixed` node on
a page prints on every page. The parts of a parent that splits stack as one
tall parent, as CSS fragments do: an absolute node that `top` places below
the part on a page prints on the part where the offset lands, the heights of
the earlier parts' padding boxes higher. A percentage inset is a share of the
whole parent's padding box, a relative `top` or `bottom` in percent of its
content box, resolved before the parent splits. A `bottom` that reaches above
the last part stays on the last part. A relative `top` or `bottom` moves the
node's box, not its siblings; the page end applies to the moved box, and every
part of a node that splits keeps the offset (`test/engine.test.ts`, "absolute
nodes and offsets on the page builder"). A text with a `minHeight` in points breaks
by its lines; its part on a page fills the room up to the `minHeight` and the
next part keeps the rest of it, as a view's parts do (`test/engine.test.ts`,
"minHeight on a text on the page builder"). The free room of each page part, and of
each view part with a `minHeight` or a row's height, goes to the children
with `flexGrow` by their factors (a `maxHeight` stops a child, the others
share the rest), else to the vertical `'auto'` margins in equal parts, else to
the spacing `justifyContent` asks for; a fixed head or footer on a page is one
of the children it spaces. A vertical auto margin on a row cell places the
cell in its row as `alignSelf` would (`test/corpus/pagination.test.ts`, "auto
margins"). A view splits where its
whole layout, justified in its whole height, puts its children, and each part
is justified again in its own height; a box (a `height` or `maxHeight`) is
justified in each part (`test/engine.test.ts`, "flexGrow and justifyContent
on the page builder"). A row cell that does not stretch (`alignSelf`, or the
row's `alignItems`, at `flex-start`, `center`, `flex-end` or `baseline`)
splits where its place in the whole row puts its lines (the rest of a row is
laid out again as a whole on the next page, a baseline cell keeping its
offset), and each row part aligns it again; a row part ends at the page end,
so on a row's first part a centered or end-aligned cell sits half or all of
the room below the last line lower than on the earlier pagination
(`test/engine.test.ts`, "alignSelf and alignItems in a row on the page
builder"). A column without a height has one flex line, so `flexWrap`
splits it as a column without it (`wrap-reverse` puts that line at the cross
end on every page); `flexWrap` on a column page that breaks fails at mount with
`PDF_TREE_INVALID`, as it would put the content past the page end in a
second column. A wrapping view with a `height` or `maxHeight` is a box like
any other, placed whole in its lines; higher than the content area it fails
with `PDF_LAYOUT_ERROR`, as each part would wrap its share into other lines.
A row with `flexWrap` breaks between its flex lines: the builder fills it as a
column of its lines, each a row, and each part is one wrapping row again. A
line that crosses the page end splits as a row, the rest of a split line starts
at the page top without the row gap (the earlier pagination added it again), and
`wrap-reverse` breaks its lines in the order it draws them. A `position:
'absolute'` child without insets keeps the place it has in the whole row (the
earlier pagination centred it in the row's part). A `fixed` item of a wrapping row that breaks
fails with `PDF_LAYOUT_ERROR`, as a repeated item would wrap the other items
into other lines (`test/engine.test.ts`, "a wrapping row on the page builder").
A node with `fixed={false}` breaks, moves and splits as one
without `fixed`, and `justifyContent` in a row places the cells again in each
row part (`test/engine.test.ts`, "flexWrap, fixed={false} and justifyContent
in a row on the page builder"; `test/renderer.test.ts`). A page with `wrap={false}` does not split, also between pages
that do: it is one page, laid out with its own page number and the total. A
view, text or link with a `height` or `maxHeight` is a box: when it fits
the content area, it never splits and moves whole to the next page when it
crosses the page end; when it is higher than the content area, it splits at
the page ends, its parts share its height and its children keep
the heights it gave them (`test/engine.test.ts`,
`test/pagination-shapes.test.ts`).

- `wrap={false}` does not paginate: the single page grows taller than A4 to hold
  all overflow (nothing clipped or dropped): 596 × 1056 pt (reviewed raster
  baseline);
- `break` on nested wrapped Views lands each block on its own page;
- a `break` starts a new page at every depth, also inside views that fit on the
  page, and the rest of each view continues on the next page (D24;
  `test/invariants/regressions/mixed-h5a-break-in-fitting-wrapper-ignored.json`);
- a `break` inside a row or table row or cell, a `wrap={false}` node or a
  `fixed` node fails with `PDF_TREE_INVALID`, naming the element and the
  ancestor that prevents it; the row, the table row and the `wrap={false}` node
  keep their own `break` (D26; `test/renderer.test.ts`, "tree validation
  messages"; the `break-in-*` fault kinds of the invalid harness profile);
- a `fixed` node that is not absolute and stands between flow content on a
  `PdfPage` or in a view or link that can break (not a row, not `fixed`, not
  `wrap={false}`) fails with `PDF_LAYOUT_ERROR`, naming the node, its
  container and its source position: on a page that ends before it, the
  pagination squeezed that page's flow to fit it and lines overlapped
  (`test/engine.test.ts`, "rejects a fixed node on the page between flow
  content");
- a node that moves whole to the next page keeps its top margin, after an
  automatic break and after `break`, and the continuation part of a split node
  has none, at every depth; a negative top margin reaches above the content
  area only where the author put the node at the page top (the first page,
  after `break`): after an automatic break it pulls a node no higher than the
  content top, and the flow after a node that starts or continues on the next
  page goes there too, so no content is drawn above the page
  (`test/corpus/pagination.test.ts`, "… with a negative top margin";
  `test/pagination-shapes.test.ts`, "a negative marginTop larger than a content
  area"); a node whose box fits stays and loses a bottom margin that does
  not, at every depth and in a column, and the content after it starts the
  next page or column; with `minPresenceAhead` the margin counts (D25;
  `test/corpus/pagination.test.ts`, "margins at a page top" and "a bottom
  margin at the page end"; `test/columns.test.ts`, "keeps a text whose bottom
  margin crosses the column end in its column"; `mixed-h5c-…` and
  `mixed-h5d-…` in `test/invariants/regressions/`); below
  other content, a row whose first cell with content has nothing on the page
  moves whole (`table-h6a-…`);
- a `break` on a node with only `fixed` content before it on its page is
  ignored, so it adds no empty page, also on the first node of a `PdfPage`.
  React PDF adds an empty page there; we differ on purpose (D20 in
  `internals/decisions.md`;
  `test/invariants/regressions/flow-g2-page-starts-with-break-adds-empty-page.json`);
- `minPresenceAhead` pushes a bottom-of-page heading onto the next page to rejoin
  its block, versus the control that strands it; content after a sibling with
  `break` does not count (`test/corpus/pagination.test.ts`, "a minPresenceAhead
  before a forced break");
- `keepWithNext` starts a node on the page where the start of its next flow
  sibling starts: a node that does not split whole, a text's orphans, a view's
  or table's first flow child that shows content (and that child's own keep),
  the latest start of a row's children that show content, and the whole box
  of a view without content that paints; fixed and absolute siblings, and
  siblings that show and paint nothing (anchors), are skipped, a node with
  `fixed: false` is in the flow, a keep before a node with `break` has no
  effect, a keep on the last flow child of a column container keeps that
  child with the node after the container (the container splits before the
  tail: that child, the siblings that keep with it and the rows a cell holds
  with them; it moves whole only when the tail is all its content or it
  cannot split), a container whose bottom padding and border alone cross
  the page end keeps its tail with the content after it as one that fits
  (`test/keep-with-next.test.ts`, "when only the view's bottom edges cross
  the page end"), keeps chain (the walk stops one content box below the node), and
  a keep higher than the content box gives up and pagination splits as
  without it, with the layout warning `PDF_KEEP_IGNORED` once per chain, on
  the first page that drops it; so does a node with `keepWithNext` or
  `minPresenceAhead` at a page top whose keep does not fit below it
  (`test/keep-with-next.test.ts`, "PDF_KEEP_IGNORED"). On a page, a fixed
  node, a nested text, inside a row, a column-reverse container or a table
  cell it fails with `PDF_TREE_INVALID` (`test/keep-with-next.test.ts`,
  invariant I26, fault kinds `keep-with-next-in-row`,
  `keep-with-next-in-column-reverse` and `keep-with-next-on-fixed`). It reaches only the
  next sibling in the same container, and a node that itself crosses the page
  end splits as without it;
- `orphans`/`widows` split a wrapped paragraph at a fixed line boundary;
- a text whose first lines are higher than the content area keeps at least one
  line on a page with no flow content above it, so its pages end (a 40 pt line
  in an 80 pt page, `test/corpus/pagination.test.ts`);
- a `fixed` header and footer repeat on every page of a multi-page flow while the
  body advances;
- a `fixed` node after the flow of its parent, such as a trailing `fixed` table
  row or a footer written last on the page, ends every page of the parent
  right below its flow, and the flow breaks above its height, so
  the rows keep their height; when that room holds no flow and nothing is
  above the parent on the page, the flow breaks at the page end and is
  squeezed, so the pages end (`test/table.test.ts`, `test/engine.test.ts`);
- a pagination that cannot end fails with `PDF_LAYOUT_ERROR` ("Pagination
  cannot end") at the second page in a row that takes nothing from the flow
  (no line, no leaf, no box of an empty view, no forced break), instead of
  running until `timeoutMs`: a line that never fits below a table header or
  a fixed view, a fixed node higher than the page in a row column,
  nothing fitting a column. One such page followed by a page with room
  renders, and so do blank pages made by forced breaks or by a view higher
  than the page (`test/engine.test.ts`, `test/columns.test.ts`); and
- page-token footers (`PdfPageNumber` and `PdfPageCount` inside a `fixed`
  `PdfText`) are correct on every page of a wrapped flow, proven by a
  page-count-derived computed oracle.

**Columns** (`test/columns.test.ts`, literal positions): a view with
`columnCount` or `columnWidth` lays its children out in columns of
(width − (n − 1) × gap) / n, `columnWidth` giving as many columns of at least
that width as fit (at most `columnCount`), and the gap 1em of its font size
when `columnGap` is not set. On the page where a container's content ends,
its columns are balanced (`columnFill: 'balance'`, the default as in CSS):
they get the lowest height at which they hold that content, so two columns
differ by at most a line, a block that cannot split stays whole, and the
content after the container follows below its highest column. On the pages
before, and always with `columnFill: 'auto'`, the columns fill in order: a
column ends at the page end and the content goes on at the top of the next
column, then in the first column of the next page. A container with a
`height` or `maxHeight` fills its columns to that height, and follows the box
rule: no higher than the content area, it moves whole to the next page when it
crosses the page end; higher, it splits at the page ends, its parts share its
height, each part fills its columns to its share, and only the last part is
balanced (`test/columns.test.ts`). Lines break at the
column width, an `'auto'` table measures inside it,
a table header repeats at the top of each column its table reaches, a heading
with `keepWithNext` moves to the next column with the text it keeps, and a
block that cannot split moves to the next column. The container's `gap` or
`rowGap` spaces its children in each column, and its padding, border and
margins stay its own: content after a container whose columns go on over
pages follows below its last part. `columnSpan: 'all'` keeps a
child full width between the columns before and after it. An absolute child
is placed against the container's box, not a column, and is painted in source
order: before the columns when it is written before their content (a
background or a watermark stays under the text), over them when it is
written after content. `break="column"`
goes on in the next column, and in the last column on the next page; `break`
ends the columns of its page. A paragraph across columns and pages keeps
every word once and in order; a page number and an internal link in a later
column show its page and sit at its x; a column container in a row takes the
width the row gives it. Limits, each a `PDF_LAYOUT_ERROR`: content that
needs more columns than a container with a `height` or `maxHeight` has at
that height (CSS adds columns beside the view), and a column container in a
column of another (one that spans with `columnSpan: 'all'` is fine).

A `PdfPage` with columns puts its flow into one view with its column
properties, `gap` and `alignItems`, and lays it out as a view container with
the same style: its `fixed` header and footer stay as wide as the page on every
page, an absolute child keeps its offsets against the page, and in a tagged
document that view adds no structure element (`test/tagged.test.ts`). The
`columns` shorthand sets the count, the width or both and resets the other,
in a style object and in the `<style>` block (`test/pdf-style.test.ts`);
`columnGap: 'normal'` is 1em of the font size. `break="column"` works from
inside a view in a column, starts the next page in a container with one
column, and `break` written as the template shorthand stays a page break.
These fail at mount with `PDF_TREE_INVALID`: columns on a primitive other
than `PdfView` and `PdfPage`, a column container that is or is inside a
`fixed` or absolute node, a column container (a view or a page) with any
`flexDirection` other than `column` (the layout fills each column from top
to bottom), a percentage `height`, `minHeight` or `maxHeight` on a direct
child of a column container (it would be a share of the room the columns get
on the page), `break="column"` outside a column, `columnSpan: 'all'` on a node in
a column that is not a direct child of its container or on a `fixed` child
of a page with columns, and `columnFill: 'balance-all'`. Without a column
container above it, `columnSpan: 'all'` has no effect, as in CSS.

A column rule (`columnRuleWidth`, `columnRuleStyle`, `columnRuleColor`, and
the `column-rule` shorthand of the `<style>` block, which takes the parts of
`border`; `test/columns.test.ts`, `test/pdf-style.test.ts`) is drawn when its
width is above 0, solid and black unless set, with the dashes of a border: a
line in the middle of each gap between two columns that hold content, from
the row's top to its highest column, to the content bottom of a container
with a `height`, interrupted by a spanning child and above the note area of a
page with columns. A width with a unit is points, as a border width. In a
tagged document the rule is an artifact. A rule key on a primitive other
than `PdfView` and `PdfPage` fails at mount with `PDF_TREE_INVALID`; on a
view or a page without columns it has no effect, as in CSS.

**Floats** (D49; `test/floats.test.ts`, literal places; invariant I28): a
`PdfView`, `PdfImage`, `PdfSvg` or `PdfTable` with `float: 'top'` or
`'bottom'` leaves the flow for the top or the bottom of its area: the column
it stands in, or the page content area without columns. A top float sits
below the fixed nodes at the top of its area; a bottom float ends at the area
end, above the note area and a fixed footer written after the flow, and in a
balanced part at the bottom of the balanced columns. Areas are placed in
order. A float goes to the area that holds its place in the flow (its
anchor) when that area, filled again with the float in it, still reaches the
anchor; otherwise it waits for the next area, and the text after it goes on
in this one. The waiting floats of a side go first at the start of the next
area, as long as they fit, so an area may hold floats only. A float never
goes to an area before its anchor's, never before an earlier float of its
side, and never out of its page's `PdfPage` or its column container. For the
flow a float is not there: a heading with `keepWithNext` before a float
keeps with the content after it. A float does not split and keeps its width;
the `gap` or `rowGap` of its container spaces it from the flow. A float may
stand in plain views, which the layout splits at the float as at a page
break: the first part keeps the top edges, the `id` and the bookmark, the last
part the bottom edges, and where content of two children meets at the cut the
view's `rowGap` stays. The note of a mark inside a float prints on the float's
page; a float whose note does not fit there waits for the next page, and the
page is filled again with the floats that stay, so no room stays empty above
the notes. An `id` on or in a float points to the page it prints on, and a page
reference whose digits move a float settles in the passes, or ends at
`maxPasses` with `PDF_LIMIT_EXCEEDED`. The outline and the structure tree keep
source order. A document without floats lays out as before (the raster suite
and the playground tests are unchanged).

A float with `columnSpan: 'all'` in a column container, or in a plain child
with it, spans all columns (`test/floats.test.ts`, "floats across all
columns"). Its area is the container's part on the page: a top float sits at
the part's top; a bottom float ends at the page end (above the notes) while
the container goes on to the next page, also when only a waiting float makes
it go on, and on the page where the container ends right below its balanced
columns, or at the container's bottom when it has a `height` (`maxHeight`
does not count: such a container is as high as its content). The columns run
on below a spanning top float and above a spanning bottom float; the float
does not end them. Its anchor is its place among the column content: it goes
to the first page whose part reaches that place, and the content after an
unreached anchor goes on in the columns. The spanning floats and the column
floats of a container share one source order per side: on a page the
spanning tops print above the column tops and the spanning bottoms below the
column bottoms, so a spanning float waits while an earlier column float of
its side waits, and a column float after it waits while it waits. A page with
`columns` is a column container too. A container with a `height` that fits
whole is laid out whole; one whose fill holds a float back splits like a
container that does not fit. A spanning float higher than a container's
`height` has room for, or a container with a `height` whose content and
floats need more than its columns hold, fails with `PDF_LAYOUT_ERROR`.

In `PdfRichText`, `float` in `styles.image` floats every image and figure of
the content (`test/rich-text-images.test.ts`); HTML `style` and `class` are
not read, so the content cannot set a float itself. An image in a list item
with such a float fails at mount with `PDF_TREE_INVALID`, naming its content
path: the item's content stands beside its marker, so it has no flow of its
own to float out of. A tagged document with page, column and spanning floats
passes veraPDF as PDF/A-3a and PDF/UA-1 (`test/pdfa.test.ts`).

These fail at mount with
`PDF_TREE_INVALID`: `float` on another primitive (such as `PdfText`); a float
inside a view that is not plain (row direction, a `height`, `minHeight`,
`maxHeight`, `flexGrow` or `justifyContent` other than `flex-start`, `fixed`,
absolute, a link, a table part, `wrap={false}`), inside a float, or on a
`PdfPage` with `wrap={false}` or a `justifyContent`; a float with
`break`, `keepWithNext` or `minPresenceAhead`, a fixed or absolute float,
and a float with columns. A float higher than the most room its area gets on
a page fails with `PDF_LAYOUT_ERROR`. Not claimed: side floats (`left`,
`right`) and LaTeX's float fractions. A forced break right after the floats at the top of an area is
taken there, so that area holds the floats only. A float under the height
limit that still fits no area of its pages (fixed content that shows only on
some pages) ends in `PDF_LAYOUT_ERROR` ("Pagination cannot end"), not a loop.

**Footnotes** (`test/footnotes.test.ts`, engine trees, literal positions):
a page holds as many flow lines as fit together with the notes of the
references on it, in a note area at the page bottom above the bottom padding:
a view whose top border is the rule, whose top margin and padding set the
space above and below it, whose `gap` sets the space between notes, and whose
text styles the notes inherit; its own children (a short rule) come first
on every page, then the notes in reference order. The flow
ends above the area, so a growing box or `justifyContent: 'flex-end'` uses
only the room left. Marks count inside boxes and table-like rows. A line with a
reference stays only with the start of its note (its orphans, or all of it
when it is short); otherwise it moves to the next page with it. The last note
of a page gets the room left and continues at the top of the next page's
area, before that page's own notes, keeping its widows; a note referenced
twice is placed once. A note whose start never fits below its reference
keeps the line and as many note lines as fit, at least one, and continues;
pages of note lines alone follow until it ends, so the document always ends.
Such a page keeps the least of its flow that holds a line. Every note
referenced on it whose first line fits the room starts there; the first one
that does not, and every one after it, moves whole, in order, to the top of
the next page's area, with the layout warning `PDF_FOOTNOTES_MOVED`. Nothing
is drawn below the page end, except a single note line higher than the page:
such a note never starts on the page of its mark, so the page after holds it
alone, its line running past the page end, and the flow goes on after it.
A note that moves keeps the number of its mark: with `footnotes="page"`,
numbers count the marks on a page (`test/footnotes.test.ts`,
`test/footnote-component.test.ts`). Per page, each mark and note number is
laid out in the width of its number through the document, in the widest
digit of the first font of its stack that has all ten digits (also a font
with proportional digits, Inter); after layout one
walk over the final pages prints the page's numbers in reading order, table
cells and columns included, and aligns each changed line again (a justified
line stays justified, a last line keeps its alignment). The render takes one
layout pass, as with numbers through the document, and has the same pages.
A tagged link describes itself by the number it prints, and
`PDF_FOOTNOTES_MOVED` names the printed numbers. A mark in a line with
right-to-left text keeps its own glyphs and link area there too
(`test/footnote-component.test.ts`). Limit, a `PDF_LAYOUT_ERROR`: a number
wider than the room its mark kept (a font that moves two digits apart, or a
font earlier in the stack that has only some digits). A block with
`wrap={false}` that fits the page stays whole on a page with footnotes; one
higher than the page is shrunk above its notes, as without them.
Each try of the fit is a fill by the sums of what the page holds (each try
after the first counts in `noteFits`); the page is laid out once. On a page
with columns the area spans the content width below
all columns, with the notes of every column in reading order. Each try
balances the columns at its height and splits there: a container that ends on
the page is balanced above the area, and one that its notes push past the page
end fills in order and is balanced on the next page. On a page with notes, all
columns of a container that continues on the next page stop at one height, so
the page is as full as one height allows: three columns can hold 7, 7 and 7
lines where 8, 8 and 7 would fit. The search up from a height that fits steps
to the next height at which any column changes, so it ends at a height that
only a later column ends at; the area takes a carried note part, and rule 11
holds on such a page too. A block with `wrap={false}` that moved to a new
page stays whole there when it fits the content area, also in a balance. Limit, a `PDF_LAYOUT_ERROR`: footnotes on a
page with `wrap={false}` or an automatic height.

**Text** (`test/corpus/text.test.ts`):

- with a document language, `hyphens: 'auto'` breaks a long token with
  trailing hyphen glyphs, versus the default `hyphens: 'manual'`, which keeps
  every word whole so the token stays unbroken and overflowing;
- `hyphens` is an inherited style key, `'manual'` by default. `'manual'`
  splits a word only at its soft hyphens, also in a document with a
  `language`; `'auto'` adds the pattern points (`test/line-breaking.test.ts`,
  literal lines, with `hyphens` set on the page). Text in `'auto'` table
  columns is measured with whole words, and a rich text code block has
  `hyphens: 'manual'`. The removed `hyphenate` prop fails with a hint to the
  style key (`test/page-primitives.test.ts`);
- with `hyphens: 'auto'`, hyphenation follows the document `language` (D41). A tag takes the
  patterns of its longest known part: `de` and `de-AT` give German points,
  `en` American and `en-GB` British ones, `sr-Latn` Serbian in Latin script.
  A word with a soft hyphen breaks only there. Without a `language`, a word
  breaks only at its soft hyphens. Text between spaces that holds `@` or
  `://` (an e-mail address, a URL) gets no hyphen from the patterns, also
  with a document language: it hyphenates only at its soft hyphens. A URL
  can still break after a slash or a hyphen, and then no hyphen is added
  (`test/text-layout.test.ts`). A link around words in a German document
  takes the German points (`test/line-breaking.test.ts`, literal lines). Every
  pattern file of `hyphen` loads by its name and splits a word into parts that
  join back to it, except Old Church Slavonic (`cu`), whose file is not valid
  JavaScript in `hyphen` 1.14.1 and is not offered (`test/text-layout.test.ts`).
  A language without patterns gives the layout warning
  `PDF_HYPHENATION_UNAVAILABLE` with the language, once per render, when a
  text has `hyphens: 'auto'`; Arabic,
  Persian, Hebrew, Yiddish, Urdu, Chinese, Japanese and Korean give none, and
  neither does a document without a `language`;
- `letterSpacing` widens glyph advances and changes wrapping;
- `fontVariantNumeric: 'tabular-nums'` is an inherited style key that shapes
  with the font's `tnum` feature: every digit of Inter gets the same advance
  in the layout and in the embedded font (`test/fonts.test.ts`). A font
  without the feature keeps its digits;
- `textWrap: 'pretty'` is an inherited style key that adds demerits to the
  line breaker for a last line shorter than a sixth of its line, a hyphen on
  the line before the last, and two hyphenated lines in a row (D50): a
  justified paragraph keeps its last word whole and a ragged one gets more
  than one short word on its last line (`test/text-layout.test.ts`). It is a
  preference, not a rule: when no set of lines inside the tolerance avoids
  them, they stay. `'wrap'`, the default, breaks as before;
- `textAlign` left/center/right shifts line origins and `justify` fills interior
  lines while the last line keeps its natural advance;
- a line is broken at its natural width (D30): a line that is not justified
  keeps its natural advances, justified lines only stretch, and every line ends
  inside its box except one token wider than the box with no break point,
  which keeps its natural width and overflows to the right
  (`test/line-breaking.test.ts`, literal lines for three fonts, four
  alignments and box widths at, just under and just over the natural width).
  React PDF squeezes a line that is wider than its box; we do not;
- text that is not justified breaks as TeX's ragged right does (D42): each
  line but the last may stretch by 3 em at its end and its spaces do not
  stretch, so a hyphen is chosen only when it avoids a much shorter line.
  A Lora 11 pt paragraph in 150 pt gets 12 lines without hyphens and a
  largest gap of 36.01 pt (first fit leaves 42.3 pt; the old breaker gave 11
  lines with 4 hyphens); left, center and right give the same lines; a
  penalty of 100 gives 3 hyphens; justified text keeps its breaks
  (`test/text-layout.test.ts`, literal lines). Rule T5 on generated ragged
  texts: a higher hyphen penalty never adds hyphens; a text with a line
  wider than its box falls back to greedy best fit and is outside T5;
- a text gets the lines of the width of its final box: a row that shrinks
  it, and a `minWidth` in points or percent that is wider than its lines,
  give it the lines of that box, and the box their height, also on a page
  with `wrap={false}`, which is laid out only once (`test/line-breaking.test.ts`);
- nested style inheritance and inline `fontFamily` switching resolve the correct
  embedded font per run and inherit color across wraps (the font and color
  of each run, and the literal lines);
- German umlauts, eszett, and Latin-extended diacritics round-trip through text
  extraction; and
- `maxLines` with `textOverflow: 'ellipsis'` clamps to the line count and appends
  the ellipsis (U+2026);
- `verticalAlign: 'sub'` and `'super'` on a text or link inside a text move its
  baseline by a fifth or a third of the parent's font size, as Blink does
  without its extra pixel, and nested shifts add up (pdf.js reads the
  baselines and the link area); its link and inline images move with it, its
  strike-through follows its own baseline, and its background stays on the
  line. An underline has the position and thickness of the outermost text
  that sets it, as CSS draws it for the decorating box: one line under 'x²'
  underlined as a whole, the line of an underlined mark under the mark
  (`test/corpus/text.test.ts`, literal positions). The line grows only where
  the shifted text leaves the line box (`test/text-layout.test.ts`, literal
  sizes); on any other node a `super` or `sub` fails with `PDF_TREE_INVALID`,
  and `baseline` is accepted everywhere. Rich text maps `<sup>` and `<sub>`
  (HTML, and raw HTML in Markdown) to a run's `verticalAlign`, in the `sup`
  or `sub` style of `PdfRichText`, 70 % of the text size by default and
  merged with the author's style; a `sup` or `sub` inside another keeps the
  outer place (`test/rich-text-html.test.ts`, `test/rich-text-comark.test.ts`,
  literal models; `test/rich-text.test.ts`, the sizes and shifts read back
  from the PDF); and
- generated texts keep four rules (`test/text-layout.test.ts`, 200 texts in
  Inter, Lora, Helvetica and the CJK and Arabic subsets): every character of
  the text is on a line in order (T1); every run has a font, and a character
  is drawn in a font without it only when no font of its stack has it (T2); a
  line is wider than its box only when it has no break point inside (T3); and
  a hyphen is added only at a pattern point or a soft hyphen of the word
  (T4; each text draws no language, American English or German). A word across two or more runs (a footnote mark, a link or a bold
  part right after a word, a character from a fallback font) is one word: it
  does not break between the runs, and with hyphenation it breaks only at a
  point of the whole word. An inline image is no part of a word: a line may break before and
  after it, with no hyphen. It takes the text's own font, also when that font has no
  U+FFFC (Inter and Lora have none), so a PDF/A or PDF/UA document never paints it in the
  standard font (`test/tagged.test.ts`). An emoji or another character outside the BMP takes
  the first font of the stack that has it, like any character. A character that no font of the
  stack has is drawn with the `.notdef` glyph of the first font, reads as U+FFFD and gives the
  layout warning `PDF_GLYPH_MISSING` once per character; under a PDF/A or PDF/UA claim it fails
  with `PDF_TREE_INVALID` (`test/international-text.test.ts`, `test/pdfa.test.ts`). A line
  breaks where the Unicode line breaking rules (UAX #14, `linebreak` 1.1.0) allow: after
  spaces, between ideographs (the generated texts hold CJK text without spaces), after a
  hyphen, a slash or an en dash with no added hyphen (after a hyphen at a penalty of 50, as
  TeX's `\exhyphenpenalty`), and at a zero-width space; never at a
  no-break space, at a word joiner or before closing punctuation; and a line or paragraph
  separator ends the line and is not painted (`test/text-layout.test.ts`, `test/engine.test.ts`).
  A word joiner that the font lacks still holds its break, takes no room and paints
  nothing. Not tested: the NFD decomposition of complex scripts (Devanagari,
  Bengali, Tamil and ten more) in a registered font, which keeps shaped
  glyphs mapped to their characters; the repository has no font for these
  scripts.

**International typography** (`test/international-text.test.ts`):

- Latin Extended, Greek, and Cyrillic render and extract exactly with an
  explicitly registered covering font;
- representative Chinese/Japanese text renders, extracts, and matches a
  reviewed raster with a test-only Noto subset (experimental broader CJK claim);
- representative Arabic shapes visually and reports an RTL text run
  (experimental). A dot that the font draws as its own glyph (Noto Sans
  Arabic after ب, ي and ة) stays with its letter in a right-to-left line, at
  the font's x and y offsets (`test/text-layout.test.ts` compares with
  fontkit's own right-to-left shaping; `test/international-text.test.ts`
  reads the written positions);
- Poppler extracts Arabic lines with such glyphs exactly, also beside a
  ligature (`test/invariants/invariants.test.ts`; the row fails when Poppler
  is missing only in the CI invariants job, `pnpm test:invariants`). pdf.js reads each such glyph as a control character
  and splits and reorders the words, so its rows compare the letters only;
  it extracts Arabic words without such glyphs exactly. A tagged Arabic line
  with such glyphs passes veraPDF as PDF/A-3a and PDF/UA-1 with their empty
  ToUnicode entries, without `/ActualText` (`test/pdfa.test.ts`);
- a wrapped Arabic line that starts with a letter whose dots the font draws
  as their own glyph keeps the glyphs it has on one line, and a truncated
  right-to-left line that ends with such a letter keeps its ellipsis
  (`test/text-layout.test.ts`);
- the runs of a line with right-to-left text follow the visual order, so a
  link, a footnote mark or another style inside right-to-left text draws its
  own glyphs, and a link area covers them (`test/footnote-component.test.ts`);
  in a tagged document each inline image is its own figure there
  (`test/tagged.test.ts`). Not done: a tagged paragraph's parts (its marked
  content, inline links and inline images) follow paint order, so in
  right-to-left text they are in visual order, not in reading order;
- combining marks that the font has render correctly but extraction can detach
  mark association (experimental); a mark the font lacks draws the
  precomposed letter when the font has it ("Å" for "A" + U+030A), which reads
  as NFC, and is otherwise a missing character (`.notdef`, U+FFFD,
  `PDF_GLYPH_MISSING`) (`test/text-layout.test.ts`, "combining marks the font
  lacks");
- a font weight needs its face: a static face paints only its registered
  weight, and a weight without a face fails with `PDF_LAYOUT_ERROR` that names
  the node and lists the faces (`test/engine.test.ts`);
- a variable TrueType font paints each weight inside its `wght` axis with that
  instance, other axes at their defaults: Source
  Code VF at 400 and 700 is close in pixels to the static Regular and Bold,
  the embedded glyph outlines are the instance's, the text extracts and two
  renders give equal bytes (`test/fonts.test.ts`, "variable font weights").
  Inter Variable at 400 and 700 lays out, embeds (`hmtx`) and reads in
  pdf.js with the advance widths of each instance; a weight outside the axis,
  registered or not, fails, and `opsz` stays at its default. A CFF2
  variable font fails at build time; and
- an emoji paints the outline glyph of a registered emoji font (the Noto Emoji
  subset in `test/international-text.test.ts`); color emoji fonts (`COLR`,
  `CBDT`, `sbix`) are not claimed: only glyph outlines are painted.

`PdfRenderDiagnostics.registeredFontFaces` reports only configured family,
weight, and style. A character that no font of its text has gives the layout
warning `PDF_GLYPH_MISSING` (see above).

**Images** (`test/corpus/images.test.ts`):

- JPEG file paths, base64 `data:` URLs, and `{ data, format }` buffer sources all
  decode in the lower-engine fixture. The public resource boundary
  accepts bundled paths, admitted byte sources, and allowlisted HTTPS images;
  it blocks `data:` URL strings on every public render path;
- explicit width+height, single-dimension aspect scaling, and percent width
  against the page content box size the laid-out box (reviewed baseline);
- `objectFit` `contain` letterboxes and `cover` crops while the box stays fixed
  (reviewed baseline); and
- an image in a `fixed` header repeats once per page, and its bytes are
  embedded once per document (`test/server-runtime.test.ts`); and
- a row breaks only where every cell whose first content fits before the
  break by its place shows some of it there (D51): when a cell's own rules
  move it after the break (a text whose orphans or widows do not fit, or an
  image, an SVG or a `wrap={false}` view that crosses the end), the whole row
  moves below other content (`test/columns.test.ts`, "rows at an area end"),
  while a cell that an alignment or a margin places below the break starts
  there as before; at the top of an
  area such a cell moves alone, whole and at its own size, and one higher
  than the page stays on its page; none is drawn twice (`test/engine.test.ts`,
  "measured sizes by placement").

**Styles and layout** (`test/corpus/styles.test.ts`):

`PdfStyle` is a framework-owned contract, not a re-export of the wider upstream
stylesheet types. Real TypeScript and Vue SFC negative fixtures reject unknown
keys, unsupported units/values, and invalid style-array entries; runtime props
remain independently closed because Vue fallthrough attrs can escape static
checking.

A style value must keep the sign rule of its key (`PDF_STYLE_SIGNS`): sizes,
paddings, border widths and radii, gaps, flex factors (also each number of the
`flex` shorthand) are 0 or more, `fontSize` and `lineHeight` are above 0, `maxLines` is a
whole number of 1 or more, `opacity` is from 0 to 1, and margins, insets,
`letterSpacing` and transforms may be negative. One function checks it for
`:style`, `v-bind()` and the `<style>` block (build time). A `PdfLink`
`hitSlop` is an object with any of `top`, `right`, `bottom` and `left`, each
a number of 0 or more. Every color-valued style key and SVG prop takes one set of forms
(`shared/color.ts`, read by validation and the painter alike: hex with 3, 4,
6 or 8 digits, `rgb()`, `hsl()`, `hwb()`, a color name in any case and
`transparent`; `none` too for a shape's `fill` and `stroke`), and its alpha
multiplies the opacity that applies, as in CSS (`test/colors.test.ts`). A
form field color with alpha fails, because /MK and /DA have no alpha. Every `PDF_TREE_INVALID` message of the tree
validation names the element (with its `id`), the prop or style key and the
wrong value, cut at 40 characters, and never a password or node text
(`test/renderer.test.ts`, "tree validation messages"); the invariant harness
checks each of its fault kinds against the message of its own check
(`test/invariants/faults.ts`).

- flexbox with `row` or `column` direction, `flexGrow`, `flexBasis` and `flexShrink`,
  `justifyContent: space-between`, `alignItems: center`, and `gap`;
- percent width/height against page and nested parent boxes; every
  percentage `height`, `minHeight` and `maxHeight` of a node that is not
  absolute resolves to points before layout, against its parent's height
  inside its paddings and borders (a page child: the page's content height),
  so a view with `minHeight: '90%'` splits at the page end, its next part
  keeps the rest, and the parts of a parent that splits keep the points; a
  parent without a height known before layout (in points, a resolved
  percentage, or a page with a height) fails with `PDF_TREE_INVALID`; an
  absolute node's percentage stays yoga's, against its parent's padding box
  (a page's absolute child: its content height, as before)
  (`test/engine.test.ts`, "pagination inputs");
- resolved margin/padding/border on every edge and border-box offset; a box
  length such as `'+0'` or `'0e1'` gives the points admission reads
  (`test/engine.test.ts`);
- `position: 'static'` in a style object: the node ignores its insets; an
  absolute text, image or SVG without a width gets the same size in a row as
  in a column, the parent's content width (`test/engine.test.ts`, "measured
  sizes by placement");
- style-array flattening with `false`/`null`/`undefined` entries filtered, equal to
  the merged object form;
- `fontFamily`/`fontSize`/`color` cascading through nested Views into Text with
  own-value override; a unitless `lineHeight` cascades as a factor of each
  text's own font size, a length or percentage as the points it gives where
  it is written, a percentage of the element's own or inherited font size
  (`test/engine.test.ts`, "inherits a unitless lineHeight as a factor",
  "resolves a percentage lineHeight on …"); a percentage `fontSize` is that
  share of the inherited font size and passes points on: a nested text at
  70 % of 20 pt is 14 pt, 50 % of 50 % of 20 pt is 5 pt, a page number in a
  text at 70 % keeps the size when it is laid out on its page, and a
  percentage `lineHeight` on the same node takes the resolved size
  (`test/engine.test.ts`, "resolves a percentage fontSize: …", read back from
  the PDF). A percentage `fontSize` on `PdfPage` or on SVG text fails with
  `PDF_TREE_INVALID` (`test/renderer.test.ts`);
- a line puts half of what each run's line height adds to the run's glyph
  height (ascent to descent) above the glyphs and half below (CSS
  half-leading): the run whose leading box reaches highest sets the
  baseline, so a line with a raised mark keeps the baseline of a line
  without it, and
  a line height below the glyph height lifts the glyphs above the line; the
  background of a nested text covers its glyph height (`test/paint-paths.test.ts`,
  "paints a line with … at its half-leading"; `test/text-layout.test.ts`,
  "keeps the baseline of a line with a raised mark …"); and
- `backgroundColor`, `opacity` alpha-blending, a stroked `border`, and a
  `rotate`/`scale`/`translate` `transform` that paints transformed while the layout
  box stays invariant (a reviewed raster baseline per painted scenario). Every
  scenario asserts its ordered boxes against the reviewed box file and its
  hand-computed boxes.

**Annotations, metadata, and page setup** (`test/corpus/annotations.test.ts`):

- external `https` and `mailto` `PdfLink` annotations round-trip their `url` and
  `unsafeUrl` verbatim;
- the link area of a link or footnote mark inside a text is its glyphs, from
  their ascent to their descent, as an inline box in CSS; a line height
  above the font's adds no space to it, so it stays on its line
  (`test/footnote-component.test.ts`, literal rectangles);
- `PdfNote` renders as a `Text` sticky-note annotation carrying its contents;
- document metadata (title, author, subject, keywords, creator, producer,
  creation date) round-trips through the info dictionary;
- `language` becomes the catalog `/Lang`, `pageLayout` the catalog
  `/PageLayout` (`TwoColumnLeft`), and `pdfVersion` the file header
  (format version `1.5`); and
- A4, Letter, custom `[w, h]` and `{ width, height }`, landscape, and
  `px`-with-`dpi` page sizes resolve to a hand-computed MediaBox.

### Vue and Nuxt authoring

The tests verify:

- `PdfDocument`, `PdfPage`, `PdfView`, `PdfText`, `PdfImage`, `PdfLink`, and
  `PdfNote`;
- the places of `PdfFootnote` (`test/footnotes.test.ts`): it mounts in a text,
  a nested text, a table cell (which stays a text cell) and next to a link.
  Outside a `PdfText`, in a fixed node or a `PdfTableHeader`, in a `PdfLink`,
  in the note of another footnote, without a note, with a `PdfPageNumber` or
  `PdfPageCount` in its note, with `fixed` or `bookmark` on a text in its
  note, with a `style` of its own, and with a `footnotes` numbering other
  than `'document'` or `'page'`, it fails with `PDF_TREE_INVALID` and a
  message that names the fix. `footnoteStyles` that is not an object, has a
  part other than `mark`, `note` and `area`, a part that is not a style (a rule may be
  `false`), an invalid style value, a key that places the box (`position`,
  `maxHeight`, the offsets of the rule), a margin of the area other than
  `marginTop`, or a raised note fails the same way, and so do an `id` that starts with the reserved
  `__nuxtPdfFootnote-`, and, in a PDF/UA-1 document, a footnote in a
  `decorative` node or inside a figure (`test/tagged.test.ts`). `PdfRichText`
  renders each note once and a later reference as a mark of that note;
- the footnotes in the engine tree (`test/footnotes.test.ts`): each page node
  holds the notes of its marks in order, each note with its reserved id, the
  number in the mark style and the content, and a note area with the area
  style whose one child is the rule (none with `rule: false`); each mark is a nested text with the number that links to its note;
  `footnoteStyles` merge over the defaults. Through the document the numbers
  count every note. Per page, each mark is laid out in the room of its number
  through the document, in the widest digit of its font, and the marks are
  numbered per page after the layout. A repeated
  rich-text reference takes the mark of its note;
- footnotes in the PDF (`test/footnote-component.test.ts`): each note prints
  at the bottom of the page of its mark, after its number, at 85 % of the
  text size with its number at 70 % of that; each mark links to its note,
  and the number of each note links back to a destination at the top of the
  line of its mark (also on a paragraph's second line). Through the document the numbers count every note; per page they
  start at 1 on each page, in one pass, with the page breaks of the numbers
  through the document, also where those have two digits.
  The rule is the first box of the area on every page: by default 33 % of
  the area's width, 0.5 pt high and 4 pt above the first note, counted in
  the area's height; `rule: { width: '100%' }` spans the area and
  `rule: false` leaves it out. A line with a raised mark is as high as the
  larger of the text's line height and the mark's top plus the font's
  descent: with the default mark style, a line height below
  0.33 + 0.7 × ascent + descent (in em; about 1.16 for Helvetica) grows the
  line, at any font size (literal line positions at 9 pt and 14 pt);
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
  property or value, and a static class or a literal `:class` name that the file
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
  component, and invalid tables fail with `PDF_TREE_INVALID`. A cell is
  always a view; a cell with only text puts it in one text as wide as the
  cell, with the cell's text-only style keys, and `justifyContent` places it
  as in a cell with other content. A column object
  `{ width, align, style }` gives its `align` and `style` to each cell that
  starts in the column, header cells included, under the cell's own align,
  class and style. The column decides a cell's width in every table kind: a
  cell's own `width`, `minWidth` or `maxWidth` fails unless every column it
  covers is `'auto'`, a horizontal margin narrows the cell inside its
  columns, so the later cells of the row stay in line, and a horizontal
  margin in percent, a flex style and `position: 'absolute'` on a cell fail. `colspan` makes
  a cell as wide as the columns it covers (shares and fixed widths summed;
  `pt`, `in`, `mm` and `cm` converted to points), also in the header on every
  page, asserted from text positions; a row counts covered columns; a
  `colspan` that is not a whole number from 1 and a span over lengths in units
  that cannot be added fail. A table whose
  first page would hold only its header starts on the next page instead (the
  orphan rule; it applies to any view whose first fragment would hold only its
  `fixed` children). In a column container it starts the next column, and
  after the last column the next page (`test/columns.test.ts`). A row does not split across pages unless it sets `wrap`;
  a row that splits keeps every cell in its column on both pages, a row with
  fewer cells than columns leaves the rest empty at their width, and a cell's
  padding does not move a share column (invariant I9 on generated tables,
  `test/invariants/`). An `'auto'` column is as wide as its widest cell on one
  line, padding included, and the share columns take the rest; with less room
  the `'auto'` columns narrow together in proportion to their slack (max-content
  less min-content), down to their longest words and below, and a share column
  keeps its longest word; the widths come from the whole table, so every page
  has the same columns; a span gets the summed width without widening its
  columns, except that the columns hold its own padding, border and margin,
  so a span stays in line with the rows above it; a cell keeps its column
  and its own padding, and a table too narrow for that warns
  `PDF_TABLE_COLUMNS_TOO_NARROW`; `PdfPageNumber` and `PdfPageCount` count as four digits and
  `PdfPageRef` as the number it prints (`test/table.test.ts`, invariant
  I9c on generated tables, `test/invariants/auto-columns.test.ts`). The work
  counters of the real-shaped invoice with `'auto'` columns show no extra
  layout, page or shaped run (`test/work-budget.test.ts`). The measure counts
  the margins of a cell and of its children, leaves out absolute children, notes and
  the cells of a nested table, and limits an element to its numeric
  `maxWidth` and `minWidth`. An unmeasurable cell (an image, an SVG, a form
  field or a row view without a width, a percentage width, or a percentage or
  `'auto'` horizontal edge) in an `'auto'` column fails at mount with
  `PDF_TREE_INVALID`, and in a
  tree built without the table components with `PDF_LAYOUT_ERROR`. A column
  whose cells are one word each does not narrow, so a table whose one-word
  columns, share columns and width columns do not fit is wider than its box.
  `rowspan` makes a body cell cover the rows below its own; the cells of those
  rows take the columns that no span takes (`test/table.test.ts`). The cell
  is as high as its rows, and the last row it covers grows by what its content
  needs beyond them; the rows a cell covers stay on one page, move to the next
  page together when they cross the page end, and stay where they start, cut
  at the page end with the layout warning `PDF_UNBREAKABLE_NODE_OVERFLOW`,
  when they are higher than the content area less the fixed rows that repeat
  (the rule of a block that cannot split); the fixed nodes after them repeat
  on that page; the cell paints after the rows it covers, with its row's
  opacity and without its row's clip; an `'auto'` column measures it (`test/row-spans.test.ts`,
  invariant I9b on generated tables, `test/invariants/row-spans.test.ts`). The
  real-shaped invoice with each rate over four rows has the pages, layouts and
  shaped runs of the invoice without spans and one more yoga layout of the
  page tree (`test/work-budget.test.ts`). A `rowspan` that is not a whole
  number from 1, a static `rowspan`, a span past the last row or in the
  header, `wrap` or `break` on a covered row, a cell over a column that a
  span takes, and a covered row inside another element fail at mount with
  `PDF_TREE_INVALID`;
- `pages` on `fixed` `PdfView` and flow `PdfText` (`test/table.test.ts`):
  `'all'`, `'first'` (first page of the parent only), `'continuation'`
  (every later page of the parent) and `'not-last'` (every page of the parent
  but the last, `test/running.test.ts`). A `'first'` or `'continuation'`
  node takes room only on the pages where it shows: the other pages of the
  parent are laid out line by line like the document without the node. A
  `'not-last'` node takes room on every page of the parent, because the last
  page is known only after that page is filled; the last page leaves that
  room empty. All of this costs no extra layout pass. An absolute node takes no flow space on any page. An absolute node keeps its
  offsets and can print page tokens. Invalid `pages` use (without `fixed`,
  nested, or with other content than views, texts and tokens) fails with
  `PDF_TREE_INVALID`;
- the layout warning `PDF_CONTENT_HIDDEN` (`test/engine.test.ts`), once per
  node: a text whose own `height` or `maxHeight`, or that of a view around
  it, cuts off lines, with the number of lines that are not drawn (lines past
  `maxLines` do not count), and an absolute node that reaches below the page
  end, with its lines and its images, SVGs and form fields that start there.
  Inside a block that gets `PDF_UNBREAKABLE_NODE_OVERFLOW` (also the rows a
  span holds together), only that warning comes (`test/row-spans.test.ts`).
  A text whose box yoga shrinks below its lines keeps them, and they can
  overlap the content below without a warning;
- the layout warning `PDF_UNBREAKABLE_NODE_OVERFLOW` (`test/engine.test.ts`)
  for a block that cannot wrap and is higher than the usable page height (the
  content area less the in-flow fixed nodes), also when the engine shrank it
  to fit; the warning then reports the height the
  block needs. The rows that a table cell with `rowspan` holds together give
  it once when they stay cut, with their height and the room below the
  repeated header rows (`test/row-spans.test.ts`). So does one block that
  cannot split and is higher than that room, though not higher than the page,
  also as a cell of a row under the header: it stays where it starts, cut at
  the page end, instead of moving to a page where it would cross the end
  again under the header. An absolute or `fixed` node never gets it: it is
  not in the flow, and its page clips it. A block exactly as high as the
  content area fits. The warning does not
  change the PDF;
- the layout warning `PDF_TABLE_COLUMNS_TOO_NARROW` (`test/table.test.ts`), once
  per table with `'auto'` columns that is narrower than its columns need to
  keep their longest words whole, with the page where the table starts;
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
  starting with `#` is an internal destination; any other `href` must be an
  absolute `http:`, `https:`, `mailto:` or `tel:` URL, else
  `PDF_TREE_INVALID` names it, `test/renderer.test.ts`), and context-specific
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
- one source for title and language: a template that sets one of them both
  in `definePdf` and on `PdfDocument` fails with `PDF_TREE_INVALID`, and the
  message names both places. A `definePdf` value is applied to the mounted tree
  before validation, so the tagged checks see it. Completed `result.metadata`
  reports the title/language written into the PDF, equal to what
  `resolveMetadata` returns whenever `definePdf` sets the value, plus the
  resolved download filename (the filename is response metadata, not a PDF
  Info field);
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

`test/letter-playground.test.ts` renders the playground business letter from its
SFC on one A4 page and reads back the text positions of DIN 5008 form B: the
return line and the address at 25 mm from the left inside the 85 × 45 mm window
45 mm from the top, the information block at 125 mm, and the text block below
98 mm. The docs template gallery is generated from five playground templates;
`pnpm test:docs` fails when a template, its imports, its named assets, a page
image or the page differ from the recorded state. It does not render, so a
change of paint output with unchanged templates is guarded by the raster
suite, not by the gallery check.

### PDF/A-3b and Factur-X

`conformance="PDF/A-3b"` on `PdfDocument` makes the render write PDF 1.7, one escaped XMP packet with the PDF/A identification and
the document metadata, an sRGB output intent with an ICC profile built from
the published sRGB constants, and a MIME type on every embedded file
(`test/pdfa.test.ts`). A document without it keeps its bytes (hash compared
with the engine before the change). A `PdfFacturX` in a document without a
PDF/A-3 level in `conformance` fails with `PDF_TREE_INVALID` and names the prop
to add; no element implies a level (`test/pdfa.test.ts`).

Evidence: veraPDF 1.30.4 (`verapdf/cli`, pinned by digest), flavour 3b,
reports PASS for two documents, run by `pnpm test:pdfa` and the CI job
`pdfa`. One holds registered-font text with umlauts, a fixed running head
with page numbers, an RGBA PNG, an external link, a table with a repeated
header over two pages, and a typed and an untyped attachment; the other is a
`PdfFacturX` invoice with the `EN 16931` profile and a synthetic CII file. The
playground invoice (`playground/pdfs/invoice.vue`) passes it too; that run is
manual, not part of CI.

`PdfFacturX` embeds the XML as `factur-x.xml` (`xrechnung.xml` for
`XRECHNUNG`) with MIME type `text/xml`, the relationship `Data` for `MINIMUM`
and `BASIC WL` and `Alternative` otherwise, and the Factur-X XMP extension
schema (`INVOICE`, file name, version `1.0`, profile). Fails with
`PDF_TREE_INVALID`: a text in a standard (not embedded) font, with its source
position, and a message that says that SVG text does not inherit
`fontFamily` from the page when the text is SVG text (a text uses only the
families it names, so a space, a tab or a bidi control character that its
font lacks paints nothing and needs no Helvetica); a
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
with `ColSpan` from `colspan` and `RowSpan` from `rowspan` (a cell beside the
hole that a span leaves in a row below has no `ColSpan`), and a body cell with
`header` is `TH` with scope row; a `PdfRichText` table caption is the
`Caption` (holding a `P`) that is the first kid of its table's `Table`, also
for a table over several pages; `PdfLink` is `Link` with an object reference to each of its
annotations, which carry `StructParent` and `Contents`; each `PdfLink` is its
own `Link`, also next to a link with the same `href`; a form field is `Form`
with its `label` as `Alt` and an object reference to its widget, which
carries `StructParent` and `TU`, and each radio option is a `Form` of its
own. A `PdfFootnote` mark is `Reference` > `Link`; its note is a `Note` with
the note's id as `ID`, listed in the `IDTree`, right after that `Reference`
among the paragraph's kids, and holds `Lbl` > `Link` (the number and the link
back to the mark) and a `P` with the note text; a repeated rich-text mark is a
`Reference` of its own without a second `Note`. A paragraph split
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
`list`; a `PdfLink` in a `fixed` or `decorative` node; a `PdfNote`; a `PdfFootnote` in a `decorative` node or inside a figure;
two PDF/A levels; `tag` on a nested `PdfText`; a `figure` view without `alt` or
`decorative`; a `PdfLink`, a `PdfTable`, or a `tag` inside a figure outside
its caption; a `PdfTable` or a `tag` inside a `PdfLink` around blocks; a
form field without `label`, in a `decorative` node, or inside a figure. In every document: `alt` on a `PdfView` without `tag="figure"`,
and a `header` on `PdfTableCell` that is not a boolean. An annotation that the structure plan did
not predict (an engine change) fails closed with `PDF_RENDER_ERROR`.

Evidence: veraPDF 1.30.4 (`verapdf/cli`, pinned by digest) reports PASS with
the flavours `ua1`, `3a` and `3b`, run by `pnpm test:pdfa` and the CI job
`pdfa`, for six fixtures (`test/fixtures/tagged-document.ts`), each with
several claims: one with headings, a paragraph split over two pages, a
figure, a decorative image and a fixed running head (`ua1`; `ua1` and `3b`);
one with a section, inline and block links (external and internal), a list, a
quotation, a figure with a caption, an inline image, and a table over two pages
with a repeated header and a `colspan` cell (`ua1`; `ua1` and `3b`; `3a`;
`3a` and `ua1`); one with `ActualText` on capitals and letter spacing (also on
each page's part of a split paragraph), a figure view with its caption, a
decorative figure, and row headers (`ua1`; `3a` and `ua1`); and one with a
table over two pages whose cells span rows, as `TD` and as row-header `TH`,
with a group of rows moved to the second page (`ua1`; `3a` and `ua1`); and
one with footnote marks in a heading, a paragraph, rich text that marks a
note twice, and a table cell, with notes on two pages and a note that
continues on the second page (`ua1`; `3a` and `ua1`; `3a` and `ua1` numbered
per page); and one with a contents, its `TOC`, `TOCI`, `Reference` and `Link`
elements and its leaders as artifacts (`3a` and `ua1`). A form with a
field of each kind (`test/pdfa.test.ts`) passes `ua1`, and `3a` and `ua1`,
also after pdf.js typed a value and saved it. The playground annual report (`playground/pdfs/annual-report.vue`,
`['PDF/A-3a', 'PDF/UA-1']`) passes `ua1` and `3a` for its sample data
(`test/pdfa.test.ts`, CI job `pdfa`); its board-cut scenario is not run
through veraPDF. `test/annual-playground.test.ts`
checks its headings, figures with their captions, lists, table, row headers
and `ActualText` with pdfjs and the raw content streams.

Limits: veraPDF checks the machine rules of PDF/UA-1 only. Whether alt texts,
link texts and the reading order make sense is a human check that no test
makes. No screen reader and no other checker (such as Acrobat's) was used. A
`PdfTableHeader` with `pages` is an artifact, so such a table has no header row
in its structure; untested. `ActualText` is not written for a text with an
inline link or image, nor for a part of a text whose template text cannot be
found exactly (`ß` becomes `SS` in capitals, a text cut by `maxLines`);
pdf.js ignores `ActualText` in text extraction; Poppler's `pdftotext` uses it,
and runs its bidi on the replacement text again. A `caption` view
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

`PdfTextField`, `PdfCheckbox`, `PdfRadio` and `PdfSelect` write AcroForm text,
checkbox, radio-button and combo-box fields with their own appearance streams,
in untagged documents, in PDF/A-3b and in tagged documents (PDF/UA-1,
PDF/A-3a; see below). `test/forms.test.ts` proves with pdf.js: each field's
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

Radio groups: radios with one `name` are one field. The tests read with pdf.js
one field `plan` with three widgets on two pages, each with its own export
value, `TU` and the group value (`getAnnotations`), and the parent field with
its three kids (`getFieldObjects`). In the bytes: the parent field has
`FT /Btn`, `Ff 49152` (Radio and NoToggleToOff), `T`, and `V`/`DV` as the name
of the checked option or `/Off`; each widget has `Parent`, no `T`, `AS`, and
`AP /N` with exactly its own on state and `Off`; no ZapfDingbats font. The
whole on and off appearance streams are compared with values computed by hand
(a disc, a ring and a dot as Bézier paths). pdf.js selects the option on page
2, saves, and reads the new value from the saved file. The typed errors cover
a radio and another field with one name, a value used twice, two checked
options, `readOnly` or `required` on some options only, and the value `Off`.
Poppler (`pdftoppm`) and Ghostscript drew the on and off states, also with the
options on two pages, in a one-time check (not in CI).

Forms in PDF/A-3b: a field's value is drawn in its registered font, written as
a simple TrueType font with `WinAnsiEncoding`, `Widths` from the font and the
whole font file as `FontFile2`; `DA` and `DR` name it, and the file has no
Helvetica (`test/forms.test.ts`: font, descriptor, widths and the inflated
font file compared with Roboto Regular; the appearance stream with Roboto's
metrics; pdf.js types a value with new letters, saves, and its new appearance
names the same font). veraPDF PDF/A-3b passes a form with a text field, a
multi-line field, a select, a checkbox and a radio group, and the same file
after pdf.js filled it (`test/pdfa.test.ts`). In a one-time check (not in
CI), two seeded bugs failed veraPDF: a
checkbox widget without `AP` (rule 6.3.3-1) and the text fields drawn in
Helvetica (6.2.11.4.1-1). Typed errors: a field without a registered font, a
value or choice character the font lacks. Not tested: a font with CFF outlines
or without a Windows Unicode cmap (no fixture; both are typed errors in code).
`PdfFacturX` with a field fails with `PDF_TREE_INVALID`. Poppler draws the
PDF/A form, and the value pdf.js typed, in the embedded font (one-time check).
PDF/UA-1 also requires embedded fonts, so every conformance level uses this
field font (`test/forms.test.ts`: no Helvetica in a PDF/UA-1 form).

Forms in tagged documents (PDF/UA-1, PDF/A-3a): pdf.js reads the structure
tree of a two-page form with all four kinds back in reading order: each
widget is the object reference of its own `Form` element, with the `label` as
`Alt`, also inside a `Sect`, with each radio option on its own; a field in a
reversed row is read in template order, not in drawn order. Each widget has
its `StructParent` key and `TU`, the radio parent field has no key, widgets
have no `Contents`, and every page has `Tabs /S`. veraPDF passes the form
with `ua1`, and with `3a` and `ua1` (see "Tagged PDF"); before the `Alt` was
written it failed rule 7.18.1-3 (a radio group's parent field has no `TU`),
and with Helvetica as the field font rule 7.21.4.1-1. Typed errors: a field
without `label` (each radio option needs one), a field in a `decorative` node
or inside a figure view.

### Rich text

`PdfRichText` prints editor HTML (`html`), a rich text model (`content`) or a
parsed comark document (`comark`) with `PdfView`, `PdfText` and `PdfLink`. `test/rich-text-html.test.ts` proves
the HTML adapter (`parseRichTextHtml`) with literal expected models: each
accepted tag and mark, each removed tag with its content, numeric and named
character references (Windows-1252 for 128 to 159, U+FFFD for invalid code
points), link targets kept only for absolute `http:`, `https:`, `mailto:` and
`tel:` URLs, browser whitespace collapse, about 30 cases of malformed or
wrongly nested markup that never throw, and hand-written output of TipTap,
Lexical and Quill, and the footnote markup of Markdown renderers (one note per
referenced list item, back links dropped, a link from one note to another a
plain link, a reference to no note and a note with two paragraphs or a list
`PDF_RICH_TEXT_INVALID`). fast-check properties: a model written as HTML parses back
to the same model, any string parses without an exception, and hostile inputs
at the length limit parse in under 200 ms. `test/rich-text.test.ts` renders the
component and reads the PDF back: every block in order, a link annotation over
its text, heading sizes from the component's own `fontSize`, `styles` merged
over the defaults, headings as outline entries only with `bookmarks`, numbers 1
to 120 right-aligned with their texts at one x, a list nested three deep, a
six-page article with no lost or doubled word and a list item and a quote split
across pages, a heading moved to the next page with its paragraph, the limit
errors and the typed `PDF_TREE_INVALID` and `PDF_RICH_TEXT_INVALID` errors with
model paths, raised and lowered runs from `sup` and `sub`, and the TipTap
recipe of the docs. `test/tagged.test.ts` reads back
`H1`, `H2`, `P`, `L`/`LI`/`LBody`, `BlockQuote` and `Link` under PDF/UA-1.
`test/rich-text-warnings.test.ts` renders through the public template and
reads `diagnostics.richTextWarnings`: one entry per code and name with its
count for dropped links (relative, `javascript:`, `#`, around an image),
attributes (`style`, `class`, `data-*` grouped, `id` never), tags dropped with
their content and tags off the allowlist, values cut or left out (`src`,
`alt`, `width`, `start`, `colspan`, `rowspan`), and content components and
props a Vue component does not get; entries of two `PdfRichText` merge, the
snippet and the source come only with a source position (development), and
plain editor HTML gives none.
`test/pdfa.test.ts` validates one rich text article, from HTML and from
Markdown (headings, a nested list, a quote, a code block, a link, an image with
alt, a captioned figure from HTML and a broken image that prints its
placeholder), with veraPDF as PDF/A-3b and as PDF/A-3a with PDF/UA-1.
`test/article-playground.test.ts`
renders the playground article from its SFC, from HTML and from Markdown with
a mapped component.

Markdown goes through the optional peer `comark`, tested with 0.8.1 and 0.9.2.
`test/rich-text-comark.test.ts` proves `parseRichTextMarkdown` with 30 literal
Markdown-to-model cases (fenced code with `language`, an image as an image block, a
table with its header and column alignment, task lists, footnotes with their notes (inline Markdown in
a note, a reference used twice, a definition without a reference dropped), raw HTML through
the same allowlist with `script` removed with its content, frontmatter, heading
`id` and comments ignored, block and inline components, named slots, JSON
props), a reference without a definition, a note that is a list, and a
definition line inside a fenced code block that fail with
`PDF_RICH_TEXT_INVALID` (the plugin would take the line out of the code), the Markdown length limit (250,000 characters) checked before the
parse, hostile inputs at the length limit that settle under 3 s, mapped
components that get only their declared props, the shape check of the `comark`
prop with paths for 7 wrong shapes, prototype names as component and prop names, and the typed
`PDF_RENDER_ERROR` for a missing package. fast-check properties: any string
resolves or fails with `PDF_RICH_TEXT_INVALID`, and the model keeps every
non-whitespace character that comark wrote outside the removed tags.
`test/rich-text.test.ts` renders the same article from HTML and Markdown to the
same text and links, mapped and unmapped components, and the error for a
Promise passed to the component. `test/tagged.test.ts` reads back the same
roles in reading order for rich text from Markdown. Components come only from
the comark and Markdown paths and only at block level; a component inside a
paragraph, list item or heading prints its text.

Tables in rich text become a `PdfTable`. `test/rich-text-html.test.ts` proves
the mapping with literal models: `thead` as the repeating header, a first row
of `th` cells only as the header without `thead`, a `th` beside `td` cells as a
row header, `tfoot` rows last, `colspan`, `rowspan`, `align` and `text-align`,
a `caption`, `col` widths as the proportions of the columns only when every column has one in one kind of unit,
content outside the cells printed before the table, and spans a browser cuts
(a `rowspan` past the last row, a `colspan` into a row span) cut the same way.
A list in a cell, two header rows, a header `rowspan`, a footnote in a header
cell and more than 64 columns fail with `PDF_RICH_TEXT_INVALID`. The round-trip
property writes tables too. `test/rich-text.test.ts` checks the model rules
(cell shapes, spans that do not fit, column widths whose units cannot be added
or that mix a percentage with a measured column) and renders: the header of a
Markdown table repeated on the next page, a table of rows only with no
repeated row, six `'auto'` columns of long sentences inside the content width,
a body row longer than a page split over three pages without a layout warning,
the note of a footnote in a body cell, right-aligned cells, and cell paddings
of 0.5 em of the body size, `col` widths of 2 × 60 %, 2 × 400px and 300px/150px inside the content width in their proportion, and the bold face of `tableHeaderCell` on header cells and row headers only. `test/tagged.test.ts` reads back `TH` with scope
Column in the header, `TH` with scope Row and `RowSpan`, `TD` with `ColSpan`,
and `TD` only for a table of rows only, and the caption as the `Caption` that
is the first kid of its own `Table` (a table without a caption has none, a
caption's footnote and link stay inside it, and a table over several pages
has one `Caption`). A cell holds text and paragraphs; the caption prints above
the table.

comark runs in a render worker with the deadline `markdownTimeoutMs`
(`test/rich-text-markdown-worker.test.ts`): a quote 100 levels deep (about
1.3 s on the main thread), 20 comments in quotes 60 levels deep (about 7.7 s)
and 250,000 characters of `<!--` (about 16 s) each fail with
`PDF_LIMIT_EXCEEDED` within 5 s of a 500 ms limit; a 10 ms timer on the
main thread never waits 1 s or more during a slow parse; the next call gets a fresh worker; the worker gives
the same model as a parse on the main thread; two parses and renders in mixed
order in one worker give the same results as each alone; the missing-package
error crosses the worker boundary with its message; a build without a worker
fails with `PDF_RENDER_ERROR` instead of parsing on the main thread.

Images (`test/rich-text-images.test.ts`): literal HTML, Markdown and comark
mapping tables (an `img` inside a paragraph ends it, `figure` with one `img` and
a `figcaption` is one block with a caption, `width` and `height` only as plain
numbers in (0, 10000], `style` and units ignored, the Markdown title and a link
around an image dropped, an image in a heading or code block dropped), the
model checks with paths, 100 images per rich text, alt cut at 1,000 characters,
`src` at most 4,096. The image is a `PdfImage` resolved by the one image path:
`file:`, `javascript:`, a `data:` URL, an asset whose bytes are not its format,
`..` in a path, a host off the allowlist and an allowed host that answers 404
each fail with the asset code and the path in the message by default, or
print the alt text in a placeholder box with one `imageWarnings` entry (code,
reason, model path) with `brokenImages="placeholder"`; `fetch` is never called for a refused
source, and an allowlisted remote image is fetched once and printed. A 50 MB
`content-length` claim and the image byte total fail with
`PDF_LIMIT_EXCEEDED` in both modes. Engine boxes: without a size the image
takes the column width (515.28 × 309.17 pt for 5:3), `width` 120 gives
120 × 72, `height` 60 gives 100 × 60, `width` 900 scales down to the column, in
a list item to its body (499.28 pt); an image that does not fit moves whole to
the next page, also inside a list item, with no layout warning. Under PDF/UA-1
pdf.js reads `Figure` with `Alt`, a captioned image as one `Figure` with a
`Caption`, and a placeholder as `P`; an image without alt fails with
`PDF_TREE_INVALID` naming its model path. The playground article prints a
figure from `pdfs/assets`. veraPDF runs on rich text images through the
article of `test/pdfa.test.ts` above.

Limits: 1,000,000 characters of HTML or text, 250,000 characters of Markdown,
50,000 elements or nodes, nesting depth 32, `markdownTimeoutMs` (5,000 ms) for
a Markdown parse. A heading that is the first block of a `PdfRichText` does not take
part in the keep-with-next check.

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

The names of internal-link targets and the keys of the attachment list are
encrypted like every other string, so internal links (`href="#id"`,
table-of-contents links) work in a protected PDF
(`test/protection.test.ts`, "resolves an internal link in a protected
document").

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
  of its own (`test/page-primitives.test.ts`). For a nested `PdfText` it is the
  page where the nested text starts, also in a paragraph that crosses a page or
  a column (`test/page-primitives.test.ts`). The printed number joins the
  text before it into one word, so `hyphens: 'manual'` (the default) keeps
  both whole. Function props (`render`, `hyphenationCallback`) and the
  `hyphenate` prop are removed. In a template they fail the build with a hint
  to `PdfPageNumber` and `PdfPageCount` or to the style key `hyphens`. In a
  render function they fail with
  `PDF_TREE_INVALID` and the same hint.
- **Pass count.** Every document runs the loop. Plain documents, documents with
  page-token footers and link-only documents converge in one pass; a named
  destination resolves by name (`test/page-primitives.test.ts`).
  Page-conditional `fixed` content (`pages`) needs no extra pass, also with a
  `pages` head in each of many sections (`test/table.test.ts`), and so does a
  view that the orphan rule moves to the next page (`test/table.test.ts`,
  "moves a table to the next page instead of leaving its header alone"). A
  `PdfPageRef` needs one more pass.
- **Convergence.** The loop is a fixed point: each pass lays out a fresh engine
  copy of the same admitted tree with the page facts of the previous pass (the
  pages of the destinations, the views moved to a new page, the first and last
  pages of page-conditional content), until the facts it produces equal the
  facts it was laid out with. Tree
  limits, metadata and image/resource policy run once, on the mounted tree; the
  passes cannot add content. The tree is taken, validated and the Vue app
  unmounted in one step before the first await, so a template that changes
  state later (a timer, a late promise) does not change the PDF
  (`test/server-runtime.test.ts`). A document with page references converges in two passes and
  is byte-identical to one layout of the final numbers. A document whose layout
  depends on the numbers it prints (a TOC entry whose height changes with its
  page number) never converges and, after `maxPasses` (a validated positive
  integer on `definePdf`, default 5), raises a `PDF_LIMIT_EXCEEDED`
  `NuxtPdfError` attributed to the template key and file through the same
  boundary as every other render failure. The message shows the page facts the
  last pass was laid out with and the different facts it produced
  (`test/page-primitives.test.ts`).
- **Named destinations resolve to a section's first page.** A node's `id` becomes
  a named destination; a `PdfLink` `href="#id"` jumps to it. When the id sits on a
  node that spans a page boundary, both the printed number and the jump target
  resolve to the section's **first** page (a deliberate divergence from React PDF,
  whose last-writer-wins destination table points at the last page). Page-spanning regression fixtures verify the
  printed number and the pdfjs destination independently. The anchoring is copy-on-write, so a
  `fixed` node repeated on every page (which pagination represents as one shared
  node object) keeps its destination, anchored at its first page.
- **Internal links** on non-splitting targets give `Link` annotations to the
  named destinations and resolve them to their pages
  (`test/internal-links.test.ts`). The `id` of a nested `PdfText` is a named
  destination at the top of the line where the nested text starts, also when
  it wraps onto more lines. An internal `#id` that does
  not match any destination in the mounted document fails closed with
  `PDF_TREE_INVALID` before layout. A `PdfDocument` without at least one
  `PdfPage` likewise fails closed.
- **Bookmarks (outline).** The upstream `bookmark` prop (a string or
  `{ title, expanded, contents }`) on `PdfPage`, `PdfView`, `PdfText`, or `PdfImage` builds a
  nested PDF outline, verified via pdfjs `getOutline` against the expected
  tree (`test/bookmarks.test.ts`), and combined with
  the multi-pass loop: `resolveBookmarks` copies the tree it numbers, so no
  pass can carry a stale hierarchy into the next, and the converged render is
  byte-identical to a single layout with nested bookmarks. A bookmarked node
  that splits across pages has one entry, at its first page with content, also
  when only its top edges stay on the page before (React PDF adds one per
  page; invariant I14, `test/invariants/`, the two `h6a` cases). Siblings in
  the outline follow source order, the order of the structure tree, also when
  they paint in another order: an absolute child placed by `bottom` goes with
  the last part of its parent, and a float can print above the content before
  it (`test/bookmarks.test.ts`, `test/floats.test.ts`).
- **Running values** (`test/running.test.ts`). `running` on a page-flow
  `PdfText` sets a value (its plain text, nested texts included and spaces
  joined, or the `text` of `{ name, text }`), and so does `running` on a flow
  `PdfTableRow` (`{ name, text }` only); `PdfRunningText` prints it. A page
  shows the value set by the node at its very top (down the first child in the
  flow of each container), otherwise the last value set before the page;
  before the first setter it prints nothing. The values of a page are fixed
  before the page is split and kept for the round with the total, so they add
  no layout pass; a header in the flow whose value wraps takes its height on
  its own page, the first page of a `PdfPage` included, and the flow of that
  page starts below it. They carry over `PdfPage` boundaries, a page with
  `wrap={false}` sets its values like any page, one value per name; a setter
  that splits gives its value to the next page; a repeated table header does
  not hide a setter in the first body row at a page top. With `at="before"` it
  prints the last value set before the page, with `at="end"` the last value
  set on the page (GCPM `last`), else the one before; the end is known after
  the split and painted in the round with the total; until then a fixed node
  that prints it, a carry row too, keeps the height of the value of its name
  that needs the most room (`test/page-builder.test.ts`), and in the `'auto'`
  column measure the token takes the longest value of its name in characters.
  A ledger whose rows set a running sum gets carried subtotals:
  a `pages="continuation"` row with `at="before"` and a `pages="not-last"` row
  with `at="end"` show the right sums over three pages, from mid page, for a
  split row (on the page of its first part), for two tables with one name and
  for two names, also with a page reference; the carry rows are artifacts in a
  tagged document (`test/tagged.test.ts`). A setter that is `fixed` or in a
  `fixed` node, in a footnote note or on a nested text, a page token or
  footnote in a setter, an invalid `running` or `name`, the token outside a
  `fixed` node, in a note or in a nested text, a token name that no text sets,
  a row `running` without a text, and `at="before"` or `at="end"` in a column
  of a column container fail with `PDF_TREE_INVALID`. GCPM `first` is not
  claimed.
- **`PdfContents`** (`test/contents.test.ts`) lists every node with a
  `bookmark` in outline order and nesting, down to `levels` (default 3), with
  the page each node starts on. A bookmark with `contents: false` has no entry
  and stays in the outline; the entries below it move up one level. The
  entries are written once, before the first layout pass; the numbers are page
  references, and a contents that fills two pages converges in two passes. Each
  entry is one link; a node without an `id` gets one generated id, the same for
  every contents in the document. An entry never splits: in two columns each
  column holds whole entries. Each entry is one text with a `PdfLeader`: the
  page numbers end at the right edge, and the leader runs from 0.3em after the
  end of the title's last line to 0.3em before the number. A title that wraps
  runs to the right edge on its other lines: no number column is reserved on
  every line, as TeX's `\@tocrmarg` does. An entry prints in the text color at
  the place of the contents, without underline. A contents without any
  bookmark in the document, inside a fixed node, a link, a text or a table
  cell, an invalid `levels`, `leader` or `styles`, and a box style in
  `styles.title` or `styles.page` fail with `PDF_TREE_INVALID`. In a tagged document the
  contents is `TOC` > `TOCI` > `Reference` > `Link`, with a nested `TOC` per
  level and the leader as an artifact (`test/tagged.test.ts`; veraPDF for
  PDF/A-3a and PDF/UA-1 in `test/pdfa.test.ts`).
- **`PdfLeader`** (`test/text-layout.test.ts`, "leaders") fills the rest of
  its line inside a `PdfText`: the text after it ends at the right edge, and
  after a wrapped title it starts at the end of the last line. No line breaks
  at a leader: the word before it and the text after it up to the next space
  move to the next line with it, and when even that line is too narrow it
  overflows. Each width of a leader line costs the same, so it never decides
  the breaks of the lines around it. Two leaders on one line share its room
  equally; a line with a leader is neither aligned nor justified; an ellipsis
  of `maxLines` takes room from the leader; a number printed narrower than it
  was laid out leaves the breaks and gives the leader the difference. In
  right-to-left text the leader sits between the title and the number. Its
  line is on the baseline, dotted, dashed or solid with the dash lengths of a
  bottom border, its pattern on a grid from the page's left edge; it takes no
  underline or strike-through, reads as a space in extracted text, and is an
  artifact in a tagged document. `minContent` counts the word before it, its
  gaps and the text after it as one piece. A leader outside a `PdfText`, in
  SVG text, with another style key or a percentage or `auto` margin fails
  with `PDF_TREE_INVALID` (`test/contents.test.ts` for the contents styles).
- A **reviewed raster baseline** of a realistic report's TOC page, following the
  same `UPDATE_PDF_BASELINES` policy and thresholds as the other fixtures.

### Local resources

The module validates configured resources during the Nuxt build. Production
builds embed validated image bytes in the server bundle; development builds
point at the source files and re-read them per render, so an edited image
shows up without a restart. The tested boundary includes:

- PNG and JPEG extension/signature validation and source byte limits;
- TTF, OTF, and WOFF2 signature/extension/structure validation,
  registration validation, source byte limits, and source-removal rendering;
- WOFF2 decoding to TTF or OTF before the font engine (the `glyf`/`loca` and
  `hmtx` transforms): for every TTF/WOFF2 pair of `source-code-pro` the glyph
  outlines, advances, boxes and tables are equal, and the embedded `FontFile2`
  has the outlines of the used glyphs, composite ones included; a truncated,
  inconsistent or oversized WOFF2 file fails with `PDF_ASSET_INVALID`, and
  WOFF 1 bytes never reach the engine;
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
  before decode or engine admission, by the header reader the PDF writer uses:
  a PNG ends with its IEND chunk and a palette PNG has a palette; a JPEG has
  one frame header with 1, 3 or 4 components, a scan and a closing EOI marker.
  SVG stays rejected.
- Fetches are `GET` only, send no request headers, and carry no credentials; a
  per-hop timeout (default 10s) covers the body read.
- Remote images resolve at render time with per-render deduplication (a repeated
  URL is fetched once, with no cross-render cache).

These are intentional Nuxt-PDF-only guarantees. React PDF has no allowlist,
timeout, byte cap, or per-hop redirect policy, so the blocked, oversized,
redirect, timeout, and unconfigured behaviors are ours alone; once the policy
admits bytes they take the same embedded-bytes path as the local-image
conformance fixture and its reviewed baselines. Not claimed: authenticated
fetches, request headers or bodies, cookies/credentials, remote fonts,
private-IP or DNS rebinding exceptions, and any cross-render caching.

### Render limits

Every render is bounded by the operator-overridable `pdf.limits` fields below
(`test/limits.test.ts`). Defaults apply when a field is omitted; every field is
a whole number from 1 validated at module setup, up to 2,147,483,647 ms for
`timeoutMs` and `markdownTimeoutMs` (the longest Node timer; a larger value
used to fail every render after 1 ms) and up to `Number.MAX_SAFE_INTEGER` for
the others. A removed field fails
module setup with a message that says what to set instead.

| Field | Default | When checked |
| --- | --- | --- |
| `timeoutMs` | `30_000` | Whole public render deadline, started before metadata evaluation |
| `markdownTimeoutMs` | `5_000` | Whole `parseRichTextMarkdown` deadline, from the call, the wait for a worker included (`test/rich-text-markdown-worker.test.ts`) |
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
- A worker is replaced after 200 renders, so engine caches do not keep data
  of earlier renders without bound. The test checks the replacement with a
  limit of two renders. The hyphenation cache of each language has its own
  bound, which also holds for in-process renders: after 10,000 different
  words it starts empty.
- An error from the worker keeps its code, message, stack and cause.
- The worker imports no Vue. It receives only the admitted plain-data tree, so
  one render cannot read data from another.
- A Nitro preset that bundles the server into one file has no worker chunk.
  Such a build logs one warning and renders in-process; the deadline is then
  checked between engine stages and once per page during pagination, so one
  layout step can still overshoot it. In-process and worker output are
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

## Invariants

`test/invariants/` generates documents from a seed, renders them through the
public render path, and checks rules that hold for every valid document. A
failing document is reduced to a small case and saved in
`test/invariants/regressions/`; every saved case replays in `pnpm test`.

Rules:

- F1: each token of a footnote's note is in the PDF exactly once.
- F2: the notes read in the order of their marks.
- F3: a note starts on the page of its mark, or, when its first line does not fit there, later: at most one page after the note before it, or after its mark's page when that is later; then every later note of its mark's page starts later too, and the moved notes start before the notes whose marks are on the page where they start; the render's `PDF_FOOTNOTES_MOVED` warning for a page of marks names exactly its notes that start later.
- F4: a note that goes on to the next page continues there before the notes that start there and the parts of later notes.
- F5: on each page, the flow's lowest line box ends above the first note line.
- F6: the number before each note equals the number after its mark, counted through the document or from 1 on each page (`footnotes="page"`), and one link covers each mark.
- F7: a footnote mark's link lands on the page where its note starts, and the note number's link back lands on the page of its mark; both name the same note.
- G1: at each automatic page break of a `flow` or `notes` document, the first line after the break did not fit the room left before it (with the notes of its marks, the lines that orphans and widows need, and the edges of the nodes around it), unless a `break`, a view that cannot split or a `minHeight` explains the break; on a page that a column container goes on after, its columns, filled in order, could not take one more unit with its notes, except on a forced page, which keeps the least of its flow that holds a line (the note lines show it: a note of its marks starts later, or starts with fewer lines than its start needs); on a page after which a note of it or of an earlier page still waits to start, and whose own notes end on it, the start of the first waiting note (its orphans, or all of its lines when it is short) did not fit below the flow. A forced page starts a note with one line, so this last check takes the lenient side.
- G2: on one page, the lines of one text are at least its line height apart, the line boxes of two texts do not overlap, and no two text runs overlap.
- G3: a neutral change keeps every text run, image and widget on its page and at its place: the flow of each page in one plain view, and, without notes, `footnotes="page"` with `footnoteStyles`.
- G4: the work a render counts grows with its pages and nodes, not faster: page relayouts, note fits and column balance tries per page, and nodes laid out and keep steps per page and node, each under a bound of about 1.5 times the highest of 300 generated documents of the profile (600 `notes` documents over three seeds, with their own bounds for a page with columns).
- I1: a render ends with a PDF or a typed error, inside the time limit.
- I2: every rejection is a `NuxtPdfError` with a known code and no absolute path in its message.
- I3: each flow token is in the PDF exactly once.
- I4: the flow tokens of one column appear in document order.
- I5: each text run lies inside its page, and inside the page padding unless placed outside on purpose (a run in which pdf.js reads a glyph without characters is checked vertically only: pdf.js shifts and widens it).
- I6: the tokens of an unbreakable block that fits a page are on one page.
- I7: a fixed token is on exactly the pages its `pages` value names.
- I8: `PdfPageNumber`, `PdfPageCount` and `PdfPageRef` print the right page.
- I9: a table header repeats on every page with a row of its table; the cells of a row share a page; columns keep their x.
- I9c: in a table with `'auto'` columns, every row on every page has the same column edges, no line runs past its column, an `'auto'` column is at its max-content and on one line when all fit, else between min- and max-content with the same part of its slack given up, and a share column keeps its longest word.
- I10: the same tree and `creationDate` give the same bytes, in sequence and in parallel.
- I11: a render holds no data of the render before it.
- I12: with small limits, the result is inside the limit or the error names it.
- I13: the same document in other units, inside a neutral `PdfView`, or with a password puts text, images and widgets at the same places.
- I14: each link rectangle lies on the text of its link; internal targets and bookmarks resolve to the page of their token.
- I15: an invalid document fails with `PDF_TREE_INVALID` (or the build error) that names the element.
- I16: each image and SVG paints its box at its laid-out size and place.
- I17: each form field has one widget at its laid-out box and reads back its value.
- I18: each text is drawn in its registered face; the runs of the Arabic face hold the letters of the right-to-left texts, and Poppler reads each right-to-left word; a tagged document uses no Helvetica.
- I19: a tagged document is marked, has its title, language, a structure tree on every page, its heading levels and figure alt texts.
- I20: every glyph of an embedded TrueType program has an outline.
- I21: Poppler reads the same page count, page sizes and words as pdf.js (Arabic words by their letters).
- I22: Poppler paints ink for every word and none where the document is empty; a document in a WOFF2 face paints the same pixels as with its TTF file.
- I23: a tagged document reads in document order (headings, paragraphs, list items, table cells row by row, links, figures), and fixed content is an artifact.
- I24: each paint box's marker is painted once at the box's size and x; the content shows the background (or the marker without one) at its alpha; the marker shows just outside each side; a corner with a radius shows the marker, a square corner its border or the background.
- I25: each side with a width shows its colour at its opacity over the background, from just inside its outer edge to just inside its inner edge, and the background just past it; a side without a width shows the background there.
- I26: a node or table row with `keepWithNext` ends on the page where its next sibling starts, unless the node, the nodes its keeps chain to and the start of the first node that does not keep are higher than the content box; a keep that fits the room left on its page does not move the node, one that fits only a page moves it, and one higher than the content box gives up.
- I28: every token and note of a float document prints once, and the flow reads in source order by page, column and top; each float lies inside the content area and one column, with no flow token of its area between it and its edge (none above a top float, none below a bottom one), no flow token, other float or note of its page overlapping it; the floats of one side keep source order; no float is in an area before the area of its anchor (the last flow token before it); the note of a mark in a float is on the float's page; a heading with `keepWithNext` before a float is in the area of the next flow token. A spanning float shows the full content width, lies in its container's part of its page at the part's top (or below another spanning top float) or, while the container goes on, at the page end (or above another spanning bottom float), has no flow token or column float of its side between it and that edge, and is not on a page before its anchor's; per side, spanning and column floats keep one source order.
- I27: in a column container, each token lies inside its column (a spanning text inside the container), and a text with `break="column"` starts at the top of a column; where a container ends, its highest column is at most the even share (of each run between column breaks) plus one unit that cannot split and a line, and the content after it starts below its highest column; on a page that a container goes on after, its columns end at one height.

Profiles: `flow` (texts, views and links on flowing pages), `fixed` (fixed and
absolute content, page numbers), `table`, `mixed` (images, SVGs, form fields,
fonts, scripts, several page sizes), `notes` (footnotes, with a column
container on the page or in a view in about half of the documents), and
`invalid` (one fault per document).
F1–F7 run on the `notes` profile, G1 on `flow` and `notes`, G2, G3 and G4
on every profile but `invalid`.
In the `notes` profile, half of the column containers have padding, and texts
in them can have `break="column"`.
A quarter of the `flow`, `table` and `mixed` documents are tagged (PDF/UA-1).
I9c, I26 and I28 have their own generators (`test/invariants/auto-columns.test.ts`,
`test/invariants/keep-with-next.test.ts`, `test/invariants/floats.test.ts`:
floats in the page flow, in 2 or 3 columns and in sections with edges, some
across all columns, some with a footnote mark, some after a heading with
`keepWithNext`; six saved specs that found bugs run in `pnpm test` too): 60 cases each
at CI size, 4 in `pnpm test`.
I21, I22 and the cross-page reading of I23 need Poppler; they read every
second document at CI size and every tenth in larger runs.

Run sizes: `pnpm test` replays the saved cases and one generated document per
rule. `pnpm test:invariants` runs in CI with seed 20261116: 100 `flow`, 100
`fixed`, 40 `table`, 40 `mixed` and 60 `notes` documents, one document per fault kind,
and the byte, pair, neutral-change (G3), isolation and limit rules on
smaller samples. Larger runs
(`NUXT_PDF_INVARIANT_RUNS`) are run by hand: the last one checked 10,000
documents at seed 20261116 (4,000 `flow`, 2,000 `fixed`, 2,000 `table`,
2,000 `mixed`, with 200 metamorphic pairs), and every failure in it is one of
the open findings below.

Open findings, each a saved case with `expectedFailure`: none.

Fixed on the page builder: six faults whose saved cases now pass as
regression cases. Each came from the earlier pagination reading a
column container or a split view by its stacked layout or its whole box;
the builder fills columns and footnote pages by the sums of what each page
holds. The faults were:

- After a column break whose columns all end on the page, the content
  after the column row is split where the columns were still one stack, so
  the page can end early
  (`notes-az-column-break-row-splits-later-siblings-too-low.json`,
  `notes-az-column-break-row-shortens-later-segment.json`);
- A view split in a column keeps the box of the whole view, so on a page
  with footnotes the note fit reads the column as high as the whole view
  (`notes-bb-view-in-column-split-reads-whole-height.json`, found by G3);
- A view split at a page break is as high as the room the split gave
  it, so the note fit reads the flow as ending at the split height
  (`notes-bc-break-in-view-gives-notes-only-their-start.json`, found by G3);
- A view that is not split is read as its whole box with its last
  child's bottom margin, which takes room from the notes
  (`notes-bd-margin-in-view-takes-note-room.json`, found by G3);
- A balance search does not count a column break and can run to its cap
  on every pass of the note fit
  (`notes-ba-column-break-balance-search-cost.json`);
- A column segment that crosses the page end in its stacked layout but
  ends its columns on the page splits the content after it too low
  (`notes-bh-filled-segment-splits-later-span-too-low.json`).

## Explicitly not claimed

- Full React PDF component, hook, browser-helper, or test-suite parity.
- React runtime compatibility, React-shaped dynamic callbacks, or any author
  function in the document tree.
- Browser-side or edge-runtime rendering. The engine is Node server-only.
- Nuxt 3, Node 20, or versions outside the table above.
- Authenticated remote fetches, request headers/bodies, credentialed requests,
  proxies, or private-IP/DNS-rebinding protection. Opt-in allowlisted remote
  images are claimed above. Remote fonts are not supported.
- SVG image files (as an image source), SVG `Marker`, alternate gradient
  coordinate systems/transforms/inheritance, and `preserveAspectRatio` modes.
  Radial-gradient inner radius (`fr`) is also absent because the pinned renderer
  hardcodes it to zero. SVG drawing primitives are otherwise claimed above.
- `wordSpacing` authoring. The layout and the text engine (ports of
  `@react-pdf/layout` and textkit) do not apply it to wrapping or glyph advances, so Nuxt PDF leaves the no-op
  property out of `PdfStyle`. Use the verified `letterSpacing` property instead.
- HTML beyond the editor tags of `PdfRichText` (each loss gives a rich text
  warning): no CSS or `style` attributes in rich text, no image size from CSS, no link around an image, no syntax
  colors in code blocks, no footnote definition over more than one line, and
  no components inside a paragraph, list item or heading. A rich-text table
  cell holds text and paragraphs only (no list in a cell); a table has one
  header row, whose cells do not span rows, and at most 64 columns.
- Browser CSS, HTML printing, or paged-media CSS. The `<style>` block accepts
  class selectors and `PdfStyle` properties only: no element, child, sibling,
  attribute or pseudo selectors, no at-rules other than `@import`, no media
  queries. Descendant selectors match within
  one file's template, not across components.
- A table layout engine beyond the `PdfTable` components: `'auto'` columns
  measure text and columns of text only, and the rows that a cell spans do not
  split: higher than the page, they stay where they start, cut at the page end. Charts, signing, editing, or PDF merging.
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
  running content in a tagged document are not claimed.
  PDF/A is claimed for part 3, levels b and a only, with veraPDF as the
  evidence; no viewer was tested.
- The content of Factur-X XML that the author passes with `xml`. Nuxt PDF
  checks that it is well-formed, has a `CrossIndustryInvoice` root and names
  the profile; the scan does not check namespaces or the CII schema.
- For e-invoices written from data: UBL output, writing the `EXTENDED`
  profile, IBAN checksums, that an identifier (VAT ID, Leitweg-ID, GLN)
  exists, and EN 16931 fields that `EInvoice` does not have. The validators
  run in `pnpm test:einvoice`, not in CI.
- Form fields beyond what is listed above. Without a conformance level the
  appearance streams use the standard font Helvetica, not embedded, and a reader
  substitutes its own Helvetica-compatible font; field values and options are
  WinAnsi only, also in PDF/A. List boxes, push buttons, field hierarchies,
  form scripts and submit actions, rounded or dashed field borders, `justify`
  in a field, an automatic font size, an accessible name for a whole radio
  group (each option has its own), and fields in e-invoices are not
  offered. pdf.js is the only reader that edits a field in
  the tests (and draws a typed value again, in PDF/A); Acrobat, PDFium and
  Preview are not checked.
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
  between engine stages and once per page during pagination, and one stage or
  one page layout can overshoot it.
- Pre-mount memory isolation. `maxNodes` rejects after Vue has mounted the
  tree; it is not a sandbox that prevents allocation during mount. Vue mounting
  runs on the main thread.
- Visual equivalence beyond the reviewed fixtures, pinned inputs, and tested
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
