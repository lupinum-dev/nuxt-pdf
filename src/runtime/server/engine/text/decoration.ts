// Underline and strike-through of a line (after textkit's
// `textDecoration` engine): one rectangle per decorated run, between the
// spaces at both ends of the line. The runs' advances count from the start
// of the line's box, which holds the leading spaces (`overflowLeft`).
import { advanceWidth, ascentOf, baselineOf, shiftOf, textWidth, type ShapedText } from './metrics'
import { DEFAULT_FONT_SIZE } from './attributed'
import type { Rect } from './types'

/** One decoration rectangle, relative to the line's box; `y` from the line's top. */
export interface Decoration {
  rect: Rect
  opacity: number | undefined
  color: string
  style: 'solid' | 'dashed' | 'dotted'
}

/**
 * The decorations of a line. A run's line starts where the run starts and
 * is as thick as its font size in twelfths, at least 0.5 pt: an underline
 * two thicknesses below the line's baseline (`baselineOf`), a strike-through a third of the
 * run's ascent above the run's baseline. An underline sits at the baseline
 * of the outermost text that sets it (`underlineShift`) and in that text's
 * thickness (`underlineSize`), so it stays one line under 'x²'; a
 * strike-through follows each run, as CSS recomputes a line-through over a
 * descendant so its text stays crossed out.
 */
export const decorationLinesOf = (line: ShapedText & { overflowLeft: number, overflowRight: number }): Decoration[] => {
  const decorations: Decoration[] = []
  const end = textWidth(line) - line.overflowRight
  const baseline = baselineOf(line)
  let runStart = 0
  for (const run of line.runs) {
    const { attributes } = run
    const runEnd = runStart + advanceWidth(run.positions)
    const x = Math.max(runStart, line.overflowLeft)
    const width = Math.min(runEnd, end) - x
    runStart = runEnd
    // A leader draws its own line (paint/text.ts) and takes no decoration.
    if (attributes.leader || width <= 0) continue
    const thickness = Math.max(0.5, Math.floor((attributes.fontSize || DEFAULT_FONT_SIZE) / 12))
    if (attributes.underline) {
      const underlineThickness = Math.max(0.5, Math.floor((attributes.underlineSize || attributes.fontSize || DEFAULT_FONT_SIZE) / 12))
      decorations.push({
        rect: { x, y: baseline - (attributes.underlineShift || 0) + underlineThickness * 2, width, height: underlineThickness },
        opacity: attributes.opacity,
        color: attributes.underlineColor || 'black',
        style: attributes.underlineStyle || 'solid',
      })
    }
    if (attributes.strike) {
      decorations.push({
        rect: { x, y: baseline - shiftOf(run) - ascentOf(run) / 3, width, height: thickness },
        opacity: attributes.opacity,
        color: attributes.strikeColor || 'black',
        style: attributes.strikeStyle || 'solid',
      })
    }
  }
  return decorations
}
