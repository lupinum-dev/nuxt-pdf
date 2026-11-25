import { WIN_ANSI } from '../../shared/win-ansi'
import { GLYPH_CODES, STANDARD_FONT_METRICS } from './standard-font-metrics'
import { countWork } from './work'

// The 12 standard PDF fonts as the layout step measures them: not embedded,
// their glyphs named by WinAnsi code. Each method gives what `@react-pdf/font`
// 4.0.8's `StandardFont` gave over pdfkit's AFM data, quirks included, so a
// document lays out as it did with React PDF: a code
// unit above 0xFF without a WinAnsi code keeps its value as glyph id but has
// no glyph and no width; `glyphForCodePoint` does not map to WinAnsi and
// gives every glyph 400; a soft hyphen measures 0 when lines break but keeps
// its advance; a glyph's `codePoints` hold its WinAnsi code.

export type StandardFontName = keyof typeof STANDARD_FONT_METRICS

/** The standard families with their regular, bold, italic and bold italic faces. */
export const STANDARD_FAMILIES: ReadonlyArray<readonly [family: string, faces: readonly StandardFontName[]]> = [
  ['Helvetica', ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']],
  ['Courier', ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique']],
  ['Times-Roman', ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic']],
]

/**
 * Every `fontFamily` that names a standard font: a family, or one face as a
 * family of its own name, as in React PDF. An application font cannot take one.
 */
export const STANDARD_FONT_FAMILY_NAMES: ReadonlySet<string> = new Set(STANDARD_FAMILIES.flatMap(([, faces]) => faces))

const SOFT_HYPHEN = 0xAD

const HAS_GLYPH = new Uint8Array(256)
for (const [first, last] of GLYPH_CODES) HAS_GLYPH.fill(1, first, last + 1)

/** The WinAnsi code of a UTF-16 code unit; a unit above 0xFF without one keeps its value. */
const winAnsi = (unit: number): number => WIN_ANSI.get(unit) ?? unit
/** The code whose metrics a glyph id has: one without a glyph measures as code 0 (.notdef). */
const metricsCode = (id: number): number => id > 0xFF ? 0 : id

export interface StandardGlyph {
  id: number
  codePoints: number[]
  isLigature: false
  advanceWidth: number
}

export interface StandardPosition {
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
  advanceWidth: number
}

/** The descent per family, as `@react-pdf/font` observed it. */
const familyDescent = (name: StandardFontName): number =>
  name.startsWith('Times') ? -220 : name.startsWith('Courier') ? -230 : -200

/** Only what the layout step and the painters read of a font. */
export class StandardFont {
  readonly type = 'STANDARD'
  /** The `BaseFont` the writers name. */
  readonly fullName: StandardFontName
  readonly ascent = 900
  readonly descent: number
  readonly lineGap = 0
  readonly unitsPerEm = 1000
  readonly #widths: readonly number[]
  /** Kerning by `left * 256 + right` code. */
  readonly #kerning = new Map<number, number>()

  constructor(name: StandardFontName) {
    this.fullName = name
    this.descent = familyDescent(name)
    const { widths, kerning } = STANDARD_FONT_METRICS[name]
    this.#widths = widths
    for (const pair of kerning ? kerning.split(',') : []) {
      const [left, right, value] = pair.split(' ')
      this.#kerning.set(Number.parseInt(left!, 16) * 256 + Number.parseInt(right!, 16), Number(value))
    }
  }

  /** Each code unit's glyph id (hex) and its position, kerned with the next one. */
  encode(text: string): [string[], StandardPosition[]] {
    const ids = Array.from({ length: text.length }, (_, index) => winAnsi(text.charCodeAt(index)))
    const positions = ids.map((id, index): StandardPosition => {
      const width = this.#widths[metricsCode(id)]!
      const next = ids[index + 1]
      const kern = next === undefined ? 0 : this.#kerning.get(metricsCode(id) * 256 + metricsCode(next)) ?? 0
      return { xAdvance: width + kern, yAdvance: 0, xOffset: 0, yOffset: 0, advanceWidth: text.charCodeAt(index) === SOFT_HYPHEN ? 0 : width }
    })
    return [ids.map(id => id.toString(16)), positions]
  }

  layout(text: string) {
    countWork('runsShaped')
    const [encoded, positions] = this.encode(text)
    const glyphs = encoded.map((code, index) => ({ ...this.getGlyph(Number.parseInt(code, 16)), advanceWidth: positions[index]!.advanceWidth }))
    return {
      positions,
      glyphs,
      script: 'latin',
      language: 'dflt',
      direction: 'ltr',
      features: {},
      advanceWidth: positions.reduce((sum, position) => sum + position.advanceWidth, 0),
      advanceHeight: 0,
      bbox: undefined,
    }
  }

  glyphForCodePoint(codePoint: number): StandardGlyph {
    return { ...this.getGlyph(codePoint), advanceWidth: 400 }
  }

  /** A glyph without its width: `layout` and `glyphForCodePoint` add the width they measure. */
  getGlyph(id: number): Omit<StandardGlyph, 'advanceWidth'> {
    return { id, codePoints: [id], isLigature: false }
  }

  hasGlyphForCodePoint(codePoint: number): boolean {
    const code = winAnsi(codePoint)
    return code <= 0xFF && HAS_GLYPH[code] === 1
  }
}

const standardFonts = new Map<StandardFontName, StandardFont>()

/** The font of this name. It holds no render data, so every render of the process shares it. */
export const standardFont = (name: StandardFontName): StandardFont => {
  let font = standardFonts.get(name)
  if (font === undefined) {
    font = new StandardFont(name)
    standardFonts.set(name, font)
  }
  return font
}
