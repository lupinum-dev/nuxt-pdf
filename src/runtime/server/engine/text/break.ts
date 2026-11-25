// Line breaking (D36, D42, D44): textkit's
// `linebreaker` with its Knuth–Plass and best-fit breakers and the D30 rules
// (spaces have no shrink, a hyphenation point has the width of its hyphen, a
// line wider than its box without shrink is no candidate unless by at most
// 1e-6). The active nodes are an array instead of textkit's linked list.
// Every sum keeps textkit's order, so the breaks are textkit's to the last
// bit.
import { DEFAULT_FONT_SIZE } from './attributed'
import { appendGlyph, firstGlyphAt, runIndexAt, sliceText } from './cut'
import { advanceOf, advanceWidth, fontOf, scaleOf } from './metrics'
import type { ShapedParagraph, ShapedRun } from './shape'
import type { TextOptions } from './types'

/** A piece of text: a syllable, or a word when words are not hyphenated. */
interface Box { type: 'box', width: number, start: number, end: number }

/**
 * Spaces between pieces: a place to break, which may stretch but never
 * shrink. A leader's glue has `fill` 1, an infinite stretch of a higher
 * order than `stretch` (TeX's `fill`); every other glue has 0.
 */
interface Glue { type: 'glue', width: number, start: number, end: number, stretch: number, shrink: number, fill: number }

/**
 * A place to break inside a word (`width` is its hyphen, and `addsHyphen`
 * is set), a break after a hyphen the text has (no width), a place where
 * no break may be, or the forced break that ends a paragraph. `end` is
 * where the line ends when it breaks here.
 */
interface Penalty { type: 'penalty', width: number, penalty: number, end: number, addsHyphen: boolean }

export type BreakNode = Box | Glue | Penalty

/** A penalty no break can have, and the penalty of a forced break, negated. */
const INFINITY = 10000
const HYPHEN = 0x002D
/** The hyphens a text may have, U+002D and U+2010, after which a line breaks at a cost and adds none. */
const EXPLICIT_HYPHENS = new Set(['-', '\u2010'])
/** TeX's `\exhyphenpenalty`: a break after a hyphen of the text is avoided unless it helps. */
const EXPLICIT_HYPHEN_PENALTY = 50
/** U+FFFC, the character an inline image or a leader stands for. */
const ATTACHMENT = '\uFFFC'
const TOLERANCE_STEPS = 5
const TOLERANCE_LIMIT = 50
/** A space stretches by half its width (textkit's `opts`: width 3, stretch 6). */
const SPACE = { width: 3, stretch: 6 }
const DEMERITS = { line: 10, fitness: 3000 }
/**
 * The demerits `textWrap: 'pretty'` adds (D50): for two lines in a row that
 * end at a hyphen (TeX's `\doublehyphendemerits`), for a hyphen on the line
 * before the last (`\finalhyphendemerits`), and as much for a last line
 * shorter than `runtShare` of its line length. They are TeX's 10,000 and
 * 5,000 times 10,000: at tolerance 4 a line's badness reaches 6,400, not
 * TeX's 200, and TeX's values changed 1 of 162 justified test paragraphs.
 * These avoid 56 of 60 bad endings for 0.38 pt more on the widest word gap.
 */
const PRETTY = { doubleHyphen: 1e8, finalHyphen: 5e7, runt: 5e7, runtShare: 1 / 6 }
/**
 * The stretch at the end of a line of text that is not justified, in ems of
 * its paragraph's first font size: TeX's `\rightskip 0pt plus 3em`
 * (D42). Its spaces then do not stretch, so any gap is feasible, the
 * badness prefers even lines, and the hyphen penalty decides where to break.
 */
const RAGGED_STRETCH = 3

// --- Widths

const runWidthBetween = (start: number, end: number, run: ShapedRun): number => {
  const from = Math.max(0, firstGlyphAt(start - run.start, run))
  const to = Math.max(0, firstGlyphAt(end - run.start, run))
  return advanceWidth(run.positions.slice(from, to))
}

/** The advances from code unit `start` to `end`, run by run. */
const widthBetween = (start: number, end: number, { runs }: ShapedParagraph): number => {
  const first = runIndexAt(start, runs)
  const last = Math.max(runIndexAt(end - 1, runs), first)
  return runs.slice(first, last + 1).reduce((width, run) => width + runWidthBetween(start, end, run), 0)
}

/** The hyphen added at a break before `end`: its advance in the font of the character before. */
const hyphenWidth = ({ runs }: ShapedParagraph, end: number): number => {
  const run = runs[runIndexAt(end - 1, runs)]
  const glyph = run && fontOf(run)?.glyphForCodePoint(HYPHEN)
  return run && glyph ? advanceOf(glyph) * scaleOf(run) : 0
}

// --- Nodes

/** Whether the character at `offset` is a leader's U+FFFC (`RunStyle.leader`), not an inline image's. */
const isLeaderAt = (offset: number, paragraph: ShapedParagraph): boolean =>
  paragraph.string[offset] === ATTACHMENT && Boolean(paragraph.runs[runIndexAt(offset, paragraph.runs)]?.attributes.leader)

/**
 * The nodes of a paragraph: a glue for each piece of spaces, a box for each
 * other syllable, and a penalty with a hyphen between two boxes (a hyphen
 * point of a word); then the final glue and the forced break. Between two
 * words with no space between them (`WrappedParagraph.opportunities`: two
 * ideographs, after a slash, an en dash or a zero-width space, next to an
 * inline image) a line may break with no hyphen: there two boxes get a glue
 * with no width and no stretch, the break the breaker already has without
 * a hyphen. After a hyphen of the text (U+002D, U+2010) they get a penalty
 * of 50 with no width instead, TeX's `\exhyphenpenalty`: the line ends in
 * that hyphen and adds none, and the break is taken only when it helps.
 * The spaces at the start and the end of the paragraph have no width.
 *
 * A leader is a penalty that forbids a break (TeX's `\nobreak`) and a glue
 * of its margins' width that stretches by `fill`. Spaces right before it
 * get such a penalty too, and a glue that follows no box is no break, so
 * the word before a leader, the leader, and the text after it up to the
 * next space stay on one line.
 */
export const breakNodes = (paragraph: ShapedParagraph, hyphenationPenalty?: number): BreakNode[] => {
  const align = paragraph.runs[0]?.attributes.align
  const hyphenPenalty = hyphenationPenalty || (align === 'justify' ? 100 : 600)
  const { syllables } = paragraph
  const nodes: BreakNode[] = []
  const pushLeader = (at: number) => {
    const last = nodes[nodes.length - 1]
    if (last?.type === 'glue' && nodes[nodes.length - 2]?.type === 'box') nodes.splice(nodes.length - 1, 0, { type: 'penalty', width: 0, penalty: INFINITY, end: last.start, addsHyphen: false })
    nodes.push({ type: 'penalty', width: 0, penalty: INFINITY, end: at, addsHyphen: false })
    nodes.push({ type: 'glue', width: widthBetween(at, at + 1, paragraph), start: at, end: at + 1, stretch: 0, shrink: 0, fill: 1 })
  }
  /** A box from `start` to `end`, and the break after it when `next`, the syllable after, is not a leader. */
  const pushBox = (start: number, end: number, syllable: string, next: string | undefined) => {
    const width = widthBetween(start, end, paragraph)
    // Spaces, one or more, and a line break are glue: no hyphen point.
    const beforeBox = next !== undefined && next.trim() !== '' && !isLeaderAt(end, paragraph)
    const opportunity = beforeBox && paragraph.opportunities.has(end)
    nodes.push({ type: 'box', width, start, end })
    if (opportunity && EXPLICIT_HYPHENS.has(paragraph.string.charAt(end - 1))) nodes.push({ type: 'penalty', width: 0, penalty: EXPLICIT_HYPHEN_PENALTY, end, addsHyphen: false })
    else if (opportunity) nodes.push({ type: 'glue', width: 0, start: end, end, stretch: 0, shrink: 0, fill: 0 })
    else if (beforeBox) nodes.push({ type: 'penalty', width: hyphenWidth(paragraph, end), penalty: hyphenPenalty, end, addsHyphen: true })
  }
  let start = 0
  syllables.forEach((syllable, index) => {
    const end = start + syllable.length
    if (syllable.trim() === '') {
      const width = widthBetween(start, end, paragraph)
      nodes.push({ type: 'glue', width, start, end, stretch: (width * SPACE.width) / SPACE.stretch, shrink: 0, fill: 0 })
    }
    else {
      // A syllable splits at each leader in it into the boxes between them.
      let from = start
      for (let at = syllable.indexOf(ATTACHMENT); at !== -1; at = syllable.indexOf(ATTACHMENT, at + 1)) {
        if (!isLeaderAt(start + at, paragraph)) continue
        if (start + at > from) pushBox(from, start + at, syllable.slice(from - start, at), syllable.slice(at))
        pushLeader(start + at)
        from = start + at + 1
      }
      if (end > from) pushBox(from, end, syllable.slice(from - start), syllables[index + 1])
    }
    start = end
  })
  // The spaces at both ends of a paragraph take no room (CSS removes them;
  // the line keeps them outside its box, `overflowLeft`/`overflowRight`), so
  // a box as wide as the glyphs holds them.
  for (const at of new Set([0, nodes.length - 1])) {
    const node = nodes[at]
    if (node?.type === 'glue' && node.fill === 0) nodes[at] = { ...node, width: 0, stretch: 0 }
  }
  nodes.push({ type: 'glue', width: 0, start, end: start, stretch: INFINITY, shrink: 0, fill: 0 })
  nodes.push({ type: 'penalty', width: 0, penalty: -INFINITY, end: start, addsHyphen: false })
  return nodes
}

/**
 * Whether a line may break at node `index`: at a penalty other than the one
 * that forbids it, or at a glue right after a box.
 */
export const breaksAt = (nodes: readonly BreakNode[], index: number): boolean => {
  const node = nodes[index]!
  if (node.type === 'penalty') return node.penalty !== INFINITY
  return node.type === 'glue' && index > 0 && nodes[index - 1]!.type === 'box'
}

// --- Knuth–Plass

interface Totals { width: number, stretch: number, shrink: number, fill: number }

interface Breakpoint {
  position: number
  demerits: number
  line: number
  fitnessClass: number
  totals: Totals
  previous: Breakpoint | null
}

const isForced = (node: BreakNode): boolean => node.type === 'penalty' && node.penalty === -INFINITY

/**
 * How far the line from `active` to `end` stretches (positive) or shrinks
 * (negative), per unit it may. A ragged line (`raggedStretch` set) stretches
 * by that at its end instead of at its spaces; the last line keeps the final
 * glue's infinite stretch, so it may be short. A line with a leader that
 * fits has 0: the leader takes its gap (justify.ts), so it never decides
 * the breaks.
 */
// Textkit reads the length of line `currentLine` here, and the last one
// from the line before the last on.
const lineLengthOf = (lineLengths: readonly number[], currentLine: number): number =>
  currentLine < lineLengths.length ? lineLengths[currentLine - 1]! : lineLengths[lineLengths.length - 1]!

const ratioOf = (nodes: readonly BreakNode[], lineLengths: readonly number[], sum: Totals, end: number, active: Breakpoint, currentLine: number, raggedStretch: number | undefined): number => {
  let width = sum.width - active.totals.width
  const lineLength = lineLengthOf(lineLengths, currentLine)
  const node = nodes[end]!
  if (node.type === 'penalty') width += node.width
  if (sum.fill - active.totals.fill > 0 && width <= lineLength) return 0
  if (width < lineLength) {
    const stretch = raggedStretch !== undefined && !isForced(node) ? raggedStretch : sum.stretch - active.totals.stretch
    return stretch > 0 ? (lineLength - width) / stretch : INFINITY
  }
  if (width > lineLength) {
    const shrink = sum.shrink - active.totals.shrink
    if (shrink > 0) return (lineLength - width) / shrink
    return width - lineLength <= 1e-6 ? 0 : -INFINITY
  }
  return 0
}

/** The totals after a break at `index`: the glue up to the next box or forced break counts as before the line. */
const totalsAfter = (nodes: readonly BreakNode[], sum: Totals, index: number): Totals => {
  const result = { ...sum }
  for (let at = index; at < nodes.length; at += 1) {
    const node = nodes[at]!
    if (node.type === 'glue') {
      result.width += node.width
      result.stretch += node.stretch
      result.shrink += node.shrink
      result.fill += node.fill
    }
    else if (node.type === 'box' || (isForced(node) && at > index)) {
      break
    }
  }
  return result
}

const fitnessOf = (ratio: number): number => {
  if (ratio < -0.5) return 0
  if (ratio <= 0.5) return 1
  if (ratio <= 1) return 2
  return 3
}

const demeritsOf = (node: BreakNode, badness: number): number => {
  if (node.type === 'penalty' && node.penalty >= 0) return Math.pow(DEMERITS.line + badness, 2) + Math.pow(node.penalty, 2)
  if (node.type === 'penalty' && node.penalty !== -INFINITY) return Math.pow(DEMERITS.line + badness, 2) - Math.pow(node.penalty, 2)
  return Math.pow(DEMERITS.line + badness, 2)
}

/** A break at a hyphen, added or of the text: TeX's flagged penalty. */
const isHyphenBreak = (node: BreakNode): boolean => node.type === 'penalty' && node.penalty > -INFINITY && node.penalty < INFINITY

/**
 * The demerits `textWrap: 'pretty'` adds to the line from `from` to `index`
 * (`PRETTY`). They depend only on the breaks at both ends, so two
 * breakpoints at one position still get the same demerits ahead, which the
 * pruning after a settled line needs.
 */
const prettyDemerits = (nodes: readonly BreakNode[], lineLengths: readonly number[], sum: Totals, index: number, from: Breakpoint): number => {
  const node = nodes[index]!
  const afterHyphen = from.previous !== null && isHyphenBreak(nodes[from.position]!)
  let demerits = 0
  if (afterHyphen && isHyphenBreak(node)) demerits += PRETTY.doubleHyphen
  if (isForced(node) && from.previous !== null) {
    if (afterHyphen) demerits += PRETTY.finalHyphen
    if (sum.width - from.totals.width < PRETTY.runtShare * lineLengthOf(lineLengths, from.line + 1)) demerits += PRETTY.runt
  }
  return demerits
}

/**
 * The break positions with the least total demerits, the paragraph start
 * first; none when no set of lines stays inside `tolerance`. The active
 * breakpoints stay sorted by line, as in textkit.
 */
const knuthPlass = (nodes: readonly BreakNode[], lineLengths: readonly number[], tolerance: number, raggedStretch: number | undefined, pretty: boolean): number[] => {
  const active: Breakpoint[] = [{ position: 0, demerits: 0, line: 0, fitnessClass: 0, totals: { width: 0, stretch: 0, shrink: 0, fill: 0 }, previous: null }]
  const sum: Totals = { width: 0, stretch: 0, shrink: 0, fill: 0 }

  // A breakpoint after which every line has the last width (`ratioOf`).
  const settledLine = lineLengths.length - 1

  const tryBreak = (node: BreakNode, index: number) => {
    // The least demerits of the breakpoints this break adds after a settled
    // line, by fitness class (see below).
    const settledBest = [Infinity, Infinity, Infinity, Infinity]
    let at = 0
    while (at < active.length) {
      const candidates: Array<{ from: Breakpoint | undefined, demerits: number }> = [
        { from: undefined, demerits: Infinity },
        { from: undefined, demerits: Infinity },
        { from: undefined, demerits: Infinity },
        { from: undefined, demerits: Infinity },
      ]
      while (at < active.length) {
        const from = active[at]!
        const currentLine = from.line + 1
        const ratio = ratioOf(nodes, lineLengths, sum, index, from, currentLine, raggedStretch)
        // Too long a line, or a forced break: no later line starts here.
        const removed = ratio < -1 || isForced(node)
        if (removed) active.splice(at, 1)
        if (ratio >= -1 && ratio <= tolerance) {
          const badness = 100 * Math.pow(Math.abs(ratio), 3)
          let demerits = demeritsOf(node, badness)
          const fitnessClass = fitnessOf(ratio)
          if (Math.abs(fitnessClass - from.fitnessClass) > 1) demerits += DEMERITS.fitness
          if (pretty) demerits += prettyDemerits(nodes, lineLengths, sum, index, from)
          demerits += from.demerits
          if (demerits < candidates[fitnessClass]!.demerits) candidates[fitnessClass] = { from, demerits }
        }
        if (!removed) at += 1
        // The candidates for this line go in before the breakpoints of later lines.
        if (at < active.length && active[at]!.line >= currentLine) break
      }
      const totals = totalsAfter(nodes, sum, index)
      const atEnd = at >= active.length
      for (const [fitnessClass, { from, demerits }] of candidates.entries()) {
        if (from === undefined) continue
        // Textkit keeps a breakpoint for every number of lines that reaches
        // this break, so the active breakpoints grow with the paragraph and
        // each break costs as many steps: a long paragraph took time in the
        // square of its length. After a settled line, two
        // breakpoints here with one fitness class have the same lines ahead,
        // so the same demerits are added to both, in the same order. The one
        // with more lines (a later line group) and no fewer demerits can then
        // never be chosen: rounding keeps its sum no lower, and on a tie the
        // final choice and each candidate takes the earlier breakpoint, which
        // has fewer lines. It is not added. The breaks stay textkit's.
        if (from.line + 1 >= settledLine) {
          if (demerits >= settledBest[fitnessClass]!) continue
          settledBest[fitnessClass] = demerits
        }
        const added: Breakpoint = { position: index, demerits, line: from.line + 1, fitnessClass, totals, previous: from }
        if (atEnd) {
          active.push(added)
        }
        else {
          active.splice(at, 0, added)
          at += 1
        }
      }
      if (atEnd) return
    }
  }

  nodes.forEach((node, index) => {
    if (node.type === 'box') {
      sum.width += node.width
      return
    }
    if (breaksAt(nodes, index)) tryBreak(node, index)
    if (node.type === 'glue') {
      sum.width += node.width
      sum.stretch += node.stretch
      sum.shrink += node.shrink
      sum.fill += node.fill
    }
  })

  if (active.length === 0) return []
  let best = active[0]!
  for (const breakpoint of active) {
    if (breakpoint.demerits < best.demerits) best = breakpoint
  }
  const positions: number[] = []
  for (let breakpoint: Breakpoint | null = best; breakpoint !== null; breakpoint = breakpoint.previous) positions.push(breakpoint.position)
  return positions.reverse()
}

// --- Best fit, when Knuth–Plass finds no set of lines

/**
 * Whether node `at` belongs to a leader's stretch (`breakNodes`): its glue,
 * the penalty that forbids a break, or a space right before or after it.
 * Best fit breaks at no such node. It keeps textkit's other candidates,
 * which include a glue after a glue.
 */
const isJoined = (nodes: readonly BreakNode[], at: number): boolean => {
  const node = nodes[at]!
  const previous = nodes[at - 1]
  if (node.type === 'penalty') return node.penalty === INFINITY
  if (node.type !== 'glue') return false
  return node.fill > 0 || (previous?.type === 'penalty' && previous.penalty === INFINITY) || (previous?.type === 'glue' && previous.fill > 0)
}

/** The last glue or penalty in the run of them after `start`. */
const lastBreakAfter = (nodes: readonly BreakNode[], start: number): BreakNode => {
  let at = start + 1
  while (at < nodes.length && (nodes[at]!.type === 'glue' || nodes[at]!.type === 'penalty')) at += 1
  return nodes[at - 1]!
}

/** The index before the first box at or after `from`: the last glue or penalty of the run there. */
const lastOfBreaks = (nodes: readonly BreakNode[], from: number): number => {
  let next = from
  while (next < nodes.length && (nodes[next]!.type === 'glue' || nodes[next]!.type === 'penalty')) next += 1
  return next - 1
}

/** The break in `nodes` with the least badness before the line overflows `widths[lineNumber]`, or null when the rest fits. */
const nextBestFit = (nodes: readonly BreakNode[], widths: readonly number[], lineNumber: number): number | null => {
  let position: number | null = null
  let minimumBadness = Infinity
  const sum = { width: 0, stretch: 0, shrink: 0 }
  const lineLength = widths[Math.min(lineNumber, widths.length - 1)]!
  const ratioAt = (node: Glue | Penalty): number => {
    const stretch = node.type === 'glue' ? node.stretch : null
    if (sum.width < lineLength) {
      if (!stretch) return INFINITY
      return sum.stretch - stretch > 0 ? (lineLength - sum.width) / sum.stretch : INFINITY
    }
    const shrink = node.type === 'glue' ? node.shrink : null
    if (sum.width > lineLength) {
      if (!shrink) return INFINITY
      return sum.shrink - shrink > 0 ? (lineLength - sum.width) / sum.shrink : INFINITY
    }
    return 0
  }
  let hyphen = 0
  for (let at = 0; at < nodes.length; at += 1) {
    const node = nodes[at]!
    if (node.type === 'box') sum.width += node.width
    if (node.type === 'glue') {
      sum.width += node.width
      sum.stretch += node.stretch
      sum.shrink += node.shrink
    }
    const lineEnd = lastBreakAfter(nodes, at)
    hyphen = lineEnd.type === 'penalty' ? lineEnd.width : 0
    if (sum.width - sum.shrink + hyphen > lineLength) {
      if (position === null) position = lastOfBreaks(nodes, at === 0 ? at + 1 : at)
      // A leader's stretch never breaks: the line overflows to its end.
      while (isJoined(nodes, position)) {
        let next = position + 1
        while (next < nodes.length && nodes[next]!.type === 'box') next += 1
        position = lastOfBreaks(nodes, next)
      }
      break
    }
    if ((node.type === 'penalty' || node.type === 'glue') && !isJoined(nodes, at)) {
      const badness = 100 * Math.abs(ratioAt(node)) ** 3 + (node.type === 'penalty' ? node.penalty : 0)
      if (minimumBadness >= badness) {
        position = at
        minimumBadness = badness
      }
    }
  }
  return sum.width - sum.shrink + hyphen > lineLength ? position : null
}

/** Each line as long as it fits, at the break with the least badness. */
const bestFit = (nodes: readonly BreakNode[], widths: readonly number[]): number[] => {
  let count = 0
  let lineNumber = 0
  let rest = nodes
  const breakpoints = [0]
  while (rest.length > 0) {
    const breakpoint = nextBestFit(rest, widths, lineNumber)
    if (breakpoint === null) break
    count += breakpoint
    breakpoints.push(count)
    rest = rest.slice(breakpoint + 1)
    count += 1
    lineNumber += 1
  }
  return breakpoints
}

// --- Lines

/** The line with the hyphen of a break inside a word, in its last run's font; none when that run has no font, as `hyphenWidth` measured. */
const hyphenated = (line: ShapedParagraph): ShapedParagraph => {
  const run = line.runs[line.runs.length - 1]
  const glyph = run && fontOf(run)?.glyphForCodePoint(HYPHEN)
  return glyph ? appendGlyph(glyph, line, [HYPHEN]) : line
}

/** The paragraph cut at the breaks, with a hyphen at each break inside a word. The break at the final glue adds no line. */
const breakLines = (paragraph: ShapedParagraph, nodes: readonly BreakNode[], breaks: readonly number[]): ShapedParagraph[] => {
  let start = 0
  const lines: ShapedParagraph[] = []
  for (const breakPoint of breaks) {
    if (breakPoint === nodes.length - 1) continue
    const node = nodes[breakPoint]!
    const line = sliceText(start, node.end, paragraph)
    lines.push(node.type === 'penalty' && node.addsHyphen ? hyphenated(line) : line)
    start = node.end
  }
  lines.push(sliceText(start, paragraph.string.length, paragraph))
  return lines
}

/**
 * The lines of a paragraph in the widths of its lines (the first, then each
 * next; the last width repeats): Knuth–Plass at tolerance 4, raised by 5 up
 * to 50 while it finds no lines, then best fit. Justified text stretches its
 * spaces; other text stretches at its line ends (`RAGGED_STRETCH`). The
 * first run's `textWrap: 'pretty'` adds the `PRETTY` demerits; best fit
 * ignores them.
 */
export const linebreaker = (options: TextOptions) => (paragraph: ShapedParagraph, availableWidths: readonly number[]): ShapedParagraph[] => {
  let tolerance = 4
  const nodes = breakNodes(paragraph, options.hyphenationPenalty)
  const first = paragraph.runs[0]?.attributes
  const raggedStretch = first && first.align !== 'justify' ? RAGGED_STRETCH * (first.fontSize || DEFAULT_FONT_SIZE) : undefined
  const pretty = first?.textWrap === 'pretty'
  let breaks = knuthPlass(nodes, availableWidths, tolerance, raggedStretch, pretty)
  while (breaks.length === 0 && tolerance < TOLERANCE_LIMIT) {
    tolerance += TOLERANCE_STEPS
    breaks = knuthPlass(nodes, availableWidths, tolerance, raggedStretch, pretty)
  }
  if (breaks.length === 0 || (breaks.length === 1 && breaks[0] === 0)) breaks = bestFit(nodes, availableWidths)
  return breakLines(paragraph, nodes, breaks.slice(1))
}
