import { Buffer } from 'node:buffer'
import { readFile, realpath, stat } from 'node:fs/promises'
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  PDF_PRIMITIVES,
  type PdfDocumentNode,
  type PdfElementNode,
} from '../../renderer/types'
import {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
  type PdfAssetErrorCode,
} from './errors'
import {
  fetchRemoteResource,
  matchesAllowlist,
  redactUrl,
  type RemoteAssetPolicy,
} from './remote'

export {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
  type PdfAssetErrorCode,
} from './errors'

export const DEFAULT_MAX_PDF_IMAGE_BYTES = 10 * 1024 * 1024

export type PdfImageFormat = 'jpg' | 'png'

export type PdfImageAsset = Readonly<{
  data: Uint8Array
  format: PdfImageFormat
}>

export type LoadedPdfImageAsset = PdfImageAsset & Readonly<{
  key: string
}>

export type PdfImageAssetMap = Readonly<Record<string, PdfImageAsset>>

export interface LoadPdfImageAssetOptions {
  roots: readonly string[]
  maxBytes?: number
}

export interface ResolvePdfImageAssetsOptions {
  assets: PdfImageAssetMap
  maxBytes?: number
  remote?: RemoteAssetPolicy
}

type ResolvedPdfImageAsset = Readonly<{
  data: Buffer
  format: PdfImageFormat
}>

type ImageTarget = {
  node: PdfElementNode
  prop: 'source' | 'src'
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const fail = (
  code: PdfAssetErrorCode,
  message: string,
  cause?: unknown,
): never => {
  throw new PdfAssetError(code, message, { cause })
}

const blocked = (message: string): never =>
  fail(PDF_ASSET_ERROR_CODES.Blocked, message)

const invalid = (message: string, cause?: unknown): never =>
  fail(PDF_ASSET_ERROR_CODES.Invalid, message, cause)

const limitExceeded = (maxBytes: number): never =>
  fail(
    PDF_ASSET_ERROR_CODES.LimitExceeded,
    `The PDF image exceeds the ${maxBytes}-byte source limit.`,
  )

const resolveMaxBytes = (value: number | undefined): number => {
  const maxBytes = value ?? DEFAULT_MAX_PDF_IMAGE_BYTES

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    invalid('The PDF image byte limit must be a positive safe integer.')
  }

  return maxBytes
}

const canonicalAssetKey = (source: string): string => {
  if (!source || source.includes('\0')) {
    invalid('The PDF image path is invalid.')
  }

  const slashPath = source.replaceAll('\\', '/')
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

const formatFromExtension = (key: string): PdfImageFormat => {
  const extension = extname(key).toLowerCase()

  if (extension === '.png') return 'png'
  if (extension === '.jpg' || extension === '.jpeg') return 'jpg'

  return invalid('PDF images must be PNG or JPEG files.')
}

const claimedFormat = (value: unknown): PdfImageFormat | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    return invalid('The PDF image format is invalid.')
  }

  const normalized = value.toLowerCase()

  if (normalized === 'png') return 'png'
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg'

  return invalid('PDF images must use the PNG or JPEG format.')
}

const asBuffer = (value: unknown): Buffer | undefined => {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  return undefined
}

const hasPngSignature = (data: Buffer): boolean =>
  data.byteLength >= 24
  && data.subarray(0, 8).equals(Buffer.from([
    0x89,
    0x50,
    0x4E,
    0x47,
    0x0D,
    0x0A,
    0x1A,
    0x0A,
  ]))
  && data.readUInt32BE(8) === 13
  && data.subarray(12, 16).equals(Buffer.from('IHDR'))

const hasJpegSignature = (data: Buffer): boolean => {
  if (
    data.byteLength < 4
    || data[0] !== 0xFF
    || data[1] !== 0xD8
    || data[2] !== 0xFF
  ) {
    return false
  }

  for (let index = data.byteLength - 2; index >= 2; index -= 1) {
    if (data[index] === 0xFF && data[index + 1] === 0xD9) return true
  }

  return false
}

const detectedFormat = (data: Buffer): PdfImageFormat | undefined => {
  if (hasPngSignature(data)) return 'png'
  if (hasJpegSignature(data)) return 'jpg'
  return undefined
}

const validateImageBytes = (
  value: unknown,
  maxBytes: number,
  expectedFormat?: PdfImageFormat,
): ResolvedPdfImageAsset => {
  const data = asBuffer(value)

  if (!data) {
    return invalid('The PDF image source does not contain bytes.')
  }

  if (data.byteLength > maxBytes) return limitExceeded(maxBytes)

  const format = detectedFormat(data)

  if (!format || (expectedFormat && format !== expectedFormat)) {
    return invalid(
      'The PDF image file extension, declared format, and signature must agree.',
    )
  }

  return Object.freeze({ data, format })
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

const isInsideRoot = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate)

  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
}

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

    if (!isInsideRoot(root, candidate)) {
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

const resolveLocalImage = (
  source: string,
  assets: PdfImageAssetMap,
  maxBytes: number,
  declaredFormat?: unknown,
): ResolvedPdfImageAsset => {
  const key = canonicalAssetKey(source)
  const pathFormat = formatFromExtension(key)
  const sourceFormat = claimedFormat(declaredFormat)

  if (sourceFormat && sourceFormat !== pathFormat) {
    return invalid('The PDF image path and declared format must agree.')
  }

  if (!hasOwn(assets, key)) {
    return invalid(
      'The local PDF image was not included in the generated asset map.',
    )
  }

  const asset = assets[key]

  if (!asset || typeof asset !== 'object') {
    return invalid('The generated PDF image asset is invalid.')
  }

  const assetFormat = claimedFormat(asset.format)

  if (!assetFormat || assetFormat !== pathFormat) {
    return invalid(
      'The generated PDF image format does not match its asset key.',
    )
  }

  return validateImageBytes(asset.data, maxBytes, assetFormat)
}

const isRemoteCandidate = (source: string): boolean =>
  /^https?:/i.test(source)

const resolveRemoteImage = async (
  url: string,
  remote: RemoteAssetPolicy | undefined,
  inflight: Map<string, Promise<Buffer>> | undefined,
): Promise<ResolvedPdfImageAsset> => {
  if (!remote) {
    return blocked(
      `Remote PDF image fetching is disabled. Set pdf.remote.allow to fetch "${redactUrl(url)}".`,
    )
  }

  if (!matchesAllowlist(url, remote)) {
    return blocked(
      `The PDF image "${redactUrl(url)}" is not permitted by pdf.remote.allow.`,
    )
  }

  const bytes = await fetchRemoteResource(url, {
    policy: remote,
    maxBytes: remote.maxImageBytes,
    inflight,
  })

  return validateImageBytes(bytes, remote.maxImageBytes)
}

const resolveImageSource = async (
  source: unknown,
  assets: PdfImageAssetMap,
  maxBytes: number,
  remote: RemoteAssetPolicy | undefined,
  inflight: Map<string, Promise<Buffer>> | undefined,
): Promise<ResolvedPdfImageAsset> => {
  if (typeof source === 'function') {
    return blocked('Dynamic PDF image source functions are blocked.')
  }

  if (typeof source === 'string') {
    return isRemoteCandidate(source)
      ? resolveRemoteImage(source, remote, inflight)
      : resolveLocalImage(source, assets, maxBytes)
  }

  const bytes = asBuffer(source)
  if (bytes) return validateImageBytes(bytes, maxBytes)

  if (!source || typeof source !== 'object') {
    return invalid('The PDF image source is invalid.')
  }

  const record = source as Record<string, unknown>

  if (typeof record.then === 'function') {
    return blocked('Asynchronous PDF image sources are blocked.')
  }

  if (hasOwn(record, 'uri')) {
    if (typeof record.uri !== 'string') {
      return invalid('The PDF image URI is invalid.')
    }

    if (isRemoteCandidate(record.uri)) {
      if (Object.keys(record).some(key => key !== 'uri')) {
        return blocked('PDF image request options are blocked for remote assets.')
      }

      return resolveRemoteImage(record.uri, remote, inflight)
    }

    const allowedKeys = new Set(['format', 'uri'])
    if (Object.keys(record).some(key => !allowedKeys.has(key))) {
      return blocked('PDF image request options are blocked for local assets.')
    }

    return resolveLocalImage(
      record.uri,
      assets,
      maxBytes,
      record.format,
    )
  }

  if (hasOwn(record, 'data')) {
    const format = claimedFormat(record.format)

    if (!format) {
      return invalid('A byte-backed PDF image source must declare its format.')
    }

    return validateImageBytes(record.data, maxBytes, format)
  }

  return invalid(
    'The PDF image source must be bytes or a bundled local path.',
  )
}

const collectImageNodes = (document: PdfDocumentNode): PdfElementNode[] => {
  const images: PdfElementNode[] = []
  const pending: PdfElementNode[] = [document]

  while (pending.length > 0) {
    const node = pending.pop()!

    if (node.type === PDF_PRIMITIVES.Image) images.push(node)

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]
      if (child && child.type !== PDF_PRIMITIVES.TextInstance) {
        pending.push(child)
      }
    }
  }

  return images
}

/**
 * Resolves every image on the canonical renderer tree before layout. The pass
 * is atomic: no image prop changes unless all image sources validate.
 */
export const resolvePdfImageAssets = async (
  document: PdfDocumentNode,
  options: ResolvePdfImageAssetsOptions,
): Promise<PdfDocumentNode> => {
  const maxBytes = resolveMaxBytes(options.maxBytes)

  if (!options.assets || typeof options.assets !== 'object') {
    return invalid('A generated PDF image asset map is required.')
  }

  const inflight = new Map<string, Promise<Buffer>>()
  const targets: ImageTarget[] = []

  for (const node of collectImageNodes(document)) {
    if (hasOwn(node.props, 'srcSet') && node.props.srcSet !== undefined) {
      return blocked('PDF image srcSet sources are blocked.')
    }

    const hasSrc = hasOwn(node.props, 'src') && node.props.src !== undefined
    const hasSource = hasOwn(node.props, 'source')
      && node.props.source !== undefined

    if (hasSrc === hasSource) {
      return invalid('Each PDF image must have exactly one src or source prop.')
    }

    targets.push({ node, prop: hasSrc ? 'src' : 'source' })
  }

  const resolved = await Promise.all(targets.map(target =>
    resolveImageSource(
      target.node.props[target.prop],
      options.assets,
      maxBytes,
      options.remote,
      inflight,
    ),
  ))

  targets.forEach((target, index) => {
    target.node.props[target.prop] = resolved[index]!
  })

  return document
}
