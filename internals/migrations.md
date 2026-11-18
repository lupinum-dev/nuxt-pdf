# Temporary compatibility code

Each entry is code that exists only to help users move off an old API. Remove
the code and its entry together when the removal condition is met.

## Hints for the removed page-number API

- **Why:** the `render` prop on `PdfText`, `hyphenationCallback` and the
  `PdfLink`-around-a-token pattern were removed with the plain-data document
  tree. Without a hint, authors get a bare "Unsupported prop" or "cannot
  contain" error and do not learn what replaces them.
- **Introduced:** 2026-11-12.
- **Code:**
  - `src/runtime/shared/removed-props.ts`: `REMOVED_PROP_HINTS` and
    `unsupportedPdfPropMessage`, the one source of the message. `render` adds
    " Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use
    pages=\"first\" or pages=\"continuation\" on a fixed text to show it on
    some pages only.", `hyphenationCallback` (also kebab case) adds " Use
    :hyphenate=\"false\"." Two readers:
    - `patchPdfProp` in `src/runtime/renderer/patch-prop.ts` (render
      functions and `v-bind="object"`). Without the hint it keeps the plain
      "Unsupported prop" error.
    - `assertNoRemovedProps` in `src/build/pdf-sfc-plugin.ts`: a removed prop
      on a `Pdf*` tag fails the build, every occurrence of the file in one
      error. Delete the function and its call; the runtime then reports the
      props as unsupported.
  - `pageTokenHint` and `PAGE_TOKENS` in `src/runtime/renderer/node-ops.ts`:
    `PdfPageNumber`, `PdfPageCount` or `PdfPageRef` directly in a `PdfLink`
    adds " Wrap it in <PdfText>. Keep that <PdfLink> outside any other
    text: …"; directly in a container that holds a `PdfText` (a `PdfView`)
    adds " Put it inside a <PdfText>."
  - `REMOVED_API` in `src/build/pdf-sfc-plugin.ts`: a template script that
    references `usePdfPageNumbers` fails the build with a hint to use
    `<PdfPageRef to="id" />`. Its cases are in `test/pdf-sfc-plugin.test.ts`.
  - Their cases: `test/page-primitives.test.ts` ("the removed render prop",
    "the removed hyphenationCallback prop", "a page reference directly in a
    link") and `test/renderer.test.ts` ("rejects … with a hint that leads to
    valid markup"): keep the plain errors, drop the hint text.
    `test/pdf-sfc-plugin.test.ts` ("rejects every removed prop of a file at
    build time in one error"): delete with `assertNoRemovedProps`.
- **Dependents:** authors upgrading from the beta releases before the
  plain-data tree.
- **Remove when:** the 1.0 release.

## Hints for removed `pdf.limits` keys

- **Why:** the per-image caps `maxImageBytes` and `maxImagePixels` were
  removed; the render totals are `maxTotalImageBytes` and
  `maxTotalImagePixels`, and `maxAttachmentBytes` became
  `maxTotalAttachmentBytes`. Six other keys were removed with the worker
  render path. Without a hint, a removed key fails with a bare "is not
  supported" and the operator does not learn what to set.
- **Introduced:** 2026-11-12.
- **Code:**
  - `REMOVED_LIMITS` in `src/runtime/server/render-limits.ts`: one message per
    removed key, used by `normalizePdfLimits` ("pdf.limits.<key> was removed:
    …").
  - Its cases in `test/limits.test.ts` ("rejects the removed option"): keep
    the rejection, expect the plain "is not supported" message.
- **Dependents:** operators upgrading from releases with the old option names.
- **Remove when:** the 1.0 release.
