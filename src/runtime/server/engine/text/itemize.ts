// Itemization (after textkit's `decomposeUnicode`, `bidiEngine`,
// `fontSubstitution`, `scriptItemizer`, `preprocessRuns` and `mirrorString`):
// the runs of a paragraph cut so that each has one bidi level, one font, one
// script and one style. Font substitution and the script runs step through
// code points; textkit stepped through UTF-16 code units, so the two halves
// of an astral character were looked up on their own (D40).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./unicode.d.ts" />
import bidiFactory from 'bidi-js'
import unicode from 'unicode-properties'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../shared/errors'
import { DEFAULT_FONT_SIZE, flattenRuns, type Paragraph, type StyledRun } from './attributed'
import { clusterEnd, composedForm, composedClusters, isCombiningMark } from './compose'
import type { Font, Line } from './types'

/** The bidi algorithm, one instance for the text layout: each holds about 1 MB of Unicode tables (reorder.ts uses it too). */
export const bidi = bidiFactory()

/**
 * Scripts whose shaped glyphs map back to the string only in NFD: after
 * OpenType shaping, fontkit's glyphs of these scripts carry the code points
 * of the decomposed form. Other scripts stay as written (NFC). No test
 * reaches this path: the repository has no font for these scripts
 * (CONFORMANCE.md).
 */
const SCRIPTS_NEEDING_DECOMPOSITION = ['Bengali', 'Devanagari', 'Gujarati', 'Gurmukhi', 'Kannada', 'Khmer', 'Malayalam', 'Myanmar', 'Oriya', 'Sinhala', 'Tamil', 'Telugu', 'Tibetan']
const scriptPattern = SCRIPTS_NEEDING_DECOMPOSITION.map(script => `\\p{Script=${script}}`).join('|')
const HAS_COMPLEX_SCRIPT = new RegExp(scriptPattern, 'u')
const COMPLEX_SCRIPT_CHARS = new RegExp(`(?:${scriptPattern})+`, 'gu')

/** A run whose first font is a registered font, not a standard font. */
const hasCustomFont = (run: StyledRun): boolean => {
  const font = run.attributes.font?.[0]
  return font !== undefined && font.type !== 'STANDARD'
}

/**
 * The text with the characters of complex scripts in NFD, in the runs of a
 * registered font; the runs move with the longer string. A text without
 * such characters comes back as it is.
 */
export const decomposeUnicode = (text: Paragraph): Paragraph => {
  if (!HAS_COMPLEX_SCRIPT.test(text.string)) return text
  let string = ''
  const runs = text.runs.map((run) => {
    const raw = text.string.slice(run.start, run.end)
    const decomposed = hasCustomFont(run) ? raw.replace(COMPLEX_SCRIPT_CHARS, match => match.normalize('NFD')) : raw
    const moved = { ...run, start: string.length, end: string.length + decomposed.length }
    string += decomposed
    return moved
  })
  return { ...text, string, runs }
}

/** The first code point of the Hebrew block, below which no character is right-to-left. */
const FIRST_RIGHT_TO_LEFT = 0x0590

const allBelowRightToLeft = (string: string): boolean => {
  for (let index = 0; index < string.length; index += 1) {
    if (string.charCodeAt(index) >= FIRST_RIGHT_TO_LEFT) return false
  }
  return true
}

/** Runs of equal bidi embedding level, one level per code unit. */
const bidiRuns = ({ string }: Paragraph): StyledRun[] => {
  // Below U+0590 no character is right-to-left, an Arabic number or a
  // directional format character, so in a left-to-right paragraph every
  // level is 0 (UAX #9, W7 and I1), the answer bidi-js would give.
  if (allBelowRightToLeft(string)) return string.length === 0 ? [] : [{ start: 0, end: string.length, attributes: { bidiLevel: 0 } }]
  // Every text runs left to right at paragraph level (fragments.ts takes no `direction`).
  const { levels } = bidi.getEmbeddingLevels(string, 'ltr')
  const runs: StyledRun[] = []
  let lastLevel: number | null = null
  let lastIndex = 0
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index]!
    if (level !== lastLevel) {
      if (lastLevel !== null) runs.push({ start: lastIndex, end: index, attributes: { bidiLevel: lastLevel } })
      lastIndex = index
      lastLevel = level
    }
  }
  if (lastIndex < string.length) runs.push({ start: lastIndex, end: string.length, attributes: { bidiLevel: lastLevel ?? undefined } })
  return runs
}

const IGNORED_SCRIPTS = new Set(['Common', 'Inherited', 'Unknown'])

/**
 * The UTF-16 length of the code point at `index`: 2 for a whole surrogate
 * pair before `end`, else 1 (a lone surrogate, or a pair that a style
 * boundary cuts, is looked up as its code unit).
 */
const codePointLength = (string: string, index: number, end: number): number =>
  index + 1 < end && (string.codePointAt(index) ?? 0) > 0xFFFF ? 2 : 1

/**
 * Runs of one script. Common, inherited and unknown characters join the
 * script before them; characters before the first real script are in no
 * run, unless no character has one (one `Unknown` run).
 */
const scriptRuns = ({ string }: Paragraph): StyledRun[] => {
  const runs: StyledRun[] = []
  let lastScript = 'Unknown'
  let lastIndex = 0
  for (let index = 0; index < string.length; index += codePointLength(string, index, string.length)) {
    const script = unicode.getScript(string.codePointAt(index)!)
    if (script !== lastScript && !IGNORED_SCRIPTS.has(script)) {
      if (lastScript !== 'Unknown') runs.push({ start: lastIndex, end: index, attributes: { script: lastScript } })
      lastIndex = index
      lastScript = script
    }
  }
  if (lastIndex < string.length) runs.push({ start: lastIndex, end: string.length, attributes: { script: lastScript } })
  return runs
}

const SOFT_HYPHEN_CODE = 0xAD

/** U+FFFC, the character an inline image or a leader stands for. */
const ATTACHMENT_CODE = 0xFFFC

/**
 * A character that draws nothing and that fonts often lack: a control (a
 * tab, a line feed), a format character (a soft hyphen, a zero-width
 * joiner, a direction mark or another bidi control), a line or paragraph
 * separator, or a variation selector. In a font that lacks it, it takes no
 * room (shape.ts).
 */
export const drawsNothing = (codePoint: number): boolean => {
  const category = unicode.getCategory(codePoint)
  return category === 'Cc' || category === 'Cf' || category === 'Zl' || category === 'Zp'
    || (codePoint >= 0xFE00 && codePoint <= 0xFE0F) || (codePoint >= 0xE0100 && codePoint <= 0xE01EF)
}

/**
 * A character that paints no ink: one that draws nothing, or a space. A font
 * that lacks it never paints it (shape.ts); a space there still takes room.
 */
export const isBlank = (codePoint: number): boolean =>
  drawsNothing(codePoint) || unicode.getCategory(codePoint) === 'Zs'

/**
 * Whether a character drawn in `font` is missing there (D40): the font has
 * no glyph for it, and it is neither an inline image's U+FFFC (the painter
 * draws the image) nor a blank character (`isBlank`). Itemization gives it
 * the first font of its stack only when no font of the stack has it, so it
 * shows the `.notdef` glyph of that font; the layout warns about it
 * (layout-diagnostics.ts), and a PDF/A or PDF/UA claim rejects it (pdfa.ts).
 */
export const isMissingGlyph = (font: Font, codePoint: number): boolean =>
  codePoint !== ATTACHMENT_CODE && !isBlank(codePoint) && !font.hasGlyphForCodePoint(codePoint)

/**
 * The code points of a laid-out line that are missing from their run's font
 * (`isMissingGlyph`), in line order. A mark that the font draws composed
 * with its base (compose.ts) is not missing.
 */
export const missingCodePoints = (line: Line): number[] => line.runs.flatMap((run) => {
  const font = run.attributes.font?.[0]
  if (font === undefined) return []
  const text = line.string.slice(run.start, run.end)
  const composed = composedClusters(font, text)
  const missing: number[] = []
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index)!
    if (isMissingGlyph(font, codePoint) && !composed.some(cluster => index >= cluster.start && index < cluster.end)) missing.push(codePoint)
    index += codePoint > 0xFFFF ? 2 : 1
  }
  return missing
})

const fontSizeOf = (run: StyledRun): number => run.attributes.fontSize || DEFAULT_FONT_SIZE

/**
 * The font for a code point: the first font of the stack that has it, else
 * the font before it if that one has it, else the first font of the stack,
 * whose `.notdef` glyph marks the missing character (D40). The stack holds
 * only the families the text names. A blank character (`isBlank`: a tab, a
 * bidi control, a space) that no font has is never painted (shape.ts). A soft hyphen keeps the font before it.
 * The U+FFFC of an inline image or a leader takes the first font of the
 * stack, which may lack U+FFFC: the painter draws the image or the leader
 * and a space in its place (paint/text.ts).
 */
const pickFont = (codePoint: number, stack: readonly Font[], lastFont: Font | null, image: boolean): Font | null => {
  if (codePoint === SOFT_HYPHEN_CODE) return lastFont
  if (image && stack[0] !== undefined) return stack[0]
  for (const font of stack) {
    if (font.hasGlyphForCodePoint(codePoint)) return font
  }
  if (lastFont?.hasGlyphForCodePoint(codePoint)) return lastFont
  const fallback = stack[0]
  if (fallback === undefined) throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, 'A text has no font.')
  return fallback
}

/**
 * A soft hyphen at the start of a paragraph has no font before it. Textkit
 * failed with a TypeError when a second one followed, or when the paragraph
 * held nothing else; that stays a failure, now a typed one.
 */
const knownFont = (font: Font | null): Font => {
  if (font === null) throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, 'A paragraph starts with two soft hyphens or holds only soft hyphens.')
  return font
}

/**
 * Runs of one font at one size. An empty paragraph gets one empty run with
 * its whole font stack. A soft hyphen at the start of a paragraph is in no
 * run.
 */
const fontRuns = ({ string, runs: styles }: Paragraph): StyledRun[] => {
  const runs: StyledRun[] = []
  let lastFont: Font | null = null
  let lastFontSize: number | null = null
  let lastIndex = 0
  let index = 0
  // Where the cluster of the current character starts: its base character.
  let clusterStart = 0
  for (const style of styles) {
    if (string.length === 0) {
      runs.push({ start: 0, end: 0, attributes: { font: style.attributes.font } })
      break
    }
    const stack = style.attributes.font ?? []
    const fontSize = fontSizeOf(style)
    for (let offset = style.start; offset < style.end;) {
      const length = codePointLength(string, offset, style.end)
      const codePoint = length === 2 ? string.codePointAt(offset)! : string.charCodeAt(offset)
      if (!isCombiningMark(codePoint)) clusterStart = offset
      // A mark that no font of the stack has stays with its base when the
      // base's font draws the cluster composed (compose.ts, B2b).
      const composing: boolean = lastFont !== null && isCombiningMark(codePoint) && !stack.some(candidate => candidate.hasGlyphForCodePoint(codePoint))
        && composedForm(lastFont, string.slice(clusterStart, clusterEnd(string, clusterStart))) !== undefined
      const font: Font | null = composing ? lastFont : pickFont(codePoint, stack, lastFont, Boolean(style.attributes.attachment || style.attributes.leader))
      if (font !== lastFont || fontSize !== lastFontSize || knownFont(font).unitsPerEm !== lastFont?.unitsPerEm) {
        if (lastFont) runs.push({ start: lastIndex, end: index, attributes: { font: [lastFont], scale: lastFontSize! / lastFont.unitsPerEm } })
        lastFont = font
        lastFontSize = fontSize
        lastIndex = index
      }
      offset += length
      index += length
    }
  }
  if (lastIndex < string.length) {
    const font = knownFont(lastFont)
    runs.push({ start: lastIndex, end: string.length, attributes: { font: [font], scale: fontSizeOf(styles.at(-1)!) / font.unitsPerEm } })
  }
  return runs
}

/**
 * The runs of a paragraph cut so that each has one bidi level, one font, one
 * script and one style. The sources come in that order; the style (without
 * its font stack) is last, so it wins for any key it shares.
 */
export const itemize = (paragraph: Paragraph): Paragraph => {
  const styles = paragraph.runs.map((run) => {
    const { font: _stack, ...attributes } = run.attributes
    return { ...run, attributes }
  })
  const runs = [...bidiRuns(paragraph), ...fontRuns(paragraph), ...scriptRuns(paragraph), ...styles]
  return { string: paragraph.string, runs: flattenRuns(runs) }
}

/** The paragraph with each code unit at an odd (right-to-left) level mirrored, such as `(` to `)`. */
export const mirror = (paragraph: Paragraph): Paragraph => {
  const levels: Array<number | undefined> = []
  for (const run of paragraph.runs) {
    for (let index = run.start; index < run.end; index += 1) levels.push(run.attributes.bidiLevel)
  }
  let string = ''
  for (let index = 0; index < paragraph.string.length; index += 1) {
    const char = paragraph.string.charAt(index)
    const level = levels[index]
    string += (level !== undefined && level % 2 === 1 ? bidi.getMirroredCharacter(char) : null) || char
  }
  return { ...paragraph, string }
}
