// One function per rule. Each returns the violations it found; an empty list
// means the rule holds for this document.
import { NuxtPdfError, PDF_ERROR_CODES } from '../../src/runtime/shared/errors'
import { figureAlt, TAGGED_LANGUAGE, TAGGED_TITLE, type LinkRect, type OutlineEntry, type MovedNotes, type Paint, type ReadPdf, type Run, type Word } from './document'
import type { ExpectedError } from './faults'
import { RASTER_DPI, type PopplerRead, type PopplerWord, type Raster } from './poppler'
import { pdfjsArabicLetters } from '../pdfjs-arabic'
import {
  CELL_PAD_X,
  pageGeometry,
  SCRIPT_FONTS,
  type BookmarkFact,
  type CellFact,
  type CellSpec,
  type ColumnFact,
  type DocumentSpec,
  type Expectations,
  type NodeSpec,
  type NumberFact,
  type Profile,
  type TextSpec,
  type TokenFact,
  type ViewSpec,
} from './generator'

export type InvariantId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'G1' | 'G2' | 'G3' | 'G4' | 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10' | 'I11' | 'I12' | 'I13' | 'I14' | 'I15' | 'I16' | 'I17' | 'I18' | 'I19' | 'I20' | 'I21' | 'I22' | 'I23' | 'I24' | 'I25' | 'I27' | 'PDF'

export interface Violation {
  invariant: InvariantId
  message: string
}

const MAX_REPORTED = 5
const POSITION_TOLERANCE = 1
/** Column edges come from the spec; Yoga does not round (point scale factor 0), so only float noise remains. */
const COLUMN_TOLERANCE = 0.5
/** A link rectangle and its line: vertical slack, and horizontal slack for the word estimate and a trailing space. */
const LINK_TOLERANCE_Y = 0.5
const LINK_TOLERANCE_X = 1.5
/** Boxes, widgets and metamorphic pairs: pdf.js reads path bounds as 32-bit floats, a few 0.0001 pt off. */
const BOX_TOLERANCE = 0.01

const violations = (invariant: InvariantId, messages: string[]): Violation[] => {
  if (messages.length === 0) return []
  const shown = messages.slice(0, MAX_REPORTED)
  if (messages.length > MAX_REPORTED) shown.push(`… and ${messages.length - MAX_REPORTED} more`)
  return [{ invariant, message: shown.join('; ') }]
}

// ---------------------------------------------------------------------------
// I1, I2: how a render ends.

const KNOWN_CODES = new Set<string>(Object.values(PDF_ERROR_CODES))
const ABSOLUTE_PATH = /(?:^|[\s"'`(=:])(?:\/(?:Users|home|private|tmp|var|opt|root)\/|[A-Z]:\\)/

/** I1: the render settled inside its time limit (with a PDF or a typed error). */
export const checkEnds = (elapsedMs: number, settled: boolean, limitMs: number): Violation[] =>
  violations('I1', settled
    ? elapsedMs > limitMs ? [`settled after ${Math.round(elapsedMs)} ms, limit ${limitMs} ms`] : []
    : [`did not settle within ${limitMs} ms`])

/** I2: a rejection is a NuxtPdfError with a known code and no absolute path in its message. */
export const checkTypedError = (error: unknown): Violation[] => {
  const messages: string[] = []
  if (!(error instanceof NuxtPdfError)) {
    messages.push(`untyped ${error instanceof Error ? error.name : typeof error}: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`)
  }
  else {
    if (!KNOWN_CODES.has(error.code)) messages.push(`unknown code ${error.code}`)
    if (ABSOLUTE_PATH.test(error.message) || error.message.includes(process.cwd())) {
      messages.push(`absolute path in message: ${error.message.slice(0, 200)}`)
    }
  }
  return violations('I2', messages)
}

/** The flow and fixed profiles generate only valid documents: each must render. */
export const checkRendered = (error: unknown): Violation[] =>
  violations('PDF', [`valid document rejected: ${error instanceof NuxtPdfError ? `${error.code} ` : ''}${String(error instanceof Error ? error.message : error).slice(0, 300)}`])

// ---------------------------------------------------------------------------
// The token view of a PDF.

const NUMBER_WORD = /^([ncr]\d+p)(\d*)$/
/** An Arabic word of a right-to-left text (rtl-subset-glyphs): not a token; I18 checks it. */
const RTL_WORD = /^[\u0600-\u06FF]+$/

export interface TokenView {
  /** Every occurrence of each known token. */
  tokens: Map<string, Word[]>
  numbers: Map<string, Array<{ word: Word, value: number | undefined }>>
  unknown: Word[]
  /** notes: the bare numbers, marks and note numbers. */
  digits: Word[]
  pageCount: number
  /** Index of the PdfPage element each PDF page belongs to (1-based pages, index 0 unused). */
  pdfPageOf: number[]
}

export const tokenView = (expectations: Expectations, read: ReadPdf): TokenView => {
  const tokens = new Map<string, Word[]>()
  const numbers = new Map<string, Array<{ word: Word, value: number | undefined }>>()
  const unknown: Word[] = []
  const digits: Word[] = []
  const prefixes = new Set(expectations.numbers.map(number => number.prefix))
  for (const word of read.words) {
    if (expectations.tokens.has(word.text)) {
      tokens.set(word.text, [...tokens.get(word.text) ?? [], word])
      continue
    }
    const match = NUMBER_WORD.exec(word.text)
    if (match && prefixes.has(match[1]!)) {
      numbers.set(match[1]!, [...numbers.get(match[1]!) ?? [], { word, value: match[2] ? Number(match[2]) : undefined }])
      continue
    }
    if (expectations.notes && /^\d+$/.test(word.text)) {
      digits.push(word)
      continue
    }
    // pdf.js reads the dots of the Arabic subset as control characters (pdfjsArabicLetters).
    const letters = pdfjsArabicLetters(word.text)
    if (expectations.rtl.length > 0 && (letters === '' || RTL_WORD.test(letters))) continue
    unknown.push(word)
  }
  // First PDF page of each PdfPage: the page of its marker.
  const firstPages = expectations.markers.map((marker) => {
    const page = tokens.get(marker)?.[0]?.page ?? numbers.get(marker)?.[0]?.word.page
    return page ?? Number.NaN
  })
  const pageCount = read.parsed.pageCount
  const pdfPageOf = [-1]
  for (let page = 1; page <= pageCount; page += 1) {
    let owner = 0
    firstPages.forEach((first, index) => {
      if (first <= page) owner = index
    })
    pdfPageOf.push(owner)
  }
  return { tokens, numbers, unknown, digits, pageCount, pdfPageOf }
}

/** PDF pages of one PdfPage element, in order. */
const pagesOf = (view: TokenView, pdfPage: number): number[] => {
  const pages: number[] = []
  for (let page = 1; page <= view.pageCount; page += 1) {
    if (view.pdfPageOf[page] === pdfPage) pages.push(page)
  }
  return pages
}

const describeWord = (word: Word): string => `p${word.page} (${word.x.toFixed(1)}, ${word.y.toFixed(1)})`

// ---------------------------------------------------------------------------
// I3: each flow and table-row token exactly once; no text the generator did not write.

const onceKinds = new Set<TokenFact['kind']>(['flow', 'cell'])

export const checkFlowTokensOnce = (expectations: Expectations, view: TokenView): Violation[] => {
  const messages: string[] = []
  for (const fact of expectations.tokens.values()) {
    if (!onceKinds.has(fact.kind)) continue
    const count = view.tokens.get(fact.token)?.length ?? 0
    if (count !== 1) messages.push(`${fact.token} ${count === 0 ? 'missing' : `${count} times (${view.tokens.get(fact.token)!.map(describeWord).join(', ')})`}`)
  }
  for (const number of expectations.numbers) {
    if (number.fixed) continue
    const count = view.numbers.get(number.prefix)?.length ?? 0
    if (count !== 1) messages.push(`${number.prefix}… ${count === 0 ? 'missing' : `${count} times`}`)
  }
  for (const word of view.unknown) messages.push(`unexpected text "${word.text}" at ${describeWord(word)}`)
  return violations('I3', messages)
}

// ---------------------------------------------------------------------------
// I4: flow tokens of one column in document order; a table is one unit. In a
// column container, a later column of a segment reads after an earlier one
// on its page (`placedAfter`).

interface Placed {
  name: string
  order: number
  word: Word
  column?: Column
}

// ---------------------------------------------------------------------------
// Columns (the notes profile): where a token of a column
// container sits. Column k of a container spans [left + k (w + gap), + w],
// w = (width - (count - 1) gap) / count, from the spec. Its segment is the
// run of children between two that span all columns (a spanning child is a
// segment of its own).

interface Column {
  /** Container and segment: tokens with one key share their columns. */
  key: string
  index: number
  span: boolean
  fact: ColumnFact
}

const columnWidthOf = (fact: ColumnFact): number => (fact.width - (fact.count - 1) * fact.gap) / fact.count

/** The column that holds `x`; callers pass a word's middle, since its left edge can sit on a column edge when the gap is 0. */
const columnIndex = (fact: ColumnFact, x: number): number =>
  Math.min(fact.count - 1, Math.max(0, Math.floor((x - fact.left + fact.gap / 2) / (columnWidthOf(fact) + fact.gap))))

const columnOf = (expectations: Expectations, token: string, word: Word): Column | undefined => {
  const lane = expectations.tokens.get(token)?.lane
  if (!lane) return undefined
  const fact = expectations.columns[lane.container]!
  return { key: `${lane.container}:${lane.segment}`, index: lane.span ? 0 : columnIndex(fact, word.x + word.width / 2), span: lane.span, fact }
}

/** Reading order with columns: on one page, a later column of the same segment reads after an earlier one. */
const placedAfter = (a: Placed, b: Placed): boolean => {
  if (a.column && b.column && a.column.key === b.column.key && a.word.page === b.word.page && a.column.index !== b.column.index) return a.column.index < b.column.index
  return readsAfter(a.word, b.word)
}

const flowPlacements = (expectations: Expectations, view: TokenView): Placed[] => {
  const placed: Placed[] = []
  for (const fact of expectations.tokens.values()) {
    const words = view.tokens.get(fact.token)
    if (!onceKinds.has(fact.kind) || words?.length !== 1) continue
    const column = columnOf(expectations, fact.token, words[0]!)
    placed.push({ name: fact.token, order: fact.order, word: words[0]!, ...(column ? { column } : {}) })
  }
  for (const number of expectations.numbers) {
    const found = view.numbers.get(number.prefix)
    if (!number.fixed && found?.length === 1) placed.push({ name: number.prefix, order: number.order, word: found[0]!.word })
  }
  return placed.sort((a, b) => a.order - b.order)
}

/** True when `b` is painted after `a` in reading order of one column. */
const readsAfter = (a: Word, b: Word): boolean => {
  if (a.page !== b.page) return a.page < b.page
  const tolerance = 0.3 * Math.min(a.fontSize, b.fontSize)
  if (Math.abs(a.y - b.y) > tolerance) return a.y > b.y
  return b.x > a.x - 0.5
}

/** The word read last of a list. */
const lastRead = (words: readonly Word[]): Word => words.reduce((last, word) => readsAfter(last, word) ? word : last)
const firstRead = (words: readonly Word[]): Word => words.reduce((first, word) => readsAfter(word, first) ? word : first)

export const checkDocumentOrder = (expectations: Expectations, view: TokenView): Violation[] => {
  // Tokens with one order value form a unit (a table): the next unit starts
  // after the unit's last word. Inside a table, I9 orders the rows.
  const units: Array<{ name: string, first: Placed, last: Placed }> = []
  let current: { order: number, placed: Placed[] } | undefined
  const close = () => {
    if (!current) return
    const first = current.placed.reduce((first, placed) => placedAfter(placed, first) ? placed : first)
    const last = current.placed.reduce((last, placed) => placedAfter(last, placed) ? placed : last)
    units.push({ name: current.placed.length > 1 ? `${first.name}…${last.name}` : first.name, first, last })
  }
  for (const placed of flowPlacements(expectations, view)) {
    if (current?.order === placed.order) {
      current.placed.push(placed)
      continue
    }
    close()
    current = { order: placed.order, placed: [placed] }
  }
  close()
  const messages: string[] = []
  for (let index = 1; index < units.length; index += 1) {
    const a = units[index - 1]!
    const b = units[index]!
    if (!placedAfter(a.last, b.first)) messages.push(`${b.name} at ${describeWord(b.first.word)} before ${a.name} at ${describeWord(a.last.word)}`)
  }
  return violations('I4', messages)
}

// ---------------------------------------------------------------------------
// I5: text inside the page, flow text inside the page padding.

const runKind = (run: Run, expectations: Expectations, numberFacts: Map<string, NumberFact>): 'flow' | 'absolute' | 'unknown' => {
  let kind: 'flow' | 'absolute' | 'unknown' = 'unknown'
  for (const text of run.words) {
    const fact: TokenFact | NumberFact | undefined = expectations.tokens.get(text) ?? numberFacts.get(NUMBER_WORD.exec(text)?.[1] ?? '')
    if (!fact) continue
    if (fact.absolute) return 'absolute'
    kind = 'flow'
  }
  return kind
}

export const checkInsidePage = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const messages: string[] = []
  const numberFacts = new Map(expectations.numbers.map(number => [number.prefix, number]))
  for (const page of read.parsed.pages) {
    const pageSpec = spec.pages[view.pdfPageOf[page.number] ?? 0]!
    const { width, height } = pageGeometry(pageSpec)
    if (Math.abs(page.width - width) > POSITION_TOLERANCE || Math.abs(page.height - height) > POSITION_TOLERANCE) {
      messages.push(`page ${page.number} is ${page.width}×${page.height}, expected ${width.toFixed(2)}×${height.toFixed(2)}`)
    }
  }
  for (const run of read.runs) {
    const page = read.parsed.pages[run.page - 1]!
    const kind = runKind(run, expectations, numberFacts)
    // The top of the glyphs: cap height of Helvetica is 0.718 em.
    const top = run.y + 0.6 * run.fontSize
    const right = run.x + run.width
    const label = `"${run.words.slice(0, 3).join(' ')}" on p${run.page} x ${run.x.toFixed(1)}–${right.toFixed(1)}, y ${run.y.toFixed(1)}`
    // pdf.js shifts and widens a run around a glyph that maps to no characters
    // (it reads it as a control character, pdfjsArabicLetters): up to 1.7 pt at
    // 10 pt while the ink stays inside. Such a run is checked vertically only,
    // against the page as against the padding.
    const horizontal = ![...run.text].some(character => character < ' ')
    if ((horizontal && (run.x < -POSITION_TOLERANCE || right > page.width + POSITION_TOLERANCE)) || run.y < -POSITION_TOLERANCE || top > page.height + POSITION_TOLERANCE) {
      messages.push(`${label} outside the ${page.width}×${page.height} page`)
      continue
    }
    if (kind !== 'flow') continue
    const [padTop, padRight, padBottom, padLeft] = spec.pages[view.pdfPageOf[run.page] ?? 0]!.padding
    if ((horizontal && (run.x < padLeft - POSITION_TOLERANCE || right > page.width - padRight + POSITION_TOLERANCE))
      || run.y < padBottom - POSITION_TOLERANCE || top > page.height - padTop + POSITION_TOLERANCE) {
      messages.push(`${label} outside the padding ${padTop}/${padRight}/${padBottom}/${padLeft}`)
    }
  }
  return violations('I5', messages)
}

// ---------------------------------------------------------------------------
// I6: an unbreakable block that fits a page stays on one page.

export const checkUnbreakable = (expectations: Expectations, view: TokenView): Violation[] => {
  const pages = new Map<number, Map<number, string>>()
  for (const placed of flowPlacements(expectations, view)) {
    const fact = expectations.tokens.get(placed.name) ?? expectations.numbers.find(number => number.prefix === placed.name)
    if (fact?.block === undefined) continue
    const seen = pages.get(fact.block) ?? new Map<number, string>()
    if (!seen.has(placed.word.page)) seen.set(placed.word.page, placed.name)
    pages.set(fact.block, seen)
  }
  const messages: string[] = []
  for (const [block, seen] of pages) {
    if (seen.size > 1) messages.push(`block ${block} on pages ${[...seen].map(([page, token]) => `${page} (${token})`).join(', ')}`)
  }
  return violations('I6', messages)
}

// ---------------------------------------------------------------------------
// G1: fill. At each automatic page break of a flow or notes document, the
// first line after the break did not fit the room left on the page before,
// unless the spec explains the break.
//
// Needed room, from the spec and the line count the PDF shows: the bottom
// edges of the nodes that close after the last text on the page (its bottom
// margin, each container's bottom padding, border and margin), the top edges
// of the nodes that open before the first text after it (top margin, border,
// padding; a node that moves whole keeps its top margin), any view without
// text between the two, whole, and the lines that text needs to start a page:
// orphans and widows (2 each, the engine's default), all lines when it cannot
// split. A break drops the bottom margin of the last node that stays, but had
// the next text stayed, it would sit below that margin, so it counts here.
// Room left: from the bottom of the last line to the bottom padding.
// Explained, not measured: a `break`, a view that cannot split, a view with
// `minHeight` around either text (its box is not its content), unless the
// minimum is at most its padding and borders, which no box is below.
//
// On a page with notes, the room ends at the top of the note area: its top
// margin and rule above the first note line. The lines that would have stayed
// bring the notes of their marks, as the footnote fit counts them: each whole
// but the last, which counts the lines it needs to start (orphans and widows
// again); the area's top margin and rule when the page has no notes yet; and,
// since only the last note may be cut, the rest of each note the page cuts.
//
// Notes that wait: on a page after which a note whose mark is on it or on an
// earlier page still starts later, and whose own notes all end on it, the
// first waiting note did not fit the room left below the lowest flow line box
// (or the content top) and above the note area (or the bottom padding): the
// area's top margin and rule when the page has no notes, and the lines the
// note needs to start, as the fit counts them (its orphans, or all of its
// lines when it is short; a forced page starts a note with one line, so this
// is the lenient side). A page whose last note goes on to the next page is
// left out: the waiting notes come after that note's rest.
//
// In a column container, a break before a segment needs the segment's first
// chunk (`chunkAt`) with the notes of the chunks every column takes at that
// height (`fillAt`), and one after a segment leaves the
// room below its lowest column. A break inside a segment is measured as
// fullness: see the end of `checkFill`. A forced page is left out of this
// column part: it keeps the least of its flow that holds a line (CONFORMANCE,
// Footnotes). Only a forced fit leaves a note of its marks to a later page or
// starts one with fewer lines than its start needs, so the note lines show it.
//
// A line is as high as its line height, else its font's ascent minus descent
// (Helvetica in the engine: 0.9 and -0.2 em; Roboto in a tagged document:
// 1900 and -500 of 2048 units), and its baseline lies the ascent below its top.
// A raised mark or note number (70 %, a third of the text's size up) lifts the
// top of its line (`lineBoxOf`).

const ORPHANS = 2
const WIDOWS = 2
/** Room left beyond what is needed before a break counts as a violation. */
const FILL_TOLERANCE = 1

interface FlowText {
  text: TextSpec
  /** Containers from the page down: views and block links. */
  path: Array<ViewSpec | { kind: 'link' }>
  /** Height of the views without text before this text, in document order. */
  emptyBefore: number
}

const hasText = (node: NodeSpec): boolean =>
  node.kind === 'text' || ((node.kind === 'view' || node.kind === 'link') && node.children.some(hasText))

const flowTexts = (spec: DocumentSpec): Map<string, FlowText> => {
  const byToken = new Map<string, FlowText>()
  let empty = 0
  const walk = (node: NodeSpec, path: FlowText['path']) => {
    if (node.kind === 'text') {
      for (const token of node.tokens) byToken.set(token, { text: node, path, emptyBefore: empty })
      return
    }
    if (node.kind === 'view' && !hasText(node)) {
      empty += node.margin[0] + Math.max(node.minHeight, node.padding[0] + node.padding[2] + 2 * node.border) + node.margin[2]
      return
    }
    if (node.kind === 'view') node.children.forEach(child => walk(child, [...path, node]))
    if (node.kind === 'link') {
      const link = { kind: 'link' as const }
      node.children.forEach(child => walk(child, [...path, link]))
    }
  }
  for (const page of spec.pages) page.children.forEach(child => walk(child, []))
  return byToken
}

/** A view whose `minHeight` can make its box higher than its content: more than its padding and borders. */
const setsBox = (view: ViewSpec): boolean => view.minHeight > view.padding[0] + view.padding[2] + 2 * view.border

const HELVETICA_LINE = { ascent: 0.9, height: 1.1 }
const ROBOTO_LINE = { ascent: 1900 / 2048, height: 2400 / 2048 }
type LineMetrics = typeof HELVETICA_LINE

const lineHeightOf = (text: TextSpec, metrics: LineMetrics): number => text.fontSize * (text.lineHeight ?? metrics.height)

/** The lines of some tokens in the PDF, in order: page, baseline and words. */
const linesOf = (tokens: readonly string[], fontSize: number, view: TokenView): Array<{ page: number, y: number, words: Word[] }> => {
  const lines: Array<{ page: number, y: number, words: Word[] }> = []
  for (const word of tokens.flatMap(token => view.tokens.get(token) ?? [])) {
    const line = lines.find(line => line.page === word.page && Math.abs(line.y - word.y) < 0.3 * fontSize)
    if (line) line.words.push(word)
    else lines.push({ page: word.page, y: word.y, words: [word] })
  }
  return lines.sort((a, b) => a.page - b.page || b.y - a.y)
}

/** The area's top margin and rule (`footnoteStyles`; the engine's defaults: 8 pt, and a 0.5 pt rule with 4 pt below it). The generator's area styles set no padding and no gap between notes. */
const noteAreaTopOf = (spec: DocumentSpec): number => {
  const styles = spec.footnotes?.styles as { rule?: unknown, area?: { marginTop?: number } } | undefined
  return (styles?.area?.marginTop ?? 8) + (styles?.rule === false ? 0 : 0.5 + 4)
}

/** How far a note's number lifts its first line: the number is 70 % of the note text and a third of it up. */
const numberLift = (fontSize: number, metrics: LineMetrics): number => Math.max(0, fontSize / 3 + 0.7 * metrics.ascent * fontSize - metrics.ascent * fontSize)

export const checkFill = (spec: DocumentSpec, expectations: Expectations, view: TokenView): Violation[] => {
  if (spec.profile !== 'flow' && spec.profile !== 'notes') return []
  const metrics = spec.tagged ? ROBOTO_LINE : HELVETICA_LINE
  const texts = flowTexts(spec)
  const placed = [...expectations.tokens.values()]
    .filter(fact => fact.kind === 'flow' && view.tokens.get(fact.token)?.length === 1)
    .sort((a, b) => a.order - b.order)
    .map(fact => ({ token: fact.token, word: view.tokens.get(fact.token)![0]! }))
  const spaced = (text: TextSpec) => ({ tokens: text.tokens, fontSize: text.fontSize, height: lineHeightOf(text, metrics), ascent: metrics.ascent * text.fontSize, descent: (metrics.height - metrics.ascent) * text.fontSize, set: text.lineHeight !== undefined })
  // The notes as the PDF shows them: their lines, and the page each starts on.
  const notes = (expectations.notes ?? []).flatMap((note) => {
    const words = note.tokens.map(token => view.tokens.get(token))
    const mark = view.tokens.get(note.mark)
    if (mark?.length !== 1 || words.some(found => found?.length !== 1)) return []
    const fontSize = words[0]![0]!.fontSize
    return [{ mark: mark[0]!, fontSize, start: words[0]![0]!.page, lines: linesOf(note.tokens, fontSize, view) }]
  })
  const noteHeight = (note: typeof notes[number], count: number) =>
    count * note.fontSize * metrics.height + numberLift(note.fontSize, metrics)
  /** The room the notes of `brought` marks need on `page`, as the fit counts it. */
  const noteNeedOf = (page: number, brought: typeof notes): number => {
    if (brought.length === 0) return 0
    const here = notes.filter(note => note.lines.some(line => line.page === page))
    return (here.length === 0 ? noteAreaTopOf(spec) : 0)
      + brought.reduce((sum, note, at) => {
        const count = note.lines.length
        return sum + noteHeight(note, at === brought.length - 1 && count >= ORPHANS + WIDOWS ? ORPHANS : count)
      }, 0)
      + here.reduce((sum, note) => sum + note.lines.filter(line => line.page > page).length * note.fontSize * metrics.height, 0)
  }
  /** Where the room on a page ends: the top of its note area, else its bottom padding. */
  const roomEndOf = (page: number): number => {
    const here = notes.filter(note => note.lines.some(line => line.page === page))
    const top = here.flatMap(note => note.lines.filter(line => line.page === page).map(line => ({ note, line }))).sort((x, y) => y.line.y - x.line.y)[0]
    if (!top) return spec.pages[view.pdfPageOf[page] ?? 0]!.padding[2]
    const lift = top.note.start === page && top.line === top.note.lines[0] ? numberLift(top.note.fontSize, metrics) : 0
    return top.line.y + metrics.ascent * top.note.fontSize + lift + noteAreaTopOf(spec)
  }
  const units = expectations.columns.length > 0 ? columnUnits(spec, expectations, view) : []
  const segments = segmentsOf(units)
  const keyOf = (token: string): string | undefined => {
    const lane = expectations.tokens.get(token)?.lane
    return lane && !lane.span ? `${lane.container}:${lane.segment}` : undefined
  }
  const messages: string[] = []
  for (let index = 1; index < placed.length; index += 1) {
    const a = placed[index - 1]!
    const b = placed[index]!
    if (b.word.page !== a.word.page + 1 || view.pdfPageOf[a.word.page] !== view.pdfPageOf[b.word.page]) continue
    // A break inside a segment of columns: fullness below. A segment that
    // starts after the break needs its first chunk in its first column; one
    // that ends before it leaves the room below its lowest column.
    const keyA = keyOf(a.token)
    const keyB = keyOf(b.token)
    if (keyA !== undefined && keyA === keyB) continue
    const before = texts.get(a.token)
    const after = texts.get(b.token)
    if (!before || !after) continue
    let shared = 0
    while (shared < before.path.length && shared < after.path.length && before.path[shared] === after.path[shared]) shared += 1
    const closing = before.path.slice(shared).reverse()
    const opening = after.path.slice(shared)
    const same = before.text === after.text
    if (!same && (after.text.brk || opening.some(node => node.kind === 'view' && (node.brk || !node.wrap || setsBox(node))))) continue
    if (closing.some(node => node.kind === 'view' && setsBox(node))) continue
    const edges = (same ? 0 : before.text.marginBottom + after.text.marginTop + after.emptyBefore - before.emptyBefore)
      + closing.reduce((sum, node) => sum + (node.kind === 'view' ? node.padding[2] + node.border + node.margin[2] : 0), 0)
      + opening.reduce((sum, node) => sum + (node.kind === 'view' ? node.margin[0] + node.border + node.padding[0] : 0), 0)
    let starting: number
    let lineNeed: number
    let brought: typeof notes
    const segmentB = keyB === undefined ? undefined : segments.get(keyB)
    if (segmentB) {
      const at = segmentB.findIndex(unit => unit.words.includes(b.word))
      // The least start fills every column in order at the first chunk's
      // height, so the later columns bring their chunks' notes too.
      const chunk = chunkAt(segmentB, at, true)
      const fill = fillAt(segmentB, at, segmentB[at]!.column.fact.count, chunk.height)
      const words = new Set(segmentB.slice(at, fill.next).flatMap(unit => unit.words))
      starting = fill.next - at
      lineNeed = chunk.height
      brought = notes.filter(note => words.has(note.mark))
    }
    else {
      const lines = linesOf(after.text.tokens, after.text.fontSize, view)
      const later = lines.filter(line => line.page > a.word.page)
      if (same) {
        // Lines of the text after the page: moving one up must leave no widow.
        starting = later.length === 1 || later.length - 1 >= WIDOWS ? 1 : later.length
      }
      else {
        starting = !after.text.wrap || lines.length < ORPHANS + WIDOWS ? lines.length : ORPHANS
      }
      const moved = later.slice(0, starting)
      lineNeed = moved.reduce((sum, line) => {
        const box = lineBoxOf(spaced(after.text), line.words, view)
        return sum + box.top - box.bottom
      }, 0)
      // The notes the lines that would have stayed bring.
      brought = notes.filter(note => moved.some(line => line.page === note.mark.page && Math.abs(line.y - note.mark.y) < 0.3 * after.text.fontSize))
    }
    const noteNeed = noteNeedOf(a.word.page, brought)
    const need = edges + lineNeed + noteNeed
    const segmentA = keyA === undefined ? undefined : segments.get(keyA)
    const lastBottom = segmentA
      ? Math.min(...segmentA.filter(unit => unit.page === a.word.page).map(unit => unit.bottom))
      : lineBoxOf(spaced(before.text), linesOf(before.text.tokens, before.text.fontSize, view).find(line => line.page === a.word.page && Math.abs(line.y - a.word.y) < 0.3 * before.text.fontSize)!.words, view).bottom
    const room = lastBottom - roomEndOf(a.word.page)
    if (room - need > FILL_TOLERANCE) {
      messages.push(`${b.token} starts p${b.word.page} after ${a.token} (p${a.word.page}): ${room.toFixed(1)} pt left, ${need.toFixed(1)} needed (${starting} line${starting === 1 ? '' : 's'}, edges ${edges.toFixed(1)}, notes ${noteNeed.toFixed(1)})`)
    }
  }
  // Columns: on a page that a segment goes on after, the next height is the
  // lowest above its highest column at which the columns, filled in order,
  // take a unit of the next page (`fillAt`). It must not fit with the notes
  // that unit brings. The need grows with the height, so one height is
  // enough. Forced pages are left out (see above).
  const forced = new Set<number>()
  for (const note of notes) {
    const count = note.lines.length
    const starting = note.lines.filter(line => line.page === note.start).length
    if (note.start > note.mark.page || starting < (count >= ORPHANS + WIDOWS ? ORPHANS : count)) forced.add(note.mark.page)
  }
  for (const { key, page, segment, first, last, top, heights } of crossingsOf(units, view)) {
    if (forced.has(page)) continue
    const room = top - roomEndOf(page)
    let height = Math.max(...heights)
    let fill = fillAt(segment, first, heights.length, height)
    while (fill.next <= last + 1) {
      const next = Math.min(...fill.events.filter(event => event > height + FIT_EPS))
      if (!Number.isFinite(next) || next > room + FILL_TOLERANCE) break
      height = next
      fill = fillAt(segment, first, heights.length, height)
    }
    if (fill.next <= last + 1) continue
    const words = new Set(segment.slice(last + 1, fill.next).flatMap(unit => unit.words))
    const noteNeed = noteNeedOf(page, notes.filter(note => words.has(note.mark)))
    if (room - height - noteNeed > FILL_TOLERANCE) {
      messages.push(`p${page}: segment ${key} ends its columns at ${Math.max(...heights).toFixed(1)} pt; at ${height.toFixed(1)} pt they take ${fill.next - last - 1} more unit${fill.next - last - 1 === 1 ? '' : 's'} from p${page + 1} (from ${segment[last + 1]!.token}), with ${noteNeed.toFixed(1)} pt of notes, and ${room.toFixed(1)} pt are free`)
    }
  }
  if (notes.length > 0 && notes.length === expectations.notes?.length) {
    const lowest = new Map<number, number>()
    for (const text of new Set([...texts.values()].map(flow => flow.text))) {
      for (const line of linesOf(text.tokens, text.fontSize, view)) lowest.set(line.page, Math.min(lowest.get(line.page) ?? Number.POSITIVE_INFINITY, lineBoxOf(spaced(text), line.words, view).bottom))
    }
    const lastStart = Math.max(...notes.map(note => note.start))
    for (let page = 1; page < lastStart; page += 1) {
      const waiting = notes.filter(note => note.mark.page <= page && note.start > page)
      if (waiting.length === 0) continue
      const here = notes.filter(note => note.lines.some(line => line.page === page))
      if (here.some(note => note.lines.some(line => line.page > page))) continue
      const first = waiting[0]!
      const count = first.lines.length
      const starting = count >= ORPHANS + WIDOWS ? ORPHANS : count
      const need = (here.length === 0 ? noteAreaTopOf(spec) : 0) + noteHeight(first, starting)
      const pageSpec = spec.pages[view.pdfPageOf[page] ?? 0]!
      const top = lowest.get(page) ?? pageGeometry(pageSpec).height - pageSpec.padding[0]
      const room = top - roomEndOf(page)
      if (room - need > FILL_TOLERANCE) {
        messages.push(`p${page}: note ${notes.indexOf(first) + 1} (mark on p${first.mark.page}) waits for p${first.start}, but ${room.toFixed(1)} pt are free below the flow and its start needs ${need.toFixed(1)} (${starting} line${starting === 1 ? '' : 's'})`)
      }
    }
  }
  return violations('G1', messages)
}

// ---------------------------------------------------------------------------
// G4: work bound. The work a render counts (engine/work.ts, read as
// test/work-budget.test.ts reads it) grows with the document's pages and
// nodes, not faster: per page for the counters of a page's split
// (`pageRelayouts`, `noteFits`, `columnBalanceTries`), per page and node for
// the counters that walk nodes (`nodesLaidOut`, `keepSteps`). A cost that
// grows faster, such as a layout of a page's whole rest on every page,
// passes its bound in a long enough document.
//
// Each bound is about 1.5 times the highest ratio over 300 generated
// documents of the profile (seed 20261116); for the notes profile, over 600
// (seeds 20261116 ×300, 5 and 19 ×150), split into the documents with and
// without a column container. A counter that no document of a profile uses
// has the bound 0: only the notes profile writes columns, no profile writes
// keeps, and only the notes profile has footnotes. A notes document with a
// column container has bounds of its own: each try of the footnote fit on a
// column page balances its columns and lays the page out again, and its
// search steps to each height at which any column changes, so such a page
// costs several times a page without columns. Its highest: 66.7 page
// relayouts and 29.3 balance tries per page (one 3-page document, the next
// 33.3 and 11), 9.1 note fits, 27.6 nodes laid out per page and node. Its
// relayout bound stays 86, under 1.5 times that one document.

type WorkCounter = 'pageRelayouts' | 'noteFits' | 'columnBalanceTries' | 'nodesLaidOut' | 'keepSteps'
export type Work = Readonly<Record<WorkCounter, number> & { pages: number }>

const PER_PAGE: ReadonlySet<WorkCounter> = new Set(['pageRelayouts', 'noteFits', 'columnBalanceTries'])

const WORK_BOUNDS: Readonly<Record<Profile, Readonly<Record<WorkCounter, number>>>> = {
  flow: { pageRelayouts: 3, noteFits: 0, columnBalanceTries: 0, nodesLaidOut: 11, keepSteps: 0 },
  fixed: { pageRelayouts: 15, noteFits: 0, columnBalanceTries: 0, nodesLaidOut: 54, keepSteps: 0 },
  table: { pageRelayouts: 9, noteFits: 0, columnBalanceTries: 0, nodesLaidOut: 46, keepSteps: 0 },
  mixed: { pageRelayouts: 18, noteFits: 0, columnBalanceTries: 0, nodesLaidOut: 72, keepSteps: 0 },
  notes: { pageRelayouts: 9, noteFits: 12, columnBalanceTries: 0, nodesLaidOut: 28, keepSteps: 0 },
}
const NOTES_COLUMN_BOUNDS: Readonly<Record<WorkCounter, number>> = { pageRelayouts: 86, noteFits: 14, columnBalanceTries: 44, nodesLaidOut: 41, keepSteps: 0 }

const hasColumns = (spec: DocumentSpec): boolean =>
  spec.pages.some(page => page.columns !== undefined || page.children.some(child => child.kind === 'view' && child.columns !== undefined))

/** The nodes the template writes: pages and their fixed nodes, views, links, texts and their notes, boxes, tables with their header cells, rows and cells. */
const nodesOf = (spec: DocumentSpec): number => {
  const count = (node: NodeSpec): number => {
    if (node.kind === 'view' || node.kind === 'link') return 1 + node.children.reduce((sum, child) => sum + count(child), 0)
    if (node.kind === 'table') return 1 + (node.header?.length ?? 0) + node.rows.reduce((sum, row) => sum + 1 + row.cells.length, 0)
    if (node.kind === 'text') return 1 + (node.notes?.length ?? 0)
    return 1
  }
  return spec.pages.reduce((sum, page) => sum + 1 + page.fixed.length + page.children.reduce((total, child) => total + count(child), 0), 0)
}

export const checkWork = (spec: DocumentSpec, work: Work): Violation[] => {
  const nodes = nodesOf(spec)
  const messages: string[] = []
  const bounds = spec.profile === 'notes' && hasColumns(spec) ? NOTES_COLUMN_BOUNDS : WORK_BOUNDS[spec.profile]
  for (const [counter, bound] of Object.entries(bounds) as Array<[WorkCounter, number]>) {
    const perPage = PER_PAGE.has(counter)
    const ratio = work[counter] / (perPage ? work.pages : work.pages + nodes)
    if (ratio > bound) messages.push(`${counter} ${work[counter]}: ${ratio.toFixed(2)} per ${perPage ? 'page' : 'page and node'} (${work.pages} pages, ${nodes} nodes), bound ${bound}`)
  }
  return violations('G4', messages)
}

// ---------------------------------------------------------------------------
// G2: no squeeze, no overlap. On one page: the lines of one text are at
// least its line height apart, the line boxes of two texts do not overlap,
// and no two text runs overlap.
//
// A line box is as high as the text's line height (× its font size), else
// its font's ascent minus descent, and its top lies the ascent and the
// half-leading above the baseline (G1, `lineBoxOf`). A text in a face or script font is left out of the line
// boxes, and of the spacing too when it has no line height: its font's
// metrics are not listed here. A run covers its width from its baseline up
// to 0.7 em. Left out of both overlap checks: absolute fixed texts (the
// generator puts them in the padding band, where they may meet a line box)
// and runs with a glyph pdf.js reads as a control character (it widens and
// shifts the run, see I5).

/** How much closer two lines may be than their line height, and line boxes may overlap. */
const SQUEEZE_TOLERANCE = 0.1
/** How far two runs, or two line boxes side by side, may reach into each other (kerning, rounding). */
const OVERLAP_TOLERANCE = 0.5

interface SpacedText {
  tokens: string[]
  fontSize: number
  /** The line height in pt. */
  height: number
  /** The ascent and the descent in pt, when the font is known. */
  ascent?: number
  descent?: number
  /** The line height is the text's own: a line is that high, unless a raised mark lifts its top so far that it needs more (`lineBoxOf`). */
  set: boolean
}

/**
 * Where a line box of a text with a known font starts and ends. Its top lies
 * the ascent and the half-leading above the baseline: half of what the
 * text's own line height adds to the glyph box (ascent plus descent), 0
 * without one, negative when it is less (CSS). A raised footnote mark on the
 * line (a smaller bare number above the baseline) has the same line height
 * factor at its size, so its own ascent and half-leading lift the top when
 * they reach higher. A line with the text's own line height is that high, or,
 * with a raised mark, as high as the glyphs' highest top and the font's
 * descent when that is more (a 9 pt line of 9 pt text with a mark is 10.47
 * pt); otherwise it ends at the font's descent below the baseline.
 */
const lineBoxOf = (text: SpacedText & { ascent: number, descent: number }, words: readonly Word[], view: TokenView): { top: number, bottom: number } => {
  const y = words[0]!.y
  const left = Math.min(...words.map(word => word.x))
  const right = Math.max(...words.map(word => word.x + word.width)) + text.fontSize
  const marks = view.digits.filter(digit => digit.page === words[0]!.page && digit.fontSize < text.fontSize && digit.x >= left && digit.x <= right && digit.y > y && digit.y < y + 0.8 * text.fontSize)
  const halfLeading = text.set ? (text.height - text.ascent - text.descent) / 2 : 0
  const reach = (above: number) => Math.max(above, ...marks.map(mark => mark.y - y + above / text.fontSize * mark.fontSize))
  const top = y + reach(text.ascent + halfLeading)
  const natural = reach(text.ascent) + text.descent
  return { top, bottom: top - (!text.set ? natural : marks.length > 0 ? Math.max(text.height, natural) : text.height) }
}

const spacedTexts = (spec: DocumentSpec, absolute: ReadonlySet<string>): SpacedText[] => {
  const metrics = spec.tagged ? ROBOTO_LINE : HELVETICA_LINE
  const texts: SpacedText[] = []
  const plain = (tokens: string[], fontSize: number, lineHeight?: number) =>
    texts.push({ tokens, fontSize, height: fontSize * (lineHeight ?? metrics.height), ascent: fontSize * metrics.ascent, descent: fontSize * (metrics.height - metrics.ascent), set: lineHeight !== undefined })
  const cells = (row: CellSpec[] | undefined, fontSize: number) => row?.forEach(cell => plain(cell.tokens, fontSize))
  const walk = (node: NodeSpec) => {
    if (node.kind === 'text') {
      if (!node.script && !node.face) plain(node.tokens, node.fontSize, node.lineHeight)
      else if (node.lineHeight !== undefined) texts.push({ tokens: node.tokens, fontSize: node.fontSize, height: node.fontSize * node.lineHeight, set: true })
    }
    if (node.kind === 'view') node.children.forEach(walk)
    if (node.kind === 'link') node.children.forEach(walk)
    if (node.kind === 'table') {
      cells(node.header, node.fontSize)
      node.rows.forEach(row => cells(row.cells, node.fontSize))
    }
  }
  for (const page of spec.pages) {
    page.children.forEach(walk)
    for (const fixed of page.fixed) {
      if (!fixed.tokens.some(token => absolute.has(token))) plain(fixed.tokens, fixed.fontSize)
    }
  }
  return texts
}

interface LineBox {
  text: number
  page: number
  token: string
  left: number
  right: number
  top: number
  bottom: number
}

/** Pairs of one page that overlap by more than the tolerances across and up. */
const overlapping = <Item extends { page: number }>(items: readonly Item[], across: (a: Item, b: Item) => number, up: (a: Item, b: Item) => number, upTolerance: number, skip: (a: Item, b: Item) => boolean = () => false): Array<[Item, Item]> => {
  const pairs: Array<[Item, Item]> = []
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const first = items[a]!
      const second = items[b]!
      if (first.page !== second.page || skip(first, second)) continue
      if (across(first, second) > OVERLAP_TOLERANCE && up(first, second) > upTolerance) pairs.push([first, second])
    }
  }
  return pairs
}

export const checkSpacing = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const messages: string[] = []
  const absolute = new Set([...expectations.tokens.values()].filter(fact => fact.absolute).map(fact => fact.token))
  const boxes: LineBox[] = []
  spacedTexts(spec, absolute).forEach((text, index) => {
    // In a column container, the lines of one text are compared within a column.
    const lines: Array<{ page: number, y: number, column: number, token: string, words: Word[] }> = []
    for (const token of text.tokens) {
      for (const word of view.tokens.get(token) ?? []) {
        const column = columnOf(expectations, token, word)?.index ?? 0
        const line = lines.find(line => line.page === word.page && line.column === column && Math.abs(line.y - word.y) < 0.3 * text.fontSize)
        if (line) line.words.push(word)
        else lines.push({ page: word.page, y: word.y, column, token, words: [word] })
      }
    }
    lines.sort((a, b) => a.page - b.page || a.column - b.column || b.y - a.y)
    const known = text.ascent === undefined || text.descent === undefined ? undefined : { ...text, ascent: text.ascent, descent: text.descent }
    const placed = lines.map(line => ({ ...line, box: known && lineBoxOf(known, line.words, view) }))
    placed.forEach((below, at) => {
      const above = placed[at - 1]
      // A line box starts at or below the bottom of the one above; without a known font, the baselines are a line height apart.
      const squeezed = above?.page === below.page && above.column === below.column && (above.box && below.box ? below.box.top > above.box.bottom + SQUEEZE_TOLERANCE : above.y - below.y < text.height - SQUEEZE_TOLERANCE)
      if (squeezed) messages.push(`${below.token} on p${below.page} ${(above.y - below.y).toFixed(2)} pt below ${above.token}, line height ${text.height.toFixed(2)}`)
      if (below.box) boxes.push({ text: index, page: below.page, token: below.token, left: Math.min(...below.words.map(word => word.x)), right: Math.max(...below.words.map(word => word.x + word.width)), ...below.box })
    })
  })
  for (const [a, b] of overlapping(boxes, (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left), (a, b) => Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom), SQUEEZE_TOLERANCE, (a, b) => a.text === b.text)) {
    messages.push(`the lines of ${a.token} and ${b.token} overlap on p${a.page} by ${(Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom)).toFixed(2)} pt`)
  }
  const numberFacts = new Map(expectations.numbers.map(number => [number.prefix, number]))
  const runs = read.runs.filter(run => ![...run.text].some(character => character < ' ')
    && !run.words.some(text => absolute.has(text) || numberFacts.get(NUMBER_WORD.exec(text)?.[1] ?? '')?.absolute))
  for (const [a, b] of overlapping(runs, (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), (a, b) => Math.min(a.y + 0.7 * a.fontSize, b.y + 0.7 * b.fontSize) - Math.max(a.y, b.y), OVERLAP_TOLERANCE)) {
    messages.push(`"${a.words.slice(0, 2).join(' ')}" and "${b.words.slice(0, 2).join(' ')}" overlap on p${a.page}`)
  }
  return violations('G2', messages)
}

// ---------------------------------------------------------------------------
// F1–F7: footnotes (the notes profile), from the positions of the marks, the
// notes' tokens and the numbers.
//
// F1: every note token once. F2: the notes in the order of their marks. F3:
// a note starts on the page of its mark, or, when its first line does not
// fit there (a forced page), later: at most one page after the note before
// it, or after its mark's page when that is later (moved notes that do not
// all start on the next page go on, in order: the engine row "warns once
// ... over two pages" in test/footnote-component.test.ts), and then every
// later note of its mark's page starts later too, and the moved notes come
// before the notes that their page has of its own; the render warns (`PDF_FOOTNOTES_MOVED`) on each page of marks
// with exactly the printed numbers of its notes that start later. F4: a note that goes on to the next
// page continues there before the notes that start there and the parts of
// later notes (a forced page can cut several). F5: on each page, the flow's
// lowest line box ends above the first note line (its top at least 0.9 em
// above its baseline; a raised number only lifts it). F6: the number before
// each note and the mark after its token are equal, counted through the
// document or from 1 on each page (`footnotes: 'page'`). F7: a mark's link
// lands on the page where its note starts, and the note number's link back
// lands on the page of its mark; both name the same note.

/**
 * The number word of a note or mark: the bare number next to a word on the
 * given side, raised on its line (not the mark of a line below), with no
 * other word between them. A justified line with no space to stretch spreads
 * its letters, the mark's too, so the gap can be wider than a space.
 */
const numberNear = (view: TokenView, word: Word, side: 'before' | 'after'): Word | undefined => {
  const gapTo = (digit: Word) => side === 'before' ? word.x - (digit.x + digit.width) : digit.x - (word.x + word.width)
  const near = view.digits
    .filter(digit => digit.page === word.page && digit.y - word.y > -0.5 && digit.y - word.y < 0.6 * word.fontSize && gapTo(digit) > -0.5)
    .sort((a, b) => gapTo(a) - gapTo(b))
  const nearest = near[0]
  if (!nearest || (near[1] && gapTo(near[1]) - gapTo(nearest) < 0.5)) return undefined
  const [from, to] = side === 'before' ? [nearest.x + nearest.width, word.x] : [word.x + word.width, nearest.x]
  const between = [...view.tokens.values()].some(found => found.some(other => other !== word && other.page === word.page
    && Math.abs(other.y - word.y) < 0.3 * word.fontSize && other.x > from - 0.5 && other.x + other.width < to + 0.5))
  return between ? undefined : nearest
}

/** The ids the notes of footnotes get (the engine rejects them on author texts). */
const FOOTNOTE_ID_PREFIX = '__nuxtPdfFootnote-'
/** The suffix of the id on a note's first mark, which the note's number links back to. */
const MARK_ID_SUFFIX = '-ref'

/** The named destinations F7 resolves: each note and its mark. */
export const noteDestinationIds = (expectations: Expectations): string[] =>
  (expectations.notes ?? []).flatMap((_, index) => [`${FOOTNOTE_ID_PREFIX}${index + 1}`, `${FOOTNOTE_ID_PREFIX}${index + 1}${MARK_ID_SUFFIX}`])

export const checkNotes = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf, view: TokenView, moved?: MovedNotes): Violation[] => {
  const notes = expectations.notes
  if (!notes) return []
  const found: Record<'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7', string[]> = { F1: [], F2: [], F3: [], F4: [], F5: [], F6: [], F7: [] }
  const placed = notes.flatMap((note, index) => {
    const missing = note.tokens.filter(token => view.tokens.get(token)?.length !== 1)
    for (const token of missing) found.F1.push(`note ${index + 1}: ${token} ${view.tokens.get(token)?.length ?? 0} times`)
    const mark = view.tokens.get(note.mark)
    if (missing.length > 0 || mark?.length !== 1) return []
    return [{ index, mark: mark[0]!, words: note.tokens.map(token => view.tokens.get(token)![0]!) }]
  })
  const perPage = new Map<number, number>()
  const printed = new Map<number, number>()
  placed.forEach((note, at) => {
    const first = note.words[0]!
    const name = `note ${note.index + 1} (${notes[note.index]!.tokens[0]})`
    const before = placed[at - 1]
    if (before && !readsAfter(before.words[0]!, first)) found.F2.push(`${name} at ${describeWord(first)} before note ${before.index + 1} at ${describeWord(before.words[0]!)}`)
    const pages = [...new Set(note.words.map(word => word.page))]
    for (const page of pages.slice(1)) {
      const part = note.words.filter(word => word.page === page)
      const head = firstRead(part)
      const others = placed.filter(other => other !== note && (other.words[0]!.page === page || other.index > note.index)).flatMap(other => other.words).filter(word => word.page === page)
      if (others.some(word => readsAfter(word, head))) found.F4.push(`${name} continues on p${page} at ${describeWord(head)}, after another note`)
    }
    const count = (perPage.get(note.mark.page) ?? 0) + 1
    perPage.set(note.mark.page, count)
    const expected = spec.footnotes?.numbering === 'page' ? count : note.index + 1
    printed.set(note.index, expected)
    const numberWord = numberNear(view, first, 'before')
    const markWord = numberNear(view, note.mark, 'after')
    const number = numberWord && Number(numberWord.text)
    const mark = markWord && Number(markWord.text)
    if (number !== expected || mark !== expected) found.F6.push(`${name}: number ${number ?? 'none'}, mark ${mark ?? 'none'}, expected ${expected}`)
    // The link covers the mark's number, wherever the line put it.
    const [from, to] = markWord ? [markWord.x, markWord.x + markWord.width] : [note.mark.x + note.mark.width, note.mark.x + note.mark.width + 0.6 * note.mark.fontSize]
    const links = read.links.filter(link => link.page === note.mark.page && targetOf(link)?.startsWith(`#${FOOTNOTE_ID_PREFIX}`)
      && link.rect[0] <= to && link.rect[2] >= from && link.rect[1] <= note.mark.y + note.mark.fontSize && link.rect[3] >= note.mark.y)
    if (links.length !== 1) found.F6.push(`${name}: ${links.length} links over its mark`)
    const markTarget = links.length === 1 ? links[0]!.destination : undefined
    if (markTarget !== undefined) {
      const page = read.destinations.get(markTarget)
      if (page !== first.page) found.F7.push(`${name}: its mark's link goes to p${page ?? 'nothing'}, the note starts on p${first.page}`)
    }
    if (!numberWord) return
    const backLinks = read.links.filter(link => link.page === numberWord.page && link.destination?.startsWith(FOOTNOTE_ID_PREFIX)
      && link.rect[0] <= numberWord.x + numberWord.width && link.rect[2] >= numberWord.x && link.rect[1] <= numberWord.y + numberWord.fontSize && link.rect[3] >= numberWord.y)
    if (backLinks.length !== 1) {
      found.F7.push(`${name}: ${backLinks.length} links over its number`)
      return
    }
    const backTarget = backLinks[0]!.destination!
    const page = read.destinations.get(backTarget)
    if (page !== note.mark.page) found.F7.push(`${name}: its number's link goes to p${page ?? 'nothing'}, its mark is on p${note.mark.page}`)
    if (markTarget !== undefined && backTarget !== `${markTarget}${MARK_ID_SUFFIX}`) found.F7.push(`${name}: the mark links to ${markTarget}, the number links back to ${backTarget}`)
  })
  // F3, from the page where each note starts.
  const later = new Map<number, number[]>()
  placed.forEach((note, at) => {
    const start = note.words[0]!.page
    if (start === note.mark.page) return
    later.set(note.mark.page, [...later.get(note.mark.page) ?? [], printed.get(note.index)!])
    const name = `note ${note.index + 1} (${notes[note.index]!.tokens[0]})`
    const before = at > 0 && placed[at - 1]!.index === note.index - 1 ? placed[at - 1]!.words[0]!.page : 0
    if (start > Math.max(before, note.mark.page) + 1) {
      found.F3.push(`${name} starts on p${start}, its mark (after ${notes[note.index]!.mark}) is on p${note.mark.page}${before > note.mark.page ? `, the note before it starts on p${before}` : ''}`)
      return
    }
    const stays = placed.find(other => other.index > note.index && other.mark.page === note.mark.page && other.words[0]!.page === note.mark.page)
    if (stays) found.F3.push(`${name} starts on p${start}, after its mark's page p${note.mark.page}, where the later note ${stays.index + 1} starts`)
    const own = placed.find(other => other.mark.page === start && other.words[0]!.page === start && !readsAfter(note.words[0]!, other.words[0]!))
    if (own) found.F3.push(`${name} moved to p${start} and starts after note ${own.index + 1}, whose mark is on p${start}`)
  })
  if (moved && placed.length === notes.length) {
    for (const page of [...new Set([...moved.keys(), ...later.keys()])].sort((a, b) => a - b)) {
      const starts = (later.get(page) ?? []).join(', ') || 'none'
      const warned = (moved.get(page) ?? []).join(', ') || 'none'
      if (starts !== warned) found.F3.push(`p${page}: notes ${starts} start on a later page, the PDF_FOOTNOTES_MOVED warning names ${warned}`)
    }
  }
  const metrics = spec.tagged ? ROBOTO_LINE : HELVETICA_LINE
  const noteTops = new Map<number, number>()
  for (const word of placed.flatMap(note => note.words)) noteTops.set(word.page, Math.max(noteTops.get(word.page) ?? Number.NEGATIVE_INFINITY, word.y + 0.9 * word.fontSize))
  const texts = new Set([...flowTexts(spec).values()].map(flow => flow.text))
  for (const text of texts) {
    const spaced = { tokens: text.tokens, fontSize: text.fontSize, height: lineHeightOf(text, metrics), ascent: metrics.ascent * text.fontSize, descent: (metrics.height - metrics.ascent) * text.fontSize, set: text.lineHeight !== undefined }
    const lines = new Map<string, Word[]>()
    for (const word of text.tokens.flatMap(token => view.tokens.get(token) ?? [])) {
      const key = [...lines.keys()].find(key => key.startsWith(`${word.page} `) && Math.abs(Number(key.split(' ')[1]) - word.y) < 0.3 * text.fontSize) ?? `${word.page} ${word.y}`
      lines.set(key, [...lines.get(key) ?? [], word])
    }
    for (const words of lines.values()) {
      const noteTop = noteTops.get(words[0]!.page)
      const { bottom } = lineBoxOf(spaced, words, view)
      if (noteTop !== undefined && bottom < noteTop - SQUEEZE_TOLERANCE) found.F5.push(`${words[0]!.text} on p${words[0]!.page}: its line ends at ${bottom.toFixed(2)}, below the first note line (${noteTop.toFixed(2)})`)
    }
  }
  return (Object.keys(found) as Array<keyof typeof found>).flatMap(rule => violations(rule, found[rule]))
}

// ---------------------------------------------------------------------------
// I27: column containers (the notes profile), as the
// columns profile (columns.ts) checks them, from the spec's column edges and
// the PDF's line boxes:
// - every token lies inside its column, and a spanning text inside the
//   container (I4 reads them column by column);
// - balanced: on the page where a segment ends, its highest column is at
//   most the even share of what its columns hold, plus the highest unit that
//   cannot end a column (a block, a text with wrap={false}, or three lines
//   that orphans and widows keep together), plus a line; with column breaks
//   on that page, the share of the best split of the columns between the
//   runs the breaks start;
// - a text with break="column" starts at the top of a column;
// - the content after a segment on that page starts below its highest
//   column;
// - the note area starts below every block (F5 checks the lines);
// - one height: on a page that a segment goes on after, its columns are
//   filled in order to one height, so no column could take its next chunk
//   (`chunkAt`) and still end at or above the highest column, unless that
//   chunk starts a text with break="column".

/** One line or block of a column container on a page: its top and bottom in PDF points. */
interface ColumnUnit {
  token: string
  page: number
  column: Column
  top: number
  bottom: number
  block: boolean
  text: TextSpec
  words: Word[]
}

/** The lines and blocks of the column containers: a line from its line box (`lineBoxOf`), a block from its text's line top and the spec's height. */
const columnUnits = (spec: DocumentSpec, expectations: Expectations, view: TokenView): ColumnUnit[] => {
  const metrics = spec.tagged ? ROBOTO_LINE : HELVETICA_LINE
  const blockHeights = new Map<TextSpec, number>()
  const findBlocks = (node: NodeSpec) => {
    if (node.kind !== 'view') return
    if (node.height !== undefined && node.children[0]?.kind === 'text') blockHeights.set(node.children[0], node.height)
    node.children.forEach(findBlocks)
  }
  spec.pages.forEach(page => page.children.forEach(findBlocks))
  const units: ColumnUnit[] = []
  for (const text of new Set([...flowTexts(spec).values()].map(flow => flow.text))) {
    if (!expectations.tokens.get(text.tokens[0]!)?.lane) continue
    const spaced = { tokens: text.tokens, fontSize: text.fontSize, height: lineHeightOf(text, metrics), ascent: metrics.ascent * text.fontSize, descent: (metrics.height - metrics.ascent) * text.fontSize, set: text.lineHeight !== undefined }
    const lines: Array<{ token: string, column: Column, words: Word[] }> = []
    for (const token of text.tokens) {
      for (const word of view.tokens.get(token) ?? []) {
        const column = columnOf(expectations, token, word)!
        const line = lines.find(line => line.words[0]!.page === word.page && line.column.index === column.index && Math.abs(line.words[0]!.y - word.y) < 0.3 * text.fontSize)
        if (line) line.words.push(word)
        else lines.push({ token, column, words: [word] })
      }
    }
    const block = blockHeights.get(text)
    for (const line of lines) {
      const box = lineBoxOf(spaced, line.words, view)
      units.push({ token: line.token, page: line.words[0]!.page, column: line.column, top: box.top, bottom: block === undefined ? box.bottom : box.top - block, block: block !== undefined, text, words: line.words })
    }
  }
  return units
}

/** The units of each segment that does not span, in reading order: page, column, then top down. */
const segmentsOf = (units: readonly ColumnUnit[]): Map<string, ColumnUnit[]> => {
  const segments = new Map<string, ColumnUnit[]>()
  for (const unit of units) {
    if (!unit.column.span) segments.set(unit.column.key, [...segments.get(unit.column.key) ?? [], unit])
  }
  for (const segment of segments.values()) segment.sort((a, b) => a.page - b.page || a.column.index - b.column.index || b.top - a.top)
  return segments
}

/** How far a chunk may reach past a height and still fit it. */
const FIT_EPS = 0.1

/**
 * The fewest units a column can take next at `at`, on
 * the safe side of the engine's orphans and widows (2 each): a block whole;
 * a text that cannot split, or a text of fewer than four lines that starts,
 * whole; a text that starts: two lines; a text that goes on at the top of a
 * column: two lines, all when fewer than four are left; a text that goes on
 * in the same column: one line, unless that leaves one behind.
 */
const chunkAt = (units: readonly ColumnUnit[], at: number, columnTop: boolean): { count: number, height: number } => {
  const unit = units[at]!
  let count = 1
  if (!unit.block) {
    const started = at > 0 && units[at - 1]!.text === unit.text
    let rest = 1
    while (at + rest < units.length && units[at + rest]!.text === unit.text) rest += 1
    if (!unit.text.wrap || (!started && rest < ORPHANS + WIDOWS)) count = rest
    else if (!started) count = ORPHANS
    else if (columnTop) count = rest < WIDOWS + 2 ? rest : WIDOWS
    else count = rest === 1 || rest - 1 >= WIDOWS ? 1 : rest
  }
  const height = units.slice(at, at + count).reduce((sum, item) => sum + item.top - item.bottom, 0)
  return { count, height }
}

/** Whether the unit at `at` is the first line of a text with break="column". */
const startsColumnBreak = (units: readonly ColumnUnit[], at: number): boolean =>
  units[at]!.text.columnBreak === true && (at === 0 || units[at - 1]!.text !== units[at]!.text)

/**
 * The columns filled in order at one height from `start`: the first unit
 * left over, and for each column that turned a chunk away the height at
 * which it would have taken it. A text with break="column" starts the next
 * column, unless its column has nothing yet (the engine ignores a break with
 * no content above it in the column, as at a page top).
 */
const fillAt = (units: readonly ColumnUnit[], start: number, count: number, height: number): { next: number, events: number[] } => {
  let at = start
  let used = 0
  let column = 0
  let top = true
  const events: number[] = []
  while (at < units.length && column < count) {
    if (!top && startsColumnBreak(units, at)) {
      column += 1
      used = 0
      top = true
      continue
    }
    const chunk = chunkAt(units, at, top)
    if (used + chunk.height <= height + FIT_EPS) {
      used += chunk.height
      at += chunk.count
      top = false
      continue
    }
    events.push(used + chunk.height)
    column += 1
    used = 0
    top = true
  }
  return { next: at, events }
}

/** A page that a segment goes on after (filled in order there): its units on the page and each column's height from the PDF. */
interface Crossing {
  key: string
  page: number
  segment: ColumnUnit[]
  /** First and last index of the segment's units on the page. */
  first: number
  last: number
  /** The top of the columns, and each column's height below it. */
  top: number
  heights: number[]
}

/**
 * The pages that segments cross, where the columns stack as the model
 * says: each column starts at the top, and its units' heights add up to its
 * height (within a point). Pages where they do not are left out.
 */
const crossingsOf = (units: readonly ColumnUnit[], view: TokenView): Crossing[] => {
  const crossings: Crossing[] = []
  for (const [key, segment] of segmentsOf(units)) {
    const pages = [...new Set(segment.map(unit => unit.page))]
    for (const page of pages) {
      const first = segment.findIndex(unit => unit.page === page)
      let last = first
      while (last + 1 < segment.length && segment[last + 1]!.page === page) last += 1
      if (last + 1 >= segment.length || view.pdfPageOf[page] !== view.pdfPageOf[segment[last + 1]!.page]) continue
      const fact = segment[first]!.column.fact
      const on = segment.slice(first, last + 1)
      const top = Math.max(...on.map(unit => unit.top))
      const heights = Array.from({ length: fact.count }, (_, index) => {
        const mine = on.filter(unit => unit.column.index === index)
        return mine.length === 0 ? 0 : top - Math.min(...mine.map(unit => unit.bottom))
      })
      const stacks = heights.every((height, index) => {
        const mine = on.filter(unit => unit.column.index === index)
        if (mine.length === 0) return true
        const sum = mine.reduce((total, unit) => total + unit.top - unit.bottom, 0)
        return Math.abs(mine[0]!.top - top) <= POSITION_TOLERANCE && Math.abs(sum - height) <= POSITION_TOLERANCE
      })
      if (stacks) crossings.push({ key, page, segment, first, last, top, heights })
    }
  }
  return crossings
}

/**
 * The least highest share when `count` columns are split between runs of
 * these heights in order, each run at least one column.
 */
const shareOf = (runs: readonly number[], count: number): number => {
  if (runs.length > count) return Math.max(...runs)
  const best = (from: number, columns: number): number => {
    if (from === runs.length - 1) return runs[from]! / columns
    let least = Number.POSITIVE_INFINITY
    for (let mine = 1; mine <= columns - (runs.length - 1 - from); mine += 1) least = Math.min(least, Math.max(runs[from]! / mine, best(from + 1, columns - mine)))
    return least
  }
  return best(0, count)
}

export const checkColumnContainers = (spec: DocumentSpec, expectations: Expectations, view: TokenView): Violation[] => {
  if (expectations.columns.length === 0) return []
  const messages: string[] = []
  for (const fact of expectations.tokens.values()) {
    const words = view.tokens.get(fact.token)
    if (!fact.lane || words?.length !== 1) continue
    const word = words[0]!
    const column = columnOf(expectations, fact.token, word)!
    const left = column.span ? column.fact.left : column.fact.left + column.index * (columnWidthOf(column.fact) + column.fact.gap)
    const width = column.span ? column.fact.width : columnWidthOf(column.fact)
    if (word.x < left - POSITION_TOLERANCE || word.x + word.width > left + width + POSITION_TOLERANCE) {
      messages.push(`${fact.token} on p${word.page} spans x ${word.x.toFixed(1)} to ${(word.x + word.width).toFixed(1)}, outside its ${column.span ? 'container' : 'column'} ${left.toFixed(1)} to ${(left + width).toFixed(1)}`)
    }
  }
  const units = columnUnits(spec, expectations, view)
  const keys = [...new Set(units.filter(unit => !unit.column.span).map(unit => unit.column.key))]
  const placed = [...expectations.tokens.values()]
    .filter(fact => fact.kind === 'flow' && view.tokens.get(fact.token)?.length === 1)
    .sort((a, b) => a.order - b.order)
  for (const key of keys) {
    const mine = units.filter(unit => unit.column.key === key)
    const page = Math.max(...mine.map(unit => unit.page))
    const last = mine.filter(unit => unit.page === page)
    const fact = last[0]!.column.fact
    const top = Math.max(...last.map(unit => unit.top))
    const bottoms = Array.from({ length: fact.count }, (_, index) => Math.min(top, ...last.filter(unit => unit.column.index === index).map(unit => unit.bottom)))
    const heights = bottoms.map(bottom => top - bottom)
    const tallest = Math.max(...heights)
    const lowest = Math.min(...bottoms)
    const line = Math.max(...last.filter(unit => !unit.block).map(unit => unit.top - unit.bottom), 0)
    // What the balance cannot split: a block, a text with wrap={false}, three lines.
    const whole = new Map<TextSpec, number>()
    for (const unit of last) {
      if (!unit.block && !unit.text.wrap) whole.set(unit.text, (whole.get(unit.text) ?? 0) + unit.top - unit.bottom)
    }
    const unit = Math.max(3 * line, ...whole.values(), ...last.filter(unit => unit.block).map(unit => unit.top - unit.bottom))
    // The runs that column breaks start on this page, and the share of the
    // best split of the columns between them (one run: the even share).
    const segment = segmentsOf(units).get(key)!
    const runs: number[] = []
    segment.forEach((item, at) => {
      if (item.page !== page) return
      if (runs.length === 0 || startsColumnBreak(segment, at)) runs.push(0)
      runs[runs.length - 1]! += item.top - item.bottom
    })
    const share = runs.length > 1 ? shareOf(runs, fact.count) : heights.reduce((sum, height) => sum + height, 0) / fact.count
    if (!fact.auto && tallest > share + unit + line + POSITION_TOLERANCE) {
      messages.push(`segment ${key} ends on p${page} with its highest column ${tallest.toFixed(1)} pt, over the ${runs.length > 1 ? `share of ${runs.length} runs` : 'even share'} ${share.toFixed(1)} pt plus ${(unit + line).toFixed(1)} pt (columns ${heights.map(height => height.toFixed(1)).join(', ')})`)
    }
    // The first token after the segment, if it is on that page.
    const lastOrder = Math.max(...placed.filter(fact => fact.lane && `${fact.lane.container}:${fact.lane.segment}` === key).map(fact => fact.order))
    const next = placed.find(fact => fact.order > lastOrder)
    const nextWord = next && view.tokens.get(next.token)![0]!
    const nextUnit = next && units.find(unit => unit.token === next.token)
    const nextTop = nextUnit?.top ?? (nextWord ? nextWord.y + 0.9 * nextWord.fontSize : undefined)
    if (nextWord?.page === page && nextTop! > lowest + POSITION_TOLERANCE) {
      messages.push(`${next!.token} after segment ${key} starts at ${nextTop!.toFixed(1)} on p${page}, above its highest column's end ${lowest.toFixed(1)}`)
    }
  }
  for (const { key, page, segment, first, last, heights } of crossingsOf(units, view)) {
    const highest = Math.max(...heights)
    let at = first
    for (let index = 0; index < heights.length; index += 1) {
      while (at <= last && segment[at]!.column.index <= index) at += 1
      if (at >= segment.length) break
      if (startsColumnBreak(segment, at)) continue
      const chunk = chunkAt(segment, at, heights[index] === 0)
      // Only a chunk that fits with room to spare: the PDF's line boxes are rounded.
      if (heights[index]! + chunk.height <= highest - FIT_EPS) {
        messages.push(`p${page}: segment ${key} goes on after the page, but column ${index + 1} ends at ${heights[index]!.toFixed(1)} pt and its next ${chunk.count} unit${chunk.count === 1 ? '' : 's'} (${chunk.height.toFixed(1)} pt, from ${segment[at]!.token}) would end at or above the highest column's ${highest.toFixed(1)} pt`)
      }
    }
  }
  // A text with break="column" starts at the top of a column: no unit of its
  // segment above it in its column on its page.
  for (const segment of segmentsOf(units).values()) {
    segment.forEach((item, at) => {
      if (!startsColumnBreak(segment, at)) return
      const above = segment.find(other => other !== item && other.page === item.page && other.column.index === item.column.index && other.top > item.top + POSITION_TOLERANCE)
      if (above) messages.push(`${item.token} (break="column") on p${item.page} starts column ${item.column.index + 1} at ${item.top.toFixed(1)}, below ${above.token} at ${above.top.toFixed(1)}`)
    })
  }
  // The note area below every block.
  const noteTops = new Map<number, number>()
  for (const token of (expectations.notes ?? []).flatMap(note => note.tokens)) {
    const word = view.tokens.get(token)?.[0]
    if (word) noteTops.set(word.page, Math.max(noteTops.get(word.page) ?? Number.NEGATIVE_INFINITY, word.y + 0.9 * word.fontSize))
  }
  for (const unit of units.filter(unit => unit.block)) {
    const noteTop = noteTops.get(unit.page)
    if (noteTop !== undefined && unit.bottom < noteTop - SQUEEZE_TOLERANCE) messages.push(`the block of ${unit.token} on p${unit.page} ends at ${unit.bottom.toFixed(2)}, below the first note line (${noteTop.toFixed(2)})`)
  }
  return violations('I27', messages)
}

// ---------------------------------------------------------------------------
// I7: fixed tokens on exactly the pages their `pages` value names.

const expectedFixedPages = (view: TokenView, pdfPage: number, pages: TokenFact['pages']): number[] => {
  const all = pagesOf(view, pdfPage)
  if (pages === 'first') return all.slice(0, 1)
  if (pages === 'continuation') return all.slice(1)
  return all
}

const samePages = (seen: number[], expected: number[]): boolean =>
  seen.length === expected.length && seen.every((page, index) => page === expected[index])

export const checkFixedPages = (expectations: Expectations, view: TokenView): Violation[] => {
  const messages: string[] = []
  const check = (name: string, pdfPage: number, pages: TokenFact['pages'], words: Word[]) => {
    const seen = words.map(word => word.page).sort((a, b) => a - b)
    const expected = expectedFixedPages(view, pdfPage, pages)
    if (!samePages(seen, expected)) messages.push(`${name} (pages="${pages}") on [${seen.join(',')}], expected [${expected.join(',')}]`)
  }
  for (const fact of expectations.tokens.values()) {
    if (fact.kind === 'fixed') check(fact.token, fact.pdfPage, fact.pages, view.tokens.get(fact.token) ?? [])
  }
  for (const number of expectations.numbers) {
    if (number.fixed) check(`${number.prefix}…`, number.pdfPage, number.pages, (view.numbers.get(number.prefix) ?? []).map(found => found.word))
  }
  return violations('I7', messages)
}

// ---------------------------------------------------------------------------
// I8: page numbers, page count, page references.

export const checkPageNumbers = (expectations: Expectations, view: TokenView): Violation[] => {
  const messages: string[] = []
  for (const number of expectations.numbers) {
    for (const { word, value } of view.numbers.get(number.prefix) ?? []) {
      let expected: number | undefined
      if (number.kind === 'pageNumber') expected = word.page
      else if (number.kind === 'pageCount') expected = view.pageCount
      else {
        const target = view.tokens.get(number.target!)
        expected = target?.length === 1 ? target[0]!.page : undefined
      }
      if (expected === undefined) continue
      if (value !== expected) messages.push(`${number.prefix} (${number.kind}${number.target ? ` → ${number.target}` : ''}) on p${word.page} prints ${value ?? 'nothing'}, expected ${expected}`)
    }
  }
  return violations('I8', messages)
}

// ---------------------------------------------------------------------------
// I9: tables.

interface Line {
  page: number
  y: number
  start: number
  end: number
  fontSize: number
}

/** Add a word or run to the line it shares a baseline with, or start one. */
const addToLine = (lines: Line[], page: number, y: number, start: number, end: number, fontSize: number): void => {
  const line = lines.find(candidate => candidate.page === page && Math.abs(candidate.y - y) < 0.3 * fontSize)
  if (!line) {
    lines.push({ page, y, start, end, fontSize })
    return
  }
  line.start = Math.min(line.start, start)
  line.end = Math.max(line.end, end)
}

const sortedPages = (words: readonly Word[]): number[] => [...new Set(words.map(word => word.page))].sort((a, b) => a - b)

/**
 * The header on exactly the pages that hold a row of its table; each
 * unbreakable row on one page; each cell of a row that breaks starts on the
 * row's first page (D51); rows in order, each token once; every line of
 * a cell at the column edges its alignment names (a spanning cell from its
 * first column's left edge to its last column's right edge).
 */
export const checkTables = (expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const messages: string[] = []
  const owners = new Map<string, { cell: CellFact, label: string }>()
  for (const table of expectations.tables) {
    const name = `table ${table.tableId}`
    table.header.forEach((cell, index) => cell.tokens.forEach(token => owners.set(token, { cell, label: `${name} header cell ${index}` })))
    table.rows.forEach((row, rowIndex) => row.cells.forEach((cell, index) => cell.tokens.forEach(token => owners.set(token, { cell, label: `${name} row ${rowIndex} cell ${index}` }))))

    const rowWords = table.rows.flatMap(row => row.cells.flatMap(cell => cell.tokens.flatMap(token => view.tokens.get(token) ?? [])))
    const rowPages = sortedPages(rowWords)
    for (const token of table.header.flatMap(cell => cell.tokens)) {
      const seen = (view.tokens.get(token) ?? []).map(word => word.page).sort((a, b) => a - b)
      if (!samePages(seen, rowPages)) messages.push(`${name} header ${token} on [${seen.join(',')}], its rows on [${rowPages.join(',')}]`)
    }
    let previous: { index: number, last: Word } | undefined
    table.rows.forEach((row, index) => {
      const tokens = row.cells.flatMap(cell => cell.tokens)
      const wrong = tokens.filter(token => view.tokens.get(token)?.length !== 1)
      if (wrong.length > 0) {
        messages.push(`${name} row ${index}: ${wrong.slice(0, 3).map(token => `${token} ${view.tokens.get(token)?.length ?? 0} times`).join(', ')}`)
        previous = undefined
        return
      }
      const words = tokens.map(token => view.tokens.get(token)![0]!)
      const pages = sortedPages(words)
      if (!row.wrap && pages.length > 1) messages.push(`${name} row ${index} split over pages ${pages.join(', ')}`)
      // D51: a row breaks only where every cell with content after the break
      // also has content before it, so each cell starts on the row's first page.
      row.cells.forEach((cell, cellIndex) => {
        if (cell.tokens.length === 0) return
        const start = Math.min(...cell.tokens.map(token => view.tokens.get(token)![0]!.page))
        if (start > pages[0]!) messages.push(`${name} row ${index} cell ${cellIndex} starts on page ${start}, its row on page ${pages[0]}`)
      })
      const first = words[0]!
      if (previous && !readsAfter(previous.last, first)) {
        messages.push(`${name} row ${index} starts at ${describeWord(first)}, before row ${previous.index} ends at ${describeWord(previous.last)}`)
      }
      previous = { index, last: lastRead(words) }
    })
  }

  // Lines of each cell from its words (a run can end in a space); a run holds
  // the words of one cell only.
  const lines = new Map<string, { cell: CellFact, lines: Line[] }>()
  const runWords = Map.groupBy(read.words, word => word.run)
  for (const [index, run] of read.runs.entries()) {
    const labels = new Set(run.words.map(word => owners.get(word)?.label))
    const owner = owners.get(run.words[0]!)
    if (owner && labels.size === 1) {
      const entry = lines.get(owner.label) ?? { cell: owner.cell, lines: [] }
      for (const word of runWords.get(index) ?? []) addToLine(entry.lines, word.page, word.y, word.x, word.x + word.width, word.fontSize)
      lines.set(owner.label, entry)
    }
    else if (labels.size > 1) {
      messages.push(`one run "${run.words.slice(0, 4).join(' ')}" on p${run.page} holds ${[...labels].map(label => label ?? 'text outside the table').join(' and ')}`)
    }
  }
  for (const [label, { cell, lines: cellLines }] of lines) {
    for (const line of cellLines) {
      const [actual, expected, edge] = cell.align === 'left'
        ? [line.start, cell.left + CELL_PAD_X, 'starts']
        : cell.align === 'right'
          ? [line.end, cell.right - CELL_PAD_X, 'ends']
          : [(line.start + line.end) / 2, (cell.left + cell.right) / 2, 'centers']
      if (Math.abs(actual - expected) > COLUMN_TOLERANCE) {
        messages.push(`${label} (${cell.align}) on p${line.page} y ${line.y.toFixed(1)} ${edge} at ${actual.toFixed(2)}, its columns at ${expected.toFixed(2)}`)
      }
    }
  }
  return violations('I9', messages)
}

// ---------------------------------------------------------------------------
// I14: links and bookmarks.

const targetOf = (rect: LinkRect): string | undefined => rect.url ?? (rect.destination === undefined ? undefined : `#${rect.destination}`)

/** The rectangles on the line's baseline cover the line from start to end. */
const covered = (line: Line, rects: readonly LinkRect[]): boolean => {
  let reached = line.start
  const onLine = rects
    .filter(({ page, rect }) => page === line.page && rect[1] - LINK_TOLERANCE_Y <= line.y && line.y <= rect[3] + LINK_TOLERANCE_Y)
    .sort((a, b) => a.rect[0] - b.rect[0])
  for (const { rect } of onLine) {
    if (rect[0] - LINK_TOLERANCE_X <= reached) reached = Math.max(reached, rect[2])
  }
  return reached + LINK_TOLERANCE_X >= line.end
}

const liesOn = ({ page, rect }: LinkRect, line: Line): boolean =>
  page === line.page && rect[1] - LINK_TOLERANCE_Y <= line.y && line.y <= rect[3] + LINK_TOLERANCE_Y
  && rect[0] < line.end && rect[2] > line.start

const describeRect = ({ page, rect }: LinkRect): string => `p${page} [${rect.map(value => value.toFixed(1)).join(', ')}]`

/**
 * Every line of a link's text is covered by that link's rectangles, on every
 * page where the text is; every rectangle lies on a line of its link's text;
 * an internal link jumps to the page of its target's first token; the outline
 * has the bookmarks' nesting, and each points to the page of its node.
 */
export const checkLinks = (expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const messages: string[] = []
  const known = new Set(expectations.links.map(link => link.href))
  for (const rect of read.links) {
    const target = targetOf(rect)
    // A footnote mark links to its note; F6 and F7 check those.
    if (expectations.notes && target?.startsWith(`#${FOOTNOTE_ID_PREFIX}`)) continue
    if (target === undefined || !known.has(target)) messages.push(`link annotation ${target ?? 'without target'} at ${describeRect(rect)} belongs to no link`)
  }
  for (const link of expectations.links) {
    const rects = read.links.filter(rect => targetOf(rect) === link.href)
    const lines: Line[] = []
    for (const token of link.tokens) {
      for (const word of view.tokens.get(token) ?? []) addToLine(lines, word.page, word.y, word.x, word.x + word.width, word.fontSize)
    }
    const name = `link ${link.href} (${link.tokens[0]}${link.tokens.length > 1 ? `…${link.tokens.at(-1)}` : ''})`
    for (const line of lines) {
      if (!covered(line, rects)) {
        const near = rects.filter(rect => rect.page === line.page)
        messages.push(`${name}: line on p${line.page} y ${line.y.toFixed(1)} x ${line.start.toFixed(1)}–${line.end.toFixed(1)} not covered${near.length > 0 ? ` (rectangles ${near.map(describeRect).join(', ')})` : ' (no rectangle on the page)'}`)
      }
    }
    for (const rect of rects) {
      if (!lines.some(line => liesOn(rect, line))) messages.push(`${name}: rectangle ${describeRect(rect)} lies on no line of its text`)
    }
    if (link.id !== undefined && link.target !== undefined) {
      const target = view.tokens.get(link.target)
      const page = read.destinations.get(link.id)
      if (target?.length === 1 && page !== target[0]!.page) messages.push(`${name} jumps to p${page ?? 'nothing'}, its target ${link.target} is on p${target[0]!.page}`)
    }
  }
  const firstPdfPage = (pdfPage: number): number | undefined => {
    const page = view.pdfPageOf.indexOf(pdfPage)
    return page > 0 ? page : undefined
  }
  const compare = (expected: readonly BookmarkFact[], actual: readonly OutlineEntry[], path: string) => {
    const titles = actual.map(entry => entry.title)
    if (titles.join(',') !== expected.map(bookmark => bookmark.title).join(',')) {
      messages.push(`outline${path}: [${titles.join(', ')}], expected [${expected.map(bookmark => bookmark.title).join(', ')}]`)
      return
    }
    expected.forEach((bookmark, index) => {
      const entry = actual[index]!
      const found = 'token' in bookmark.at ? view.tokens.get(bookmark.at.token) : undefined
      const page = 'token' in bookmark.at ? found?.length === 1 ? found[0]!.page : undefined : firstPdfPage(bookmark.at.pdfPage)
      if (page !== undefined && entry.page !== page) {
        messages.push(`bookmark ${bookmark.title} points to p${entry.page ?? 'nothing'}, its node is on p${page}${'token' in bookmark.at ? ` (${bookmark.at.token})` : ''}`)
      }
      compare(bookmark.children, entry.children, `${path} > ${bookmark.title}`)
    })
  }
  if (expectations.bookmarks.length > 0 || read.outline.length > 0) compare(expectations.bookmarks, read.outline, '')
  return violations('I14', messages)
}

// ---------------------------------------------------------------------------
// I16 to I19: the mixed profile.

const near = (a: number, b: number): boolean => Math.abs(a - b) <= BOX_TOLERANCE
const sameRect = (a: readonly number[], b: readonly number[]): boolean => a.every((value, index) => near(value, b[index]!))
const describePaint = ({ page, rect }: Paint): string => `p${page} [${rect.map(value => value.toFixed(2)).join(', ')}]`

/**
 * I16: each image and SVG, and each boxed field, has one filled rectangle in
 * its box colour (the laid-out box: the background of the view around it, or
 * the SVG's full-size rect) at the spec's size and x; each image is painted
 * on that rectangle and no image elsewhere; the SVG text starts at its x and
 * has its baseline at its y inside that rectangle.
 */
export const checkBoxes = (expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const details = read.details
  if (!details) return []
  const messages: string[] = []
  const images = expectations.boxes.filter(box => box.kind === 'image')
  if (details.images.length !== images.length) messages.push(`${details.images.length} images painted, the document has ${images.length}`)
  for (const box of expectations.boxes) {
    if (!box.painted) continue
    const label = `${box.kind} ${box.boxId}`
    const fills = details.fills.filter(fill => fill.color === box.color)
    if (fills.length !== 1) {
      messages.push(`${label}: its box is painted ${fills.length} times${fills.length > 0 ? ` (${fills.map(describePaint).join(', ')})` : ''}`)
      continue
    }
    const fill = fills[0]!
    const [x1, y1, x2, y2] = fill.rect
    if (!near(x2 - x1, box.width) || !near(y2 - y1, box.height) || !near(x1, box.left)) {
      messages.push(`${label}: box ${describePaint(fill)}, expected ${box.width}×${box.height} at x ${box.left}`)
    }
    if (box.kind === 'image' && !details.images.some(image => image.page === fill.page && sameRect(image.rect, fill.rect))) {
      const onPage = details.images.filter(image => image.page === fill.page)
      messages.push(`${label}: drawn at ${onPage.length > 0 ? onPage.map(describePaint).join(', ') : 'no place on its page'}, its box is ${describePaint(fill)}`)
    }
    if (box.kind === 'svg') {
      const text = expectations.svgTexts.find(entry => entry.boxId === box.boxId)!
      const words = view.tokens.get(text.tokens[0]!) ?? []
      const word = words[0]
      if (words.length === 1 && word && (word.page !== fill.page || !near(word.x, x1 + text.x) || !near(word.y, y2 - text.y))) {
        messages.push(`${label}: text ${text.tokens[0]} at ${describeWord(word)}, expected p${fill.page} (${(x1 + text.x).toFixed(2)}, ${(y2 - text.y).toFixed(2)})`)
      }
    }
  }
  return violations('I16', messages)
}

const overlaps = (a: Paint, b: Paint): boolean =>
  a.page === b.page && Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0]) > BOX_TOLERANCE
  && Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]) > BOX_TOLERANCE

/**
 * I17 (D22): one widget and one
 * field object per field; the widget has the field's size (a field never
 * splits), lies on a page of its PdfPage inside the page padding, at the
 * spec's x and, when boxed, on the background of its view (the laid-out box);
 * widgets do not overlap; the value pdf.js reads back is the prop; a document
 * without fields has no AcroForm.
 */
export const checkForms = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const details = read.details
  if (!details) return []
  const messages: string[] = []
  const { fields } = expectations
  if (details.acroForm !== (fields.length > 0)) messages.push(fields.length > 0 ? 'no AcroForm, the document has fields' : 'an AcroForm in a document without fields')
  const names = new Set(fields.map(field => field.name))
  for (const widget of details.widgets) if (!names.has(widget.name)) messages.push(`widget "${widget.name}" at ${describePaint(widget)} belongs to no field`)
  for (const field of fields) {
    const own = details.widgets.filter(widget => widget.name === field.name)
    const objects = details.fieldCounts.get(field.name) ?? 0
    if (own.length !== 1 || objects !== 1) {
      messages.push(`field ${field.name}: ${own.length} widgets${own.length > 0 ? ` (${own.map(describePaint).join(', ')})` : ''}, ${objects} field objects`)
      continue
    }
    const widget = own[0]!
    const [x1, y1, x2, y2] = widget.rect
    if (!near(x2 - x1, field.width) || !near(y2 - y1, field.height)) messages.push(`field ${field.name}: widget ${describePaint(widget)}, expected ${field.width}×${field.height}`)
    const box = expectations.boxes.find(entry => entry.boxId === field.boxId)!
    if (!near(x1, box.left)) messages.push(`field ${field.name}: widget at x ${x1.toFixed(2)}, expected ${box.left}`)
    const pdfPage = view.pdfPageOf[widget.page] ?? -1
    if (pdfPage !== field.pdfPage) messages.push(`field ${field.name}: on p${widget.page} of PdfPage ${pdfPage}, expected PdfPage ${field.pdfPage}`)
    const pageSpec = spec.pages[field.pdfPage]!
    const { width, height } = pageGeometry(pageSpec)
    const [padTop, padRight, padBottom, padLeft] = pageSpec.padding
    if (x1 < padLeft - BOX_TOLERANCE || x2 > width - padRight + BOX_TOLERANCE || y1 < padBottom - BOX_TOLERANCE || y2 > height - padTop + BOX_TOLERANCE) {
      messages.push(`field ${field.name}: widget ${describePaint(widget)} outside the content box (padding ${padTop}/${padRight}/${padBottom}/${padLeft})`)
    }
    if (field.boxed) {
      const fill = details.fills.find(entry => entry.color === box.color)
      if (fill && (fill.page !== widget.page || !sameRect(fill.rect, widget.rect))) messages.push(`field ${field.name}: widget ${describePaint(widget)}, its laid-out box ${describePaint(fill)}`)
    }
    if (JSON.stringify(widget.value) !== JSON.stringify(field.value)) messages.push(`field ${field.name}: value ${JSON.stringify(widget.value)}, expected ${JSON.stringify(field.value)}`)
  }
  details.widgets.forEach((widget, index) => {
    for (const other of details.widgets.slice(index + 1)) {
      if (overlaps(widget, other)) messages.push(`widgets ${widget.name} ${describePaint(widget)} and ${other.name} ${describePaint(other)} overlap`)
    }
  })
  return violations('I17', messages)
}

/**
 * I18: every token of a text in another face, a script text and SVG text is
 * drawn in that font; the runs of the Arabic font hold the letters of every
 * right-to-left word (as a multiset: pdf.js splits these words, and Poppler
 * reads the words themselves and so their letter order,
 * `checkPopplerArabicWords`); a tagged document draws no text in the standard
 * font Helvetica.
 */
export const checkFonts = (expectations: Expectations, read: ReadPdf, view: TokenView): Violation[] => {
  const messages: string[] = []
  for (const { tokens, postscript } of expectations.faces) {
    for (const token of tokens) {
      for (const word of view.tokens.get(token) ?? []) {
        const font = read.runs[word.run]?.font
        if (font !== postscript) messages.push(`${token} at ${describeWord(word)} in ${font ?? 'an unnamed font'}, expected ${postscript}`)
      }
    }
  }
  // pdf.js splits and reorders the words of the Arabic subset (pdfjsArabicLetters), so
  // the Arabic letters in the runs of the Arabic font (which also draw each
  // text's code) are compared with those of each right-to-left text's word,
  // once per time its code is read (a fixed text repeats). Poppler reads the
  // words themselves (checkPopplerArabicWords).
  if (expectations.rtl.length > 0) {
    const shown = pdfjsArabicLetters(read.runs.filter(run => run.font === SCRIPT_FONTS.rtl.postscript).map(run => run.text).join('')).replace(/\P{Script=Arabic}/gu, '')
    const expected = pdfjsArabicLetters(expectations.rtl.map(entry => entry.word.repeat(view.tokens.get(entry.code)?.length ?? 0)).join(''))
    if (shown !== expected) messages.push(`the runs of ${SCRIPT_FONTS.rtl.postscript} show the Arabic letters ${shown || 'none'}, the right-to-left texts hold ${expected || 'none'}`)
  }
  if (expectations.tagged) {
    const standard = read.runs.filter(run => run.font === 'Helvetica')
    if (standard.length > 0) messages.push(`tagged document draws "${standard[0]!.words.slice(0, 3).join(' ')}" on p${standard[0]!.page} in Helvetica (not embedded)`)
  }
  return violations('I18', messages)
}

const merged = (levels: readonly number[]): number[] => levels.filter((level, index) => index === 0 || level !== levels[index - 1])

/**
 * I19: a tagged document is marked, has its title and language, a structure
 * tree on every page, the heading levels of the spec in order (a heading
 * split over pages counts once), and one figure with its alt text for each
 * image and SVG.
 */
export const checkTagged = (expectations: Expectations, read: ReadPdf): Violation[] => {
  const details = read.details
  if (!details || !expectations.tagged) return []
  const messages: string[] = []
  if (!details.marked) messages.push('not marked (MarkInfo /Marked true missing)')
  if (details.title !== TAGGED_TITLE) messages.push(`title ${JSON.stringify(details.title)}, expected ${JSON.stringify(TAGGED_TITLE)}`)
  if (details.language !== TAGGED_LANGUAGE) messages.push(`language ${JSON.stringify(details.language)}, expected ${TAGGED_LANGUAGE}`)
  const missing = details.structure.flatMap((tree, index) => tree ? [] : [index + 1])
  if (missing.length > 0) messages.push(`no structure tree on pages ${missing.join(', ')}`)
  const levels = merged(details.structure.flatMap(tree => (tree?.roles ?? []).flatMap(role => /^H[1-6]$/.test(role) ? [Number(role.slice(1))] : [])))
  const expected = merged(expectations.headings)
  if (levels.join(',') !== expected.join(',')) messages.push(`headings ${levels.map(level => `H${level}`).join(' ') || 'none'}, expected ${expected.map(level => `H${level}`).join(' ') || 'none'}`)
  const alts = new Set(details.structure.flatMap(tree => tree?.alts ?? []))
  const figures = expectations.boxes.filter(box => box.kind !== 'field').map(box => figureAlt(box.boxId))
  const absent = figures.filter(alt => !alts.has(alt))
  if (absent.length > 0) messages.push(`no figure with alt ${absent.map(alt => JSON.stringify(alt)).join(', ')}`)
  if (alts.size > figures.length) messages.push(`${alts.size} figure alt texts, the document has ${figures.length} figures`)
  return violations('I19', messages)
}

/**
 * Words as reading entries: a known token, `#prefix` for a page number in the
 * flow (its prefix and digits), `figure:<boxId>`, or nothing. Letters drawn one
 * by one (letter spacing) are joined into the known tokens they make.
 */
const readingEntries = (words: readonly string[], known: ReadonlySet<string>, prefixes: readonly string[], figures: ReadonlyMap<string, string>): string[] => {
  const entries: string[] = []
  const entry = (word: string): string | undefined => {
    if (figures.has(word)) return figures.get(word)
    if (known.has(word)) return word
    const prefix = prefixes.find(candidate => word.startsWith(candidate) && /^\d+$/.test(word.slice(candidate.length)))
    return prefix === undefined ? undefined : `#${prefix}`
  }
  for (let index = 0; index < words.length; index += 1) {
    // The longest known token from the start of a run of single letters: one
    // letter-spaced line can hold several tokens (`w 1 0 0 0 w 1 0 0 1`).
    let end = index
    while (words[end]?.length === 1) end += 1
    while (end - index > 1 && !known.has(words.slice(index, end).join(''))) end -= 1
    if (end - index > 1) {
      entries.push(words.slice(index, end).join(''))
      index = end - 1
      continue
    }
    const found = entry(words[index]!)
    if (found !== undefined) entries.push(found)
  }
  return entries
}

/**
 * I23 (H7): a tagged document reads in document order. The structure tree,
 * walked in order with the words of its marked content, gives the flow tokens,
 * table cells row by row after the header, page numbers in the flow, and each
 * figure (by its alt text) in the order of the spec. pdf.js gives one tree per
 * page, holding only what that page shows, so an element that continues on
 * the next page (a table cell, a paragraph) appears on both: each page must
 * read in document order, and every shown entry must be read. The order
 * across pages is Poppler's part (`checkPopplerReading`). Fixed content
 * (headers, footers, page numbers, absolute texts) is an artifact: never in
 * the structure, always in /Artifact marked content. A repeated table header
 * is an artifact on later pages; only its first reading counts.
 */
export const checkReadingOrder = (expectations: Expectations, read: ReadPdf): Violation[] => {
  const details = read.details
  if (!details || !expectations.tagged) return []
  const messages: string[] = []
  const fixed = new Set([...expectations.tokens.values()].filter(fact => fact.kind === 'fixed').map(fact => fact.token))
  const headers = new Set([...expectations.tokens.values()].filter(fact => fact.kind === 'header').map(fact => fact.token))
  const flowPrefixes = expectations.numbers.filter(number => !number.fixed).map(number => number.prefix)
  const fixedPrefixes = expectations.numbers.filter(number => number.fixed).map(number => number.prefix)
  const known = new Set([...expectations.reading, ...fixed])
  // The structure tree names a figure by its alt text.
  const figures = new Map(expectations.boxes.filter(box => box.kind !== 'field').map(box => [`figure:${figureAlt(box.boxId)}`, `figure:${box.boxId}`]))
  const entriesOf = (words: string[]) => readingEntries(words, known, [...flowPrefixes, ...fixedPrefixes], figures)
  const structure = entriesOf(details.reading.flatMap(page => page.structure))
  const artifacts = new Set(entriesOf(details.reading.flatMap(page => page.artifacts)))

  const tagged = structure.filter(entry => fixed.has(entry) || fixedPrefixes.some(prefix => entry === `#${prefix}`))
  if (tagged.length > 0) messages.push(`fixed content in the structure tree: ${tagged.slice(0, 3).join(' ')}`)
  const shown = new Set(read.words.map(word => word.text))
  const untagged = [...fixed].filter(token => shown.has(token) && !artifacts.has(token))
  if (untagged.length > 0) messages.push(`fixed content outside artifacts: ${untagged.slice(0, 3).join(' ')}`)
  const hidden = expectations.reading.filter(entry => !entry.startsWith('#') && !entry.startsWith('figure:') && !headers.has(entry) && artifacts.has(entry))
  if (hidden.length > 0) messages.push(`flow content marked as an artifact: ${hidden.slice(0, 3).join(' ')}`)

  const position = new Map(expectations.reading.map((entry, index) => [entry, index]))
  const seen = new Set<string>()
  const repeated = new Set<string>()
  details.reading.forEach((page, index) => {
    let last: string | undefined
    let inverted = false
    for (const entry of entriesOf(page.structure)) {
      if (!position.has(entry)) continue
      if (seen.has(entry) && !headers.has(entry) && !entry.startsWith('#') && entry !== last) repeated.add(entry)
      if (!inverted && last !== undefined && position.get(entry)! < position.get(last)! && !(headers.has(entry) && seen.has(entry))) {
        messages.push(`page ${index + 1} reads ${entry} after ${last}`)
        inverted = true
      }
      seen.add(entry)
      last = entry
    }
  })
  if (repeated.size > 0) messages.push(`read twice: ${[...repeated].slice(0, 3).join(' ')}`)
  const missing = expectations.reading.filter(entry => !seen.has(entry) && (entry.startsWith('#') || entry.startsWith('figure:') || shown.has(entry)))
  if (missing.length > 0) messages.push(`not in the structure tree: ${missing.slice(0, 3).join(' ')}`)
  return violations('I23', messages)
}

/**
 * I23, second reading: `pdfinfo -struct-text` walks the whole structure tree,
 * so its words follow the document order across pages. Figures have no text
 * there and are left out; a repeated table header counts once.
 */
export const checkPopplerReading = (expectations: Expectations, poppler: PopplerRead): Violation[] => {
  if (!expectations.tagged || poppler.structure === undefined) return []
  const tokens = expectations.reading.filter(entry => !entry.startsWith('figure:'))
  const known = new Set(tokens)
  const flowPrefixes = expectations.numbers.filter(number => !number.fixed).map(number => number.prefix)
  const read = readingEntries(poppler.structure, known, flowPrefixes, new Map())
  const order = read.filter((entry, index) => read.indexOf(entry) === index)
  const expected = tokens.filter(entry => order.includes(entry))
  const extra = poppler.structure.filter(word => [...expectations.tokens.values()].some(fact => fact.kind === 'fixed' && fact.token === word))
  const messages: string[] = []
  if (extra.length > 0) messages.push(`pdfinfo -struct-text reads fixed content: ${extra.slice(0, 3).join(' ')}`)
  const at = expected.findIndex((entry, index) => entry !== order[index])
  if (at !== -1) messages.push(`pdfinfo -struct-text: entry ${at + 1} is ${order[at]}, expected ${expected[at]} (then ${expected.slice(at + 1, at + 3).join(' ')})`)
  return violations('I23', messages)
}

/**
 * I13: the second document of a metamorphic pair shows the same text at the
 * same places (within 0.01 pt): same pages and page sizes, same runs in
 * order, and the same image paints and widget rectangles.
 */
export const checkSamePositions = (label: string, reference: ReadPdf, other: ReadPdf): Violation[] => {
  const messages: string[] = []
  if (reference.parsed.pageCount !== other.parsed.pageCount) return violations('I13', [`${label}: ${other.parsed.pageCount} pages, expected ${reference.parsed.pageCount}`])
  reference.parsed.pages.forEach((page, index) => {
    const twin = other.parsed.pages[index]!
    if (!near(page.width, twin.width) || !near(page.height, twin.height)) messages.push(`${label}: p${page.number} is ${twin.width}×${twin.height}, expected ${page.width}×${page.height}`)
  })
  const describeRun = (run: Run) => `"${run.text.slice(0, 24)}" p${run.page} (${run.x.toFixed(3)}, ${run.y.toFixed(3)})`
  const length = Math.max(reference.runs.length, other.runs.length)
  for (let index = 0; index < length; index += 1) {
    const a = reference.runs[index]
    const b = other.runs[index]
    if (!a || !b) {
      messages.push(`${label}: run ${index} ${a ? `${describeRun(a)} missing` : `${describeRun(b!)} extra`}`)
      break
    }
    if (a.text !== b.text || a.page !== b.page || !near(a.x, b.x) || !near(a.y, b.y)) messages.push(`${label}: ${describeRun(b)}, expected ${describeRun(a)}`)
  }
  const paints = (read: ReadPdf): Paint[] => [...read.details?.images ?? [], ...read.details?.widgets ?? []]
  const own = paints(reference)
  const twin = paints(other)
  if (own.length !== twin.length) messages.push(`${label}: ${twin.length} images and widgets, expected ${own.length}`)
  else own.forEach((paint, index) => {
    if (paint.page !== twin[index]!.page || !sameRect(paint.rect, twin[index]!.rect)) messages.push(`${label}: image or widget ${describePaint(twin[index]!)}, expected ${describePaint(paint)}`)
  })
  return violations('I13', messages)
}

/**
 * I20: every glyph a text uses has an outline in the embedded font program,
 * except white space. A text extraction check passes when a reader draws
 * nothing (E3-F1: a TrueType WOFF2 font embedded without outlines).
 */
export const checkOutlines = (read: ReadPdf): Violation[] =>
  violations('I20', (read.details?.glyphsWithoutOutline ?? []).map(({ font, glyph, text }) =>
    `${font}: glyph ${glyph}${text === undefined ? '' : ` (${JSON.stringify(text)})`} has no outline`))

// ---------------------------------------------------------------------------
// I21, I22: Poppler as a second reader (test/invariants/poppler.ts). I23: reading order.

/**
 * The words of one Poppler page as pdf.js words are joined: consecutive
 * one-letter words on one line become one word (a justified line with one
 * word spreads its letters).
 */
const popplerTokens = (words: readonly PopplerWord[]): string[] => {
  const tokens: string[] = []
  words.forEach((word, index) => {
    const previous = words[index - 1]
    if (word.text.length === 1 && previous?.text.length === 1 && tokens.length > 0
      && Math.abs(previous.top - word.top) < 0.1 && word.left > previous.left) {
      tokens[tokens.length - 1] += word.text
      return
    }
    tokens.push(word.text)
  })
  return tokens
}

const ARABIC = /\p{Script=Arabic}/u

/**
 * I18 with Poppler: each right-to-left text's Arabic word is a word of the
 * pdftotext reading (in visual order there, so reversed), at least as often
 * as the generator wrote it.
 */
export const checkPopplerArabicWords = (expectations: Expectations, poppler: PopplerRead): Violation[] => {
  const read = poppler.words.flatMap(words => popplerTokens(words)).filter(word => ARABIC.test(word)).map(word => [...word].reverse().join(''))
  const messages: string[] = []
  for (const [word, entries] of Map.groupBy(expectations.rtl, entry => entry.word)) {
    const count = read.filter(other => other === word).length
    if (count < entries.length) messages.push(`${entries.length} right-to-left texts with "${entries[0]!.code}…" hold the word, pdftotext reads it ${count} times`)
  }
  return violations('I18', messages)
}

/**
 * I21: Poppler reads what pdf.js reads: the same page count and page sizes
 * (pdfinfo), and on each page the same words in the same order (pdftotext in
 * content-stream order). Two reader differences are allowed for: pdftotext
 * also reads the appearance text of form field widgets (clipped text past the
 * widget's right edge too), which pdf.js text content leaves out, so words
 * on a widget's rows from its left edge on are not compared; and pdftotext
 * writes an Arabic word in visual order and places it apart from the Latin
 * words of its line, so Arabic words are compared on their own. pdf.js also
 * splits them and reads the dots of the Arabic subset as control characters,
 * so they are compared by their letters (`pdfjsArabicLetters`).
 */
export const checkSecondReader = (read: ReadPdf, poppler: PopplerRead, label = ''): Violation[] => {
  const messages: string[] = []
  const pages = read.parsed.pages
  const prefix = label === '' ? '' : `${label}: `
  if (poppler.sizes.length !== pages.length) messages.push(`${prefix}pdfinfo reads ${poppler.sizes.length} pages, pdf.js ${pages.length}`)
  pages.forEach((page, index) => {
    const size = poppler.sizes[index]
    if (size && (Math.abs(size.width - page.width) > BOX_TOLERANCE || Math.abs(size.height - page.height) > BOX_TOLERANCE)) {
      messages.push(`${prefix}page ${page.number} is ${size.width}×${size.height} in pdfinfo, ${page.width}×${page.height} in pdf.js`)
    }
    // A word of control characters only is pdf.js's reading of the dots of the Arabic subset (pdfjsArabicLetters).
    const pageWords = read.words.filter(word => word.page === page.number && pdfjsArabicLetters(word.text) !== '').map(word => word.text)
    const widgets = (read.details?.widgets ?? []).filter(widget => widget.page === page.number)
    const inWidget = (word: PopplerWord) => {
      const y = page.height - word.top - word.height / 2
      return widgets.some(({ rect: [x1, y1, , y2] }) => word.left >= x1 - BOX_TOLERANCE && y >= y1 && y <= y2)
    }
    const all = popplerTokens((poppler.words[index] ?? []).filter(word => !inWidget(word)))
    const arabic = (word: string) => ARABIC.test(word)
    // pdf.js splits the words of the Arabic subset, so the two readings are compared by their letters.
    const ourArabic = pdfjsArabicLetters(pageWords.filter(arabic).join(''))
    const theirArabic = pdfjsArabicLetters(all.filter(arabic).join(''))
    if (ourArabic !== theirArabic) messages.push(`${prefix}page ${page.number}: Arabic letters ${theirArabic || 'none'} in pdftotext, ${ourArabic || 'none'} in pdf.js`)
    const ours = pageWords.filter(word => !arabic(word))
    const theirs = all.filter(word => !arabic(word))
    const at = ours.findIndex((word, position) => word !== theirs[position])
    const first = at === -1 && theirs.length !== ours.length ? ours.length : at
    if (first !== -1) {
      messages.push(`${prefix}page ${page.number}, word ${first + 1}: ${JSON.stringify(theirs[first] ?? null)} in pdftotext, ${JSON.stringify(ours[first] ?? null)} in pdf.js (${theirs.length} and ${ours.length} words)`)
    }
  })
  return violations('I21', messages)
}

/**
 * A pixel this dark or darker is ink of a glyph (gray, 0 is black, the page
 * 255). Light on purpose: the CJK fixture is the Thin weight, whose strokes at
 * 8 pt and 72 dpi reach only gray 191; a glyph without an outline leaves 255.
 */
const GLYPH_INK = 224
/** Outside every painted box, a pixel this dark or darker is ink where the document has nothing. */
const STRAY_INK = 100
/** Pixels added around each painted box: anti-aliasing and the reach of glyphs beyond their box. */
const PAINT_MARGIN_PX = 2

/** Pixel rows and columns of a PDF rectangle (origin bottom left) on a raster of a page `height` points high. */
const pixelBox = (raster: Raster, height: number, [x1, y1, x2, y2]: readonly number[], margin = 0) => {
  const scale = RASTER_DPI / 72
  return {
    left: Math.max(0, Math.floor(x1! * scale) - margin),
    right: Math.min(raster.width - 1, Math.ceil(x2! * scale) + margin),
    top: Math.max(0, Math.floor((height - y2!) * scale) - margin),
    bottom: Math.min(raster.height - 1, Math.ceil((height - y1!) * scale) + margin),
  }
}

const darkest = (raster: Raster, box: ReturnType<typeof pixelBox>): number => {
  let value = 255
  for (let row = box.top; row <= box.bottom; row += 1) {
    for (let column = box.left; column <= box.right; column += 1) value = Math.min(value, raster.pixels[row * raster.width + column]!)
  }
  return value
}

/**
 * I22: Poppler paints every word, and nothing where the document is empty.
 * The x-height band of each word box has glyph ink; a dark pixel lies inside
 * a painted box as pdf.js reads it (a word, a fill, a stroke, an image, an
 * annotation), never outside all of them.
 */
export const checkInk = (read: ReadPdf, poppler: PopplerRead, painted: readonly Paint[]): Violation[] => {
  const messages: string[] = []
  read.parsed.pages.forEach((page, index) => {
    const raster = poppler.rasters[index]
    if (!raster) {
      messages.push(`page ${page.number} has no Poppler raster`)
      return
    }
    for (const word of read.words.filter(entry => entry.page === page.number)) {
      const band = pixelBox(raster, page.height, [word.x, word.y, word.x + word.width, word.y + 0.45 * word.fontSize])
      if (band.right < band.left || band.bottom < band.top) continue
      const value = darkest(raster, band)
      if (value > GLYPH_INK) messages.push(`"${word.text}" on p${page.number} (${word.x.toFixed(1)}, ${word.y.toFixed(1)}) has no ink (darkest ${value})`)
    }
    const covered = new Uint8Array(raster.width * raster.height)
    const cover = (rect: readonly number[]) => {
      const box = pixelBox(raster, page.height, rect, PAINT_MARGIN_PX)
      for (let row = box.top; row <= box.bottom; row += 1) covered.fill(1, row * raster.width + box.left, row * raster.width + box.right + 1)
    }
    for (const run of read.runs.filter(entry => entry.page === page.number)) {
      cover([run.x - 0.3 * run.fontSize, run.y - 0.45 * run.fontSize, run.x + run.width + 0.3 * run.fontSize, run.y + 1.15 * run.fontSize])
    }
    for (const paint of painted.filter(entry => entry.page === page.number)) cover(paint.rect)
    let stray = 0
    let first: number | undefined
    raster.pixels.forEach((value, pixel) => {
      if (value > STRAY_INK || covered[pixel] === 1) return
      stray += 1
      first ??= pixel
    })
    if (first !== undefined) {
      const scale = RASTER_DPI / 72
      messages.push(`p${page.number}: ${stray} dark pixels outside every painted box, the first at (${((first % raster.width) / scale).toFixed(0)}, ${(page.height - Math.floor(first / raster.width) / scale).toFixed(0)})`)
    }
  })
  return violations('I22', messages)
}

/** I22 for a document in the TrueType WOFF2 face: its pages paint the same pixels as with the TTF file of the same font. */
export const checkSameRaster = (woff2: PopplerRead, ttf: PopplerRead): Violation[] => {
  const messages: string[] = []
  if (woff2.rasters.length !== ttf.rasters.length) messages.push(`${woff2.rasters.length} pages with the WOFF2 face, ${ttf.rasters.length} with its TTF file`)
  woff2.rasters.forEach((raster, index) => {
    const other = ttf.rasters[index]
    if (!other) return
    let differing = 0
    raster.pixels.forEach((value, pixel) => {
      if (value !== other.pixels[pixel]) differing += 1
    })
    if (raster.width !== other.width || raster.height !== other.height || differing > 0) {
      messages.push(`page ${index + 1}: ${differing} pixels differ between the WOFF2 face and its TTF file`)
    }
  })
  return violations('I22', messages)
}

// ---------------------------------------------------------------------------

/** Every rule on one rendered document; `moved` is the render's moved notes, which F3 compares (absent: not compared). Rules hold vacuously where a profile writes nothing they check. */
export const checkDocument = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf, moved?: MovedNotes): Violation[] => {
  const view = tokenView(expectations, read)
  return [
    ...checkFlowTokensOnce(expectations, view),
    ...checkInsidePage(spec, expectations, read, view),
    ...checkDocumentOrder(expectations, view),
    ...checkUnbreakable(expectations, view),
    ...checkFill(spec, expectations, view),
    ...checkSpacing(spec, expectations, read, view),
    ...checkNotes(spec, expectations, read, view, moved),
    ...checkColumnContainers(spec, expectations, view),
    ...checkFixedPages(expectations, view),
    ...checkPageNumbers(expectations, view),
    ...checkTables(expectations, read, view),
    ...checkLinks(expectations, read, view),
    ...checkBoxes(expectations, read, view),
    ...checkForms(spec, expectations, read, view),
    ...checkFonts(expectations, read, view),
    ...checkTagged(expectations, read),
    ...checkReadingOrder(expectations, read),
    ...checkOutlines(read),
  ]
}

/** I10: equal bytes. */
export const checkSameBytes = (label: string, reference: Uint8Array, others: readonly Uint8Array[]): Violation[] => {
  const differing = others
    .map((bytes, index) => ({ index, same: Buffer.from(bytes).equals(Buffer.from(reference)) }))
    .filter(entry => !entry.same)
  return violations('I10', differing.map(entry => `${label} render ${entry.index + 2} differs from render 1`))
}

// ---------------------------------------------------------------------------
// I11, I12, I15: isolation, limits, invalid documents.

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/**
 * I15: the one fault of an invalid document gives the expected typed error,
 * the message names the faulty element and is the message of the check the
 * kind tests (not of another check), no password shows, and no PDF comes
 * back. `rendered` is the PDF when the render resolved.
 */
export const checkInvalid = (expected: ExpectedError, outcome: { rendered: Uint8Array } | { error: unknown }): Violation[] => {
  if ('rendered' in outcome) return violations('I15', [`the fault rendered a PDF of ${outcome.rendered.byteLength} bytes`])
  const { error } = outcome
  if (!(error instanceof NuxtPdfError)) return violations('I15', [`untyped rejection ${errorText(error).slice(0, 200)}`])
  const messages: string[] = []
  if (error.code !== expected.code) messages.push(`code ${error.code}, expected ${expected.code}: ${error.message.slice(0, 200)}`)
  if (!new RegExp(`<${expected.element}[\\s>]`).test(error.message)) messages.push(`message does not name <${expected.element}>: ${error.message.slice(0, 200)}`)
  if (!expected.message.test(error.message)) messages.push(`another check caught the fault: ${error.message.slice(0, 200)}`)
  if (expected.secret !== undefined && `${error.message}\n${error.stack ?? ''}`.includes(expected.secret)) messages.push('message or stack holds the password')
  return violations('I15', messages)
}

/** I11: a render repeated after other renders gives the same bytes and no token of them. */
export const checkIsolated = (label: string, reference: Uint8Array, again: Uint8Array, againWords: readonly string[], foreign: ReadonlySet<string>): Violation[] => {
  const messages: string[] = []
  if (!Buffer.from(again).equals(Buffer.from(reference))) messages.push(`${label}: bytes differ from the first render`)
  const leaked = againWords.filter(word => foreign.has(word))
  if (leaked.length > 0) messages.push(`${label}: holds tokens of the other document: ${[...new Set(leaked)].slice(0, 5).join(', ')}`)
  return violations('I11', messages)
}

export type LimitKey = 'maxPages' | 'maxNodes' | 'timeoutMs'

/**
 * I12: a render under a small limit stays inside it or fails with
 * PDF_LIMIT_EXCEEDED naming that limit. `size` is the document's page count
 * (maxPages) or mounted node count (maxNodes), measured without the limit.
 */
export const checkLimit = (
  key: LimitKey,
  limit: number,
  size: number | undefined,
  outcome: { pages: number } | { error: unknown },
): Violation[] => {
  const label = `${key} ${limit}${size === undefined ? '' : ` (document: ${size})`}`
  if ('pages' in outcome) {
    if (key === 'maxPages' && outcome.pages > limit) return violations('I12', [`${label}: rendered ${outcome.pages} pages`])
    if (size !== undefined && size > limit) return violations('I12', [`${label}: rendered, but the document is over the limit`])
    return []
  }
  const { error } = outcome
  if (!(error instanceof NuxtPdfError) || error.code !== PDF_ERROR_CODES.LimitExceeded) {
    return violations('I12', [`${label}: failed with ${errorText(error).slice(0, 200)}`])
  }
  if (!error.message.includes(`limits.${key}`)) return violations('I12', [`${label}: the error does not name limits.${key}: ${error.message.slice(0, 200)}`])
  if (size !== undefined && size <= limit) return violations('I12', [`${label}: failed inside the limit: ${error.message.slice(0, 200)}`])
  return []
}
