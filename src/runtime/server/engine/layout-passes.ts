import type { DocumentNode, SafeDocumentNode } from '@react-pdf/layout'
import { createPdfFontStore, type PdfFontStore } from '../fonts'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import type { PdfElementNode, PdfNode } from '../../renderer/types'
import {
  extractDestinationPages,
  layoutPdfTree,
  serializePdfLayout,
  type DestinationPageMap,
} from './render-document'

export { extractDestinationPages, type DestinationPageMap }

// SPIKE (internal, not publicly exported). Proves the multi-pass layout
// architecture that a table of contents with correct page numbers requires.
//
// The loop is a fixed-point iteration over the existing single-pass pipeline:
//
//   feed(map) → layoutPdfTree → extract id→page map → repeat until stable → serialize ONCE
//
// The document is authored once and mounted once. Between passes the id→page map
// is fed back into the LIVE Vue tree through a reactive prop; our custom renderer
// re-patches the same node objects in place (proven by node-identity assertions
// in test/toc-multipass.test.ts — no re-mount per pass). `layoutDocument` treats
// its input as immutable for every non-bookmark node (Object.assign copies at
// each step; see CONTRACTS.md "Layout purity contract"), so the same mounted tree
// is safe to lay out repeatedly without cloning.

/**
 * A mountable document whose page-number feedback can be re-fed between passes.
 * The spike backs this with a MountedPdfComponent whose fixture reads the map
 * from a reactive prop; productization would back it with a provided ref that a
 * `usePdfPageNumbers()` composable exposes (see the API sketch).
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
}

/**
 * Whether the mounted tree contains a `Link` whose `src`/`href` targets an
 * internal destination (`#id`). Such a link needs the resolved page number of
 * its target, so it activates the multi-pass loop even when the template never
 * calls `usePdfPageNumbers()`. External links (`http…`, `mailto:`) do not.
 */
export const hasInternalLink = (document: DocumentNode): boolean => {
  const visit = (node: PdfNode): boolean => {
    if (!('props' in node)) return false
    const element = node as PdfElementNode
    if (element.type === 'LINK') {
      const target = element.props.src ?? element.props.href
      if (typeof target === 'string' && target.startsWith('#')) return true
    }
    return element.children.some(visit)
  }
  return visit(document as unknown as PdfNode)
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
// object), so restoring the captured reference is a complete reset.
type BookmarkSnapshot = ReadonlyArray<readonly [PdfElementNode, unknown]>

const snapshotBookmarks = (root: PdfElementNode): BookmarkSnapshot => {
  const entries: Array<readonly [PdfElementNode, unknown]> = []
  const visit = (node: PdfNode): void => {
    if (!('children' in node)) return
    const element = node as PdfElementNode
    if ('bookmark' in element.props) entries.push([element, element.props.bookmark])
    for (const child of element.children) visit(child)
  }
  visit(root)
  return entries
}

const restoreBookmarks = (snapshot: BookmarkSnapshot): void => {
  for (const [node, bookmark] of snapshot) node.props.bookmark = bookmark
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
  const bookmarks = snapshotBookmarks(source.document as unknown as PdfElementNode)

  let fed: DestinationPageMap = {}
  let produced: DestinationPageMap = {}

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    await source.feed(fed)
    restoreBookmarks(bookmarks)
    const layout = await layoutPdfTree(source.document, fontStore)
    produced = extractDestinationPages(layout)

    if (samePages(produced, fed)) {
      const bytes = await serializePdfLayout(
        source.document.props,
        layout,
        options.compress ?? true,
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
