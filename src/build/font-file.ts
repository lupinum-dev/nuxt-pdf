// Checks one font file's bytes: its signature, the SFNT table directory and the cmap glyph ids.

import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import { decodeWoff2 } from '../runtime/server/engine/woff2'
import { NuxtPdfError } from '../runtime/shared/errors'

export const fontError = (
  source: string,
  message: string,
): TypeError => new TypeError(`Invalid PDF font "${source}": ${message}`)

/** The decoder's error, as the `TypeError` every other font check throws here. */
const decodedWoff2 = (source: string, bytes: Uint8Array): Uint8Array => {
  try {
    return decodeWoff2(bytes, source)
  }
  catch (error) {
    if (error instanceof NuxtPdfError) throw new TypeError(error.message, { cause: error })
    throw error
  }
}

type PdfFontFormat = 'otf' | 'ttf' | 'woff2'

/** The format a file's first four bytes name; `fontFormat` checks the length first. */
const detectFontFormat = (bytes: Uint8Array): PdfFontFormat | undefined => {
  const isTrueType = bytes[0] === 0x00
    && bytes[1] === 0x01
    && bytes[2] === 0x00
    && bytes[3] === 0x00
  const isOpenType = bytes[0] === 0x4F
    && bytes[1] === 0x54
    && bytes[2] === 0x54
    && bytes[3] === 0x4F
  const isWoff2 = bytes[0] === 0x77
    && bytes[1] === 0x4F
    && bytes[2] === 0x46
    && bytes[3] === 0x32

  if (isTrueType) return 'ttf'
  if (isOpenType) return 'otf'
  if (isWoff2) return 'woff2'
  return undefined
}

interface SfntTable { offset: number, length: number }

/**
 * fontkit's order for the Unicode cmap subtable it reads glyph ids from
 * (`CmapProcessor`): the first pair present wins.
 */
const UNICODE_CMAP_PAIRS = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]] as const

/**
 * Fail when the Unicode cmap that the engine reads names a glyph id the font
 * does not have. The render would otherwise fail in the PDF writer with an
 * offset error that does not name the font. Formats 0, 4, 6, 12 and 13 are
 * checked; a font that uses another format (8, 10) is left to the engine.
 */
const checkCmapGlyphIds = (
  source: string,
  data: Buffer,
  tables: ReadonlyMap<string, SfntTable>,
): void => {
  const corrupt = (table: string): never => {
    throw fontError(source, `the ${table} table is corrupt or truncated.`)
  }
  const maxp = tables.get('maxp')!
  if (maxp.length < 6) corrupt('maxp')
  const numGlyphs = data.readUInt16BE(maxp.offset + 4)

  const cmap = tables.get('cmap')!
  const cmapEnd = cmap.offset + cmap.length
  const u16 = (position: number): number =>
    position >= cmap.offset && position + 2 <= cmapEnd ? data.readUInt16BE(position) : corrupt('cmap')
  const u32 = (position: number): number =>
    position >= cmap.offset && position + 4 <= cmapEnd ? data.readUInt32BE(position) : corrupt('cmap')

  const subtables = Array.from({ length: u16(cmap.offset + 2) }, (_, index) => {
    const record = cmap.offset + 4 + index * 8
    return { platform: u16(record), encoding: u16(record + 2), start: cmap.offset + u32(record + 4) }
  })
  const pair = UNICODE_CMAP_PAIRS.find(([platform, encoding]) =>
    subtables.some(table => table.platform === platform && table.encoding === encoding))
  if (!pair) return
  const { start } = subtables.find(table => table.platform === pair[0] && table.encoding === pair[1])!

  const check = (codePoint: number, glyph: number): void => {
    if (glyph >= numGlyphs) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, '0')
      throw fontError(source, `the cmap table maps U+${hex} to glyph ${glyph}, but the font has ${numGlyphs} glyphs.`)
    }
  }

  const format = u16(start)
  if (format === 0) {
    for (let code = 0; code < 256; code += 1) {
      if (start + 6 + code >= cmapEnd) corrupt('cmap')
      check(code, data[start + 6 + code]!)
    }
  }
  else if (format === 4) {
    const segCountX2 = u16(start + 6)
    const ends = start + 14
    const starts = ends + segCountX2 + 2
    const deltas = starts + segCountX2
    const rangeOffsets = deltas + segCountX2
    for (let segment = 0; segment < segCountX2; segment += 2) {
      const first = u16(starts + segment)
      const last = u16(ends + segment)
      const delta = u16(deltas + segment)
      const rangeOffset = u16(rangeOffsets + segment)
      if (rangeOffset === 0) {
        // The glyphs run from first + delta, modulo 65,536: check the largest.
        const low = (first + delta) & 0xFFFF
        if (low + last - first <= 0xFFFF) check(last, low + last - first)
        else check(first + 0xFFFF - low, 0xFFFF)
        continue
      }
      for (let code = first; code <= last; code += 1) {
        const glyph = u16(rangeOffsets + segment + rangeOffset + 2 * (code - first))
        check(code, glyph === 0 ? 0 : (glyph + delta) & 0xFFFF)
      }
    }
  }
  else if (format === 6) {
    const firstCode = u16(start + 6)
    const count = u16(start + 8)
    for (let index = 0; index < count; index += 1) check(firstCode + index, u16(start + 10 + index * 2))
  }
  else if (format === 12 || format === 13) {
    const groups = u32(start + 12)
    for (let index = 0; index < groups; index += 1) {
      const group = start + 16 + index * 12
      const first = u32(group)
      const last = u32(group + 4)
      const glyph = u32(group + 8)
      // Format 12 counts up from the group's first glyph; 13 maps every code to it.
      check(format === 12 ? last : first, format === 12 ? glyph + (last - first) : glyph)
    }
  }
}

const validateSfntStructure = (
  source: string,
  bytes: Uint8Array,
  format: 'otf' | 'ttf',
): void => {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The 12-byte header holds the table count; a shorter file has no directory.
  if (data.byteLength < 12) {
    throw fontError(source, 'the SFNT table directory is corrupt or truncated.')
  }
  const tableCount = data.readUInt16BE(4)
  const directoryEnd = 12 + tableCount * 16
  if (tableCount < 1 || tableCount > 4096 || directoryEnd > data.byteLength) {
    throw fontError(source, 'the SFNT table directory is corrupt or truncated.')
  }

  const tables = new Map<string, SfntTable>()
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16
    const tag = data.toString('latin1', record, record + 4)
    const offset = data.readUInt32BE(record + 8)
    const length = data.readUInt32BE(record + 12)
    const end = offset + length
    if (
      !/^[\x20-\x7E]{4}$/u.test(tag)
      || tables.has(tag)
      || offset < directoryEnd
      || !Number.isSafeInteger(end)
      || end > data.byteLength
    ) {
      throw fontError(source, 'the SFNT table directory is corrupt or truncated.')
    }
    tables.set(tag, { offset, length })
  }

  const outlineTable = format === 'ttf'
    ? tables.has('glyf')
    : tables.has('CFF ') || tables.has('CFF2')
  if (
    !tables.has('head')
    || !tables.has('maxp')
    || !tables.has('cmap')
    || !outlineTable
  ) {
    throw fontError(source, 'the font is missing required SFNT tables.')
  }
  // The engine writes a variable font's instance from TrueType outlines
  // (engine/instance-subset.ts); fontkit cannot subset CFF2 outlines.
  if (tables.has('CFF2')) {
    throw fontError(source, 'CFF2 variable fonts are not supported. Use the TrueType variable font (.ttf) or one static .otf file per weight.')
  }
  checkCmapGlyphIds(source, data, tables)
}

/** Checks a font file's bytes and returns the format its signature names. */
export const fontFormat = (
  source: string,
  bytes: Uint8Array,
): PdfFontFormat => {
  const extension = extname(source).toLowerCase()
  if (extension !== '.otf' && extension !== '.ttf' && extension !== '.woff2') {
    throw fontError(source, 'only .ttf, .otf, and .woff2 files are supported.')
  }
  if (bytes.byteLength < 4) {
    throw fontError(source, 'the file is too small to be a supported font.')
  }

  const format = detectFontFormat(bytes)
  if (!format) {
    throw fontError(source, 'the file has an unsupported font signature.')
  }
  if (`.${format}` !== extension) {
    throw fontError(source, 'the file extension does not match its font signature.')
  }
  // A WOFF2 font is decoded here only to check it, so a broken file fails
  // the build with its name. The render worker decodes it again, once per
  // font (engine/fonts.ts), and the bundle keeps the smaller WOFF2 bytes.
  if (format === 'woff2') {
    const sfnt = decodedWoff2(source, bytes)
    validateSfntStructure(source, sfnt, sfnt[0] === 0x4F ? 'otf' : 'ttf')
  }
  else validateSfntStructure(source, bytes, format)

  return format
}
