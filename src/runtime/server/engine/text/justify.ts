// Alignment and justification of a line (after textkit's
// `justifyLine` and its `justification` engine, after Apple's justification
// priorities). Only growing happens: a line is justified when it is no
// wider than its box, so the gap to fill is never negative.
import type { RunStyle } from './attributed'
import { textWidth, type ShapedText } from './metrics'
import type { Glyph, Rect } from './types'

interface Factor {
  /** How much of the gap goes before and after the glyph, relative to the other glyphs. */
  before: number
  after: number
  /** Spaces grow first; letters only when spaces alone cannot fill the gap. */
  priority: typeof SPACE_PRIORITY | typeof LETTER_PRIORITY
}

const SPACE_PRIORITY = 1
const LETTER_PRIORITY = 2
const PRIORITIES = [SPACE_PRIORITY, LETTER_PRIORITY] as const
const SPACE_FACTOR: Factor = { before: 0.5, after: 0.5, priority: SPACE_PRIORITY }
const LETTER_FACTOR: Factor = { before: 37 / 256, after: 37 / 256, priority: LETTER_PRIORITY }
const SPACE = 32
/** U+FFFC, the character a leader stands for. */
const OBJECT_REPLACEMENT = 0xFFFC

const isMark = (glyph: Glyph): boolean => 'isMark' in glyph && glyph.isMark

/**
 * The factors of one run's glyphs. A space that ends the run takes nothing
 * between it and the glyph before; a mark grows as the glyph it sits on,
 * and nothing goes between them.
 */
const runFactors = (glyphs: readonly Glyph[]): Factor[] => {
  const factors: Factor[] = []
  glyphs.forEach((glyph, index) => {
    const previous = factors[index - 1]
    let factor: Factor
    if (glyph.codePoints.includes(SPACE)) {
      factor = { ...SPACE_FACTOR }
      if (index === glyphs.length - 1) {
        factor.before = 0
        if (previous) previous.after = 0
      }
    }
    else if (isMark(glyph) && previous) {
      factor = { ...previous, before: 0 }
      previous.after = 0
    }
    else {
      factor = { ...LETTER_FACTOR }
    }
    factors.push(factor)
  })
  return factors
}

/**
 * The width to add after each glyph. The space priority fills the gap if it
 * can; else it grows fully and the letter priority fills the rest; a gap
 * that both cannot fill goes to the first priority present, against its
 * factors.
 */
const distancesOf = (gap: number, factors: readonly Factor[]): number[] => {
  let total = 0
  const sums = { [SPACE_PRIORITY]: 0, [LETTER_PRIORITY]: 0 }
  for (const factor of factors) {
    const sum = factor.before + factor.after
    total += sum
    sums[factor.priority] += sum
  }
  const scales = { [SPACE_PRIORITY]: 0, [LETTER_PRIORITY]: 0 }
  let first: Factor['priority'] | undefined
  let remaining = gap
  for (const priority of PRIORITIES) {
    const sum = sums[priority]
    if (sum === 0) continue
    first ??= priority
    if (Math.abs(remaining) <= Math.abs(sum)) {
      scales[priority] = remaining / sum
      remaining = 0
      break
    }
    scales[priority] = 1
    remaining -= sum
  }
  if (remaining > 0 && first !== undefined) scales[first] = (sums[first] + (gap - total)) / sums[first]
  return factors.map((factor, index) => {
    const next = factors[index + 1]
    let distance = factor.after * scales[factor.priority]
    if (next) distance += next.before * scales[next.priority]
    return distance
  })
}

/** The line with each glyph's advance grown by `sign` times its share of `gap`, as `justified` spreads it. */
const spreadBy = <Line extends ShapedText>(line: Line, gap: number, sign: 1 | -1): Line => {
  const factors = line.runs.flatMap(run => runFactors(run.glyphs))
  const first = factors[0]
  const last = factors[factors.length - 1]
  // A line without glyphs has nothing to spread the gap over (textkit failed on it).
  if (gap === 0 || !first || !last) return line
  first.before = 0
  last.after = 0
  const distances = distancesOf(gap, factors)
  let index = 0
  const runs = line.runs.map(run => ({
    ...run,
    positions: run.positions.map(position => ({ ...position, xAdvance: position.xAdvance + sign * distances[index++]! })),
  }))
  return { ...line, runs }
}

/** The line with its gap spread between its glyphs. */
const justified = <Line extends ShapedText & { box: Rect }>(line: Line): Line => spreadBy(line, line.box.width - textWidth(line), 1)

const ALIGN_FACTORS = { left: 0, justify: 0, center: 0.5, right: 1 }

type LineRun = ShapedText['runs'][number]

const isLeader = (run: LineRun, glyph: Glyph): boolean => Boolean(run.attributes.leader) && glyph.codePoints.includes(OBJECT_REPLACEMENT)

const leaderCount = (line: ShapedText): number =>
  line.runs.reduce((count, run) => count + run.glyphs.filter(glyph => isLeader(run, glyph)).length, 0)

/** The line with each of its `count` leaders grown by its share of `gap` (negative: shrunk back). */
const fillLeaders = <Line extends ShapedText>(line: Line, gap: number, count: number): Line => ({
  ...line,
  runs: line.runs.map(run => run.attributes.leader
    ? { ...run, positions: run.positions.map((position, index) => isLeader(run, run.glyphs[index]!) ? { ...position, xAdvance: position.xAdvance + gap / count } : position) }
    : run),
})

/**
 * The line moved in its box by its alignment, or justified when `justify`
 * and no wider than its box. A line with leaders gives its whole gap to
 * them, in equal shares, and is neither moved nor justified: the text after
 * the last leader ends at the box's right edge.
 */
export const alignLine = <Line extends ShapedText & { box: Rect }>(line: Line, align: RunStyle['align'] | undefined): Line => {
  const width = textWidth(line)
  const remaining = Math.max(0, line.box.width - width)
  const leaders = leaderCount(line)
  if (leaders > 0) return fillLeaders(line, remaining, leaders)
  const aligned = { ...line, box: { ...line.box, x: line.box.x + remaining * (align ? ALIGN_FACTORS[align] : 0) } }
  return align === 'justify' && width <= line.box.width ? justified(aligned) : aligned
}

/**
 * The line as it was before `alignLine(line, align)`: without the `spread`
 * that justification or its leaders gave its glyphs (the same shares, taken
 * back), and at the x it had in its box.
 */
export const unalignLine = <Line extends ShapedText & { box: Rect }>(line: Line, align: RunStyle['align'] | undefined, spread: number): Line => {
  const leaders = leaderCount(line)
  if (leaders > 0) return fillLeaders(line, -spread, leaders)
  const natural = spreadBy(line, spread, -1)
  const remaining = Math.max(0, natural.box.width - textWidth(natural))
  return { ...natural, box: { ...natural.box, x: natural.box.x - remaining * (align ? ALIGN_FACTORS[align] : 0) } }
}
