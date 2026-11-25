import { fontStoreOf, type PdfFontStore, type FontStore } from '../fonts'
import { resolveAssets } from './assets'
import type { DocumentNode, LaidOutDocument, YogaInstance } from './types'
import { resolveDimensions, resolvePageDimensions } from './dimensions'
import { loadYoga } from './dimensions/yoga'
import { resolveOrigin } from './finish/origin'
import { foldNotes, liftNotes } from './notes'
import { resolvePagination, type Relayout } from './paginate'
import { resolvePercentRadius } from './finish/percent-radius'
import { resolveBookmarks } from './prepare/bookmarks'
import { resolveHyphenation } from './prepare/hyphenation'
import { resolveLinkSubstitution } from './prepare/links'
import { resolvePageSizes } from './prepare/page-size'
import { resolveInheritance } from './styles/inheritance'
import { resolvePagesPaddings, resolvePercentHeight } from './styles/page-percent'
import { resolvePageStyles, resolveStyles } from './styles/resolve-styles'
import { resolveSvg } from './svg'
import { resolvePageTextLayout, resolveTextLayout } from './text/layout'
import { loadHyphenation, patternKeyOf } from '../text'
import { countWork } from '../work'

/** The layout result, under the name the painter and the passes after the layout import. */
export type SafeDocumentNode = LaidOutDocument
export type { DocumentNode }
/** A parsed transform operation, as the painter applies it (paint/box.ts). */
export type { Transform } from './types'

/**
 * Lays out a document: the engine tree of one pass (`plain-tree.ts`) in, one
 * laid-out page node per page out. `fontStore` holds the fonts of this render.
 */
export default async function layoutDocument(document: DocumentNode, pdfFontStore: PdfFontStore): Promise<SafeDocumentNode> {
  const fontStore = fontStoreOf(pdfFontStore)
  const yoga = await loadYoga()
  // The patterns of the document's language (D41): the text layout reads them synchronously.
  const patterns = patternKeyOf(document.props.language)
  if (patterns !== undefined) await loadHyphenation(patterns)
  const prepared = resolveHyphenation(resolveLinkSubstitution(resolveBookmarks(liftNotes(resolvePageSizes({ ...document, yoga })))), patterns)
  // Inheritance before the percent heights: it resolves `em` paddings of a page, which they read.
  const styled = resolvePercentHeight(resolveInheritance(resolvePagesPaddings(resolveStyles(prepared))))
  const withAssets = resolveSvg(await resolveAssets(styled, fontStore), fontStore)
  const measured = resolveTextLayout(resolvePercentRadius(resolveDimensions(withAssets, fontStore, yoga)), fontStore)
  const paged = await resolveAssets(resolvePagination(foldNotes(measured), relayoutWith(fontStore, yoga)), fontStore)
  return resolveOrigin(paged)
}

/**
 * The pagination seam: one page styled (with the inherited style of the
 * nodes page callbacks returned), measured and its texts laid out again,
 * with the same steps as the whole document (no page sizes, assets or SVG
 * resolution: a page part keeps those).
 */
const relayoutWith = (fontStore: FontStore, yoga: YogaInstance): Relayout => (page) => {
  countWork('pageRelayouts')
  return resolvePageTextLayout(resolvePageDimensions(resolvePageStyles(page), fontStore, yoga), fontStore)
}
