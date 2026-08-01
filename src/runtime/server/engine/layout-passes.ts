import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import { createPdfFontStore, type PdfFontStore } from './fonts'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import type { PdfElementNode, PdfNode } from '../../renderer/types'
import type { RenderLimits } from '../render-limits'
import {
  extractDestinationPages,
  layoutPdfTree,
  serializePdfLayout,
  type DestinationPageMap,
} from './render-document'

export { extractDestinationPages, type DestinationPageMap }

// The shipped multi-pass layout loop that resolves table-of-contents page
// numbers. It is a fixed-point iteration over the existing single-pass pipeline:
//
//   feed(map) → layoutPdfTree → extract id→page map → repeat until stable → serialize ONCE
//
// The document is authored once and mounted once. Between passes the id→page map
// is fed back into the LIVE Vue tree; our custom renderer re-patches the same
// node objects in place (proven by node-identity assertions in
// test/toc-multipass.test.ts — no re-mount per pass). `layoutDocument` treats its
// input as immutable for every non-bookmark node (Object.assign copies at each
// step; see CONTRACTS.md "Layout purity contract"), so the same mounted tree is
// safe to lay out repeatedly without cloning. registry.ts gates entry to this
// loop on `usePdfPageNumbers()` usage — the only thing that consumes resolved
// page numbers. Internal `#id` links alone do NOT need it: a named destination
// is resolved by name in a single pass (`serializePdfLayout` anchors it at the
// section's first page), so link-only documents stay single-pass.

/**
 * A mountable document whose page-number feedback can be re-fed between passes.
 * In production the registry backs `feed` with `MountedPdfComponent.feedPageNumbers`,
 * which pushes the map into the reactive record the `usePdfPageNumbers()`
 * composable exposes; engine tests back it with a reactive prop through `update`.
 */
export interface MultiPassSource {
  /** The live mounted document root; re-patched in place by `feed`. */
  readonly document: DocumentNode
  /** Push the latest id→page map into the live tree and await the renderer flush. */
  feed: (pages: DestinationPageMap) => Promise<void>
}

export interface MultiPassOptions {
  fontStore?: PdfFontStore
  compress?: boolean
  /** Hard cap on layout passes before declaring non-convergence. */
  maxPasses?: number
  /** Render limits bounding the whole loop (page cap + shared time budget). */
  limits?: RenderLimits
}

export interface MultiPassResult {
  bytes: Uint8Array
  layout: SafeDocumentNode
  /** Number of layout passes actually run (a converged doc needs ≥ 2). */
  passes: number
  /** The stable id→page map the serialized PDF was produced with. */
  pages: DestinationPageMap
}

const DEFAULT_MAX_PASSES = 5

// `resolveBookmarks` is the one layout step that writes derived state back onto
// the input tree: it REPLACES `props.bookmark` with a resolved `{ ref, parent,
// …bookmark }` hierarchy on the mounted node (`resolveBookmarks.ts:52`; see
// CONTRACTS.md "Layout purity contract"). Across passes that resolved object
// feeds back into the next pass's `getBookmarkValue`, whose `{ …bookmark }` spread
// carries the STALE `ref`/`parent` forward and corrupts the outline hierarchy.
// The reset restores each bookmark-carrying node's ORIGINAL authored value before
// every pass. resolveBookmarks only reassigns the reference (never mutates the
// object), so restoring the captured reference is a complete reset. The snapshot
// is merged before EVERY pass, not captured once: a bookmark that first appears
// mid-loop (e.g. behind a v-if on a resolved page number) is recorded with its
// authored value the first time it is seen, before any layout resolves it.
type BookmarkSnapshot = Map<PdfElementNode, unknown>

const resetBookmarks = (
  root: PdfElementNode,
  snapshot: BookmarkSnapshot,
): void => {
  const visit = (node: PdfNode): void => {
    if (!('children' in node)) return
    const element = node as PdfElementNode
    if ('bookmark' in element.props) {
      if (snapshot.has(element)) element.props.bookmark = snapshot.get(element)
      else snapshot.set(element, element.props.bookmark)
    }
    for (const child of element.children) visit(child)
  }
  visit(root)
}

const samePages = (a: DestinationPageMap, b: DestinationPageMap): boolean => {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => a[key] === b[key])
}

const describeMap = (map: DestinationPageMap): string => {
  const entries = Object.entries(map)
  if (entries.length === 0) return '(empty)'
  return entries.map(([id, page]) => `#${id}→p${page}`).join(', ')
}

/**
 * Lay the mounted document out repeatedly, feeding each pass's destination→page
 * map back into the live tree, until the map the layout PRODUCES equals the map
 * it was laid out WITH (a fixed point). Serializes that converged layout once.
 *
 * Throws a `PDF_LIMIT_EXCEEDED` NuxtPdfError on non-convergence rather than
 * looping forever or shipping silently wrong page numbers.
 */
export const renderDocumentMultiPass = async (
  source: MultiPassSource,
  options: MultiPassOptions = {},
): Promise<MultiPassResult> => {
  const fontStore = options.fontStore ?? createPdfFontStore()
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES
  const bookmarks: BookmarkSnapshot = new Map()

  let fed: DestinationPageMap = {}
  let produced: DestinationPageMap = {}

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    await source.feed(fed)
    resetBookmarks(source.document as unknown as PdfElementNode, bookmarks)
    // layoutPdfTree checks the shared deadline before and after each pass and
    // enforces the page cap on every laid-out result, so the whole loop is
    // bounded by the same budget without a second enforcement site here.
    const layout = await layoutPdfTree(source.document, fontStore, options.limits)
    produced = extractDestinationPages(layout)

    if (samePages(produced, fed)) {
      const bytes = await serializePdfLayout(
        source.document.props,
        layout,
        options.compress ?? true,
        options.limits,
      )
      return { bytes, layout, passes: pass, pages: produced }
    }

    fed = produced
  }

  throw new NuxtPdfError(
    PDF_ERROR_CODES.LimitExceeded,
    `Table-of-contents page numbers did not stabilize after ${maxPasses} layout passes. `
    + `This means a document's layout depends on the page numbers it prints — usually a `
    + `table-of-contents entry whose height changes with the page number it shows, forming a `
    + `feedback loop. Fix the entry so its size does not depend on the number (e.g. a fixed-width `
    + `number column, or reserve the line height up front), or raise maxPasses if the document is `
    + `legitimately this deep. Last fed map: ${describeMap(fed)}; last produced map: ${describeMap(produced)}.`,
  )
}
