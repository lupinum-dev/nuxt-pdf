// A text as one string with styled runs, before shaping (after
// textkit's `fromFragments`, `applyDefaultStyles`, `splitParagraphs` and
// `flatten`).
import type { Font, Fragment, InlineImage, Leader, TextAnchor, TextStyle } from './types'
import { breakOpportunities } from './words'

/**
 * The style of a run, with textkit's defaults: what the line breaker, the
 * typesetter, the finishing steps and the readers of a line use.
 */
export interface RunStyle {
  align: 'left' | 'right' | 'center' | 'justify'
  textWrap: 'wrap' | 'pretty'
  alignLastLine: 'left' | 'right' | 'center'
  anchors: readonly TextAnchor[] | null
  attachment: InlineImage | null
  backgroundColor: string | null
  /** Points above the line's baseline (`TextStyle.baselineShift`). */
  baselineShift: number
  /** Points above the line's baseline of the underline's baseline (`TextStyle.underlineShift`). */
  underlineShift: number
  /** The font size the underline's thickness comes from (`TextStyle.underlineSize`). */
  underlineSize: number
  characterSpacing: number
  color: string
  font: Font[]
  fontSize: number
  fontVariantNumeric: 'normal' | 'tabular-nums'
  leader: Leader | null
  lineHeight: number | null
  link: string | null
  opacity: number | undefined
  /** Set by itemization: the Unicode script of the run. */
  script: string | null
  strike: boolean
  strikeColor: string
  strikeStyle: 'solid' | 'dashed' | 'dotted'
  underline: boolean
  underlineColor: string
  underlineStyle: 'solid' | 'dashed' | 'dotted'
}

/**
 * A run before shaping. Itemization adds `bidiLevel`, `script` and `scale`
 * and replaces `font` by the one font of the run.
 */
export interface StyledRun {
  start: number
  end: number
  attributes: Partial<RunStyle> & { bidiLevel?: number, scale?: number }
}

export interface Paragraph {
  string: string
  runs: StyledRun[]
}

/**
 * The font size of a text that sets none, as in textkit: 18 points. A page's
 * `fontSize` is also the `rem` base, so a page without one gives this.
 */
export const DEFAULT_FONT_SIZE = 18

/**
 * The defaults for a style. Each value is read with `||`, so an empty string
 * and false fall back, as in textkit. Admission rejects a `fontSize` of 0
 * (sign rule `positive`), so every text has its own font size here.
 */
const runStyle = (style: TextStyle): RunStyle => ({
  align: style.align || 'left',
  textWrap: style.textWrap || 'wrap',
  alignLastLine: style.align === 'justify' ? 'left' : style.align || 'left',
  anchors: style.anchors || null,
  attachment: style.attachment || null,
  backgroundColor: style.backgroundColor || null,
  baselineShift: style.baselineShift || 0,
  characterSpacing: style.characterSpacing || 0,
  color: style.color || 'black',
  font: [...style.fonts],
  fontSize: style.fontSize,
  fontVariantNumeric: style.fontVariantNumeric || 'normal',
  leader: style.leader || null,
  lineHeight: style.lineHeight || null,
  link: style.link || null,
  opacity: style.opacity,
  script: null,
  strike: style.strike || false,
  strikeColor: style.strikeColor || style.color || 'black',
  strikeStyle: style.decorationStyle || 'solid',
  underline: style.underline || false,
  underlineColor: style.underlineColor || style.color || 'black',
  underlineShift: style.underlineShift || 0,
  underlineSize: style.underlineSize || style.fontSize,
  underlineStyle: style.decorationStyle || 'solid',
})

/** The fragments as one string, a run with the defaulted style of each fragment. */
export const fromFragments = (fragments: readonly Fragment[]): Paragraph => {
  let string = ''
  const runs = fragments.map((fragment) => {
    const run = { start: string.length, end: string.length + fragment.string.length, attributes: runStyle(fragment.style) }
    string += fragment.string
    return run
  })
  return { string, runs }
}

/**
 * The part of a paragraph from `start` to `end`, before shaping: the runs
 * that overlap it, cut to it and moved to start at 0. A paragraph boundary
 * always falls inside a run, since the runs cover the string.
 */
const slice = (start: number, end: number, paragraph: Paragraph): Paragraph => {
  if (paragraph.string.length === 0) return paragraph
  const first = paragraph.runs.findIndex(run => run.start <= start && start < run.end)
  const last = Math.max(paragraph.runs.findIndex(run => run.start <= end - 1 && end - 1 < run.end), first)
  const runs = paragraph.runs.slice(first, last + 1).map((run, index, kept) => {
    const isFirst = index === 0
    const isLast = !isFirst && index === kept.length - 1
    const runStart = isFirst ? start : run.start
    const runEnd = isFirst || isLast ? Math.min(run.end, end) : run.end
    return { ...run, start: runStart - start, end: runEnd - start }
  })
  return { string: paragraph.string.slice(start, end), runs }
}

/**
 * The paragraphs of a text: each ends where a line must break (UAX #14:
 * after a line feed, a carriage return not before a line feed, a line or
 * paragraph separator, a next line, a form feed or a vertical tab), the last
 * one at the end.
 */
export const splitParagraphs = (text: Paragraph): Paragraph[] => {
  const paragraphs: Paragraph[] = []
  let start = 0
  for (const { position, required } of breakOpportunities(text.string)) {
    if (!required) continue
    paragraphs.push(slice(start, position, text))
    start = position
  }
  if (start === 0) paragraphs.push(text)
  else if (start < text.string.length) paragraphs.push(slice(start, text.string.length, text))
  return paragraphs
}

type Attributes = StyledRun['attributes']

/**
 * Runs of the same length merged into one: the last run with every
 * attribute, later runs winning.
 */
const mergeEmptyRuns = (runs: readonly StyledRun[]): StyledRun[] => {
  const groups = new Map<number, StyledRun[]>()
  for (const run of runs) groups.set(run.start, [...(groups.get(run.start) ?? []), run])
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) =>
    group.reduce<StyledRun>((merged, run) => ({ ...run, attributes: { ...merged.attributes, ...run.attributes } }), { start: 0, end: 0, attributes: {} }))
}

/**
 * Overlapping runs cut at every boundary. Each piece gets the attributes of
 * every run that covers it, merged in the order the runs started (by offset,
 * then by the order of `runs`), a later run winning.
 *
 * Performance (`flattenRegularRuns` took 5.8 % self time in a profile): each piece
 * copies the merged attributes again. Pieces could share one object per
 * set of covering runs once no later stage mutates attributes.
 */
const flattenRegularRuns = (runs: readonly StyledRun[]): StyledRun[] => {
  const points: Array<{ start: boolean, offset: number, attributes: Attributes, index: number }> = []
  runs.forEach((run, index) => {
    points.push({ start: true, offset: run.start, attributes: run.attributes, index })
    points.push({ start: false, offset: run.end, attributes: run.attributes, index })
  })
  points.sort((a, b) => a.offset - b.offset || a.index - b.index)
  const pieces: StyledRun[] = []
  let start = -1
  let attributes: Attributes = {}
  const open: Attributes[] = []
  for (const point of points) {
    if (start !== -1 && start < point.offset) {
      // Textkit also gave each piece empty glyph arrays, which shaping always replaces.
      pieces.push({ start, end: point.offset, attributes })
    }
    if (point.start) {
      open.push(point.attributes)
      attributes = { ...attributes, ...point.attributes }
    }
    else {
      attributes = {}
      for (let index = 0; index < open.length; index += 1) {
        if (open[index] === point.attributes) open.splice(index--, 1)
        else attributes = { ...attributes, ...open[index] }
      }
    }
    start = point.offset
  }
  return pieces
}

/**
 * Overlapping runs cut at every boundary, each piece with the attributes of
 * every run that covers it; empty runs merged per offset. Sorted by start,
 * then end.
 */
export const flattenRuns = (runs: readonly StyledRun[]): StyledRun[] => {
  const empty = mergeEmptyRuns(runs.filter(run => run.start === run.end))
  const regular = flattenRegularRuns(runs.filter(run => run.start !== run.end))
  return [...empty, ...regular].sort((a, b) => a.start - b.start || a.end - b.end)
}
