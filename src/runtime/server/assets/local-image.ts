import { Buffer } from 'node:buffer'
import { readFile, realpath, stat } from 'node:fs/promises'
import {
  extname,
  isAbsolute,
  resolve,
} from 'node:path'
import { NuxtPdfError } from '../../shared/errors'
import { forwardSlashes, isStrictlyInside } from '../../shared/paths'
import { readImageHeader, type ImageHeader } from '../engine/image'
import { PdfAssetError, blocked, imageLimitExceeded, invalid, limitExceeded } from './errors'
import { DEFAULT_PDF_RENDER_LIMITS } from '../render-limits'

// One local image: its asset key, roots and containment, size and read, and
// the byte validation every image source shares. The build calls
// `loadPdfImageAsset` (src/build/registry-inputs.ts); in development a render
// calls it for each disk entry (resolve-images.ts).

type PdfImageFormat = 'jpg' | 'png'

/**
 * One discovered local image. In development the entry points at the source
 * file on disk so edits show up without a restart; in production the validated
 * bytes travel as base64 inside the server bundle so every Nitro preset stays
 * self-contained. Both forms resolve through the same validation boundary.
 */
type PdfImageAssetEntry = Readonly<
  | { format: PdfImageFormat, root: string }
  | { dataB64: string, format: PdfImageFormat }
>

export type PdfImageAssetMap = Readonly<Record<string, PdfImageAssetEntry>>

type LoadedPdfImageAsset = Readonly<{ key: string }> & ResolvedPdfImageAsset

interface LoadPdfImageAssetOptions {
  roots: readonly string[]
  maxBytes?: number
  maxPixels?: number
}

export type ResolvedPdfImageAsset = Readonly<{
  data: Buffer
  format: PdfImageFormat
  height: number
  pixels: number
  width: number
}>

const resolveMaxBytes = (value: number | undefined): number => {
  const maxBytes = value ?? DEFAULT_PDF_RENDER_LIMITS.maxTotalImageBytes

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    invalid('The PDF image byte limit must be a positive safe integer.')
  }

  return maxBytes
}

export const canonicalAssetKey = (source: string): string => {
  if (!source || source.includes('\0')) {
    invalid('The PDF image path is invalid.')
  }

  const slashPath = forwardSlashes(source)
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(slashPath)
  const isWindowsAbsolute = /^[a-z]:\//i.test(slashPath)

  if (
    hasScheme
    || isAbsolute(source)
    || isWindowsAbsolute
    || slashPath.startsWith('/')
  ) {
    blocked('PDF images must use a relative local asset path.')
  }

  const segments = slashPath.split('/')

  if (segments.includes('..')) {
    blocked('Parent-directory traversal is blocked for PDF images.')
  }

  const key = segments
    .filter(segment => segment && segment !== '.')
    .join('/')

  if (!key) {
    invalid('The PDF image path is invalid.')
  }

  return key
}

/** The format a file extension or a `format` value names, in any case. */
const formatFromName = (name: string): PdfImageFormat | undefined => {
  const normalized = name.toLowerCase()
  if (normalized === 'png') return 'png'
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg'
  return undefined
}

export const formatFromExtension = (key: string): PdfImageFormat =>
  formatFromName(extname(key).slice(1)) ?? invalid('PDF images must be PNG or JPEG files.')

/** Format for a discovered asset key, validated at module setup time. */
export const pdfImageFormatFromKey = (key: string): PdfImageFormat => {
  const format = formatFromName(extname(key).slice(1))
  if (format === undefined) throw new TypeError(`PDF images must be PNG or JPEG files: "${key}".`)
  return format
}

export const claimedFormat = (value: unknown): PdfImageFormat | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    return invalid('The PDF image format is invalid.')
  }
  return formatFromName(value) ?? invalid('PDF images must use the PNG or JPEG format.')
}

/**
 * The one copy of image bytes from the author's tree: the render owns it, so
 * a later change to the author's buffer cannot reach the PDF, and the worker
 * can take its memory.
 */
export const asBuffer = (value: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  return undefined
}

/**
 * Check image bytes the render already owns (a file read, a fetch, a decoded
 * entry or `asBuffer`'s copy) and keep them without another copy.
 */
export const validateImageBytes = (
  data: Buffer,
  maxBytes: number,
  expectedFormat?: PdfImageFormat,
  maxPixels = DEFAULT_PDF_RENDER_LIMITS.maxTotalImagePixels,
): ResolvedPdfImageAsset => {
  if (data.byteLength > maxBytes) return limitExceeded(maxBytes)

  const mismatch = 'The PDF image structure, file extension, and declared format must agree.'
  let header: ImageHeader
  try {
    header = readImageHeader(data)
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return invalid(mismatch, error)
    throw error
  }
  const { height, width } = header
  const format: PdfImageFormat = header.format === 'jpeg' ? 'jpg' : 'png'
  if (expectedFormat && format !== expectedFormat) return invalid(mismatch)

  const pixels = width * height
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    return imageLimitExceeded(
      `The PDF image has ${pixels} decoded pixels, exceeding pdf.limits.maxTotalImagePixels (${maxPixels}).`,
    )
  }

  return Object.freeze({ data, format, height, width, pixels })
}

const canonicalRoots = async (roots: readonly string[]): Promise<string[]> => {
  if (!Array.isArray(roots) || roots.length === 0) {
    return blocked('At least one local PDF asset root must be configured.')
  }

  const result: string[] = []

  for (const root of roots) {
    if (typeof root !== 'string' || !isAbsolute(root)) {
      return invalid('Configured PDF asset roots must be absolute paths.')
    }

    try {
      const canonicalRoot = await realpath(root)
      const rootStat = await stat(canonicalRoot)

      if (!rootStat.isDirectory()) {
        return invalid('A configured PDF asset root is not a directory.')
      }

      if (!result.includes(canonicalRoot)) result.push(canonicalRoot)
    }
    catch (error) {
      if (error instanceof PdfAssetError) throw error

      return invalid(
        'A configured PDF asset root cannot be read.',
        error,
      )
    }
  }

  return result
}

// Wider than the build's `isMissingFile`: a path through a regular file
// (ENOTDIR) is a missing asset too.
const isMissingFileError = (error: unknown): boolean => {
  if (!(error instanceof Error) || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

/**
 * Loads and validates one local image while the Nuxt module still has access to
 * source files. Generated server code should store the returned bytes under
 * `key`; rendering must not retain the absolute source path.
 */
export const loadPdfImageAsset = async (
  relativePath: string,
  options: LoadPdfImageAssetOptions,
): Promise<LoadedPdfImageAsset> => {
  const key = canonicalAssetKey(relativePath)
  const expectedFormat = formatFromExtension(key)
  const maxBytes = resolveMaxBytes(options.maxBytes)
  const maxPixels = options.maxPixels ?? DEFAULT_PDF_RENDER_LIMITS.maxTotalImagePixels
  const roots = await canonicalRoots(options.roots)

  for (const root of roots) {
    let candidate: string

    try {
      candidate = await realpath(resolve(root, ...key.split('/')))
    }
    catch (error) {
      if (isMissingFileError(error)) continue

      return invalid('The local PDF image cannot be resolved.', error)
    }

    if (!isStrictlyInside(root, candidate)) {
      return blocked(
        'The local PDF image resolves outside its configured asset root.',
      )
    }

    let fileStat

    try {
      fileStat = await stat(candidate)
    }
    catch (error) {
      return invalid('The local PDF image cannot be inspected.', error)
    }

    if (!fileStat.isFile()) {
      return invalid('The local PDF image is not a regular file.')
    }

    if (fileStat.size > maxBytes) return limitExceeded(maxBytes)

    try {
      const image = validateImageBytes(
        await readFile(candidate),
        maxBytes,
        expectedFormat,
        maxPixels,
      )

      return Object.freeze({ key, ...image })
    }
    catch (error) {
      if (error instanceof PdfAssetError) throw error

      return invalid('The local PDF image cannot be read.', error)
    }
  }

  return invalid(
    'The local PDF image was not found in a configured asset root.',
  )
}
