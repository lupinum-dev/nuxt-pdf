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

## Dynamic text contract

Layout detects a dynamic node when the `render` key exists in its props. The Vue renderer must therefore delete nullish props instead of retaining `render: undefined`.

During pagination, layout invokes dynamic callbacks first with `pageNumber`, and later with final page and subpage totals. Its internal instance converter accepts scalar strings and numbers but assumes React-shaped objects for element results. Nuxt PDF 0.1 exposes only synchronous dynamic text callbacks returning scalar text. Vue VNodes are not supported as dynamic callback results.

**Dynamic lineHeight shield.** Before layout, `renderDocument` gives every dynamic `TEXT` node (a `render` function in its props) its own `lineHeight: ''` on the disposable mounted tree (`normalizeDynamicTextLineHeight`, replacing the `node.style` reference, never mutating the shared object). This works around an upstream non-idempotency: `lineHeight` is the only inherited property whose stylesheet transform is not a fixed point — `transformLineHeight` returns `lineHeight * fontSize` for any unitless/absolute number (`@react-pdf/stylesheet` `src/resolve/text.ts:48-67`), and pagination re-resolves dynamic nodes' already-resolved styles multiple times (`@react-pdf/layout` `resolvePagination.ts` relayout paths → `resolveStyles.ts:62-71`). Each pass re-multiplies the absolute value by `fontSize`, exploding the dynamic line box off-page. `''` is the unique value short-circuited by `transformLineHeight` (`text.ts:53 if (value === '') return value`), and `resolveInheritance`'s own-over-inherited merge (`resolveInheritance.ts:53-64`) lets the node's own `''` override the compounding ancestor value; textkit then uses the font-derived line height. This is a deliberate divergence from `@react-pdf/renderer` 4.5.1, which has the identical bug and instead drops such footers entirely. Static text is unaffected (its `lines` are frozen after the first layout) and keeps inherited `lineHeight`.

Protected by callback and page-number conformance tests, plus a geometry-equality test asserting the dynamic footer matches the static equivalent while body text keeps its inherited `lineHeight`. Expanding dynamic results requires a new explicit layout seam or an upstream change; it must not be implemented with a React-shaped compatibility object.

## PDFKit contract

`@react-pdf/pdfkit` exports a readable `PDFDocument` constructor but publishes no TypeScript declaration. Nuxt PDF carries a narrow ambient declaration for only the constructor and readable-stream behavior it uses.

The constructor receives metadata and rendering options. `renderPDF(context, layout)` paints pages, calls `context.end()`, and returns the same readable context. Nuxt PDF must not call `end()` again.

Protected by PDF magic-byte, parse, metadata, stream completion, and stream error tests. The local declaration must grow only when a concrete call site requires another member.

## Font contract

A fresh `FontStore` contains the standard PDF fonts. Additional local fonts are registered before layout and the same store is passed to `layoutDocument`.

Protected by the local-font conformance fixture. Asset policy, path validation, and registration ownership live outside the engine and must run before layout.

## Deliberately unused contracts

- React reconciler and renderer lifecycle
- React hooks and DOM helpers
- `PDFViewer`, `PDFDownloadLink`, and `BlobProvider`
- deprecated string rendering
- private PDFKit page-mode mutation
- arbitrary React-node dynamic render results

Any proposal to use one of these requires a documented acceptance criterion and an update to this file.
