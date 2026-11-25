// The page tokens (page number, page count, page reference, running text)
// and the leader.
import type { PdfStyle } from '../authoring'
import { primitive, required, value } from './spec'

/**
 * A running value that a `PdfText` sets: its name, or its name and the text
 * to show in place of the text's own, such as a short title.
 */
export type PdfRunning = string | { name: string, text: string }

/** The name and the text of a valid `running` prop, or undefined for any other value. */
export const pdfRunningName = (running: unknown): string | undefined =>
  typeof running === 'string' ? running : typeof running === 'object' && running !== null && 'name' in running && typeof running.name === 'string' ? running.name : undefined

/**
 * The styles a `PdfLeader` takes: the line it draws on the baseline (a bottom
 * border's style, width and color) and the gaps before and after it.
 */
export type PdfLeaderStyle = Pick<PdfStyle, 'borderBottomStyle' | 'borderBottomWidth' | 'borderBottomColor' | 'marginLeft' | 'marginRight'>

/** One entry of a `PdfLeader` style array. */
export type PdfLeaderStyleEntry = PdfLeaderStyle | readonly PdfLeaderStyleEntry[] | false | null | undefined

/**
 * A line, dotted by default, that fills the rest of its line in a
 * `PdfText`, such as between a title and its page number. No line break
 * comes before or after it, so the word before it, the leader and the text
 * after it stay on one line.
 */
export type PdfLeaderProps = {
  style?: PdfLeaderStyle | readonly PdfLeaderStyleEntry[]
}

/** Prints the number of the page the surrounding text is painted on. */
export type PdfPageNumberProps = Record<never, never>

/** Prints the total number of pages in the document. */
export type PdfPageCountProps = Record<never, never>

/** Prints the number of the first page that shows the element with this id. */
export type PdfPageRefProps = {
  to: string
}

/** Which running value of a page `PdfRunningText` prints. */
export const PDF_RUNNING_AT = ['top', 'before', 'end'] as const
export type PdfRunningAt = typeof PDF_RUNNING_AT[number]

/**
 * Prints the running value `name` of the page the surrounding text is
 * painted on. Nothing before the first value. Only inside a `fixed` node,
 * such as a header or a footer.
 */
export type PdfRunningTextProps = {
  name: string
  /**
   * `'top'` (default): the value set by the node at the very top of the
   * page, otherwise the last value set before the page. `'before'`: the last
   * value set before the page. `'end'`: the last value set on the page,
   * otherwise the last value set before it.
   */
  at?: PdfRunningAt
}

export const TOKEN_PRIMITIVES = {
  // An inline item of a text: its paragraph gives it the rest of its line
  // (text/break.ts, text/justify.ts), and the painter draws its line there.
  PdfLeader: primitive<PdfLeaderProps>()({
    tag: 'LEADER',
    props: { style: value },
    children: [],
    context: 'flow',
  }),
  // Inline page tokens. They are plain data in the mounted tree; the engine
  // adapter (server/engine/plain-tree.ts) replaces them before layout, so the
  // layout engine never sees these tags.
  PdfPageNumber: primitive<PdfPageNumberProps>()({
    tag: 'PAGE_NUMBER',
    props: {},
    children: [],
    context: 'flow',
    token: 'page',
  }),
  PdfPageCount: primitive<PdfPageCountProps>()({
    tag: 'PAGE_COUNT',
    props: {},
    children: [],
    context: 'flow',
    token: 'page',
  }),
  PdfPageRef: primitive<PdfPageRefProps>()({
    tag: 'PAGE_REF',
    props: { to: required({ check: 'nonEmptyId' }) },
    children: [],
    context: 'flow',
    token: 'document',
  }),
  PdfRunningText: primitive<PdfRunningTextProps>()({
    tag: 'RUNNING_TEXT',
    props: { name: required({ check: 'runningName' }), at: { check: 'runningAt' } },
    children: [],
    context: 'flow',
    token: 'page',
  }),
}
