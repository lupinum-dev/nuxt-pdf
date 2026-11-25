import { Buffer } from 'node:buffer'
import { deflateSync, inflateSync } from 'node:zlib'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../shared/errors'

// One image module for the layout (size) and the writer (embedding)
// (D37). A JPEG goes into
// the PDF as it is; a PNG's image data too, with its predictor, unless it has
// an alpha channel, palette transparency or interlacing: only then is it
// inflated, unfiltered and split into colour and alpha. Each file is read
// once; nothing here keeps state between calls.

export type ImageFormat = 'jpeg' | 'png'

export interface ImageHeader {
  readonly format: ImageFormat
  /** As stored; an `orientation` above 4 turns the image, so width and height swap on the page. */
  readonly width: number
  readonly height: number
  /** The EXIF orientation of a JPEG (1 to 8); always 1 for a PNG. */
  readonly orientation: number
}

type ImageColorSpace = 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK'

/** What the writer puts into the image XObject. */
export interface PdfImage extends ImageHeader {
  /** A palette image names its RGB palette (3 bytes per entry). */
  readonly colorSpace: ImageColorSpace | { readonly palette: Uint8Array }
  readonly bitsPerComponent: number
  readonly filter: 'DCTDecode' | 'FlateDecode'
  /** PNG predictors over the stored rows. */
  readonly decodeParms?: { readonly Predictor: 15, readonly Colors: number, readonly BitsPerComponent: number, readonly Columns: number }
  /** CMYK JPEGs (Adobe) store inverted values. */
  readonly decode?: readonly number[]
  /** Colour key masking (ISO 32000-1, 8.9.6.4): a PNG's single transparent grey or RGB value. */
  readonly mask?: readonly number[]
  /** Compressed with `filter`. */
  readonly data: Uint8Array
  /** 8-bit alpha, Flate-compressed, for the `SMask`. */
  readonly alpha?: Uint8Array
}

const invalid = (message: string): NuxtPdfError =>
  new NuxtPdfError(PDF_ERROR_CODES.AssetInvalid, `<PdfImage> holds bytes that do not decode as an image: ${message}`)

const uint16 = (bytes: Uint8Array, at: number): number => (bytes[at]! << 8) | bytes[at + 1]!
const uint32 = (bytes: Uint8Array, at: number): number => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!

// JPEG

const JPEG_COLOR_SPACES: Readonly<Record<number, ImageColorSpace>> = { 1: 'DeviceGray', 3: 'DeviceRGB', 4: 'DeviceCMYK' }

/** Every SOF marker: C0 to CF without DHT (C4), JPG (C8) and DAC (CC). */
const isStartOfFrame = (marker: number): boolean => marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC

/** The orientation tag (0x0112) of the first IFD of an EXIF block, or 1. */
const exifOrientation = (bytes: Uint8Array, start: number, end: number): number => {
  // "Exif\0\0", then a TIFF header: byte order, 42, offset of the first IFD.
  if (end - start < 14 || String.fromCharCode(...bytes.subarray(start, start + 4)) !== 'Exif') return 1
  const tiff = start + 6
  const little = bytes[tiff] === 0x49
  const read16 = (at: number): number => little ? bytes[at]! | (bytes[at + 1]! << 8) : uint16(bytes, at)
  const read32 = (at: number): number => little ? read16(at) + read16(at + 2) * 0x10000 : uint32(bytes, at)
  const ifd = tiff + read32(tiff + 4)
  if (ifd + 2 > end) return 1
  const count = read16(ifd)
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return 1
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

interface JpegHeader extends ImageHeader {
  readonly bits: number
  readonly components: number
}

const readJpeg = (bytes: Uint8Array): JpegHeader => {
  // The whole file goes into the PDF, so it must end at its EOI marker.
  if (bytes[bytes.length - 2] !== 0xFF || bytes[bytes.length - 1] !== 0xD9) throw invalid('the JPEG does not end with an EOI marker.')
  let frame: { bits: number, height: number, width: number, components: number } | undefined
  let orientation = 1
  let scan = false
  let offset = 2
  // The markers before the first scan: one frame header, as a decoder reads them.
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xFF) throw invalid('a JPEG marker is missing.')
    const marker = bytes[offset + 1]!
    if (marker === 0xFF) {
      offset += 1
      continue
    }
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
      offset += 2
      continue
    }
    if (marker === 0xDA) {
      scan = true
      break
    }
    if (marker === 0xD9) break
    const length = uint16(bytes, offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > bytes.length) throw invalid('a JPEG segment runs past the end of the file.')
    if (isStartOfFrame(marker)) {
      if (frame !== undefined) throw invalid('the JPEG has two frame headers.')
      if (length < 8) throw invalid('the JPEG frame header is too short.')
      frame = { bits: bytes[offset + 4]!, height: uint16(bytes, offset + 5), width: uint16(bytes, offset + 7), components: bytes[offset + 9]! }
    }
    else if (marker === 0xE1) {
      orientation = exifOrientation(bytes, offset + 4, end)
    }
    offset = end
  }
  if (frame === undefined) throw invalid('the JPEG has no frame header.')
  if (!scan) throw invalid('the JPEG has no scan.')
  if (frame.width < 1 || frame.height < 1) throw invalid('the JPEG has no pixels.')
  if (JPEG_COLOR_SPACES[frame.components] === undefined) throw invalid(`a JPEG with ${frame.components} components has no PDF colour space.`)
  return { format: 'jpeg', width: frame.width, height: frame.height, orientation, bits: frame.bits, components: frame.components }
}

const jpegImage = (bytes: Uint8Array): PdfImage => {
  const { bits, components, ...header } = readJpeg(bytes)
  const colorSpace = JPEG_COLOR_SPACES[components]!
  return {
    ...header,
    colorSpace,
    bitsPerComponent: bits,
    filter: 'DCTDecode',
    // Adobe writes CMYK inverted; swapping each range inverts it back (ISO 32000-1, 8.9.5.2).
    decode: colorSpace === 'DeviceCMYK' ? [1, 0, 1, 0, 1, 0, 1, 0] : undefined,
    data: bytes,
  }
}

// PNG

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
/** Colour channels per colour type, without alpha. */
const PNG_COLORS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 1, 6: 3 }
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

interface Png {
  readonly width: number
  readonly height: number
  readonly bits: number
  readonly colorType: number
  readonly interlaced: boolean
  readonly palette?: Uint8Array
  /** tRNS: an alpha per palette entry, or the one transparent grey or RGB sample. */
  readonly transparency?: Uint8Array
  readonly data: Uint8Array
}

const isPng = (bytes: Uint8Array): boolean => PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)

const readPng = (bytes: Uint8Array): Png => {
  let header: Omit<Png, 'data' | 'palette' | 'transparency'> | undefined
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const data: Uint8Array[] = []
  let offset = 8
  for (;;) {
    if (offset + 12 > bytes.length) throw invalid('the PNG ends before its IEND chunk.')
    const length = uint32(bytes, offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) throw invalid(`the PNG chunk ${type} runs past the end of the file.`)
    if (header === undefined && type !== 'IHDR') throw invalid('the PNG does not start with IHDR.')
    if (type === 'IHDR') {
      if (header !== undefined || length !== 13) throw invalid('the PNG has a broken IHDR chunk.')
      const colorType = bytes[start + 9]!
      const bits = bytes[start + 8]!
      header = { width: uint32(bytes, start), height: uint32(bytes, start + 4), bits, colorType, interlaced: bytes[start + 12] === 1 }
      if (!PNG_DEPTHS[colorType]?.includes(bits) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12]! > 1) {
        throw invalid(`a PNG of colour type ${colorType} at ${bits} bits is not valid.`)
      }
      if (header.width < 1 || header.height < 1) throw invalid('the PNG has no pixels.')
    }
    else if (type === 'PLTE') palette = bytes.subarray(start, end)
    else if (type === 'tRNS') transparency = bytes.subarray(start, end)
    else if (type === 'IDAT') data.push(bytes.subarray(start, end))
    else if (type === 'IEND') {
      if (length !== 0 || end + 4 !== bytes.length) throw invalid('the PNG does not end with its IEND chunk.')
      break
    }
    offset = end + 4
  }
  if (header === undefined || data.length === 0) throw invalid('the PNG has no image data.')
  if (header.colorType === 3 && (palette === undefined || palette.length % 3 !== 0)) throw invalid('the palette PNG has no valid palette.')
  return {
    ...header,
    palette: header.colorType === 3 ? palette : undefined,
    transparency: header.colorType === 4 || header.colorType === 6 ? undefined : transparency,
    data: data.length === 1 ? data[0]! : Buffer.concat(data),
  }
}

/** Adam7: the first pixel and the step of each pass, as x0, y0, dx, dy. */
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const

/**
 * Every sample of the image, row by row, `channels` per pixel (alpha last),
 * at its stored depth: inflated, unfiltered (ISO 15948, 9) and, for an
 * interlaced image, put back in place.
 */
const decodeSamples = (png: Png, channels: number): Uint16Array => {
  const { width, height, bits } = png
  let raw: Uint8Array
  try {
    raw = inflateSync(png.data)
  }
  catch (error) {
    throw new NuxtPdfError(PDF_ERROR_CODES.AssetInvalid, '<PdfImage> holds bytes that do not decode as an image: the PNG image data does not inflate.', { cause: error })
  }
  const samples = new Uint16Array(width * height * channels)
  const pixelBits = bits * channels
  const step = Math.max(1, pixelBits >> 3)
  let position = 0
  for (const [x0, y0, dx, dy] of png.interlaced ? ADAM7 : [[0, 0, 1, 1] as const]) {
    const columns = Math.ceil((width - x0) / dx)
    const rows = Math.ceil((height - y0) / dy)
    if (columns <= 0 || rows <= 0) continue
    const rowBytes = Math.ceil(columns * pixelBits / 8)
    let previous = new Uint8Array(rowBytes)
    for (let row = 0; row < rows; row += 1) {
      if (position + 1 + rowBytes > raw.length) throw invalid('the PNG image data is too short.')
      const filter = raw[position]!
      const line = raw.slice(position + 1, position + 1 + rowBytes)
      position += 1 + rowBytes
      for (let index = 0; index < rowBytes; index += 1) {
        const left = index >= step ? line[index - step]! : 0
        const up = previous[index]!
        const upLeft = index >= step ? previous[index - step]! : 0
        let predicted: number
        if (filter === 0) predicted = 0
        else if (filter === 1) predicted = left
        else if (filter === 2) predicted = up
        else if (filter === 3) predicted = (left + up) >> 1
        else if (filter === 4) {
          const estimate = left + up - upLeft
          const toLeft = Math.abs(estimate - left)
          const toUp = Math.abs(estimate - up)
          const toUpLeft = Math.abs(estimate - upLeft)
          predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
        }
        else throw invalid(`the PNG uses the unknown filter ${filter}.`)
        line[index] = (line[index]! + predicted) & 0xFF
      }
      previous = line
      const y = y0 + row * dy
      for (let column = 0; column < columns; column += 1) {
        const target = (y * width + x0 + column * dx) * channels
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = column * channels + channel
          if (bits === 16) samples[target + channel] = uint16(line, sample * 2)
          else if (bits === 8) samples[target + channel] = line[sample]!
          else {
            const bit = sample * bits
            samples[target + channel] = (line[bit >> 3]! >> (8 - bits - (bit & 7))) & ((1 << bits) - 1)
          }
        }
      }
    }
  }
  return samples
}

/** Rows of `count` samples per pixel from `first` on, at `bits` (16 bits keep their high byte at 8), Flate-compressed. */
const pack = (samples: Uint16Array, png: Png, channels: number, first: number, count: number, bits: number): Uint8Array => {
  const { width, height } = png
  const shift = png.bits === 16 && bits === 8 ? 8 : 0
  const rowBytes = Math.ceil(width * count * bits / 8)
  const out = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < count; channel += 1) {
        const value = samples[(y * width + x) * channels + first + channel]! >> shift
        const sample = x * count + channel
        if (bits === 16) {
          out[y * rowBytes + sample * 2] = value >> 8
          out[y * rowBytes + sample * 2 + 1] = value & 0xFF
        }
        else if (bits === 8) out[y * rowBytes + sample] = value
        else {
          const bit = sample * bits
          const at = y * rowBytes + (bit >> 3)
          out[at] = out[at]! | (value << (8 - bits - (bit & 7)))
        }
      }
    }
  }
  return deflateSync(out)
}

const pngImage = (bytes: Uint8Array): PdfImage => {
  const png = readPng(bytes)
  const { width, height, bits, colorType, palette, transparency } = png
  const colors = PNG_COLORS[colorType]!
  const hasAlpha = colorType === 4 || colorType === 6
  const header: ImageHeader = { format: 'png', width, height, orientation: 1 }
  const colorSpace = palette !== undefined ? { palette } : colors === 1 ? 'DeviceGray' as const : 'DeviceRGB' as const
  // A grey or RGB tRNS holds one 16-bit sample per channel.
  const mask = transparency !== undefined && palette === undefined
    ? Array.from({ length: colors }, (_, channel) => uint16(transparency, channel * 2)).flatMap(value => [value, value])
    : undefined
  if (hasAlpha) {
    const channels = colors + 1
    const samples = decodeSamples(png, channels)
    return { ...header, colorSpace, bitsPerComponent: 8, filter: 'FlateDecode', data: pack(samples, png, channels, 0, colors, 8), alpha: pack(samples, png, channels, colors, 1, 8) }
  }
  if (palette !== undefined && transparency !== undefined) {
    // An alpha per palette entry; entries past the end of tRNS are opaque.
    const samples = decodeSamples(png, 1)
    const alpha = new Uint8Array(width * height)
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = transparency[samples[index]!] ?? 255
    const data = png.interlaced ? pack(samples, png, 1, 0, 1, bits) : png.data
    const decodeParms = png.interlaced ? undefined : { Predictor: 15 as const, Colors: 1, BitsPerComponent: bits, Columns: width }
    return { ...header, colorSpace, bitsPerComponent: bits, filter: 'FlateDecode', decodeParms, data, alpha: deflateSync(alpha) }
  }
  if (png.interlaced) {
    return { ...header, colorSpace, bitsPerComponent: bits, filter: 'FlateDecode', mask, data: pack(decodeSamples(png, colors), png, colors, 0, colors, bits) }
  }
  return {
    ...header,
    colorSpace,
    bitsPerComponent: bits,
    filter: 'FlateDecode',
    decodeParms: { Predictor: 15, Colors: colors, BitsPerComponent: bits, Columns: width },
    mask,
    data: png.data,
  }
}

const formatOf = (bytes: Uint8Array): ImageFormat => {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'jpeg'
  if (isPng(bytes)) return 'png'
  throw invalid('only PNG and JPEG are supported.')
}

/** The format, size and orientation, from the header alone. */
export const readImageHeader = (bytes: Uint8Array): ImageHeader => {
  if (formatOf(bytes) === 'jpeg') {
    const { format, width, height, orientation } = readJpeg(bytes)
    return { format, width, height, orientation }
  }
  const { width, height } = readPng(bytes)
  return { format: 'png', width, height, orientation: 1 }
}

/** The image as the writer embeds it. */
export const pdfImage = (bytes: Uint8Array): PdfImage => formatOf(bytes) === 'jpeg' ? jpegImage(bytes) : pngImage(bytes)
