// Footnote numbers counted on each page (`footnotes: 'page'`). The layout
// sets each mark, each repeated mark and each note's number in the width of
// the widest number it can print (`NUMBER_RESERVE_PROP`), so it paginates as
// with numbers through the document, in one pass. On the final pages one
// walk then numbers the marks from 1 on each page in reading order and gives
// each note and repeated mark its mark's number (`relabelRun`).
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import { PDF_FOOTNOTE_ID_PREFIX, PDF_PRIMITIVES } from '../../primitives'
import type { SafeDocumentNode } from './layout/index'
import { NOTES_MOVED_PROP } from './layout/paginate/notes'
import type { LaidOutNode } from './layout/types'
import { splitMarkedLink } from './tagged'
import type { Line, Run } from './text'
import { relabelRun } from './text/lines'

/** The id of a note's first mark is the note's id with this suffix; the note's number links back to it. */
export const FOOTNOTE_MARK_ID_SUFFIX = '-ref'

const FOOTNOTE_ID = new RegExp(`^${PDF_FOOTNOTE_ID_PREFIX}(\\d+)(${FOOTNOTE_MARK_ID_SUFFIX})?$`)

/** The footnote an id names, by its number through the document: a note's id, or its mark's. */
const footnoteOf = (id: string | undefined): { ordinal: number, mark: boolean } | undefined => {
  const match = id === undefined ? null : FOOTNOTE_ID.exec(id)
  return match ? { ordinal: Number(match[1]), mark: match[2] !== undefined } : undefined
}

/** The footnote whose mark a run is: the run holds the mark's id (the first run of the nested text). */
const markOf = (run: Run): number | undefined =>
  run.attributes.anchors?.map(anchor => footnoteOf(anchor.id)).find(footnote => footnote?.mark)?.ordinal

/** The footnote a run links to: a mark (repeated or not) links to its note, a note's number back to its mark. */
const linkOf = (run: Run): { ordinal: number, mark: boolean } | undefined => {
  const link = run.attributes.link
  return link?.startsWith('#') ? footnoteOf(splitMarkedLink(link).target.slice(1)) : undefined
}

/** A name for the font of a run, for an error. */
const fontName = (run: Run): string => {
  const font = run.attributes.font?.[0]
  if (font?.type === 'STANDARD') return font.fullName
  // fontkit declares no name field (fonts.ts); every parsed font has one.
  const name: unknown = font === undefined ? undefined : Reflect.get(font, 'postscriptName')
  return typeof name === 'string' ? name : 'a registered font'
}

/** The lines of a text with each run that `labelOf` names relabelled; undefined when none is. */
const relabelLines = (lines: readonly Line[], labelOf: (run: Run) => string | undefined): Line[] | undefined => {
  let changed = false
  const relabelled = lines.map((line) => {
    let current = line
    for (let at = 0; at < current.runs.length; at += 1) {
      const run = current.runs[at]!
      const label = labelOf(run)
      if (label === undefined) continue
      const next = relabelRun(current, at, label)
      if (next === undefined) {
        throw new NuxtPdfError(PDF_ERROR_CODES.LayoutError, `The footnote number ${label} is wider in the font ${fontName(run)} than the room its mark keeps for ${label.length} ${label.length === 1 ? 'digit' : 'digits'}: the font gives its digits different widths or moves them apart. Number the footnotes through the document, or give the marks a font with digits of one width (footnoteStyles.mark).`)
      }
      current = next
      changed = true
    }
    return current
  })
  return changed ? relabelled : undefined
}

/** The node with the lines of every text below it relabelled, in tree order; the same node when nothing changed. */
const relabelNode = (node: LaidOutNode, labelOf: (run: Run) => string | undefined): LaidOutNode => {
  if (node.type === PDF_PRIMITIVES.Text && node.lines) {
    const lines = relabelLines(node.lines, labelOf)
    return lines === undefined ? node : { ...node, lines }
  }
  if (!Array.isArray(node.children)) return node
  let changed = false
  const children = node.children.map((child) => {
    if (child.type === PDF_PRIMITIVES.TextInstance) return child
    const next = relabelNode(child, labelOf)
    changed ||= next !== child
    return next
  })
  return changed ? { ...node, children } : node
}

/**
 * The layout with its footnotes numbered on each page. First every page
 * numbers its marks from 1 in tree order (reading order, columns included);
 * then each note's number and each repeated mark takes its mark's number,
 * also a note that moved to a later page, and so does the list of moved
 * notes that the moved-notes warning reads (`NOTES_MOVED_PROP`). A note
 * whose mark is on no page keeps its number through the document, which
 * fits the reserved width.
 */
export const numberFootnotesByPage = (layout: SafeDocumentNode): SafeDocumentNode => {
  const numbers = new Map<number, string>()
  const marked = layout.children.map((page) => {
    let count = 0
    return relabelNode(page, (run) => {
      const ordinal = markOf(run)
      if (ordinal === undefined) return undefined
      const label = String(count += 1)
      numbers.set(ordinal, label)
      return label
    })
  })
  const numberOf = (ordinal: number): string => numbers.get(ordinal) ?? String(ordinal)
  const children = marked.map((page) => {
    const relabelled = relabelNode(page, (run) => {
      const footnote = linkOf(run)
      return footnote === undefined || markOf(run) !== undefined ? undefined : numberOf(footnote.ordinal)
    })
    const moved: unknown = relabelled.props[NOTES_MOVED_PROP]
    if (!Array.isArray(moved)) return relabelled
    const renumbered = moved.map((note: unknown) => typeof note === 'object' && note !== null && 'number' in note && typeof note.number === 'number'
      ? { ...note, number: Number(numberOf(note.number)) }
      : note)
    return { ...relabelled, props: { ...relabelled.props, [NOTES_MOVED_PROP]: renumbered } }
  })
  return { ...layout, children }
}
