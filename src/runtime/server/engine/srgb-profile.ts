// The sRGB ICC profile of a PDF/A output intent, built in code from the
// public constants of IEC 61966-2-1, so there is no profile file to ship or
// license.

type Vector = readonly [number, number, number]
type Matrix = readonly [Vector, Vector, Vector]

const xyToXyz = (x: number, y: number): Vector => [x / y, 1, (1 - x - y) / y]

const multiply = (m: Matrix, v: Vector): Vector => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
]

const invert = (m: Matrix): Matrix => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

const columns = (a: Vector, b: Vector, c: Vector): Matrix => [
  [a[0], b[0], c[0]],
  [a[1], b[1], c[1]],
  [a[2], b[2], c[2]],
]

// sRGB primaries and white point (IEC 61966-2-1), the ICC PCS illuminant
// (D50, ICC.1) and the Bradford cone response matrix for the adaptation.
const SRGB_RED = xyToXyz(0.64, 0.33)
const SRGB_GREEN = xyToXyz(0.30, 0.60)
const SRGB_BLUE = xyToXyz(0.15, 0.06)
const D65 = xyToXyz(0.3127, 0.3290)
const D50: Vector = [0.9642, 1, 0.8249]
const BRADFORD: Matrix = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

/** The sRGB colorants (red, green, blue) adapted to D50, as an ICC profile states them. */
export const srgbColorantsD50 = (): Matrix => {
  const primaries = columns(SRGB_RED, SRGB_GREEN, SRGB_BLUE)
  const scale = multiply(invert(primaries), D65)
  const coneD65 = multiply(BRADFORD, D65)
  const coneD50 = multiply(BRADFORD, D50)
  const toD50 = (xyz: Vector): Vector => {
    const cone = multiply(BRADFORD, xyz)
    return multiply(invert(BRADFORD), [
      cone[0] * coneD50[0] / coneD65[0],
      cone[1] * coneD50[1] / coneD65[1],
      cone[2] * coneD50[2] / coneD65[2],
    ])
  }
  return [
    toD50([SRGB_RED[0] * scale[0], SRGB_RED[1] * scale[0], SRGB_RED[2] * scale[0]]),
    toD50([SRGB_GREEN[0] * scale[1], SRGB_GREEN[1] * scale[1], SRGB_GREEN[2] * scale[1]]),
    toD50([SRGB_BLUE[0] * scale[2], SRGB_BLUE[1] * scale[2], SRGB_BLUE[2] * scale[2]]),
  ]
}

/** The sRGB transfer function from encoded value to linear light (IEC 61966-2-1). */
const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const CURVE_POINTS = 1024
const ascii = (text: string): number[] => [...text].map(char => char.charCodeAt(0))

class IccWriter {
  readonly bytes: number[] = []
  u8(value: number) {
    this.bytes.push(value & 0xFF)
  }

  u16(value: number) {
    this.u8(value >>> 8)
    this.u8(value)
  }

  u32(value: number) {
    this.u16(value >>> 16)
    this.u16(value & 0xFFFF)
  }

  s15Fixed16(value: number) {
    this.u32(Math.round(value * 65536) >>> 0)
  }

  text(value: string) {
    for (const byte of ascii(value)) this.u8(byte)
  }

  pad() {
    while (this.bytes.length % 4 !== 0) this.u8(0)
  }
}

const xyzTag = (xyz: Vector): number[] => {
  const writer = new IccWriter()
  writer.text('XYZ ')
  writer.u32(0)
  for (const value of xyz) writer.s15Fixed16(value)
  return writer.bytes
}

const SRGB_DESCRIPTION = 'sRGB IEC61966-2.1'

/**
 * An ICC v2.1 display profile for sRGB: D50 colorants and white point, and
 * the sRGB transfer curve as a 1024-point table. Built in code, so there is
 * no profile file to ship or license.
 */
export const buildSrgbIccProfile = (): Uint8Array => {
  const description = new IccWriter()
  description.text('desc')
  description.u32(0)
  description.u32(SRGB_DESCRIPTION.length + 1)
  description.text(SRGB_DESCRIPTION)
  description.u8(0)
  description.u32(0) // Unicode language code
  description.u32(0) // Unicode count
  description.u16(0) // ScriptCode code
  description.u8(0) // ScriptCode count
  for (let index = 0; index < 67; index += 1) description.u8(0)

  const copyright = new IccWriter()
  copyright.text('text')
  copyright.u32(0)
  copyright.text('No copyright, use freely')
  copyright.u8(0)

  const curve = new IccWriter()
  curve.text('curv')
  curve.u32(0)
  curve.u32(CURVE_POINTS)
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    curve.u16(Math.round(srgbToLinear(index / (CURVE_POINTS - 1)) * 0xFFFF))
  }

  const [red, green, blue] = srgbColorantsD50()
  const tags: ReadonlyArray<readonly [string, number[]]> = [
    ['desc', description.bytes],
    ['cprt', copyright.bytes],
    ['wtpt', xyzTag(D50)],
    ['rXYZ', xyzTag(red)],
    ['gXYZ', xyzTag(green)],
    ['bXYZ', xyzTag(blue)],
    ['rTRC', curve.bytes],
    ['gTRC', curve.bytes],
    ['bTRC', curve.bytes],
  ]

  // Header (128 bytes), tag table, then the tag data; one copy of the curve
  // serves all three channels.
  const tableSize = 4 + tags.length * 12
  const data = new IccWriter()
  const offsets = new Map<number[], number>()
  const entries = tags.map(([signature, bytes]) => {
    let offset = offsets.get(bytes)
    if (offset === undefined) {
      data.pad()
      offset = 128 + tableSize + data.bytes.length
      offsets.set(bytes, offset)
      for (const byte of bytes) data.u8(byte)
    }
    return { signature, offset, size: bytes.length }
  })
  data.pad()

  const size = 128 + tableSize + data.bytes.length
  const profile = new IccWriter()
  profile.u32(size)
  profile.u32(0) // preferred CMM
  profile.u32(0x02100000) // version 2.1
  profile.text('mntr')
  profile.text('RGB ')
  profile.text('XYZ ')
  for (const part of [2026, 1, 1, 0, 0, 0]) profile.u16(part) // fixed date: same bytes every render
  profile.text('acsp')
  for (let index = 0; index < 6; index += 1) profile.u32(0) // platform, flags, device, attributes
  profile.u32(0) // rendering intent: perceptual
  for (const value of D50) profile.s15Fixed16(value)
  while (profile.bytes.length < 128) profile.u8(0)
  profile.u32(tags.length)
  for (const { signature, offset, size: tagSize } of entries) {
    profile.text(signature)
    profile.u32(offset)
    profile.u32(tagSize)
  }
  for (const byte of data.bytes) profile.u8(byte)
  return Uint8Array.from(profile.bytes)
}

let builtProfile: Uint8Array | undefined

/**
 * The sRGB output intent of our writer: the profile and its condition. The
 * profile is built once per process; each call gets its own copy (2.5 KB), so
 * no render can change the bytes another render writes. A typed array cannot
 * be frozen.
 */
export const srgbOutputIntent = (): { profile: Uint8Array, identifier: string } => {
  builtProfile ??= buildSrgbIccProfile()
  return { profile: builtProfile.slice(), identifier: SRGB_DESCRIPTION }
}
