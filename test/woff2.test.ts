import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, deflateSync } from 'node:zlib'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { renderDocument } from './engine-render'
import { decodeWoff2 } from '../src/runtime/server/engine/woff2'
import { NuxtPdfError } from '../src/runtime/shared/errors'
import { embeddedTrueTypeFonts, fontFileStreams, glyphsWithoutOutline, openFont } from './font-programs'

const SCP = 'node_modules/source-code-pro'
const read = (file: string): Buffer => readFileSync(join(SCP, file))
const TRUETYPE_FONTS = readdirSync(join(SCP, 'TTF')).filter(name => name.endsWith('.ttf'))
const OPENTYPE_FONTS = readdirSync(join(SCP, 'OTF')).filter(name => name.endsWith('.otf'))

/** The tables of sfnt bytes by tag. */
const sfntTables = (bytes: Uint8Array): Map<string, Buffer> => {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = new Map<string, Buffer>()
  for (let index = 0; index < data.readUInt16BE(4); index += 1) {
    const record = 12 + index * 16
    const offset = data.readUInt32BE(record + 8)
    tables.set(data.toString('latin1', record, record + 4), data.subarray(offset, offset + data.readUInt32BE(record + 12)))
  }
  return tables
}

const differingTables = (expected: Uint8Array, actual: Uint8Array): string[] => {
  const a = sfntTables(expected)
  const b = sfntTables(actual)
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter(tag => !a.get(tag)?.equals(b.get(tag) ?? Buffer.alloc(0)) || !b.has(tag))
}

// ---------------------------------------------------------------------------
// A small WOFF2 re-encoder, to build inputs the fixture files do not have:
// a transformed hmtx table, the overlap bitmap and hostile directories.

interface Woff2Table { flags: number, tag: string, origLength: number, transformLength?: number, data: Buffer }

const base128 = (value: number): number[] => {
  const bytes = [value & 0x7F]
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift(0x80 | (rest & 0x7F))
  return bytes
}

const readBase128 = (data: Buffer, at: { offset: number }): number => {
  let value = 0
  for (;;) {
    const byte = data[at.offset++]!
    value = value * 128 + (byte & 0x7F)
    if ((byte & 0x80) === 0) return value
  }
}

const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ']

const splitWoff2 = (woff2: Buffer): { header: Buffer, tables: Woff2Table[] } => {
  const at = { offset: 48 }
  const tables: Woff2Table[] = []
  for (let index = 0; index < woff2.readUInt16BE(12); index += 1) {
    const flags = woff2[at.offset++]!
    let tag = KNOWN[flags & 0x3F]
    if ((flags & 0x3F) === 63) {
      tag = woff2.toString('latin1', at.offset, at.offset + 4)
      at.offset += 4
    }
    const version = flags >> 6
    const origLength = readBase128(woff2, at)
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
    tables.push({ flags, tag: tag ?? `#${flags & 0x3F}`, origLength, ...(transformed ? { transformLength: readBase128(woff2, at) } : {}), data: Buffer.alloc(0) })
  }
  const stream = brotliDecompressSync(woff2.subarray(at.offset, at.offset + woff2.readUInt32BE(20)))
  let offset = 0
  for (const table of tables) {
    const length = table.transformLength ?? table.origLength
    table.data = stream.subarray(offset, offset + length)
    offset += length
  }
  return { header: woff2.subarray(0, 48), tables }
}

const joinWoff2 = (header: Buffer, tables: readonly Woff2Table[], compressed?: Buffer): Buffer => {
  const directory: number[] = []
  for (const table of tables) {
    directory.push(table.flags)
    if ((table.flags & 0x3F) === 63) directory.push(...Buffer.from(table.tag, 'latin1'))
    directory.push(...base128(table.origLength))
    if (table.transformLength !== undefined) directory.push(...base128(table.transformLength))
  }
  const stream = compressed ?? brotliCompressSync(Buffer.concat(tables.map(table => table.data)))
  const out = Buffer.concat([Buffer.from(header), Buffer.from(directory), stream])
  out.writeUInt32BE(out.length, 8)
  out.writeUInt16BE(tables.length, 12)
  out.writeUInt32BE(stream.length, 20)
  return out
}

const rewrite = (woff2: Buffer, edit: (tables: Woff2Table[]) => void): Buffer => {
  const { header, tables } = splitWoff2(woff2)
  edit(tables)
  return joinWoff2(header, tables)
}

const table = (tables: readonly Woff2Table[], tag: string): Woff2Table => tables.find(entry => entry.tag === tag)!

describe('WOFF2 decoder', () => {
  // Catches a wrong outline, advance, side bearing or box for any glyph, and
  // any other table changed on the way (E3-F1: every glyph of a TrueType
  // WOFF2 lost its outline in the PDF).
  it.each(TRUETYPE_FONTS)('decodes the TrueType WOFF2 of %s to the glyphs and tables of the TTF', (name) => {
    const ttf = read(`TTF/${name}`)
    const decoded = decodeWoff2(read(`WOFF2/TTF/${name}.woff2`), name)
    // glyf: flag runs and padding written anew; loca follows the padding;
    // head: the encoder's flags bit 11 and checkSumAdjustment; DSIG: the
    // encoder drops the signature, which no longer matches.
    expect(differingTables(ttf, decoded).filter(tag => !['glyf', 'loca', 'head'].includes(tag))).toEqual(['DSIG'])
    expect(sfntTables(decoded).has('DSIG')).toBe(false)
    const source = openFont(ttf)
    const font = openFont(decoded)
    expect(font.numGlyphs).toBe(source.numGlyphs)
    const wrong: number[] = []
    for (let id = 0; id < source.numGlyphs; id += 1) {
      const a = source.getGlyph(id)
      const b = font.getGlyph(id)
      if (JSON.stringify([a.path.commands, a.advanceWidth, a.cbox]) !== JSON.stringify([b.path.commands, b.advanceWidth, b.cbox])) wrong.push(id)
    }
    expect(wrong).toEqual([])
  })

  it.each(OPENTYPE_FONTS)('decodes the OpenType WOFF2 of %s to the tables of the OTF', (name) => {
    const decoded = decodeWoff2(read(`WOFF2/OTF/${name}.woff2`), name)
    expect(differingTables(read(`OTF/${name}`), decoded).filter(tag => tag !== 'head')).toEqual(['DSIG'])
  })

  it('writes the checksums and checkSumAdjustment of the sfnt', () => {
    const decoded = Buffer.from(decodeWoff2(read('WOFF2/TTF/SourceCodePro-Regular.ttf.woff2'), 'Regular'))
    const sum = (bytes: Buffer): number => {
      const padded = Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)])
      let total = 0
      for (let at = 0; at < padded.length; at += 4) total = (total + padded.readUInt32BE(at)) >>> 0
      return total
    }
    expect(sum(decoded)).toBe(0xB1B0AFBA)
    const tables = sfntTables(decoded)
    for (let index = 0; index < decoded.readUInt16BE(4); index += 1) {
      const record = 12 + index * 16
      const tag = decoded.toString('latin1', record, record + 4)
      const data = tables.get(tag)!
      // The head checksum is taken with checkSumAdjustment set to 0.
      const expected = tag === 'head' ? sum(Buffer.concat([data.subarray(0, 8), Buffer.alloc(4), data.subarray(12)])) : sum(data)
      expect(decoded.readUInt32BE(record + 4)).toBe(expected)
    }
  })

  // Catches a wrong left side bearing: the hmtx transform (version 1) drops
  // the bearings that equal the glyph's xMin. No fixture uses it, so the
  // test writes one.
  it('rebuilds a transformed hmtx table from the glyph boxes', () => {
    const ttf = read('TTF/SourceCodePro-Regular.ttf')
    const hmtx = sfntTables(ttf).get('hmtx')!
    const source = openFont(ttf)
    const metrics = sfntTables(ttf).get('hhea')!.readUInt16BE(34)
    const proportional = Array.from({ length: metrics }, (_, glyph) => hmtx.readInt16BE(glyph * 4 + 2) === source.getGlyph(glyph).cbox.minX)
    expect(proportional.every(Boolean)).toBe(true)
    const woff2 = rewrite(read('WOFF2/TTF/SourceCodePro-Regular.ttf.woff2'), (tables) => {
      const entry = table(tables, 'hmtx')
      const advances = Buffer.alloc(metrics * 2)
      for (let glyph = 0; glyph < metrics; glyph += 1) advances.writeUInt16BE(hmtx.readUInt16BE(glyph * 4), glyph * 2)
      // Flag 1: no proportional bearings; the monospaced ones stay stored.
      const data = Buffer.concat([Buffer.from([1]), advances, hmtx.subarray(metrics * 4)])
      Object.assign(entry, { flags: (entry.flags & 0x3F) | 0x40, transformLength: data.length, data })
    })
    expect(sfntTables(decodeWoff2(woff2, 'hmtx')).get('hmtx')!.equals(hmtx)).toBe(true)
  })

  // Catches the overlap bitmap ignored: the first point of a marked glyph
  // gets OVERLAP_SIMPLE (0x40), and the outline stays the same.
  it('sets OVERLAP_SIMPLE from the overlap bitmap', () => {
    const woff2 = rewrite(read('WOFF2/TTF/SourceCodePro-Regular.ttf.woff2'), (tables) => {
      const glyf = table(tables, 'glyf')
      const numGlyphs = glyf.data.readUInt16BE(4)
      const data = Buffer.concat([glyf.data, Buffer.alloc((numGlyphs + 7) >> 3, 0xFF)])
      data.writeUInt16BE(data.readUInt16BE(2) | 1, 2)
      Object.assign(glyf, { transformLength: data.length, data })
    })
    const decoded = decodeWoff2(woff2, 'overlap')
    const font = openFont(decoded)
    const glyph = font.glyphsForString('E')[0]!
    const tables = sfntTables(decoded)
    const offset = tables.get('loca')!.readUInt32BE(glyph.id * 4)
    const record = tables.get('glyf')!.subarray(offset)
    const contours = record.readInt16BE(0)
    const instructions = record.readUInt16BE(10 + contours * 2)
    expect(record[12 + contours * 2 + instructions]! & 0x40).toBe(0x40)
    expect(glyph.path.commands).toEqual(openFont(read('TTF/SourceCodePro-Regular.ttf')).glyphsForString('E')[0]!.path.commands)
  })
})

const WOFF2_SEED = Number(process.env.NUXT_PDF_WOFF2_SEED) || 20_261_122

describe('WOFF2 decoder on hostile input', () => {
  const regular = read('WOFF2/TTF/SourceCodePro-Regular.ttf.woff2')
  const openType = read('WOFF2/OTF/SourceCodePro-Regular.otf.woff2')

  const outcome = (bytes: Uint8Array): { error?: NuxtPdfError, ms: number } => {
    const start = performance.now()
    try {
      decodeWoff2(bytes, 'hostile.woff2')
      return { ms: performance.now() - start }
    }
    catch (error) {
      if (!(error instanceof NuxtPdfError)) throw error
      return { error, ms: performance.now() - start }
    }
  }

  const patched = (bytes: Buffer, at: number, value: number): Buffer => {
    const copy = Buffer.from(bytes)
    copy.writeUInt32BE(value, at)
    return copy
  }

  // Catches a crash, a hang or an allocation from a header number; each
  // case fails fast with PDF_ASSET_INVALID and names the file.
  it.each([
    ['a font collection', () => patched(regular, 4, 0x74746366), 'the WOFF2 file is a font collection, which is not supported.'],
    ['a wrong signature', () => patched(regular, 0, 0x774F4633), 'the file is not a WOFF2 font.'],
    ['a wrong length', () => patched(regular, 8, regular.length + 1), 'the WOFF2 header is corrupt or truncated.'],
    ['a header shorter than 48 bytes', () => regular.subarray(0, 47), 'the WOFF2 header is corrupt or truncated.'],
    ['a table length past the stream', () => rewrite(regular, (tables) => {
      table(tables, 'name').origLength += 100_000
    }), 'the WOFF2 table "name" reads past the end of the data.'],
    ['numGlyphs larger than the streams', () => rewrite(regular, (tables) => {
      const glyf = table(tables, 'glyf')
      const data = Buffer.from(glyf.data)
      data.writeUInt16BE(0xFFFF, 4)
      glyf.data = data
    // The bbox bitmap, sized from numGlyphs, is the first read past its stream.
    }), 'the WOFF2 bbox stream is truncated.'],
    ['a transformed loca with data', () => rewrite(regular, (tables) => {
      const loca = table(tables, 'loca')
      Object.assign(loca, { transformLength: 4, data: Buffer.alloc(4) })
    }), 'the WOFF2 loca table has data.'],
    ['a table with an unknown transform', () => rewrite(regular, (tables) => {
      const name = table(tables, 'name')
      Object.assign(name, { flags: (name.flags & 0x3F) | 0x80, transformLength: name.data.length })
    }), 'the WOFF2 table "name" uses an unknown transform.'],
    ['a Brotli bomb', () => {
      const { header } = splitWoff2(regular)
      const bomb = brotliCompressSync(Buffer.alloc(30 * 1024 * 1024))
      return joinWoff2(header, [{ flags: 5, tag: 'name', origLength: 30 * 1024 * 1024, data: Buffer.alloc(0) }], bomb)
    }, 'the decoded font exceeds the 20971520-byte limit.'],
  ] as const)('refuses %s', (_, input, message) => {
    const bytes = input()
    const { error, ms } = outcome(bytes)
    expect(error?.code).toBe('PDF_ASSET_INVALID')
    expect(error?.message).toBe(`Invalid PDF font "hostile.woff2": ${message}`)
    expect(ms).toBeLessThan(200)
  })

  it.each([['TrueType', regular], ['OpenType', openType]] as const)('refuses the %s WOFF2 cut at every 97th byte', (_, font) => {
    const slow: number[] = []
    for (let cut = 97; cut < font.length; cut += 97) {
      // The header keeps the cut length, so the decoder reads into the cut data.
      const bytes = Buffer.from(font.subarray(0, cut))
      if (cut >= 48) bytes.writeUInt32BE(cut, 8)
      const { error, ms } = outcome(bytes)
      expect(error?.code, `cut at ${cut}`).toBe('PDF_ASSET_INVALID')
      if (ms >= 200) slow.push(cut)
    }
    expect(slow).toEqual([])
  })

  // A fixed seed, so a run of the suite is red or green by the code and not
  // by chance; NUXT_PDF_WOFF2_SEED=7 explores another one.
  it(`decodes or refuses a WOFF2 with changed bytes, never crashes (seed ${WOFF2_SEED})`, () => {
    fc.assert(fc.property(
      fc.array(fc.record({ at: fc.nat({ max: regular.length - 1 }), value: fc.nat({ max: 255 }) }), { minLength: 1, maxLength: 8 }),
      (changes) => {
        const bytes = Buffer.from(regular)
        for (const { at, value } of changes) bytes[at] = value
        const { ms } = outcome(bytes)
        expect(ms).toBeLessThan(200)
      },
    ), { numRuns: 300, seed: WOFF2_SEED })
  })
})

// ---------------------------------------------------------------------------
// The embedded font program in the PDF.

const documentWith = (text: string): DocumentNode => ({
  type: PDF_PRIMITIVES.Document,
  props: {},
  children: [{
    type: PDF_PRIMITIVES.Page,
    box: {},
    style: { padding: 32 },
    props: { size: 'A4' },
    children: [{
      type: PDF_PRIMITIVES.Text,
      box: {},
      style: { fontFamily: 'Embedded', fontSize: 16 },
      props: {},
      children: [{ type: PDF_PRIMITIVES.TextInstance, value: text }],
    }],
  }],
} as DocumentNode)

const render = async (bytes: Uint8Array, format: string, text: string): Promise<Uint8Array> => {
  const src = `data:font/${format};base64,${Buffer.from(bytes).toString('base64')}` as PdfFontDataUrl
  const fontStore = createPdfFontStore([{ family: 'Embedded', src, fontStyle: 'normal', fontWeight: 400 }])
  return (await renderDocument(documentWith(text), { fontStore })).bytes
}

/** A WOFF 1 file from sfnt bytes: each table deflated (WOFF 1.0, section 5). */
const woff1 = (sfnt: Buffer): Buffer => {
  const count = sfnt.readUInt16BE(4)
  let offset = 44 + 20 * count
  const entries = Array.from({ length: count }, (_, index) => {
    const record = 12 + index * 16
    const original = sfnt.subarray(sfnt.readUInt32BE(record + 8), sfnt.readUInt32BE(record + 8) + sfnt.readUInt32BE(record + 12))
    const compressed = deflateSync(original)
    const data = compressed.length < original.length ? compressed : original
    const entry = { record, original, data, offset }
    offset += Math.ceil(data.length / 4) * 4
    return entry
  })
  const out = Buffer.alloc(offset)
  out.write('wOFF', 0, 'latin1')
  out.writeUInt32BE(sfnt.readUInt32BE(0), 4)
  out.writeUInt32BE(offset, 8)
  out.writeUInt16BE(count, 12)
  out.writeUInt32BE(sfnt.length, 16)
  entries.forEach((entry, index) => {
    const at = 44 + index * 20
    sfnt.copy(out, at, entry.record, entry.record + 4)
    out.writeUInt32BE(entry.offset, at + 4)
    out.writeUInt32BE(entry.data.length, at + 8)
    out.writeUInt32BE(entry.original.length, at + 12)
    out.writeUInt32BE(sfnt.readUInt32BE(entry.record + 4), at + 16)
    entry.data.copy(out, entry.offset)
  })
  return out
}

describe('embedded font programs', () => {
  // The test that was missing for E3-F1: a check of the extracted text passed
  // while the glyphs had no outline. Each used glyph, simple ones (E, m) and
  // composite ones (i, Ö, the hyphen), must have the outline of the source
  // font in the PDF's font program.
  const TEXT = 'Em iÖ-'
  it.each([
    ['TTF', 'TTF/SourceCodePro-Regular.ttf', 'ttf'],
    ['TrueType WOFF2', 'WOFF2/TTF/SourceCodePro-Regular.ttf.woff2', 'woff2'],
  ] as const)('embeds the source outlines of a %s font', async (_, file, format) => {
    const pdf = await render(read(file), format, TEXT)
    const [embedded, ...others] = embeddedTrueTypeFonts(pdf)
    expect(others).toEqual([])
    expect(embedded!.name).toBe('SourceCodePro-Regular')
    const source = openFont(read('TTF/SourceCodePro-Regular.ttf'))
    const glyphOf = new Map([...embedded!.text].map(([glyph, text]) => [text, glyph]))
    const compared = [...TEXT.replaceAll(' ', '')].map(character => [
      character,
      JSON.stringify(embedded!.font.getGlyph(glyphOf.get(character)!).path.commands) === JSON.stringify(source.glyphsForString(character)[0]!.path.commands),
    ])
    expect(compared).toEqual([['E', true], ['m', true], ['i', true], ['Ö', true], ['-', true]])
    expect(glyphsWithoutOutline(embedded!)).toEqual([])
  })

  it('embeds the same CFF program for an OpenType WOFF2 as for its OTF', async () => {
    const [fromOtf, ...others] = fontFileStreams(await render(read('OTF/SourceCodePro-Regular.otf'), 'otf', TEXT), 'FontFile3')
    const [fromWoff2] = fontFileStreams(await render(read('WOFF2/OTF/SourceCodePro-Regular.otf.woff2'), 'woff2', TEXT), 'FontFile3')
    expect(others).toEqual([])
    expect(fromOtf!.length).toBeGreaterThan(0)
    expect(fromWoff2!.equals(fromOtf!)).toBe(true)
  })

  // WOFF 1 is not a supported font format (the build accepts .ttf, .otf and
  // .woff2); the guard keeps any WOFF bytes away from fontkit.
  it('refuses WOFF bytes before they reach the font engine', async () => {
    const bytes = woff1(read('TTF/SourceCodePro-Regular.ttf'))
    await expect(render(bytes, 'ttf', TEXT)).rejects.toMatchObject({
      code: 'PDF_ASSET_INVALID',
      message: 'Invalid PDF font "Embedded 400 normal": the font engine must receive TTF or OTF bytes, not WOFF bytes.',
    })
  })
})
