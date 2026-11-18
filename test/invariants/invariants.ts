// One function per rule. Each returns the violations it found; an empty list
// means the rule holds for this document.
import { NuxtPdfError, PDF_ERROR_CODES } from '../../src/runtime/shared/errors'
import { figureAlt, TAGGED_LANGUAGE, TAGGED_TITLE, type LinkRect, type OutlineEntry, type Paint, type ReadPdf, type Run, type Word } from './document'
import type { ExpectedError } from './faults'
import {
  CELL_PAD_X,
  pageGeometry,
  SCRIPT_FONTS,
  type BookmarkFact,
  type CellFact,
  type DocumentSpec,
  type Expectations,
  type NumberFact,
  type TokenFact,
} from './generator'

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10' | 'I11' | 'I12' | 'I13' | 'I14' | 'I15' | 'I16' | 'I17' | 'I18' | 'I19' | 'PDF'

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
  pageCount: number
  /** Index of the PdfPage element each PDF page belongs to (1-based pages, index 0 unused). */
  pdfPageOf: number[]
}

export const tokenView = (expectations: Expectations, read: ReadPdf): TokenView => {
  const tokens = new Map<string, Word[]>()
  const numbers = new Map<string, Array<{ word: Word, value: number | undefined }>>()
  const unknown: Word[] = []
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
    if (expectations.rtl.length > 0 && RTL_WORD.test(word.text)) continue
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
  return { tokens, numbers, unknown, pageCount, pdfPageOf }
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
// I4: flow tokens of one column in document order; a table is one unit.

interface Placed {
  name: string
  order: number
  word: Word
}

const flowPlacements = (expectations: Expectations, view: TokenView): Placed[] => {
  const placed: Placed[] = []
  for (const fact of expectations.tokens.values()) {
    const words = view.tokens.get(fact.token)
    if (onceKinds.has(fact.kind) && words?.length === 1) placed.push({ name: fact.token, order: fact.order, word: words[0]! })
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
  const units: Array<{ name: string, first: Word, last: Word }> = []
  let current: { order: number, placed: Placed[] } | undefined
  const close = () => {
    if (!current) return
    const words = current.placed.map(placed => placed.word)
    const first = firstRead(words)
    const last = lastRead(words)
    const name = (word: Word) => current!.placed.find(placed => placed.word === word)!.name
    units.push({ name: current.placed.length > 1 ? `${name(first)}…${name(last)}` : name(first), first, last })
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
    if (!readsAfter(a.last, b.first)) messages.push(`${b.name} at ${describeWord(b.first)} before ${a.name} at ${describeWord(a.last)}`)
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
    if (run.x < -POSITION_TOLERANCE || right > page.width + POSITION_TOLERANCE || run.y < -POSITION_TOLERANCE || top > page.height + POSITION_TOLERANCE) {
      messages.push(`${label} outside the ${page.width}×${page.height} page`)
      continue
    }
    if (kind !== 'flow') continue
    const [padTop, padRight, padBottom, padLeft] = spec.pages[view.pdfPageOf[run.page] ?? 0]!.padding
    if (run.x < padLeft - POSITION_TOLERANCE || right > page.width - padRight + POSITION_TOLERANCE
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
 * unbreakable row on one page; rows in order, each token once; every line of
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
 * I17 (internals/features/f5a-forms.md, "A form profile"): one widget and one
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
 * drawn in that font; each right-to-left word is in a right-to-left run of
 * the Arabic font (one run per text at least); a tagged document draws no
 * text in the standard font Helvetica.
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
  const counts = Map.groupBy(expectations.rtl, entry => entry.word)
  for (const [word, entries] of counts) {
    const runs = read.runs.filter(run => run.text.includes(word) && run.direction === 'rtl' && run.font === SCRIPT_FONTS.rtl.postscript)
    if (runs.length < entries.length) messages.push(`${entries.length} right-to-left texts with "${entries[0]!.code}…" hold the word, ${runs.length} right-to-left runs of ${SCRIPT_FONTS.rtl.postscript} show it`)
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

// ---------------------------------------------------------------------------

/** Every rule on one rendered document. Rules hold vacuously where a profile writes nothing they check. */
export const checkDocument = (spec: DocumentSpec, expectations: Expectations, read: ReadPdf): Violation[] => {
  const view = tokenView(expectations, read)
  return [
    ...checkFlowTokensOnce(expectations, view),
    ...checkInsidePage(spec, expectations, read, view),
    ...checkDocumentOrder(expectations, view),
    ...checkUnbreakable(expectations, view),
    ...checkFixedPages(expectations, view),
    ...checkPageNumbers(expectations, view),
    ...checkTables(expectations, read, view),
    ...checkLinks(expectations, read, view),
    ...checkBoxes(expectations, read, view),
    ...checkForms(spec, expectations, read, view),
    ...checkFonts(expectations, read, view),
    ...checkTagged(expectations, read),
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
