import { PDF_PRIMITIVES } from '../../../../primitives'
import type { MeasuredNode, ResolvedStyle } from '../types'
import type { UnstyledNode } from './dynamic'
import { isFixed, isText, linesOf, SAFETY_THRESHOLD } from './rules'
import { heightAtLineIndex, splitText, startLines } from './text'

// The footnotes of a page: its note book, the references in a page part, and
// which notes, or which part of the last one, the page's note area holds for
// a chosen split (rule 11 on a forced page). The page builder searches the
// height a page fills its flow to (builder.ts, `fitNotes`).

/**
 * The note area, from the page's `noteArea` view laid out with the notes as
 * its children (layout/notes.ts): its style, its own children (they come
 * first on every page part, before the notes), where it starts across the
 * page and how wide it is, its top margin, its own height (its margins,
 * borders and vertical paddings, and its own children with the gap after
 * each: the area with no notes) and the gap between notes. Every key means
 * what it means on any view: a top border is a rule above everything in it,
 * the top margin the least space between the flow and the area.
 */
interface Area {
  style: ResolvedStyle
  children: MeasuredNode[]
  left: number
  width: number
  marginTop: number
  own: number
  gap: number
}

/** The footnotes of one source page across the pages pagination makes of it. */
export interface NoteBook {
  /** The laid-out bodies by id (layout/notes.ts). */
  readonly bodies: ReadonlyMap<string, MeasuredNode>
  /** The ids whose body a page holds, or carries on: a second reference adds no second body. */
  readonly placed: Set<string>
  /** Note parts that continue on the next page, in order: they come first there. */
  carried: MeasuredNode[]
  readonly area: Area
}

/**
 * On a page part with a note area: where the page's content area ends without
 * it, from the page top. The area raises the page's bottom padding to where
 * the flow's room ends; the layout diagnostics read the page's own end here,
 * which only a block the relayout shrank reaches (layout-diagnostics.ts). A
 * part whose flow the fit shrinks above its notes (`NoteFit.shrinks`) has
 * none: there a block reaches the raised padding only when shrunk.
 */
export const CONTENT_BOTTOM_PROP = '__nuxtPdfContentBottom'

/** On the note of a footnote: the number it prints (plain-tree.ts). */
export const NOTE_NUMBER_PROP = '__nuxtPdfNoteNumber'

/**
 * On a page part whose notes did not all start on it (rule 11): the notes
 * that move whole to the next page, in order, as `{ number, source }`, for
 * the layout warning (layout-diagnostics.ts).
 */
export const NOTES_MOVED_PROP = '__nuxtPdfNotesMoved'

const numberOr = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** The notes of a page, or undefined for a page without any, which runs none of the fit. */
export const noteBookOf = (notes: readonly MeasuredNode[] | undefined, area: MeasuredNode | undefined): NoteBook | undefined => {
  if (!notes?.length || area === undefined) return undefined
  const bodies = new Map<string, MeasuredNode>()
  for (const note of notes) {
    if (typeof note.props.id === 'string') bodies.set(note.props.id, note)
  }
  const { box } = area
  const gap = numberOr(area.style.rowGap, 0)
  const children = area.children.filter((child): child is MeasuredNode => child.type !== PDF_PRIMITIVES.TextInstance)
  const childrenHeight = children.reduce((sum, child) => sum + child.box.marginTop + child.box.height + child.box.marginBottom + gap, 0)
  return {
    bodies,
    placed: new Set(),
    carried: [],
    area: {
      style: area.style,
      children,
      left: box.left,
      width: box.width,
      marginTop: box.marginTop,
      own: box.marginTop + box.borderTopWidth + box.paddingTop + childrenHeight + box.paddingBottom + box.borderBottomWidth + box.marginBottom,
      gap,
    },
  }
}

const edge = (style: ResolvedStyle, key: 'marginTop' | 'marginBottom' | 'paddingTop' | 'paddingBottom' | 'borderTopWidth' | 'borderBottomWidth'): number => numberOr(style[key], 0)

/** The height of a text part's box with its first `count` lines: those lines and its paddings and borders (a split part has none at the cut). */
const boxHeightOf = (text: MeasuredNode, count = linesOf(text).length): number => edge(text.style, 'borderTopWidth') + edge(text.style, 'paddingTop')
  + heightAtLineIndex(text, count)
  + edge(text.style, 'paddingBottom') + edge(text.style, 'borderBottomWidth')

/** The height a note part takes in the area: its box and its margins. */
const heightOf = (note: MeasuredNode, count?: number): number => edge(note.style, 'marginTop') + boxHeightOf(note, count) + edge(note.style, 'marginBottom')

/** The note id a run's link names, or undefined: `#id`, without the suffix of a tagged link (tagged.ts, `markedHref`). */
const noteIdOf = (link: unknown, book: NoteBook): string | undefined => {
  if (typeof link !== 'string' || !link.startsWith('#')) return undefined
  const cut = link.indexOf('\u0000')
  const id = link.slice(1, cut === -1 ? undefined : cut)
  return book.bodies.has(id) ? id : undefined
}

/**
 * The bodies the references in a page part need, in reading order: the runs
 * of the lines that stay, whose link names a note not placed yet. Fixed
 * nodes hold no reference (mount rejects a footnote in one).
 */
export const referencesIn = (nodes: readonly MeasuredNode[], book: NoteBook): MeasuredNode[] => {
  const ids = new Set<string>()
  const visit = (node: MeasuredNode): void => {
    if (isFixed(node)) return
    if (isText(node)) {
      for (const line of node.lines ?? []) {
        for (const run of line.runs) {
          const id = noteIdOf(run.attributes.link, book)
          if (id !== undefined && !book.placed.has(id)) ids.add(id)
        }
      }
      return
    }
    for (const child of node.children) {
      if (child.type !== PDF_PRIMITIVES.TextInstance) visit(child)
    }
  }
  for (const node of nodes) visit(node)
  return [...ids].map(id => book.bodies.get(id)!)
}

/**
 * What the fit keeps: the note parts of the area, where the area
 * starts and where the flow's room ends (the area top, or lower where the
 * last node's bottom margin reaches into the area), and whether the flow is
 * higher than that room, so the relayout shrinks it.
 */
interface NoteFit {
  parts: MeasuredNode[]
  areaTop: number
  flowEnd: number
  shrinks: boolean
  /** The notes of references on this page that move whole to the next page (rule 11). */
  moved: MeasuredNode[]
}

/**
 * The height the notes of a page part need below its flow: the area's own
 * height, the parts carried from the page before, and the notes of
 * `references`, each whole except the last, which counts its start.
 */
export const notesNeed = (book: NoteBook, references: readonly MeasuredNode[]): number => {
  const { own, gap } = book.area
  const count = book.carried.length + references.length
  if (count === 0) return 0
  let height = own + gap * (count - 1) + book.carried.reduce((sum, part) => sum + heightOf(part), 0)
  for (const [at, note] of references.entries()) height += at === references.length - 1 ? heightOf(note, startLines(note)) : heightOf(note)
  return height
}

/** A chosen split as the area reads it: where its flow ends, the bottom margin after it, its references, whether its notes fit and whether it takes flow. */
export interface ChosenSplit {
  end: number
  margin: number
  references: MeasuredNode[]
  fits: boolean
  takesFlow: boolean
}

/** The note parts of a chosen split, where the area starts and where the flow's room ends (rule 11 on a forced page); carried and placed notes go into `book`. */
export const placeNotes = (book: NoteBook, chosen: ChosenSplit, end: number, contentTop: number): NoteFit => {
  const { own, gap } = book.area
  const carried = book.carried
  const forced = !chosen.fits

  // The area: the carried parts, then the notes of the references, in
  // order. Each is whole while it fits; one that does not is cut at the room
  // left, and the rest of it goes on to the next page. On a page that fits,
  // only the last note is ever cut, and nothing comes after it; only it can
  // keep no line (every note starts with its number), and it goes on whole.
  //
  // A forced page (rule 11) draws nothing below the page end. The notes
  // start in order while the first line of each fits the room (on a page
  // whose flow is shrunk, the content area); the first one whose first line
  // does not, and every one after it, moves whole to the next page, where
  // carried notes come first. A page that takes no flow starts the first, so
  // pagination goes on: a note line higher than the page is the one thing
  // that still passes the page end. A cut leaves room for one line of each
  // started note after it (`after`), so each keeps at least one line.
  const shrinks = chosen.end > end + SAFETY_THRESHOLD
  const queue = [...carried, ...chosen.references]
  let starts = queue.length
  if (forced) {
    const startRoom = (shrinks ? end - contentTop : end - chosen.end) - own
    starts = 0
    for (let used = 0; starts < queue.length; starts += 1) {
      const line = (starts > 0 ? gap : 0) + heightOf(queue[starts]!, 1)
      if (used + line > startRoom + SAFETY_THRESHOLD) break
      used += line
    }
    if (starts === 0 && !chosen.takesFlow) starts = 1
  }
  const started = queue.slice(0, starts)
  const moved = queue.slice(starts)
  const after: number[] = []
  for (let at = started.length - 1, sum = 0; at >= 0; at--) {
    after[at] = sum
    sum += gap + heightOf(started[at]!, 1)
  }
  const parts: MeasuredNode[] = []
  const rest: MeasuredNode[] = []
  let room = end - chosen.end - own
  for (const note of queue) {
    if (typeof note.props.id === 'string') book.placed.add(note.props.id)
  }
  for (const [at, note] of started.entries()) {
    const before = parts.length > 0 ? gap : 0
    const space = room - after[at]! - before
    const height = heightOf(note)
    if (height <= space + SAFETY_THRESHOLD) {
      parts.push(note)
      room -= before + height
      continue
    }
    // Forced, the cut keeps at least one line, as a text that never fits
    // keeps one at a page top (`splitText` with no room for its start).
    const [part, next] = forced
      ? splitText(note, space - edge(note.style, 'marginTop'), 0, false)
      : splitText(note, space - edge(note.style, 'marginTop'), Number.POSITIVE_INFINITY, true)
    if (linesOf(part).length > 0) {
      parts.push(part)
      room -= before + heightOf(part)
      if (next !== null) rest.push(next)
    }
    else {
      rest.push(note)
    }
  }
  book.carried = [...rest, ...moved]
  // The page reports the notes of its own references that moved; a carried
  // note was reported by the page of its mark.
  const movedNotes = queue.slice(Math.max(starts, carried.length))
  const areaHeight = own + gap * Math.max(0, parts.length - 1) + parts.reduce((sum, part) => sum + heightOf(part), 0)
  // A flow that ends below the page end holds a block that cannot split and
  // stays, cut at the page end: the relayout shrinks it to
  // its room in any case. The notes take theirs at the page bottom, and the
  // flow is shrunk above them; placed below the flow, they would be off the
  // page.
  if (shrinks) {
    return { parts, areaTop: end - areaHeight, flowEnd: end - areaHeight, shrinks: true, moved: movedNotes }
  }
  const areaTop = Math.max(chosen.end, end - areaHeight)
  return { parts, areaTop, flowEnd: Math.min(end, Math.max(areaTop, chosen.end + chosen.margin)), shrinks: false, moved: movedNotes }
}

/**
 * The note area of a page part: the page's area view out of the flow, at the
 * fit's top below its top margin, as wide as it was laid out, with its own
 * children and then the note parts. Its margins and offsets are its place,
 * set here.
 */
export const noteAreaOf = (book: NoteBook, fit: Pick<NoteFit, 'areaTop' | 'parts'>): UnstyledNode => {
  const { style, children, left, width, marginTop } = book.area
  const boxStyle = Object.fromEntries(Object.entries(style).filter(([key]) => !/^(?:margin|position$|top$|right$|bottom$|left$|width$)/.test(key)))
  return {
    type: PDF_PRIMITIVES.View,
    props: {},
    style: { ...boxStyle, position: 'absolute', top: fit.areaTop + marginTop, left, width },
    box: {},
    children: [...children, ...fit.parts],
  }
}
