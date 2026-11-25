// The sizes of shaped text (after textkit's `scale`, `ascent`,
// `descent`, `lineGap`, `height` and `advanceWidth`): what the line breaker,
// the typesetter and the finishing steps read from runs. Each keeps
// textkit's order of operations.
import { DEFAULT_FONT_SIZE, type StyledRun } from './attributed'
import type { ShapedRun } from './shape'
import type { Font, Glyph, Position } from './types'

/** A shaped paragraph or a piece of one: its string and the runs over it. */
export interface ShapedText {
  string: string
  runs: ShapedRun[]
}

/** A run's font; none before itemization gives the run one. */
export const fontOf = (run: StyledRun): Font | undefined => run.attributes.font?.[0] ?? undefined

/** Points per font unit of a run: its own `scale`, else its font size over its font's units per em. */
export const scaleOf = (run: StyledRun): number => {
  const unitsPerEm = fontOf(run)?.unitsPerEm
  return run.attributes.scale || (unitsPerEm ? (run.attributes.fontSize || DEFAULT_FONT_SIZE) / unitsPerEm : 0)
}

/** A glyph's advance in font units. */
export const advanceOf = (glyph: Glyph): number => glyph.advanceWidth

/** The sum of the advances, in order. */
export const advanceWidth = (positions: readonly Position[]): number =>
  positions.reduce((width, position) => width + (position.xAdvance || 0), 0)

/** The advances of all runs, run by run. */
export const textWidth = (text: ShapedText): number =>
  text.runs.reduce((width, run) => width + advanceWidth(run.positions), 0)

/**
 * A vertical metric of a font in font units, 0 when unset. fonts.ts declares
 * none for a fontkit font, which reads them from its `hhea` table; a standard
 * font has them as fields.
 */
const metricOf = (font: Font | undefined, name: 'ascent' | 'descent' | 'lineGap'): number => {
  const value: unknown = font === undefined ? undefined : Reflect.get(font, name)
  return (typeof value === 'number' ? value : 0) || 0
}

/** How far a run reaches above its baseline: its font's ascent, or an inline image's height when that is more. */
export const ascentOf = (run: ShapedRun): number =>
  Math.max(run.attributes.attachment?.height || 0, metricOf(fontOf(run), 'ascent') * scaleOf(run))

/** How far a run reaches below its baseline, negative. */
export const descentOf = (run: ShapedRun): number => scaleOf(run) * metricOf(fontOf(run), 'descent')

/** A run's line height: its own, else its font's line gap, ascent and descent. */
export const heightOf = (run: ShapedRun): number =>
  run.attributes.lineHeight || metricOf(fontOf(run), 'lineGap') * scaleOf(run) + ascentOf(run) - descentOf(run)

/** Points a run's baseline sits above the line's (`verticalAlign`), negative below it. */
export const shiftOf = (run: StyledRun): number => run.attributes.baselineShift || 0

/**
 * The highest of a text's runs. When a run is raised or lowered, also at
 * least the distance from the highest top to the lowest bottom of its runs,
 * so a shifted run grows its line only beyond the line gap.
 */
export const textHeight = (text: ShapedText): number => {
  let height = 0
  let top = 0
  let bottom = 0
  let shifted = false
  for (const run of text.runs) {
    height = Math.max(height, heightOf(run))
    const shift = shiftOf(run)
    shifted ||= shift !== 0
    top = Math.max(top, ascentOf(run) + shift)
    bottom = Math.min(bottom, descentOf(run) + shift)
  }
  return shifted ? Math.max(height, top - bottom) : height
}

/**
 * How far a text's baseline lies below the top of its line, as in CSS: each
 * run's line height splits what it adds to the run's glyph box (its ascent
 * to its descent) into two equal halves, one above and one below (the
 * half-leading), and the baseline goes where the highest of these leading
 * boxes, with each run's shift, ends at the line's top. A line height below
 * the glyph box gives a negative half: the glyphs then reach above the line.
 * A text without runs has its baseline at the top.
 */
export const baselineOf = (text: ShapedText): number => text.runs.length === 0
  ? 0
  : Math.max(...text.runs.map(run => ascentOf(run) + shiftOf(run) + (heightOf(run) - (ascentOf(run) - descentOf(run))) / 2))
