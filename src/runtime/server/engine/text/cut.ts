// Cutting shaped text (textkit's run and attributed-string
// `slice`, `trim`, `append` and `dropLast`): the pieces the line breaker
// and the typesetter take out of a paragraph. Each keeps textkit's order of
// operations, so the results are textkit's to the last bit.
import type { FontFeatures } from '../fonts'
import type { StyledRun } from './attributed'
import { advanceOf, fontOf, scaleOf, type ShapedText } from './metrics'
import { codeUnitLength, featuresOf, shapeText, type ShapedRun } from './shape'
import type { Font, Glyph, Position } from './types'

/** The index of the run that holds code unit `index`, or -1. */
export const runIndexAt = (index: number, runs: readonly StyledRun[]): number =>
  runs.findIndex(run => run.start <= index && index < run.end)

/**
 * The last glyph whose first character is at or before `index`, the glyph
 * count past the last one: the last glyph drawn for character `index`, with
 * any glyph without code points after it (a font may draw a letter's dots
 * as their own glyphs).
 */
export const glyphIndexAt = (index: number, run: ShapedRun): number => {
  const { glyphIndices } = run
  const last = glyphIndices[glyphIndices.length - 1]
  if (last !== undefined && index > last) return glyphIndices.length
  for (let glyph = glyphIndices.length - 1; glyph >= 0; glyph -= 1) {
    const first = glyphIndices[glyph]
    if (first !== undefined && first <= index) return glyph
  }
  return index
}

/**
 * The first glyph drawn for character `index`. The glyphs of characters
 * `start` to `end` are those from `firstGlyphAt(start)` up to
 * `firstGlyphAt(end)`. textkit started at `glyphIndexAt`, which
 * is a letter's dot glyph when the font draws the dot apart, so a line that
 * began with such a letter lost the letter's glyph.
 */
export const firstGlyphAt = (index: number, run: ShapedRun): number => run.stringIndices[index] ?? glyphIndexAt(index, run)

/**
 * How many code units before `index` share the glyph of `index`: where a
 * ligature is cut. The glyph indices of a run only rise (`stringIndicesOf`
 * in shape.ts, and slices of them), so the code units of a glyph are next to
 * each other and the count stops at the first other glyph. Counting from the
 * run start cost a step per code unit before `index` for every line cut,
 * which made a long paragraph cost time in the square of its length.
 */
const ligatureOffset = (index: number, run: ShapedRun): number => {
  const { stringIndices } = run
  const glyph = stringIndices[index]
  let count = 0
  for (let at = index - 1; at >= 0 && stringIndices[at] === glyph; at -= 1) count += 1
  return count
}

/** The glyphs for code units `start` to `end` of `glyph`: the glyph itself, or that part of a ligature shaped again. */
const glyphPart = (start: number, end: number, font: Font | undefined, glyph: Glyph | undefined, features: FontFeatures | undefined): readonly Glyph[] => {
  if (!glyph || start === end) return []
  const units = String.fromCodePoint(...glyph.codePoints)
  if ((start === 0 && end >= units.length) || !font) return [glyph]
  return shapeText(font, units.slice(start, end), features).glyphs
}

const fromZero = (values: readonly number[]): number[] => {
  const first = values[0]
  return first === undefined ? [] : values.map(value => value - first)
}

const positionOf = (glyph: Glyph, scale: number): Position => ({ xAdvance: advanceOf(glyph) * scale, yAdvance: 0, xOffset: 0, yOffset: 0 })

/** Code units `start` to `end` of a run (offsets in the run); a ligature cut in two is shaped again for each part. */
export const sliceRun = (start: number, end: number, run: ShapedRun): ShapedRun => {
  const scale = scaleOf(run)
  const font = fontOf(run)
  const features = featuresOf(run.attributes.fontVariantNumeric)
  const startIndex = firstGlyphAt(start, run)
  const endIndex = glyphIndexAt(end - 1, run)
  const startOffset = ligatureOffset(start, run)
  const startGlyphs = startOffset > 0 ? glyphPart(startOffset, Infinity, font, run.glyphs[startIndex], features) : []
  const endOffset = ligatureOffset(end, run)
  const endGlyphs = glyphPart(0, endOffset, font, run.glyphs[endIndex], features)
  const startGlyphCovers = (run.glyphIndices[startIndex] ?? startIndex) >= start
  const sliceStart = startIndex + (startOffset > 0 || !startGlyphCovers ? 1 : 0)
  const sliceEnd = endIndex + 1 - Math.min(1, endOffset)
  // A glyph without code points first in a run has no first character (shape.ts); textkit subtracted from undefined.
  const fromStart = (value: number | undefined): number => value === undefined ? Number.NaN : value - start
  return {
    ...run,
    start: Math.max(run.start + start, 0),
    end: Math.max(Math.min(run.end, run.start + end), 0),
    stringIndices: fromZero(run.stringIndices.slice(start, end)),
    glyphIndices: [
      ...startGlyphs.map((_, index) => (run.glyphIndices[startIndex] ?? 0) - start + startOffset + index),
      ...run.glyphIndices.slice(sliceStart, sliceEnd).map(fromStart),
      ...endGlyphs.map((_, index) => (run.glyphIndices[endIndex] ?? 0) - start + index),
    ],
    glyphs: [...startGlyphs, ...run.glyphs.slice(sliceStart, sliceEnd), ...endGlyphs],
    positions: [
      ...startGlyphs.map(glyph => positionOf(glyph, scale)),
      ...run.positions.slice(sliceStart, sliceEnd),
      ...endGlyphs.map(glyph => positionOf(glyph, scale)),
    ],
  }
}

/** Code units `start` to `end` of a text: the runs over them, cut at both ends and counted from `start`. */
export const sliceText = <Text extends ShapedText>(start: number, end: number, text: Text): Text => {
  if (text.string.length === 0) return text
  const first = runIndexAt(start, text.runs)
  const last = Math.max(runIndexAt(end - 1, text.runs), first)
  const kept = text.runs.slice(first, last + 1)
  const runs = kept.map((run, index) => {
    const isFirst = index === 0
    const isLast = !isFirst && index === kept.length - 1
    let result = run
    if (isFirst) result = sliceRun(start - run.start, end - run.start, run)
    if (isLast) result = sliceRun(0, end - run.start, run)
    return { ...result, start: result.start - start, end: result.end - start }
  })
  return { ...text, string: text.string.slice(start, end), runs }
}

const NOT_SPACE = /\S/

/** The text without spaces at either end. */
export const trimText = <Text extends ShapedText>(text: Text): Text => {
  let last = text.string.length - 1
  while (last >= 0 && !NOT_SPACE.test(text.string.charAt(last))) last -= 1
  return sliceText(text.string.search(NOT_SPACE), last + 1, text)
}

const EMPTY_RUN: ShapedRun = { start: 0, end: 0, stringIndices: [], glyphIndices: [], glyphs: [], positions: [], attributes: {} }

/**
 * The text with `glyph` after its last run, at that run's scale. The string
 * gets `codePoints`: the glyph's own, or the character the glyph was looked
 * up for (a font without that character gives a glyph without code points).
 */
export const appendGlyph = <Text extends ShapedText>(glyph: Glyph, text: Text, codePoints: readonly number[] = glyph.codePoints): Text => {
  const run = text.runs[text.runs.length - 1] ?? EMPTY_RUN
  const glyphLength = codeUnitLength(codePoints)
  const appended: ShapedRun = {
    ...run,
    end: run.end + glyphLength,
    glyphs: [...run.glyphs, glyph],
    stringIndices: [...run.stringIndices, ...Array<number>(glyphLength).fill(run.glyphs.length)],
    glyphIndices: [...run.glyphIndices, run.stringIndices.length || 0],
    positions: [...run.positions, positionOf(glyph, scaleOf(run))],
  }
  return { ...text, string: text.string + String.fromCodePoint(...codePoints), runs: [...text.runs.slice(0, -1), appended] }
}

/** The text without its last code unit. */
export const dropLastCharacter = <Text extends ShapedText>(text: Text): Text => {
  const last = text.runs[text.runs.length - 1]
  const runs = last === undefined ? text.runs : [...text.runs.slice(0, -1), sliceRun(0, last.end - last.start - 1, last)]
  return { ...text, string: text.string.slice(0, -1), runs }
}
