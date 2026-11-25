// The props and bookmarks that the primitives share.
import type { PdfStyleValue } from '../authoring'

export type PdfBookmark = string | {
  title: string
  expanded?: boolean
  /** `false` keeps the entry in the outline but out of every `PdfContents`. */
  contents?: false
}

export type PdfBaseProps = {
  id?: string
  fixed?: boolean
  /**
   * `true` starts the node on a new page; `'column'` in the next column of
   * its column container (after the last column, on the next page).
   */
  break?: boolean | 'column'
  debug?: boolean
  /**
   * The node starts on the same page as the start of the next flow sibling
   * in its container (a heading before a table keeps the table's first row).
   */
  keepWithNext?: boolean
  minPresenceAhead?: number
  style?: PdfStyleValue
  /**
   * In a PDF/UA-1 document: the node and everything inside it is decoration,
   * which assistive technology skips (a PDF artifact). No effect otherwise.
   */
  decorative?: boolean
}

// Outline entries are typed only where they are claimed and tested
// (Page/View/Text/Image); see CONFORMANCE.md.
export type PdfBookmarkProp = {
  bookmark?: PdfBookmark
}

/** The pages of its parent on which a `fixed` node appears. */
export const PDF_FIXED_PAGES = ['all', 'first', 'continuation', 'not-last'] as const

export type PdfFixedPages = typeof PDF_FIXED_PAGES[number]

export type PdfFixedPagesProp = {
  /**
   * With `fixed`: on which pages of its parent the node appears. `'all'`
   * (default), `'first'`, `'continuation'` (every page but the first) or
   * `'not-last'` (every page but the last). Where it does not appear it takes
   * no space, except a `'not-last'` node on the last page, which keeps its
   * room free. The parent is the `PdfPage` for a node directly on the page,
   * else the view that holds it.
   */
  pages?: PdfFixedPages
}
