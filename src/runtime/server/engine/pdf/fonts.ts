import { createHash } from 'node:crypto'
import { fontProgramOf, type Font } from '../fonts'
import type { PdfFile } from './file'
import { PdfText, type PdfRef } from './objects'
import { countWork } from '../work'

// Embedded fonts of our writer: each font a Type 0 font
// with Identity-H encoding over one CID font, its glyphs named by their id in
// a fontkit subset (two bytes), its widths in `W` and its text in a ToUnicode
// CMap, as pdfkit's `EmbeddedFont` wrote them, so readers show and extract
// the same text.

/**
 * What the writer reads from a fontkit font to embed it. fontkit 2.0 ships no
 * types; CONTRACTS.md, "Font contract", names these fields.
 */
export interface EmbeddableFont {
  readonly 'postscriptName': string
  readonly 'unitsPerEm': number
  readonly 'ascent': number
  readonly 'descent': number
  readonly 'capHeight': number
  readonly 'xHeight': number
  readonly 'italicAngle': number
  readonly 'bbox': { readonly minX: number, readonly minY: number, readonly maxX: number, readonly maxY: number }
  readonly 'OS/2'?: { readonly sFamilyClass?: number }
  readonly 'post': { readonly isFixedPitch: number | boolean }
  readonly 'head': { readonly macStyle: { readonly italic: boolean } }
  'getGlyph'(id: number): { readonly advanceWidth: number }
  'createSubset'(): FontSubset
}

/** The one cast at the untyped fontkit boundary, as `fontProgram` in form-font.ts. */
export const embeddable = (font: Font): EmbeddableFont => font as unknown as EmbeddableFont

/** fontkit's subset: glyph ids renumbered in the order they are included. */
export interface FontSubset {
  includeGlyph(id: number): number
  encode(): Uint8Array
  /** Set for a CFF (OpenType) font. */
  readonly cff?: unknown
}

/** A glyph as the painter hands it over. */
export interface EmbeddedGlyph {
  readonly id: number
  readonly advanceWidth: number
  readonly codePoints: readonly number[]
}

interface Embedded {
  readonly font: EmbeddableFont
  /** Its place in the order of first use. */
  readonly index: number
  readonly ref: PdfRef
  readonly subset: FontSubset
  /** By subset id: the width in thousandths of an em, and the text. */
  readonly widths: number[]
  readonly unicode: (readonly number[])[]
  readonly glyphIds: number[]
}

export interface EmbeddedFonts {
  /** The font's object (reserved on first use) and a function that names a glyph in the content. */
  use(font: EmbeddableFont): { ref: PdfRef, encode: (glyph: EmbeddedGlyph) => string }
  /** Writes every font used, at the end of the document. */
  finish(): void
}

const hex4 = (value: number): string => value.toString(16).padStart(4, '0')

/**
 * Six capital letters from the font, its place among the document's fonts
 * and its glyphs (ISO 32000-1, 9.6.4): one subset, one tag, also for two
 * files of one name.
 */
const subsetTag = (font: EmbeddableFont, index: number, glyphIds: readonly number[]): string => {
  const digest = createHash('sha256').update(`${index}:${font.postscriptName}:${glyphIds.join(',')}`).digest()
  return [...digest.subarray(0, 6)].map(byte => String.fromCharCode(65 + (byte % 26))).join('')
}

/** The text of the `.notdef` glyph when the content paints it: U+FFFD. */
const REPLACEMENT_CHARACTER = [0xFFFD]

/**
 * The text of a glyph in NFC. A glyph drawn for a base character and a mark
 * (compose.ts) stands for both; as two characters, pdf.js read a space after
 * it. NFC is canonically the same text, and leaves every other glyph's
 * characters as they are.
 */
const composedText = (codePoints: readonly number[]): readonly number[] => {
  const text = String.fromCodePoint(...codePoints)
  const composed = text.normalize('NFC')
  return composed === text ? codePoints : [...composed].map(character => character.codePointAt(0)!)
}

/** UTF-16 code units of the code points, four hex digits each. */
const utf16 = (codePoints: readonly number[]): string => codePoints.flatMap((codePoint) => {
  if (codePoint <= 0xFFFF) return [hex4(codePoint)]
  const value = codePoint - 0x10000
  return [hex4(0xD800 | (value >>> 10)), hex4(0xDC00 | (value & 0x3FF))]
}).join(' ')

/** The ToUnicode CMap, in groups of at most 100 entries. */
const toUnicode = (unicode: readonly (readonly number[])[]): string => {
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo <<',
    '  /Registry (Adobe)',
    '  /Ordering (UCS)',
    '  /Supplement 0',
    '>> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000><ffff>',
    'endcodespacerange',
  ]
  for (let start = 0; start < unicode.length; start += 100) {
    const group = unicode.slice(start, start + 100)
    lines.push(`${group.length} beginbfchar`, ...group.map((codePoints, index) => `<${hex4(start + index)}><${utf16(codePoints)}>`), 'endbfchar')
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')
  return lines.join('\n')
}

export const createEmbeddedFonts = (file: PdfFile): EmbeddedFonts => {
  // By font program: two faces of one file share a subset. pdfkit shared by
  // PostScript name and so painted a second file of the same name with the
  // first one's glyphs.
  const fonts = new Map<object, Embedded>()

  const embed = ({ font, index, ref, subset, widths, unicode, glyphIds }: Embedded): void => {
    const scale = 1000 / font.unitsPerEm
    const cff = subset.cff != null
    const program = file.stream(cff ? { Subtype: 'CIDFontType0C' } : {}, subset.encode())
    const familyClass = (font['OS/2']?.sFamilyClass ?? 0) >> 8
    let flags = 1 << 2 // symbolic: the font holds glyphs outside the standard Latin set
    if (font.post.isFixedPitch) flags |= 1 << 0
    if (familyClass >= 1 && familyClass <= 7) flags |= 1 << 1
    if (familyClass === 10) flags |= 1 << 3
    if (font.head.macStyle.italic) flags |= 1 << 6
    const name = `${subsetTag(font, index, glyphIds)}+${font.postscriptName}`
    const { bbox } = font
    const descriptor = file.set({
      Type: 'FontDescriptor',
      FontName: name,
      Flags: flags,
      FontBBox: [bbox.minX * scale, bbox.minY * scale, bbox.maxX * scale, bbox.maxY * scale],
      ItalicAngle: font.italicAngle,
      Ascent: font.ascent * scale,
      Descent: font.descent * scale,
      CapHeight: (font.capHeight || font.ascent) * scale,
      XHeight: (font.xHeight || 0) * scale,
      StemV: 0,
      [cff ? 'FontFile3' : 'FontFile2']: program,
    })
    const descendant = file.set({
      Type: 'Font',
      Subtype: cff ? 'CIDFontType0' : 'CIDFontType2',
      BaseFont: name,
      CIDSystemInfo: { Registry: new PdfText('Adobe'), Ordering: new PdfText('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      W: [0, widths],
      CIDToGIDMap: cff ? undefined : 'Identity',
    })
    const cmap = file.stream({}, toUnicode(unicode))
    file.set({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [descendant], ToUnicode: cmap }, ref)
  }

  return {
    use: (font) => {
      let entry = fonts.get(fontProgramOf(font))
      if (entry === undefined) {
        const scale = 1000 / font.unitsPerEm
        countWork('fontsEmbedded')
        // Subset id 0 is the font's .notdef glyph.
        entry = { font, index: fonts.size, ref: file.reserve(), subset: font.createSubset(), widths: [font.getGlyph(0).advanceWidth * scale], unicode: [[0]], glyphIds: [0] }
        fonts.set(fontProgramOf(font), entry)
      }
      const { subset, widths, unicode, glyphIds } = entry
      const scale = 1000 / entry.font.unitsPerEm
      return {
        ref: entry.ref,
        encode: (glyph) => {
          const id = subset.includeGlyph(glyph.id)
          // `.notdef` stands for every character the font lacks (D40), so its
          // text is U+FFFD; a subset that paints no `.notdef` keeps 0.
          if (id === 0) unicode[0] = REPLACEMENT_CHARACTER
          if (widths[id] === undefined) {
            widths[id] = glyph.advanceWidth * scale
            unicode[id] = composedText(glyph.codePoints)
            glyphIds[id] = glyph.id
          }
          return hex4(id)
        },
      }
    },
    finish: () => {
      for (const entry of fonts.values()) embed(entry)
    },
  }
}
