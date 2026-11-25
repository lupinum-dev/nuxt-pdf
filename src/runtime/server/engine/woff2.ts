// WOFF2 to sfnt (TTF or OTF bytes), per the W3C WOFF File Format 2.0
// recommendation (https://www.w3.org/TR/WOFF2/), so fontkit never reads a
// WOFF2 file. fontkit 2.0.4 lays out a WOFF2 font correctly but subsets it
// from the transformed `glyf` stream and a `loca` table it reads from the
// wrong bytes: the embedded glyphs had no outline or a wrong one, and a
// composite glyph failed the render. Decoding to a plain sfnt first gives fontkit the input it subsets
// correctly.
import type { Buffer } from 'node:buffer'
import { brotliDecompressSync } from 'node:zlib'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'

/**
 * The largest decoded font, for the Brotli output and for the rebuilt sfnt.
 * The WOFF2 header's `totalSfntSize` is only a hint; the decoder checks the
 * real lengths against this limit and never allocates from a header number.
 */
export const MAX_DECODED_FONT_BYTES = 20 * 1024 * 1024

const SIGNATURE_WOFF2 = 0x774F4632
const SIGNATURE_WOFF = 0x774F4646
const FLAVOR_TRUETYPE = 0x00010000
const FLAVOR_OPENTYPE = 0x4F54544F
const FLAVOR_COLLECTION = 0x74746366

/** Section 4.1: the tags a table directory entry names by index (0 to 62). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
] as const

class Woff2Error extends Error {}

const invalidFont = (label: string, message: string, cause?: unknown): NuxtPdfError =>
  new NuxtPdfError(PDF_ERROR_CODES.AssetInvalid, `Invalid PDF font "${label}": ${message}`, { cause })

/** A bounded big-endian reader: reading past the end throws. */
// Plain fields, not parameter properties: the render worker runs this file
// with Node's type stripping, which does not support them.
class Reader {
  offset = 0
  readonly bytes: Uint8Array
  private readonly name: string
  private readonly view: DataView

  constructor(bytes: Uint8Array, name: string) {
    this.bytes = bytes
    this.name = name
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private take(length: number): number {
    const start = this.offset
    if (length < 0 || start + length > this.bytes.byteLength) {
      throw new Woff2Error(`the WOFF2 ${this.name} is truncated.`)
    }
    this.offset = start + length
    return start
  }

  u8(): number { return this.view.getUint8(this.take(1)) }
  u16(): number { return this.view.getUint16(this.take(2)) }
  i16(): number { return this.view.getInt16(this.take(2)) }
  u32(): number { return this.view.getUint32(this.take(4)) }
  bytesOf(length: number): Uint8Array {
    const start = this.take(length)
    return this.bytes.subarray(start, start + length)
  }

  /** Section 4.1, UIntBase128: at most 5 bytes, no leading zero byte, fits 32 bits. */
  base128(): number {
    let value = 0
    for (let index = 0; index < 5; index += 1) {
      const byte = this.u8()
      if (index === 0 && byte === 0x80) throw new Woff2Error('the WOFF2 table directory has an invalid number.')
      if (value > 0x01FFFFFF) throw new Woff2Error('the WOFF2 table directory has an invalid number.')
      value = value * 128 + (byte & 0x7F)
      if ((byte & 0x80) === 0) return value
    }
    throw new Woff2Error('the WOFF2 table directory has an invalid number.')
  }

  /** Section 6.1.1, 255UInt16. */
  u255(): number {
    const code = this.u8()
    if (code === 253) return this.u16()
    if (code === 255) return this.u8() + 253
    if (code === 254) return this.u8() + 253 * 2
    return code
  }
}

interface TableEntry {
  tag: string
  transformVersion: number
  origLength: number
  transformLength?: number
  data: Uint8Array
}

const isTransformed = (tag: string, version: number): boolean =>
  tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0

/** Section 4: the table directory, read from the header reader. */
const readDirectory = (header: Reader, count: number): Omit<TableEntry, 'data'>[] => {
  const entries: Omit<TableEntry, 'data'>[] = []
  const seen = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const flags = header.u8()
    const tagIndex = flags & 0x3F
    const tag = tagIndex === 63
      ? String.fromCharCode(...header.bytesOf(4))
      : KNOWN_TAGS[tagIndex]!
    const transformVersion = flags >> 6
    const origLength = header.base128()
    const transformed = isTransformed(tag, transformVersion)
    const transformLength = transformed ? header.base128() : undefined
    if (seen.has(tag)) throw new Woff2Error(`the WOFF2 table directory names the table "${tag}" twice.`)
    seen.add(tag)
    const known = tag === 'glyf' || tag === 'loca'
      ? transformVersion === 0 || transformVersion === 3
      : transformVersion === 0 || (tag === 'hmtx' && transformVersion === 1)
    if (!known) throw new Woff2Error(`the WOFF2 table "${tag}" uses an unknown transform.`)
    entries.push({ tag, transformVersion, origLength, transformLength })
  }
  return entries
}

const bit = (bitmap: Uint8Array, index: number): boolean => (bitmap[index >> 3]! & (0x80 >> (index & 7))) !== 0

/** Section 5.2: one point of a simple glyph from its flag byte and the glyph stream. */
const withSign = (flag: number, value: number): number => (flag & 1) !== 0 ? value : -value

interface Point { x: number, y: number, onCurve: boolean }

const readPoints = (flags: Reader, glyphs: Reader, count: number): Point[] => {
  const points: Point[] = []
  let x = 0
  let y = 0
  for (let index = 0; index < count; index += 1) {
    let flag = flags.u8()
    const onCurve = (flag & 0x80) === 0
    flag &= 0x7F
    let dx: number
    let dy: number
    if (flag < 10) {
      dx = 0
      dy = withSign(flag, ((flag & 14) << 7) + glyphs.u8())
    }
    else if (flag < 20) {
      dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphs.u8())
      dy = 0
    }
    else if (flag < 84) {
      const b0 = flag - 20
      const b1 = glyphs.u8()
      dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4))
      dy = withSign(flag >> 1, 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F))
    }
    else if (flag < 120) {
      const b0 = flag - 84
      dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphs.u8())
      dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8())
    }
    else if (flag < 124) {
      const b1 = glyphs.u8()
      const b2 = glyphs.u8()
      const b3 = glyphs.u8()
      dx = withSign(flag, (b1 << 4) + (b2 >> 4))
      dy = withSign(flag >> 1, ((b2 & 0x0F) << 8) + b3)
    }
    else {
      dx = withSign(flag, glyphs.u16())
      dy = withSign(flag >> 1, glyphs.u16())
    }
    x += dx
    y += dy
    points.push({ x, y, onCurve })
  }
  return points
}

const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const REPEAT = 0x08
const X_SAME_OR_POSITIVE = 0x10
const Y_SAME_OR_POSITIVE = 0x20
const OVERLAP_SIMPLE = 0x40

const fitsInt16 = (value: number): boolean => value >= -0x8000 && value <= 0x7FFF

/** A TrueType simple glyph record (OpenType `glyf`), flags with repeat runs. */
const encodeSimpleGlyph = (
  endPoints: readonly number[],
  points: readonly Point[],
  box: readonly [number, number, number, number],
  instructions: Uint8Array,
  overlap: boolean,
): Uint8Array => {
  const flags: number[] = []
  const xs: number[] = []
  const ys: number[] = []
  let lastX = 0
  let lastY = 0
  let lastFlag = -1
  let repeat = 0
  for (const [index, point] of points.entries()) {
    const dx = point.x - lastX
    const dy = point.y - lastY
    if (!fitsInt16(dx) || !fitsInt16(dy)) throw new Woff2Error('a glyph has a coordinate outside the 16-bit range.')
    let flag = point.onCurve ? ON_CURVE : 0
    if (overlap && index === 0) flag |= OVERLAP_SIMPLE
    if (dx === 0) flag |= X_SAME_OR_POSITIVE
    else if (dx > -256 && dx < 256) {
      flag |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0)
      xs.push(-1, Math.abs(dx))
    }
    else xs.push(dx)
    if (dy === 0) flag |= Y_SAME_OR_POSITIVE
    else if (dy > -256 && dy < 256) {
      flag |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0)
      ys.push(-1, Math.abs(dy))
    }
    else ys.push(dy)
    if (flag === lastFlag && repeat !== 255) {
      flags[flags.length - 1]! |= REPEAT
      repeat += 1
    }
    else {
      if (repeat !== 0) flags.push(repeat)
      flags.push(flag)
      repeat = 0
    }
    lastFlag = flag
    lastX = point.x
    lastY = point.y
  }
  if (repeat !== 0) flags.push(repeat)

  // A -1 marker is followed by one unsigned byte; any other value is an int16.
  const coordinateBytes = (values: readonly number[]): number => {
    let size = 0
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === -1) {
        size += 1
        index += 1
      }
      else size += 2
    }
    return size
  }
  const size = 10 + 2 * endPoints.length + 2 + instructions.byteLength + flags.length + coordinateBytes(xs) + coordinateBytes(ys)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0
  const int16 = (value: number): void => {
    view.setInt16(at, value)
    at += 2
  }
  const bytes = (data: ArrayLike<number>): void => {
    out.set(data, at)
    at += data.length
  }
  int16(endPoints.length)
  for (const value of box) int16(value)
  for (const end of endPoints) int16(end)
  int16(instructions.byteLength)
  bytes(instructions)
  bytes(flags)
  for (const values of [xs, ys]) {
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === -1) {
        bytes([values[index + 1]!])
        index += 1
      }
      else int16(values[index]!)
    }
  }
  return out
}

const ARG_1_AND_2_ARE_WORDS = 0x0001
const WE_HAVE_A_SCALE = 0x0008
const MORE_COMPONENTS = 0x0020
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040
const WE_HAVE_A_TWO_BY_TWO = 0x0080
const WE_HAVE_INSTRUCTIONS = 0x0100

/** Section 5.3: the bytes of one composite glyph's components, and whether it has instructions. */
const readComposite = (composites: Reader): { components: Uint8Array, hasInstructions: boolean } => {
  const start = composites.offset
  let hasInstructions = false
  let flags: number
  do {
    flags = composites.u16()
    composites.u16() // glyph index
    hasInstructions ||= (flags & WE_HAVE_INSTRUCTIONS) !== 0
    let argumentBytes = (flags & ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2
    if ((flags & WE_HAVE_A_SCALE) !== 0) argumentBytes += 2
    else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) argumentBytes += 4
    else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) argumentBytes += 8
    composites.bytesOf(argumentBytes)
  } while ((flags & MORE_COMPONENTS) !== 0)
  return { components: composites.bytes.subarray(start, composites.offset), hasInstructions }
}

interface RebuiltGlyf { glyf: Uint8Array, loca: Uint8Array, xMins: Int16Array, numGlyphs: number, indexFormat: number }

/** Section 5: the transformed `glyf` table back to `glyf` and `loca`. */
const rebuildGlyf = (data: Uint8Array, limit: number): RebuiltGlyf => {
  const header = new Reader(data, 'glyf table')
  header.u16() // reserved
  const optionFlags = header.u16()
  const numGlyphs = header.u16()
  const indexFormat = header.u16()
  if (indexFormat > 1) throw new Woff2Error('the WOFF2 glyf table has an unknown index format.')
  const sizes = Array.from({ length: 7 }, () => header.u32())
  const streams: Uint8Array[] = []
  let at = header.offset
  for (const size of sizes) {
    if (at + size > data.byteLength) throw new Woff2Error('the WOFF2 glyf table is truncated.')
    streams.push(data.subarray(at, at + size))
    at += size
  }
  const [nContourBytes, nPointsBytes, flagBytes, glyphBytes, compositeBytes, bboxBytes, instructionBytes] = streams as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array]
  let overlapBitmap: Uint8Array | undefined
  if ((optionFlags & 1) !== 0) {
    const length = (numGlyphs + 7) >> 3
    if (at + length > data.byteLength) throw new Woff2Error('the WOFF2 glyf table is truncated.')
    overlapBitmap = data.subarray(at, at + length)
  }
  const nContours = new Reader(nContourBytes, 'nContour stream')
  const nPoints = new Reader(nPointsBytes, 'nPoints stream')
  const flags = new Reader(flagBytes, 'flag stream')
  const glyphs = new Reader(glyphBytes, 'glyph stream')
  const composites = new Reader(compositeBytes, 'composite stream')
  const bbox = new Reader(bboxBytes, 'bbox stream')
  const bboxBitmap = bbox.bytesOf(4 * ((numGlyphs + 31) >> 5))
  const instructions = new Reader(instructionBytes, 'instruction stream')

  const records: Uint8Array[] = []
  const xMins = new Int16Array(numGlyphs)
  const align = indexFormat === 0 ? 2 : 4
  let total = 0
  for (let glyph = 0; glyph < numGlyphs; glyph += 1) {
    const contours = nContours.i16()
    const hasBox = bit(bboxBitmap, glyph)
    const readBox = (): [number, number, number, number] => [bbox.i16(), bbox.i16(), bbox.i16(), bbox.i16()]
    let record: Uint8Array
    if (contours === 0) {
      if (hasBox) throw new Woff2Error('the WOFF2 glyf table gives an empty glyph a bounding box.')
      record = new Uint8Array(0)
    }
    else if (contours > 0) {
      const endPoints: number[] = []
      let count = 0
      for (let contour = 0; contour < contours; contour += 1) {
        count += nPoints.u255()
        if (count > 0xFFFF) throw new Woff2Error('a glyph has more than 65535 points.')
        endPoints.push(count - 1)
      }
      if (count === 0) throw new Woff2Error('the WOFF2 glyf table has a glyph with contours but no points.')
      const points = readPoints(flags, glyphs, count)
      const instructionLength = glyphs.u255()
      const program = instructions.bytesOf(instructionLength)
      let box: [number, number, number, number]
      if (hasBox) box = readBox()
      else {
        box = [points[0]!.x, points[0]!.y, points[0]!.x, points[0]!.y]
        for (const point of points) {
          box = [Math.min(box[0], point.x), Math.min(box[1], point.y), Math.max(box[2], point.x), Math.max(box[3], point.y)]
        }
        if (!box.every(fitsInt16)) throw new Woff2Error('a glyph has a coordinate outside the 16-bit range.')
      }
      xMins[glyph] = box[0]
      record = encodeSimpleGlyph(endPoints, points, box, program, overlapBitmap !== undefined && bit(overlapBitmap, glyph))
    }
    else if (contours === -1) {
      if (!hasBox) throw new Woff2Error('the WOFF2 glyf table has a composite glyph without a bounding box.')
      const box = readBox()
      xMins[glyph] = box[0]
      const { components, hasInstructions } = readComposite(composites)
      const program = hasInstructions ? instructions.bytesOf(glyphs.u255()) : new Uint8Array(0)
      record = new Uint8Array(10 + components.byteLength + (hasInstructions ? 2 + program.byteLength : 0))
      const view = new DataView(record.buffer)
      view.setInt16(0, -1)
      box.forEach((value, index) => view.setInt16(2 + index * 2, value))
      record.set(components, 10)
      if (hasInstructions) {
        view.setUint16(10 + components.byteLength, program.byteLength)
        record.set(program, 12 + components.byteLength)
      }
    }
    else throw new Woff2Error('the WOFF2 glyf table has an invalid contour count.')
    records.push(record)
    total += Math.ceil(record.byteLength / align) * align
    if (total > limit) throw new Woff2Error(`the decoded font exceeds the ${limit}-byte limit.`)
  }
  if (indexFormat === 0 && total > 0x1FFFE) throw new Woff2Error('the WOFF2 glyf table is too large for its short index format.')

  const glyf = new Uint8Array(total)
  const loca = new Uint8Array((numGlyphs + 1) * (indexFormat === 0 ? 2 : 4))
  const locaView = new DataView(loca.buffer)
  let offset = 0
  const writeOffset = (index: number): void => {
    if (indexFormat === 0) locaView.setUint16(index * 2, offset / 2)
    else locaView.setUint32(index * 4, offset)
  }
  for (const [index, record] of records.entries()) {
    writeOffset(index)
    glyf.set(record, offset)
    offset += Math.ceil(record.byteLength / align) * align
  }
  writeOffset(numGlyphs)
  return { glyf, loca, xMins, numGlyphs, indexFormat }
}

/** Section 5.4: the transformed `hmtx` table back, left side bearings from the glyph xMin. */
const rebuildHmtx = (data: Uint8Array, rebuilt: RebuiltGlyf, hhea: Uint8Array | undefined): Uint8Array => {
  if (!hhea || hhea.byteLength < 36) throw new Woff2Error('the WOFF2 font has a transformed hmtx table without an hhea table.')
  const numberOfHMetrics = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34)
  const { numGlyphs, xMins } = rebuilt
  if (numberOfHMetrics < 1 || numberOfHMetrics > numGlyphs) throw new Woff2Error('the WOFF2 hhea table has an invalid number of metrics.')
  const reader = new Reader(data, 'hmtx table')
  const flags = reader.u8()
  if ((flags & 0xFC) !== 0 || (flags & 0x03) === 0) throw new Woff2Error('the WOFF2 hmtx table has invalid flags.')
  const advances = Array.from({ length: numberOfHMetrics }, () => reader.u16())
  const proportional = (flags & 1) === 0
    ? Array.from({ length: numberOfHMetrics }, () => reader.i16())
    : Array.from({ length: numberOfHMetrics }, (_, glyph) => xMins[glyph]!)
  const monospaced = (flags & 2) === 0
    ? Array.from({ length: numGlyphs - numberOfHMetrics }, () => reader.i16())
    : Array.from({ length: numGlyphs - numberOfHMetrics }, (_, index) => xMins[numberOfHMetrics + index]!)
  const out = new Uint8Array(4 * numberOfHMetrics + 2 * (numGlyphs - numberOfHMetrics))
  const view = new DataView(out.buffer)
  advances.forEach((advance, index) => {
    view.setUint16(index * 4, advance)
    view.setInt16(index * 4 + 2, proportional[index]!)
  })
  monospaced.forEach((bearing, index) => view.setInt16(4 * numberOfHMetrics + index * 2, bearing))
  return out
}

const checksum = (bytes: Uint8Array): number => {
  const padded = bytes.byteLength % 4 === 0 ? bytes : Uint8Array.from({ length: Math.ceil(bytes.byteLength / 4) * 4 }, (_, index) => bytes[index] ?? 0)
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  let sum = 0
  for (let at = 0; at < padded.byteLength; at += 4) sum = (sum + view.getUint32(at)) >>> 0
  return sum
}

/** An sfnt with a sorted table directory, 4-byte padding, checksums and `head.checkSumAdjustment`. */
const writeSfnt = (flavor: number, tables: ReadonlyMap<string, Uint8Array>, limit: number): Uint8Array => {
  const tags = [...tables.keys()].sort()
  const count = tags.length
  let size = 12 + 16 * count
  for (const tag of tags) size += Math.ceil(tables.get(tag)!.byteLength / 4) * 4
  if (size > limit) throw new Woff2Error(`the decoded font exceeds the ${limit}-byte limit.`)
  const head = tables.get('head')
  if (!head || head.byteLength < 12) throw new Woff2Error('the WOFF2 font has no valid head table.')

  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  const power = 2 ** Math.floor(Math.log2(count))
  view.setUint32(0, flavor)
  view.setUint16(4, count)
  view.setUint16(6, power * 16)
  view.setUint16(8, Math.log2(power))
  view.setUint16(10, count * 16 - power * 16)
  let offset = 12 + 16 * count
  let headOffset = 0
  for (const [index, tag] of tags.entries()) {
    const table = tag === 'head' ? Uint8Array.from(tables.get(tag)!) : tables.get(tag)!
    if (tag === 'head') {
      new DataView(table.buffer).setUint32(8, 0)
      headOffset = offset
    }
    const record = 12 + index * 16
    for (let character = 0; character < 4; character += 1) out[record + character] = tag.charCodeAt(character)
    view.setUint32(record + 4, checksum(table))
    view.setUint32(record + 8, offset)
    view.setUint32(record + 12, table.byteLength)
    out.set(table, offset)
    offset += Math.ceil(table.byteLength / 4) * 4
  }
  view.setUint32(headOffset + 8, (0xB1B0AFBA - checksum(out)) >>> 0)
  return out
}

/** Whether these bytes are a WOFF2 file (by signature). */
export const isWoff2 = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) === SIGNATURE_WOFF2

/**
 * Decode a WOFF2 font to sfnt bytes. Fails with `PDF_ASSET_INVALID`, naming
 * `label` (the font file or family), for a font collection, a wrong
 * signature, flavor or length, a table that reads past its data, and a
 * decoded size over `limit`.
 */
export const decodeWoff2 = (input: Uint8Array, label: string, limit = MAX_DECODED_FONT_BYTES): Uint8Array => {
  try {
    if (input.byteLength < 48) throw new Woff2Error('the WOFF2 header is corrupt or truncated.')
    const header = new Reader(input, 'header')
    if (header.u32() !== SIGNATURE_WOFF2) throw new Woff2Error('the file is not a WOFF2 font.')
    const flavor = header.u32()
    if (flavor === FLAVOR_COLLECTION) throw new Woff2Error('the WOFF2 file is a font collection, which is not supported.')
    if (flavor !== FLAVOR_TRUETYPE && flavor !== FLAVOR_OPENTYPE) throw new Woff2Error('the WOFF2 font must wrap a TTF or OTF font.')
    const length = header.u32()
    const tableCount = header.u16()
    const reserved = header.u16()
    header.u32() // totalSfntSize: a hint only
    const compressedSize = header.u32()
    header.u32() // majorVersion, minorVersion
    const metadataOffset = header.u32()
    const metadataLength = header.u32()
    const metadataOriginalLength = header.u32()
    const privateOffset = header.u32()
    const privateLength = header.u32()
    if (length !== input.byteLength || tableCount < 1 || tableCount > 4096 || reserved !== 0 || compressedSize < 1) {
      throw new Woff2Error('the WOFF2 header is corrupt or truncated.')
    }
    const metadataAbsent = metadataOffset === 0 && metadataLength === 0 && metadataOriginalLength === 0
    const metadataPresent = metadataOffset >= 48 && metadataLength > 0 && metadataOriginalLength > 0 && metadataOffset + metadataLength <= length
    const privateAbsent = privateOffset === 0 && privateLength === 0
    const privatePresent = privateOffset >= 48 && privateLength > 0 && privateOffset + privateLength <= length
    if ((!metadataAbsent && !metadataPresent) || (!privateAbsent && !privatePresent)) {
      throw new Woff2Error('the WOFF2 optional data blocks are corrupt.')
    }

    const directory = readDirectory(header, tableCount)
    const compressedStart = header.offset
    if (compressedStart + compressedSize > length) throw new Woff2Error('the WOFF2 compressed data reads past the end of the file.')
    let stream: Buffer
    try {
      stream = brotliDecompressSync(input.subarray(compressedStart, compressedStart + compressedSize), { maxOutputLength: limit })
    }
    catch (error) {
      if (error instanceof RangeError) throw new Woff2Error(`the decoded font exceeds the ${limit}-byte limit.`)
      throw new Woff2Error('the WOFF2 compressed data is corrupt.')
    }

    const entries: TableEntry[] = []
    let at = 0
    for (const entry of directory) {
      const stored = entry.transformLength ?? entry.origLength
      if (at + stored > stream.byteLength) throw new Woff2Error(`the WOFF2 table "${entry.tag}" reads past the end of the data.`)
      entries.push({ ...entry, data: stream.subarray(at, at + stored) })
      at += stored
    }
    const byTag = new Map(entries.map(entry => [entry.tag, entry]))
    const glyfEntry = byTag.get('glyf')
    const locaEntry = byTag.get('loca')
    const glyfTransformed = glyfEntry?.transformLength !== undefined
    const locaTransformed = locaEntry?.transformLength !== undefined
    if (glyfTransformed !== locaTransformed) {
      throw new Woff2Error('the WOFF2 glyf and loca tables must be transformed together.')
    }
    if (locaTransformed && locaEntry!.transformLength !== 0) throw new Woff2Error('the WOFF2 loca table has data.')

    const tables = new Map<string, Uint8Array>()
    for (const entry of entries) {
      if (entry.transformLength === undefined) tables.set(entry.tag, entry.data)
    }
    if (glyfTransformed) {
      const rebuilt = rebuildGlyf(glyfEntry!.data, limit)
      if (rebuilt.loca.byteLength !== locaEntry!.origLength) throw new Woff2Error('the WOFF2 loca table length does not match its glyf table.')
      // fontkit finds glyphs through maxp.numGlyphs and head.indexToLocFormat.
      const maxp = tables.get('maxp')
      const head = tables.get('head')
      if (!maxp || maxp.byteLength < 6 || new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4) !== rebuilt.numGlyphs) {
        throw new Woff2Error('the WOFF2 maxp table does not match its glyf table.')
      }
      if (!head || head.byteLength < 54 || new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(50) !== rebuilt.indexFormat) {
        throw new Woff2Error('the WOFF2 head table does not match its loca format.')
      }
      tables.set('glyf', rebuilt.glyf)
      tables.set('loca', rebuilt.loca)
      const hmtx = byTag.get('hmtx')
      if (hmtx?.transformLength !== undefined) {
        const table = rebuildHmtx(hmtx.data, rebuilt, tables.get('hhea'))
        if (table.byteLength !== hmtx.origLength) throw new Woff2Error('the WOFF2 hmtx table length does not match its glyphs.')
        tables.set('hmtx', table)
      }
    }
    else if (byTag.get('hmtx')?.transformLength !== undefined) {
      throw new Woff2Error('the WOFF2 hmtx table is transformed without a transformed glyf table.')
    }
    return writeSfnt(flavor, tables, limit)
  }
  catch (error) {
    if (error instanceof Woff2Error) throw invalidFont(label, error.message)
    throw error
  }
}

/**
 * The guard in front of fontkit: only sfnt bytes (TrueType or OpenType) may
 * reach it. A WOFF or WOFF2 file here is a bug in the font path.
 */
export const assertSfnt = (bytes: Uint8Array, label: string): void => {
  const signature = bytes.byteLength >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) : 0
  if (signature === FLAVOR_TRUETYPE || signature === FLAVOR_OPENTYPE) return
  const kind = signature === SIGNATURE_WOFF2 ? 'WOFF2' : signature === SIGNATURE_WOFF ? 'WOFF' : 'non-sfnt'
  throw invalidFont(label, `the font engine must receive TTF or OTF bytes, not ${kind} bytes.`)
}
