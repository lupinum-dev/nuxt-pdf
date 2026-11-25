import { NuxtPdfError, PDF_ERROR_CODES } from '../../../../shared/errors'
import type { MeasuredDocument, MeasuredNode, ResolvedStyle } from '../types'
import type { UnstyledNode } from './dynamic'
import { buildPagination } from './builder'

/**
 * Styles, measures and lays out one page again (index.ts): the one way back
 * into the earlier stages. Pagination needs it for each page it makes and
 * for each page whose dynamic nodes changed (G3).
 */
export type Relayout = (page: UnstyledNode & { style?: ResolvedStyle }) => MeasuredNode

/** The error for a pagination that cannot end: `pageNumber` is the second page that took nothing. */
export const paginationStuck = (pageNumber: number): NuxtPdfError => new NuxtPdfError(
  PDF_ERROR_CODES.LayoutError,
  `Pagination cannot end: pages ${pageNumber - 1} and ${pageNumber} take no content from the flow, so every page after them would start the same way. `
  + 'Content that does not fit the room left below or beside fixed content on a page (a table header, a fixed node in a row or above a column container) causes this. '
  + 'Make that content or the fixed content lower, or remove fixed so it can break across pages.',
)

/**
 * The page fragments of a measured document: each `PdfPage` split into as
 * many pages as its content needs, following `fixed`, `break`, `wrap`,
 * `minPresenceAhead` and the dynamic nodes, then every page laid out once
 * more with its final page number and the total (the page builder, builder.ts).
 */
export const resolvePagination = (root: MeasuredDocument, relayout: Relayout): MeasuredDocument => buildPagination(root, relayout)
