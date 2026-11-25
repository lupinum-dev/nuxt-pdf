import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from './layout/index'
import { fontStoreOf, type PdfFontStore } from './fonts'
import { NuxtPdfError, PDF_ERROR_CODES, treeInvalid } from '../../shared/errors'
import { countWork } from './work'
import { resolveFieldFonts } from './form-font'
import { countPages } from './laid-out'
import { enforceMaxPages, type RenderLimits } from '../render-limits'

// One layout pass. Validates the root and runs the layout pipeline once. The
// pass loop (`layoutToFixedPoint` in plain-tree.ts) calls this once per pass on
// a fresh engine tree, and only the converged result is serialized via
// `serializePdfLayout`.
// The engine tests' `renderDocument` (test/engine-render.ts) composes one pass
// and serialization; both share this one source of truth for layout error mapping.
export const layoutPdfTree = async (
  document: DocumentNode,
  fontStore: PdfFontStore,
  limits?: RenderLimits,
): Promise<SafeDocumentNode> => {
  limits?.deadline.check()

  if (document.type !== 'DOCUMENT') {
    treeInvalid(`Expected a DOCUMENT root, received ${document.type}.`)
  }

  // The page cap is checked as each page starts too, so a pagination that
  // takes content on every page without ending fails at the limit by itself,
  // before the deadline or the memory runs out.
  let started = 0
  const counted: DocumentNode = limits
    ? { ...document, onPage: () => {
        document.onPage?.()
        enforceMaxPages(++started, limits.maxPages)
      } }
    : document

  let layout: SafeDocumentNode
  try {
    layout = await layoutDocument(counted, fontStore)
    countWork('layouts')
  }
  catch (error) {
    // A typed error raised inside pagination (the render deadline, checked
    // once per page) keeps its code.
    if (error instanceof NuxtPdfError) throw error
    // Font resolution is a layout sub-stage (resolveAssets → fontStore.load), so
    // font failures surface here as LAYOUT_ERROR carrying the store's message
    // (e.g. "Font family not registered: Roboto"). Nuxt PDF does not re-classify
    // by message text or duplicate the layout traversal to sub-type the failure.
    throw new NuxtPdfError(
      PDF_ERROR_CODES.LayoutError,
      `PDF layout failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  // The page count of the whole layout, with the pages that never split
  // (`wrap={false}`), which start no page in the loop above. Both the
  // single-pass path and every multi-pass iteration reach layout through
  // here, right after the page list is produced and before serialization.
  // Kept outside the layout try/catch so a limit breach stays PDF_LIMIT_EXCEEDED
  // rather than being re-wrapped as a layout error.
  limits?.deadline.check()
  const pages = countPages(layout)
  countWork('pagesLaidOut', pages)
  if (limits) enforceMaxPages(pages, limits.maxPages)
  // A field in a PDF/A document draws in its registered font; serialization
  // has no font store, so the layout step resolves it.
  await resolveFieldFonts(layout, fontStoreOf(fontStore))

  return layout
}
