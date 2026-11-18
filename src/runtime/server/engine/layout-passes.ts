import type { DocumentNode, SafeDocumentNode } from './layout/index'
import { createPdfFontStore, type PdfFontStore } from './fonts'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import type { RenderLimits } from '../render-limits'
import {
  extractDestinationPages,
  layoutPdfTree,
  serializePdfLayout,
  type DestinationPageMap,
  type PdfEngineAttachment,
} from './render-document'

export { extractDestinationPages, type DestinationPageMap }

// The fixed-point layout loop. It resolves what one layout can only learn from
// a finished layout: page-reference (`PAGE_REF`) numbers and views that must
// start on a new page so a repeated header is not left alone:
//
//   feed(facts) → layoutPdfTree → extract facts → repeat until stable → serialize ONCE
//
// `feed` rebuilds the engine tree from the plain-data document with the latest
// facts (`toEngineDocument` in plain-tree.ts). Every pass lays out a fresh copy, so
// the one layout step that writes into its input (`resolveBookmarks` replaces
// `props.bookmark`, see CONTRACTS.md "Layout purity contract") never reaches the
// next pass or the mounted tree. Internal `#id` links alone do not need the loop:
// a named destination is resolved by name in a single pass.

/**
 * What one layout pass reports and the next pass is built with. `Facts` is the
 * adapter's choice (plain-tree.ts: destination pages and views that must
 * start on a new page).
 */
export interface MultiPassSource<Facts> {
  /** The engine tree of the current pass, rebuilt by `feed` before each layout. */
  readonly document: DocumentNode
  /** Facts for pass 1, before any layout ran. */
  readonly initial: Facts
  /** Build the engine tree for the next pass from the latest facts. */
  feed: (facts: Facts) => Promise<void>
  /** Read the facts from a laid-out document, given the facts it was built with. */
  extract: (layout: SafeDocumentNode, fed: Facts) => Facts
  same: (a: Facts, b: Facts) => boolean
  /** Short text for the non-convergence error. */
  describe: (facts: Facts) => string
  /**
   * Remove adapter-only nodes from a laid-out pass before anything reads or
   * serializes it (the page guard in plain-tree.ts).
   */
  clean?: (layout: SafeDocumentNode) => SafeDocumentNode
}

export interface MultiPassOptions {
  fontStore?: PdfFontStore
  compress?: boolean
  /** Hard cap on layout passes before declaring non-convergence. */
  maxPasses?: number
  /** Render limits bounding the whole loop (page cap + shared time budget). */
  limits?: RenderLimits
  /** Files embedded once, when the converged layout is serialized. */
  attachments?: readonly PdfEngineAttachment[]
}

export interface MultiPassResult<Facts> {
  bytes: Uint8Array
  layout: SafeDocumentNode
  /** Number of layout passes actually run (1 when pass 1 already reports its own input). */
  passes: number
  /** The stable facts the serialized PDF was produced with. */
  facts: Facts
}

const DEFAULT_MAX_PASSES = 5

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

/** Facts that are only the destination pages; for sources that feed a page map. */
export const DESTINATION_FACTS = {
  initial: {} as DestinationPageMap,
  extract: (layout: SafeDocumentNode) => extractDestinationPages(layout),
  same: samePages,
  describe: describeMap,
}

export { samePages, describeMap }

/**
 * Lay the document out repeatedly, feeding each pass's facts into the next
 * engine tree, until the facts a layout PRODUCES equal the facts it was laid
 * out WITH (a fixed point). Serializes that converged layout once.
 *
 * Throws a `PDF_LIMIT_EXCEEDED` NuxtPdfError on non-convergence rather than
 * looping forever or shipping silently wrong page numbers.
 */
export const renderDocumentMultiPass = async <Facts>(
  source: MultiPassSource<Facts>,
  options: MultiPassOptions = {},
): Promise<MultiPassResult<Facts>> => {
  const fontStore = options.fontStore ?? createPdfFontStore()
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES

  let next = source.initial
  let fed = next
  let produced = next

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    fed = next
    await source.feed(fed)
    // layoutPdfTree checks the shared deadline before and after each pass and
    // enforces the page cap on every laid-out result, so the whole loop is
    // bounded by the same budget without a second enforcement site here.
    const laidOut = await layoutPdfTree(source.document, fontStore, options.limits)
    const layout = source.clean ? source.clean(laidOut) : laidOut
    produced = source.extract(layout, fed)

    if (source.same(produced, fed)) {
      const bytes = await serializePdfLayout(
        source.document.props,
        layout,
        options.compress ?? true,
        options.limits,
        options.attachments,
      )
      return { bytes, layout, passes: pass, facts: produced }
    }

    next = produced
  }

  // `fed` and `produced` belong to the last pass, so the message shows what
  // that pass was laid out with and what it reported instead.

  throw new NuxtPdfError(
    PDF_ERROR_CODES.LimitExceeded,
    `Page numbers did not stabilize after ${maxPasses} layout passes. `
    + `This means a document's layout depends on the page numbers it prints — usually a `
    + `table-of-contents entry whose height changes with the page number it shows, forming a `
    + `feedback loop. Fix the entry so its size does not depend on the number (e.g. a fixed-width `
    + `number column, or reserve the line height up front), or raise maxPasses if the document is `
    + `legitimately this deep. Last fed: ${source.describe(fed)}; last produced: ${source.describe(produced)}.`,
  )
}
