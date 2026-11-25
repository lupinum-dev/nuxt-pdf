// Lines in a box (after textkit's `typesetter`, `layoutParagraph`,
// `layoutLines`, `truncate` and `finalizeFragments`): each paragraph broken
// into lines and stacked from the top of the box, cut at `maxLines` or at
// the box's height, then each line finished. Every sum keeps textkit's
// order, so the results are textkit's to the last bit.
import { linebreaker } from './break'
import { appendGlyph, dropLastCharacter, trimText } from './cut'
import { decorationLinesOf } from './decoration'
import { alignLine, unalignLine } from './justify'
import { advanceWidth, ascentOf, baselineOf, descentOf, fontOf, heightOf, shiftOf, textHeight, textWidth, type ShapedText } from './metrics'
import { shapeRun, type ShapedParagraph, type ShapedRun } from './shape'
import type { Font, Glyph, Line, Rect, Run, TextBox, TextOptions } from './types'

/** A line where the typesetter put it. */
export interface PlacedLine extends ShapedText {
  box: Rect
}

const ATTACHMENT = '\uFFFC'

/**
 * The lines of a paragraph at the top of `rect`, each as high as its highest
 * run and at least its first run's line height. A line without U+FFFC
 * drops the runs' inline image and leader. A paragraph without runs (a text without
 * fragments) has no lines; textkit reached that through a NaN height.
 */
const placeLines = (rect: Rect, paragraph: ShapedParagraph, options: TextOptions): PlacedLine[] => {
  if (paragraph.runs.length === 0) return []
  let y = rect.y
  return linebreaker(options)(paragraph, [rect.width, rect.width]).map((line) => {
    const height = Math.max(textHeight(line), line.runs[0]?.attributes.lineHeight ?? 0)
    const runs = line.string.includes(ATTACHMENT) ? line.runs : line.runs.map(run => ({ ...run, attributes: { ...run.attributes, attachment: null, leader: null } }))
    const placed = { string: line.string, runs, box: { x: rect.x, y, width: rect.width, height } }
    y += height
    return placed
  })
}

const ELLIPSIS = 0x2026

/** The ellipsis glyph of a font: a standard font's WinAnsi code for it. */
const ellipsisOf = (font: Font): Glyph => {
  if (font.type !== 'STANDARD') return font.glyphForCodePoint(ELLIPSIS)
  const [codes] = font.encode(String.fromCodePoint(ELLIPSIS))
  return font.glyphForCodePoint(Number.parseInt(codes[0] ?? '', 16))
}

/** The lines with the last one trimmed and an ellipsis after it, in its last run's font. */
const truncated = (lines: PlacedLine[]): PlacedLine[] => {
  const last = lines[lines.length - 1]
  const lastRun = last?.runs[last.runs.length - 1]
  const font = lastRun && fontOf(lastRun)
  if (!last || !font) return lines
  return [...lines.slice(0, -1), appendGlyph(ellipsisOf(font), trimText(last), [ELLIPSIS])]
}

/** The lines that end above `height`. */
const linesAbove = (height: number, lines: readonly PlacedLine[]): PlacedLine[] => {
  let bottom = 0
  const kept: PlacedLine[] = []
  for (const line of lines) {
    bottom += line.box.height
    if (bottom < height) kept.push(line)
    else break
  }
  return kept
}

/**
 * The lines of each paragraph, stacked from the top of `box`. After
 * `maxLines` lines no more follow, and with `truncate` the last one gets an
 * ellipsis when lines were cut. A paragraph that does not fit the box's
 * height keeps the lines that do, the last with an ellipsis, and ends the
 * text. `hidden` counts the lines that the box's height cut off (those of
 * the later paragraphs too, up to `maxLines`): they are not drawn.
 */
export const typeset = (paragraphs: readonly ShapedParagraph[], box: TextBox, options: TextOptions): { blocks: PlacedLine[][], hidden: number } => {
  const blocks: PlacedLine[][] = []
  let linesLeft = box.maxLines ?? Infinity
  let rect: Rect = { x: box.x, y: box.y, width: box.width, height: box.height }
  for (const [index, paragraph] of paragraphs.entries()) {
    if (linesLeft <= 0) break
    const lines = placeLines(rect, paragraph, options)
    const kept = lines.slice(0, linesLeft)
    const height = kept.reduce((sum, line) => sum + line.box.height, 0)
    linesLeft -= kept.length
    if (rect.height >= height) {
      blocks.push(box.truncate === 'ellipsis' && kept.length !== lines.length ? truncated(kept) : kept)
      rect = { ...rect, y: rect.y + height, height: rect.height - height }
    }
    else {
      const above = linesAbove(rect.height, kept)
      blocks.push(truncated(above))
      let hidden = kept.length - above.length
      // Only to count them: the later paragraphs are broken at the box's width.
      for (const later of paragraphs.slice(index + 1)) {
        if (linesLeft <= 0) break
        const count = Math.min(linesLeft, placeLines(rect, later, options).length)
        hidden += count
        linesLeft -= count
      }
      return { blocks, hidden }
    }
  }
  return { blocks, hidden: 0 }
}

const SPACE = 32

const isSpace = (glyph: Glyph): boolean => glyph.codePoints.includes(SPACE)

const isAllSpaces = (run: ShapedRun): boolean => run.glyphs.length > 0 && run.glyphs.every(isSpace)

/** The advances of the spaces that `glyphs` start with, in that order. */
const spacesWidth = (glyphs: readonly Glyph[], positions: ShapedRun['positions']): number => {
  const firstOther = glyphs.findIndex(glyph => !isSpace(glyph))
  return advanceWidth(firstOther === -1 ? positions : positions.slice(0, firstOther))
}

/** The spaces at the start of a line, up to the first run that is not all spaces. */
const leadingSpaces = (line: PlacedLine): number => {
  let width = 0
  for (const run of line.runs) {
    width += spacesWidth(run.glyphs, run.positions)
    if (!isAllSpaces(run)) break
  }
  return width
}

/** The spaces at the end of a line, from the last glyph back. */
const trailingSpaces = (line: PlacedLine): number => {
  let width = 0
  for (let index = line.runs.length - 1; index >= 0; index -= 1) {
    const run = line.runs[index]!
    width += spacesWidth([...run.glyphs].reverse(), [...run.positions].reverse())
    if (!isAllSpaces(run)) break
  }
  return width
}

/** The line with its spaces at both ends outside its box: the box grows by them, to the left by the leading ones. */
const withOverflow = (line: PlacedLine): PlacedLine & { overflowLeft: number, overflowRight: number } => {
  const overflowLeft = leadingSpaces(line)
  const overflowRight = trailingSpaces(line)
  const box = { ...line.box, x: line.box.x - overflowLeft, width: line.box.width + overflowLeft + overflowRight }
  return { ...line, box, overflowLeft, overflowRight }
}

/**
 * Each run's sizes, and the line's: the highest top and the lowest bottom of
 * its runs (each with its shift), its baseline below its top (`baselineOf`),
 * and the sum of their advances.
 */
const withSizes = <Placed extends PlacedLine>(line: Placed): Placed & { runs: Run[], ascent: number, descent: number, baseline: number, height: number, xAdvance: number } => {
  let ascent = 0
  let descent = 0
  let height = 0
  let xAdvance = 0
  const runs = line.runs.map((run) => {
    const sized = { ...run, height: heightOf(run), ascent: ascentOf(run), descent: descentOf(run), xAdvance: advanceWidth(run.positions) }
    height = Math.max(height, sized.height)
    ascent = Math.max(ascent, sized.ascent + shiftOf(run))
    descent = Math.min(descent, sized.descent + shiftOf(run))
    xAdvance += sized.xAdvance
    return sized
  })
  return { ...line, runs, ascent, descent, baseline: baselineOf(line), height, xAdvance }
}

/**
 * A character that ends its paragraph (`splitParagraphs`: a line feed, a
 * carriage return, a line or paragraph separator, a next line, a form feed,
 * a vertical tab). It draws nothing, and its font may be the standard font
 * at the end of the stack (`pickFont`), so a line never paints it.
 */
const PARAGRAPH_END = /[\n\r\v\f\u0085\u2028\u2029]$/

/**
 * A line finished: without the character that ends its paragraph, its
 * spaces at both ends outside its box, aligned (a paragraph's last line by
 * `alignLastLine`), with its decorations and its sizes.
 */
export const finishLine = (line: PlacedLine, isLast: boolean): Line => {
  const style = line.runs[0]?.attributes
  const align = isLast ? style?.alignLastLine : style?.align
  const overflowing = withOverflow(PARAGRAPH_END.test(line.string) ? dropLastCharacter(line) : line)
  const aligned = alignLine(overflowing, align)
  return withSizes({ ...aligned, decorationLines: decorationLinesOf(aligned), isLast, spread: textWidth(aligned) - textWidth(overflowing) })
}

/**
 * The line with the characters from `start` to `end` of its string showing
 * `label` (a number in the width its reserve kept), finished as `finishLine`
 * finishes a line with the label in that place: its alignment taken back, the
 * run that holds the range shaped again, the line aligned again. The break
 * stays. Undefined when no one run holds the range, or when the label is wider
 * than the range was, which would push the line past its box.
 */
export const relabelRange = (line: Line, start: number, end: number, label: string): Line | undefined => {
  const style = line.runs[0]?.attributes
  const align = line.isLast ? style?.alignLastLine : style?.align
  const natural = unalignLine(line, align, line.spread)
  const at = natural.runs.findIndex(run => run.start <= start && end <= run.end)
  const run = natural.runs[at]
  if (run === undefined) return undefined
  const shift = end - start - label.length
  const string = line.string.slice(0, start) + label + line.string.slice(end)
  const shaped = shapeRun(string, { ...run, end: run.end - shift })
  // Taking the spread back leaves a float residual in the reserved width.
  if (advanceWidth(shaped.positions) > advanceWidth(run.positions) + 1e-6) return undefined
  const runs = natural.runs.map((other, index) => index === at ? shaped : index < at ? other : { ...other, start: other.start - shift, end: other.end - shift })
  const relabelled = { ...natural, string, runs }
  const aligned = alignLine(relabelled, align)
  return withSizes({ ...aligned, decorationLines: decorationLinesOf(aligned), isLast: line.isLast, spread: textWidth(aligned) - textWidth(relabelled) })
}

/** The line with run `at` showing `label` (a footnote number in the width its mark reserved), as `relabelRange`. */
export const relabelRun = (line: Line, at: number, label: string): Line | undefined => {
  const run = line.runs[at]
  return run === undefined ? undefined : relabelRange(line, run.start, run.end, label)
}
