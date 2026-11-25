// The embedded TrueType font programs of an unencrypted PDF, read from its
// bytes, with fontkit (the engine's own font parser) to read their outlines.
// pdf.js does not expose the font program as written, and a text extraction
// check passes when the glyphs have no outline (E3-F1), so tests that care
// about what a reader draws open `FontFile2` themselves.
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'

/** The part of a fontkit font and glyph these tests read. */
export interface FontkitGlyph {
  id: number
  path: { commands: ReadonlyArray<{ command: string, args: readonly number[] }> }
  advanceWidth: number
  /** The box the glyph record states (TrueType) or its control box. */
  cbox: { minX: number, minY: number, maxX: number, maxY: number }
}
export interface FontkitFont {
  numGlyphs: number
  postscriptName: string
  getGlyph: (id: number) => FontkitGlyph
  glyphsForString: (text: string) => FontkitGlyph[]
}

const require = createRequire(import.meta.url)
// fontkit 2.0 ships no types.
const fontkit = require('fontkit') as {
  create: (bytes: Uint8Array) => unknown
}

/** Open sfnt bytes with fontkit. */
export const openFont = (bytes: Uint8Array): FontkitFont => fontkit.create(Buffer.from(bytes)) as FontkitFont

export interface EmbeddedTrueTypeFont {
  /** `/FontName` without the subset tag. */
  name: string
  font: FontkitFont
  /** Subset glyph id to its text, from the font's `/ToUnicode` map. */
  text: Map<number, string>
}

interface PdfObject { dictionary: string, stream?: Buffer }

const readObjects = (pdf: Uint8Array): Map<number, PdfObject> => {
  const bytes = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)
  const source = bytes.toString('latin1')
  const objects = new Map<number, PdfObject>()
  for (const match of source.matchAll(/(?:^|\n)(\d+) 0 obj\n/g)) {
    const start = match.index + match[0].length
    const end = source.indexOf('\nendobj', start)
    const body = source.slice(start, end)
    const streamAt = body.indexOf('\nstream\n')
    if (streamAt === -1) {
      objects.set(Number(match[1]), { dictionary: body })
      continue
    }
    const dictionary = body.slice(0, streamAt)
    const dataStart = start + streamAt + '\nstream\n'.length
    const length = Number(/\/Length (\d+)/.exec(dictionary)?.[1])
    const raw = bytes.subarray(dataStart, dataStart + length)
    objects.set(Number(match[1]), { dictionary, stream: dictionary.includes('/FlateDecode') ? inflateSync(raw) : raw })
  }
  return objects
}

const reference = (dictionary: string, key: string): number | undefined => {
  const found = new RegExp(`/${key} (\\d+) 0 R`).exec(dictionary)
  return found ? Number(found[1]) : undefined
}

const hexText = (hex: string): string => {
  const units: number[] = []
  for (let at = 0; at + 4 <= hex.length; at += 4) units.push(Number.parseInt(hex.slice(at, at + 4), 16))
  return String.fromCharCode(...units)
}

/** The glyph id to text map of a `/ToUnicode` CMap (bfchar and bfrange). */
const toUnicode = (cmap: string): Map<number, string> => {
  const map = new Map<number, string>()
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    // pdfkit writes several UTF-16 units of one glyph separated by spaces.
    for (const pair of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f ]*)>/gi)) map.set(Number.parseInt(pair[1]!, 16), hexText(pair[2]!.replaceAll(' ', '')))
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]*>)/gi)) {
      const low = Number.parseInt(range[1]!, 16)
      const high = Number.parseInt(range[2]!, 16)
      const target = range[3]!
      if (target.startsWith('[')) {
        const values = [...target.matchAll(/<([0-9a-f]*)>/gi)].map(value => hexText(value[1]!))
        values.forEach((value, index) => map.set(low + index, value))
      }
      else {
        const first = hexText(target.slice(1, -1))
        for (let code = low; code <= high; code += 1) {
          map.set(code, first.slice(0, -1) + String.fromCharCode(first.charCodeAt(first.length - 1) + code - low))
        }
      }
    }
  }
  return map
}

/** The decompressed font program streams of the PDF under `key`. */
export const fontFileStreams = (pdf: Uint8Array, key: 'FontFile2' | 'FontFile3'): Buffer[] => {
  const objects = readObjects(pdf)
  return [...objects.values()].flatMap((object) => {
    const file = object.dictionary.includes('/FontDescriptor') ? reference(object.dictionary, key) : undefined
    const stream = file === undefined ? undefined : objects.get(file)?.stream
    return stream ? [stream] : []
  })
}

/** Every `/FontFile2` program of the PDF, with its name and ToUnicode map. */
export const embeddedTrueTypeFonts = (pdf: Uint8Array): EmbeddedTrueTypeFont[] => {
  const objects = readObjects(pdf)
  const unicodeByName = new Map<string, Map<number, string>>()
  for (const object of objects.values()) {
    const baseFont = object.dictionary.includes('/Subtype /Type0') ? /\/BaseFont \/([^\s/]+)/.exec(object.dictionary)?.[1] : undefined
    const cmap = reference(object.dictionary, 'ToUnicode')
    const stream = cmap === undefined ? undefined : objects.get(cmap)?.stream
    if (baseFont && stream) unicodeByName.set(baseFont, toUnicode(stream.toString('latin1')))
  }
  const fonts: EmbeddedTrueTypeFont[] = []
  for (const object of objects.values()) {
    if (!object.dictionary.includes('/FontDescriptor')) continue
    const file = reference(object.dictionary, 'FontFile2')
    const program = file === undefined ? undefined : objects.get(file)?.stream
    const fontName = /\/FontName \/([^\s/]+)/.exec(object.dictionary)?.[1]
    if (!program || !fontName) continue
    fonts.push({ name: fontName.replace(/^[A-Z]{6}\+/, ''), font: openFont(program), text: unicodeByName.get(fontName) ?? new Map() })
  }
  return fonts
}

/**
 * The glyphs of an embedded font without an outline, other than glyph 0 and
 * glyphs whose text is white space: each a glyph a reader cannot draw.
 */
export const glyphsWithoutOutline = (embedded: EmbeddedTrueTypeFont): Array<{ glyph: number, text: string | undefined }> => {
  const missing: Array<{ glyph: number, text: string | undefined }> = []
  for (let glyph = 1; glyph < embedded.font.numGlyphs; glyph += 1) {
    if (embedded.font.getGlyph(glyph).path.commands.length > 0) continue
    const text = embedded.text.get(glyph)
    if (text !== undefined && text.trim() === '') continue
    missing.push({ glyph, text })
  }
  return missing
}
