import type { Font, FontStore } from './fonts'
import { PDF_PRIMITIVES } from '../../primitives'
import type { FieldNode } from './forms'
import type { SafeDocumentNode } from './layout/index'
import { WIN_ANSI, winAnsiCode } from '../../shared/win-ansi'
import type { PdfFile } from './pdf/file'
import type { PdfRef } from './pdf/objects'
import { STANDARD_FONT_FAMILY_NAMES } from './standard-fonts'

// The font a form field draws its value in (D22, D31): Helvetica, or with a
// conformance level the field's registered TrueType font, embedded whole as a
// simple font with WinAnsiEncoding.

/**
 * The font a field draws its value in: Helvetica (D22) or, with a
 * conformance level, an embedded TrueType font (D31). Metrics per 1000 units of the size.
 */
export interface FieldFont {
  /** The resource name in `DA`, `DR` and the appearance resources. */
  readonly id: string
  ref(): PdfRef
  /** The descender is negative. */
  readonly ascender: number
  readonly descender: number
  /** (ascender − descender + line gap) × size / 1000. */
  lineHeight(size: number): number
  /** WinAnsi codes in hex, and each glyph's unkerned advance width. */
  encode(text: string): [string[], number[]]
}

/**
 * The fontkit 2.0 members an embedded field font reads. fontkit ships no types
 * (CONTRACTS.md, "Forms").
 */
export interface FontProgram {
  postscriptName: string | null
  unitsPerEm: number
  ascent: number
  descent: number
  lineGap: number
  capHeight: number
  italicAngle: number
  bbox: { minX: number, minY: number, maxX: number, maxY: number }
  directory: { tables: Record<string, unknown> }
  stream: { buffer: Uint8Array }
  cmap: { tables: readonly { platformID: number, encodingID: number }[] }
  hasGlyphForCodePoint(codePoint: number): boolean
  glyphForCodePoint(codePoint: number): { advanceWidth: number }
  getGlyph(id: number): { advanceWidth: number }
}

// The one cast at the untyped fontkit boundary for field fonts.
export const fontProgram = (font: Font): FontProgram => font as unknown as FontProgram

const FIRST_CODE = 32
/** The WinAnsi codes 0x80 to 0x9F that stand for a character above 0xFF. */
const HIGH_CHARACTERS: ReadonlyMap<number, string> = new Map([...WIN_ANSI].map(([unit, code]) => [code, String.fromCharCode(unit)]))
/**
 * The character of each WinAnsi code from 32 to 255, in code order: the code
 * itself, or from `WIN_ANSI` between 0x7F and 0x9F. DEL (0x7F) and the five
 * codes that `WIN_ANSI` leaves out are `undefined`; they have no glyph.
 */
const WIN_ANSI_CHARACTERS = Array.from({ length: 256 - FIRST_CODE }, (_, index) => {
  const code = index + FIRST_CODE
  return code >= 0x7F && code <= 0x9F ? HIGH_CHARACTERS.get(code) : String.fromCharCode(code)
})
/**
 * The character a reader looks up for each WinAnsi code from 32 to 255
 * (ISO 32000-1, D.2), or `undefined` for the six codes without a glyph.
 * Code 0xA0 is the glyph "space" and 0xAD the glyph "hyphen".
 */
const WIN_ANSI_GLYPHS: readonly (string | undefined)[] = WIN_ANSI_CHARACTERS.map((character, index) => {
  const code = index + FIRST_CODE
  if (code === 0xA0) return ' '
  if (code === 0xAD) return '-'
  return character
})
/** The glyph a reader draws for `character` in a WinAnsi simple font. */
export const glyphCharacter = (character: string): string | undefined => {
  const code = winAnsiCode(character)
  return code === undefined ? undefined : WIN_ANSI_GLYPHS[code - FIRST_CODE]
}

/**
 * A registered TrueType font as a simple font with WinAnsiEncoding, its
 * whole font file embedded (`FontFile2`): a reader that draws a typed value
 * again finds every glyph the font has, and maps codes to glyphs through the
 * font's Unicode cmap. `Widths` holds the advance of each code's glyph (the
 * missing glyph for a code the font lacks).
 */
export const embeddedFieldFont = (objects: PdfFile, program: FontProgram, id: string): FieldFont => {
  const scale = 1000 / program.unitsPerEm
  const missing = Math.round(program.getGlyph(0).advanceWidth * scale)
  const widths = WIN_ANSI_GLYPHS.map((character) => {
    const point = character?.codePointAt(0)
    return point !== undefined && program.hasGlyphForCodePoint(point)
      ? Math.round(program.glyphForCodePoint(point).advanceWidth * scale)
      : missing
  })
  const name = (program.postscriptName ?? 'NuxtPdfFieldFont').replace(/[^\w+.-]/g, '')
  const bytes = program.stream.buffer
  const file = objects.stream({ Length1: bytes.byteLength }, bytes)
  const descriptor = objects.set({
    Type: 'FontDescriptor',
    FontName: name,
    // Nonsymbolic (bit 6), italic (bit 7).
    Flags: 32 | (program.italicAngle === 0 ? 0 : 64),
    FontBBox: [program.bbox.minX, program.bbox.minY, program.bbox.maxX, program.bbox.maxY].map(value => Math.round(value * scale)),
    ItalicAngle: program.italicAngle,
    Ascent: Math.round(program.ascent * scale),
    Descent: Math.round(program.descent * scale),
    CapHeight: Math.round((program.capHeight || program.ascent) * scale),
    StemV: 0,
    FontFile2: file,
  })
  const dictionary = objects.set({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: name,
    FirstChar: FIRST_CODE,
    LastChar: 255,
    Widths: widths,
    Encoding: 'WinAnsiEncoding',
    FontDescriptor: descriptor,
  })
  const ascender = program.ascent * scale
  const descender = program.descent * scale
  return {
    id,
    ref: () => dictionary,
    ascender,
    descender,
    lineHeight: size => (ascender - descender + program.lineGap * scale) * size / 1000,
    encode: (text) => {
      const codes = [...text].map(character => winAnsiCode(character) ?? 0x3F)
      return [codes.map(code => code.toString(16).padStart(2, '0')), codes.map(code => widths[code - FIRST_CODE]!)]
    },
  }
}

/**
 * Give each text and choice field of `layout` its registered font, for a
 * document that claims a conformance level (`prepareForm`). Runs in the layout step, which has the
 * font store; the first registered family of the field's resolved
 * `fontFamily` with its `fontWeight` and `fontStyle`. A field in a standard
 * font gets none.
 */
export const resolveFieldFonts = async (layout: SafeDocumentNode, fontStore: FontStore): Promise<void> => {
  const registered = fontStore.getRegisteredFonts()
  // The font store also holds the standard fonts, which are not embedded.
  const embeddable = (family: unknown): family is string =>
    typeof family === 'string' && Object.hasOwn(registered, family) && !STANDARD_FONT_FAMILY_NAMES.has(family)
  const pending: FieldNode[] = [...layout.children]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === PDF_PRIMITIVES.TextField || node.type === PDF_PRIMITIVES.Select) {
      const { style } = node
      const family = [style.fontFamily].flat().find(embeddable)
      if (family !== undefined) {
        const source = fontStore.getFont({ fontFamily: family, fontWeight: style.fontWeight as never, fontStyle: style.fontStyle as never })
        await source.load()
        if (source.data) node.fieldFont = source.data
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.type !== PDF_PRIMITIVES.TextInstance) pending.push(child)
      }
    }
  }
}
