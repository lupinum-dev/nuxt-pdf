// Shaping (after textkit's `generateGlyphs`, `verticalAlignment`,
// `resolveAttachments` and `resolveYOffset`): the glyphs of each run and
// their positions in points, in one pass.
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../shared/errors'
import { glyphWithCodePoints, type FontFeatures } from '../fonts'
import { DEFAULT_FONT_SIZE, type RunStyle, type StyledRun } from './attributed'
import { composedClusters } from './compose'
import { drawsNothing, isBlank } from './itemize'
import type { Font, Glyph, Position } from './types'
import type { WrappedParagraph } from './words'

/** A run with its glyphs. A glyph of a standard font carries only an id, its code points and its advance. */
export interface ShapedRun extends StyledRun {
  glyphs: ReadonlyArray<Glyph>
  positions: Position[]
  /** For each code unit of the run's string, the index of its glyph. */
  stringIndices: number[]
  /** For each glyph, the index of its first character; a glyph with no code points takes the one before it. */
  glyphIndices: Array<number | undefined>
}

export interface ShapedParagraph extends Omit<WrappedParagraph, 'runs'> {
  runs: ShapedRun[]
}

type FontShaping = { readonly glyphs: ReadonlyArray<Glyph>, readonly positions: ReadonlyArray<Position> }

/**
 * The OpenType features a run turns on beyond the font's defaults:
 * `'tabular-nums'` is `tnum`. A font without the feature ignores it, so its
 * digits stay as they are, as in CSS. A new object each time: fontkit adds
 * its default features to the object it gets.
 */
export const featuresOf = (fontVariantNumeric: RunStyle['fontVariantNumeric'] | undefined): FontFeatures | undefined =>
  fontVariantNumeric === 'tabular-nums' ? { tnum: true } : undefined

/**
 * The font's shaping. fontkit is told `'ltr'`, so it keeps the order of the
 * string; bidi reordering comes later. Cutting a ligature shapes its parts
 * again (cut.ts). The features are part of the shaping cache's key
 * (`fontForRender`). The standard fonts take none: their digits are tabular.
 */
export const shapeText = (font: Font, text: string, features?: FontFeatures): FontShaping =>
  font.type === 'STANDARD' ? font.layout(text) : font.layout(text, features, undefined, undefined, 'ltr')

/**
 * The UTF-16 length of a glyph's code points: the code units of the string
 * it stands for. A character outside the BMP is two (D40).
 */
export const codeUnitLength = (codePoints: readonly number[] | undefined): number =>
  (codePoints ?? []).reduce((length, codePoint) => length + (codePoint > 0xFFFF ? 2 : 1), 0)

const stringIndicesOf = (glyphs: FontShaping['glyphs']): number[] => {
  const indices: number[] = []
  glyphs.forEach((glyph, index) => {
    for (let count = codeUnitLength(glyph.codePoints); count > 0; count -= 1) indices.push(index)
  })
  return indices
}

const glyphIndicesOf = (glyphs: FontShaping['glyphs']): Array<number | undefined> => {
  const indices: Array<number | undefined> = []
  let character = 0
  glyphs.forEach((glyph, index) => {
    const length = codeUnitLength(glyph.codePoints)
    indices.push(length === 0 ? indices[index - 1] : character)
    character += length
  })
  return indices
}

/**
 * The font's shaping of a text, with each cluster the font draws composed
 * (compose.ts) shaped as its precomposed form. The first glyph of such a
 * form takes the cluster's code points and any other glyph of it none, so
 * the glyphs still cover the text's code units one to one: the offsets of
 * the run, its line breaks and its text layer stay those of the text.
 */
const shapeComposed = (font: Font, text: string, features: FontFeatures | undefined): FontShaping => {
  const clusters = composedClusters(font, text)
  if (clusters.length === 0) return shapeText(font, text, features)
  let composedText = ''
  let at = 0
  // For each cluster: where its form starts and ends in the composed text, and its own code points.
  const forms = clusters.map((cluster) => {
    composedText += text.slice(at, cluster.start)
    const start = composedText.length
    composedText += cluster.composed
    at = cluster.end
    return { start, end: composedText.length, codePoints: [...text.slice(cluster.start, cluster.end)].map(character => character.codePointAt(0)!) }
  })
  composedText += text.slice(at)
  const shaped = shapeText(font, composedText, features)
  let offset = 0
  const glyphs: Glyph[] = []
  for (const glyph of shaped.glyphs) {
    const start = offset
    offset += codeUnitLength(glyph.codePoints)
    const form = forms.find(candidate => start < candidate.end && offset > candidate.start)
    if (form === undefined) glyphs.push(glyph)
    // A ligature across the edge of a form: the decomposed shaping.
    else if (start < form.start || offset > form.end) return shapeText(font, text, features)
    else glyphs.push(glyphWithCodePoints(glyph, start === form.start ? form.codePoints : []))
  }
  return { glyphs, positions: shaped.positions }
}

/** U+FFFC, the character an inline image or a leader stands for. */
const ATTACHMENT_CODE = 0xFFFC

/**
 * A glyph for blank characters (a tab, a bidi control, a space) that its font
 * lacks: the font's `.notdef`, or for a standard font a WinAnsi code that
 * would paint another character. It is never painted (`paintedGlyphs`).
 */
const isSilent = (font: Font, glyph: Glyph): boolean =>
  glyph.codePoints.length > 0 && glyph.codePoints.every(codePoint => isBlank(codePoint) && !font.hasGlyphForCodePoint(codePoint))

/**
 * The advance of a space that its font lacks, in em: the standard space
 * width (Helvetica's 278 of 1000), which such a space took before the text
 * used only the fonts it names. Other blank characters take no room.
 */
const MISSING_SPACE_EM = 0.278

/**
 * The glyphs of a run that paint, with their positions. A silent glyph is
 * left out and its advance goes to the painted glyph before it, or for a
 * leading one, to the offset and advance of the first painted glyph.
 */
export const paintedGlyphs = (font: Font, glyphs: readonly Glyph[], positions: readonly Position[]): { glyphs: Glyph[], positions: Position[] } => {
  const painted = { glyphs: [] as Glyph[], positions: [] as Position[] }
  let pending = 0
  glyphs.forEach((glyph, index) => {
    const position = positions[index]!
    if (isSilent(font, glyph)) {
      const previous = painted.positions.at(-1)
      if (previous === undefined) pending += position.xAdvance
      else previous.xAdvance += position.xAdvance
      return
    }
    painted.glyphs.push(glyph)
    painted.positions.push(pending === 0 ? { ...position } : { ...position, xOffset: position.xOffset + pending, xAdvance: position.xAdvance + pending })
    pending = 0
  })
  return painted
}

/**
 * A run's glyphs and positions. A position is scaled to points and gets the
 * letter spacing, the last one too; the glyph of an inline image advances by
 * the image's width. The offsets are the font's: a mark or the dot of an
 * Arabic letter sits where the font puts it, also above or below the
 * baseline. Offsets move a glyph only where it is drawn, never a line box.
 *
 * The positions are new objects: the font returns the same frozen shaped
 * object for the same string within a render.
 */
export const shapeRun = (string: string, run: StyledRun): ShapedRun => {
  const stack = run.attributes.font
  if (!stack) return { ...run, glyphs: [], stringIndices: [], glyphIndices: [], positions: [] }
  const font = stack[0]
  // Itemization gives every run of a non-empty paragraph its font, and the
  // empty run its stack.
  if (font === undefined) throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, 'A text run has no font.')
  const shaped = shapeComposed(font, string.slice(run.start, run.end), featuresOf(run.attributes.fontVariantNumeric))
  const scale = run.attributes.scale || (font.unitsPerEm ? (run.attributes.fontSize || DEFAULT_FONT_SIZE) / font.unitsPerEm : 0)
  const spacing = run.attributes.characterSpacing || 0
  // An inline image is as wide as the image, a leader as its margins
  // before it grows (justify.ts).
  const { attachment, leader } = run.attributes
  const objectWidth = attachment?.width || (leader ? leader.before + leader.after : undefined)
  const positions = shaped.positions.map((position, index): Position => {
    const glyph = shaped.glyphs[index]!
    if (isSilent(font, glyph)) {
      const space = glyph.codePoints.some(codePoint => !drawsNothing(codePoint))
      return { xAdvance: space ? MISSING_SPACE_EM * (run.attributes.fontSize || DEFAULT_FONT_SIZE) + spacing : 0, yAdvance: 0, xOffset: 0, yOffset: 0 }
    }
    return {
      ...position,
      xAdvance: objectWidth !== undefined && glyph.codePoints.includes(ATTACHMENT_CODE)
        ? objectWidth
        : position.xAdvance * scale + spacing,
      yAdvance: position.yAdvance * scale,
      xOffset: position.xOffset * scale,
      yOffset: position.yOffset * scale,
    }
  })
  return { ...run, positions, stringIndices: stringIndicesOf(shaped.glyphs), glyphIndices: glyphIndicesOf(shaped.glyphs), glyphs: shaped.glyphs }
}

/** The paragraph with every run shaped. */
export const shape = (paragraph: WrappedParagraph): ShapedParagraph =>
  ({ ...paragraph, runs: paragraph.runs.map(run => shapeRun(paragraph.string, run)) })
