import type { FontSubset } from './pdf/fonts'

// The subset of a variable font instance (one registered weight). fontkit
// 2.0.4 cannot subset an instance: its simple-glyph encoder calls
// `new EncodeStream(size)` with a number where restructure 3 wants a buffer,
// and a composite glyph keeps its unvaried component offsets. So the
// instance's glyphs are written here as simple glyphs from the outline
// fontkit varies: `_getContours` applies `gvar` to every point and resolves
// composites into their components, so no composite and no instruction is
// written. The other tables are copied as fontkit's TrueType subset copies
// them (`head`, `hhea`, `maxp` with their counts set; `cvt `, `prep`, `fpgm`
// as they are). A static font keeps fontkit's subset.

interface ContourPoint {
  readonly x: number
  readonly y: number
  readonly onCurve: boolean
}

/** What this module reads of a fontkit 2.0 instance (`TTFFont` from `getVariation`); fontkit ships no types. */
export interface InstanceSource {
  getGlyph(id: number): {
    _getContours(): ReadonlyArray<ReadonlyArray<ContourPoint>>
    /** The varied advance; read after the contours, which update it when the font has no HVAR. */
    readonly advanceWidth: number
  }
  readonly directory: { readonly tables: Readonly<Record<string, { readonly offset: number, readonly length: number }>> }
  readonly stream: { readonly buffer: Uint8Array }
}

const ON_CURVE = 0x01
const X_SHORT = 0x02
const Y_SHORT = 0x04
const X_SAME_OR_POSITIVE = 0x10
const Y_SAME_OR_POSITIVE = 0x20

interface EncodedGlyph {
  readonly bytes: Uint8Array
  readonly xMin: number
  readonly points: number
  readonly contours: number
}

const EMPTY: EncodedGlyph = { bytes: new Uint8Array(0), xMin: 0, points: 0, contours: 0 }

/** One coordinate's delta: the flag bits and the bytes it adds. */
const delta = (value: number, short: number, sameOrPositive: number, bytes: number[]): number => {
  if (value === 0) return sameOrPositive
  if (Math.abs(value) < 256) {
    bytes.push(Math.abs(value))
    return short | (value > 0 ? sameOrPositive : 0)
  }
  bytes.push((value >> 8) & 0xFF, value & 0xFF)
  return 0
}

/** A simple glyph (ISO/IEC 14496-22, `glyf`) from rounded contours, without instructions, padded to 4 bytes. */
const encodeGlyph = (contours: ReadonlyArray<ReadonlyArray<ContourPoint>>): EncodedGlyph => {
  const rounded = contours.filter(contour => contour.length > 0)
    .map(contour => contour.map(point => ({ x: Math.round(point.x), y: Math.round(point.y), onCurve: point.onCurve })))
  const points = rounded.flat()
  if (points.length === 0) return EMPTY
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const flags: number[] = []
  const xBytes: number[] = []
  const yBytes: number[] = []
  let [x, y] = [0, 0]
  for (const point of points) {
    flags.push((point.onCurve ? ON_CURVE : 0)
      | delta(point.x - x, X_SHORT, X_SAME_OR_POSITIVE, xBytes)
      | delta(point.y - y, Y_SHORT, Y_SAME_OR_POSITIVE, yBytes))
    ;[x, y] = [point.x, point.y]
  }
  const length = 10 + rounded.length * 2 + 2 + flags.length + xBytes.length + yBytes.length
  const bytes = new Uint8Array(Math.ceil(length / 4) * 4)
  const view = new DataView(bytes.buffer)
  const xMin = Math.min(...xs)
  view.setInt16(0, rounded.length)
  view.setInt16(2, xMin)
  view.setInt16(4, Math.min(...ys))
  view.setInt16(6, Math.max(...xs))
  view.setInt16(8, Math.max(...ys))
  let at = 10
  let end = -1
  for (const contour of rounded) {
    end += contour.length
    view.setUint16(at, end)
    at += 2
  }
  view.setUint16(at, 0) // no instructions
  bytes.set([...flags, ...xBytes, ...yBytes], at + 2)
  return { bytes, xMin, points: points.length, contours: rounded.length }
}

const tableBytes = (font: InstanceSource, tag: string): Uint8Array | undefined => {
  const entry = font.directory.tables[tag]
  // A copy: the buffer is a Node Buffer, whose `slice` is a view of the shared file.
  return entry === undefined ? undefined : Uint8Array.from(font.stream.buffer.subarray(entry.offset, entry.offset + entry.length))
}

const checksum = (bytes: Uint8Array): number => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  padded.set(bytes)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let at = 0; at < padded.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
  return sum
}

/** An sfnt file of these tables, records sorted by tag, `head.checkSumAdjustment` set. */
const sfnt = (tables: ReadonlyMap<string, Uint8Array>): Uint8Array => {
  const tags = [...tables.keys()].sort()
  const header = 12 + tags.length * 16
  const offsets: number[] = []
  let size = header
  for (const tag of tags) {
    offsets.push(size)
    size += Math.ceil(tables.get(tag)!.length / 4) * 4
  }
  const file = new Uint8Array(size)
  const view = new DataView(file.buffer)
  const power = 2 ** Math.floor(Math.log2(tags.length))
  view.setUint32(0, 0x00010000)
  view.setUint16(4, tags.length)
  view.setUint16(6, power * 16)
  view.setUint16(8, Math.log2(power))
  view.setUint16(10, tags.length * 16 - power * 16)
  tags.forEach((tag, index) => {
    const bytes = tables.get(tag)!
    const record = 12 + index * 16
    for (let char = 0; char < 4; char += 1) view.setUint8(record + char, tag.charCodeAt(char))
    view.setUint32(record + 4, checksum(bytes))
    view.setUint32(record + 8, offsets[index]!)
    view.setUint32(record + 12, bytes.length)
    file.set(bytes, offsets[index]!)
  })
  const head = offsets[tags.indexOf('head')]!
  view.setUint32(head + 8, (0xB1B0AFBA - checksum(file)) >>> 0)
  return file
}

const encodeInstance = (font: InstanceSource, glyphIds: readonly number[]): Uint8Array => {
  const glyphs = glyphIds.map((id) => {
    const glyph = font.getGlyph(id)
    const encoded = encodeGlyph(glyph._getContours())
    return { ...encoded, advance: Math.round(glyph.advanceWidth) }
  })
  const glyf = new Uint8Array(glyphs.reduce((sum, glyph) => sum + glyph.bytes.length, 0))
  const loca = new DataView(new ArrayBuffer((glyphs.length + 1) * 4))
  const hmtx = new DataView(new ArrayBuffer(glyphs.length * 4))
  let offset = 0
  glyphs.forEach((glyph, index) => {
    loca.setUint32(index * 4, offset)
    glyf.set(glyph.bytes, offset)
    offset += glyph.bytes.length
    hmtx.setUint16(index * 4, glyph.advance)
    hmtx.setInt16(index * 4 + 2, glyph.xMin)
  })
  loca.setUint32(glyphs.length * 4, offset)

  const head = tableBytes(font, 'head')!
  const hhea = tableBytes(font, 'hhea')!
  const maxp = tableBytes(font, 'maxp')!
  const headView = new DataView(head.buffer)
  headView.setUint32(8, 0) // checkSumAdjustment, set over the whole file
  headView.setInt16(50, 1) // indexToLocFormat: long offsets
  new DataView(hhea.buffer).setUint16(34, glyphs.length) // numberOfHMetrics
  const maxpView = new DataView(maxp.buffer)
  maxpView.setUint16(4, glyphs.length)
  if (maxpView.getUint32(0) === 0x00010000) {
    // Resolved composites have more points and contours than the font's simple glyphs.
    maxpView.setUint16(6, Math.max(maxpView.getUint16(6), ...glyphs.map(glyph => glyph.points)))
    maxpView.setUint16(8, Math.max(maxpView.getUint16(8), ...glyphs.map(glyph => glyph.contours)))
  }
  const tables = new Map<string, Uint8Array>([
    ['head', head],
    ['hhea', hhea],
    ['maxp', maxp],
    ['loca', new Uint8Array(loca.buffer)],
    ['glyf', glyf],
    ['hmtx', new Uint8Array(hmtx.buffer)],
  ])
  for (const tag of ['cvt ', 'prep', 'fpgm']) {
    const bytes = tableBytes(font, tag)
    if (bytes !== undefined) tables.set(tag, bytes)
  }
  return sfnt(tables)
}

/** A subset of an instance: glyph ids renumbered in the order they are included, `.notdef` first. */
export const createInstanceSubset = (font: InstanceSource): FontSubset => {
  const glyphIds: number[] = []
  const mapping = new Map<number, number>()
  const includeGlyph = (id: number): number => {
    let index = mapping.get(id)
    if (index === undefined) {
      index = glyphIds.push(id) - 1
      mapping.set(id, index)
    }
    return index
  }
  includeGlyph(0)
  return { includeGlyph, encode: () => encodeInstance(font, glyphIds) }
}
