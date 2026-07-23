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
  createRemoteRequestState,
  fetchRemoteResource,
  matchesAllowlist,
  redactUrl,
  type RemoteAssetPolicy,
  type RemoteRequestState,
} from './remote'
import {
  DEFAULT_PDF_MAX_IMAGE_BYTES,
  DEFAULT_PDF_MAX_IMAGE_PIXELS,
  DEFAULT_PDF_RENDER_LIMITS,
  createRenderLimits,
  type RenderLimits,
} from '../engine/limits'

export {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
  type PdfAssetErrorCode,
} from './errors'

export const DEFAULT_MAX_PDF_IMAGE_BYTES = DEFAULT_PDF_MAX_IMAGE_BYTES

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
  maxPixels?: number
}

export interface ResolvePdfImageAssetsOptions {
  assets: PdfImageAssetMap
  limits?: RenderLimits
  remote?: RemoteAssetPolicy
  /**
   * Mutable accounting shared by every image-admission pass in one render.
   * Multi-pass documents re-render their Vue tree between layout passes; this
   * state keeps deduplication and byte/request budgets render-wide.
   */
  state?: PdfImageResolutionState
}

type ResolvedPdfImageAsset = Readonly<{
  data: Buffer
  format: PdfImageFormat
  height: number
  pixels: number
  width: number
}>

type ImageBudgetState = {
  bytes: number
  pixels: number
}

type ImageResolutionCache = Map<unknown, Promise<Buffer>>

export interface PdfImageResolutionState {
  readonly budget: ImageBudgetState
  readonly inflight: Map<string, Promise<Buffer>>
  readonly remote: RemoteRequestState
  readonly resolved: ImageResolutionCache
}

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

const imageLimitExceeded = (message: string): never =>
  fail(PDF_ASSET_ERROR_CODES.LimitExceeded, message)

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

const PNG_SIGNATURE = Buffer.from([
  0x89,
  0x50,
  0x4E,
  0x47,
  0x0D,
  0x0A,
  0x1A,
  0x0A,
])

const inspectPng = (data: Buffer): { height: number, width: number } | undefined => {
  if (data.byteLength < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return undefined
  }

  let height = 0
  let offset = 8
  let sawHeader = false
  let sawImageData = false
  let width = 0

  while (offset + 12 <= data.byteLength) {
    const length = data.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > data.byteLength) return undefined
    const type = data.toString('ascii', offset + 4, offset + 8)

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) return undefined
      width = data.readUInt32BE(offset + 8)
      height = data.readUInt32BE(offset + 12)
      if (width < 1 || height < 1) return undefined
      const bitDepth = data[offset + 16]
      const colorType = data[offset + 17]
      const validDepths = colorType === 0
        ? [1, 2, 4, 8, 16]
        : colorType === 2
          ? [8, 16]
          : colorType === 3
            ? [1, 2, 4, 8]
            : colorType === 4 || colorType === 6
              ? [8, 16]
              : []
      if (
        bitDepth === undefined
        || !validDepths.includes(bitDepth)
        || data[offset + 18] !== 0
        || data[offset + 19] !== 0
        || (data[offset + 20] !== 0 && data[offset + 20] !== 1)
      ) return undefined
      sawHeader = true
    }
    else if (type === 'IHDR') return undefined

    if (type === 'IDAT') sawImageData = true

    offset = end
    if (type === 'IEND') {
      return length === 0 && sawImageData && offset === data.byteLength
        ? { height, width }
        : undefined
    }
  }

  return undefined
}

const hasJpegSignature = (data: Buffer): boolean => {
  if (
    data.byteLength < 4
    || data[0] !== 0xFF
    || data[1] !== 0xD8
    || data[2] !== 0xFF
  ) {
    return false
  }

  return data[data.byteLength - 2] === 0xFF
    && data[data.byteLength - 1] === 0xD9
}

const isJpegStartOfFrame = (marker: number): boolean =>
  marker >= 0xC0
  && marker <= 0xCF
  && ![0xC4, 0xC8, 0xCC].includes(marker)

const inspectJpeg = (data: Buffer): { height: number, width: number } | undefined => {
  if (!hasJpegSignature(data)) return undefined

  let dimensions: { height: number, width: number } | undefined
  let offset = 2
  while (offset + 2 < data.byteLength) {
    while (offset < data.byteLength && data[offset] === 0xFF) offset += 1
    const marker = data[offset]
    offset += 1
    if (marker === undefined || marker === 0xD9) break
    if (marker === 0xDA) return dimensions
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) continue
    if (offset + 2 > data.byteLength) return undefined

    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.byteLength) return undefined
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) return undefined
      const height = data.readUInt16BE(offset + 3)
      const width = data.readUInt16BE(offset + 5)
      if (width < 1 || height < 1) return undefined
      dimensions = { height, width }
    }
    offset += length
  }

  return undefined
}

const inspectImage = (
  data: Buffer,
): { format: PdfImageFormat, height: number, width: number } | undefined => {
  const png = inspectPng(data)
  if (png) return { ...png, format: 'png' }
  const jpeg = inspectJpeg(data)
  if (jpeg) return { ...jpeg, format: 'jpg' }
  return undefined
}

const validateImageBytes = (
  value: unknown,
  maxBytes: number,
  expectedFormat?: PdfImageFormat,
  maxPixels = DEFAULT_PDF_MAX_IMAGE_PIXELS,
): ResolvedPdfImageAsset => {
  const data = asBuffer(value)

  if (!data) {
    return invalid('The PDF image source does not contain bytes.')
  }

  if (data.byteLength > maxBytes) return limitExceeded(maxBytes)

  const inspected = inspectImage(data)

  if (!inspected || (expectedFormat && inspected.format !== expectedFormat)) {
    return invalid(
      'The PDF image structure, file extension, and declared format must agree.',
    )
  }

  const pixels = inspected.width * inspected.height
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    return imageLimitExceeded(
      `The PDF image has ${pixels} decoded pixels, exceeding pdf.limits.maxImagePixels (${maxPixels}).`,
    )
  }

  return Object.freeze({ data, ...inspected, pixels })
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
  const maxPixels = options.maxPixels ?? DEFAULT_PDF_MAX_IMAGE_PIXELS
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

const resolveLocalImage = (
  source: string,
  assets: PdfImageAssetMap,
  maxBytes: number,
  maxPixels: number,
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

  return validateImageBytes(asset.data, maxBytes, assetFormat, maxPixels)
}

const isRemoteCandidate = (source: string): boolean =>
  /^https?:/i.test(source)

// Deduplicate the source forms authors naturally repeat in one document without
// hashing image bytes. String sources share by value; byte-backed sources share
// only when the same object is reused. Keep the declared local-object format in
// the key so caching can never bypass its path/format agreement validation.
const imageResolutionCacheKey = (source: unknown): unknown => {
  if (typeof source === 'string') return `string\0${source}`
  if (!source || typeof source !== 'object') return source

  const record = source as Record<string, unknown>
  if (typeof record.uri === 'string') {
    return isRemoteCandidate(record.uri)
      ? `remote\0${record.uri}`
      : `local\0${record.uri}\0${String(record.format ?? '')}`
  }

  return source
}

const resolveRemoteImage = async (
  url: string,
  remote: RemoteAssetPolicy | undefined,
  remoteState: RemoteRequestState,
  inflight: Map<string, Promise<Buffer>> | undefined,
  maxBytes: number,
  maxPixels: number,
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
    maxBytes,
    state: remoteState,
    inflight,
  })

  return validateImageBytes(bytes, maxBytes, undefined, maxPixels)
}

const resolveImageSource = async (
  source: unknown,
  assets: PdfImageAssetMap,
  maxBytes: number,
  maxPixels: number,
  remote: RemoteAssetPolicy | undefined,
  remoteState: RemoteRequestState,
  inflight: Map<string, Promise<Buffer>> | undefined,
): Promise<ResolvedPdfImageAsset> => {
  if (typeof source === 'function') {
    return blocked('Dynamic PDF image source functions are blocked.')
  }

  if (typeof source === 'string') {
    return isRemoteCandidate(source)
      ? resolveRemoteImage(source, remote, remoteState, inflight, maxBytes, maxPixels)
      : resolveLocalImage(source, assets, maxBytes, maxPixels)
  }

  const bytes = asBuffer(source)
  if (bytes) return validateImageBytes(bytes, maxBytes, undefined, maxPixels)

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

      return resolveRemoteImage(
        record.uri,
        remote,
        remoteState,
        inflight,
        maxBytes,
        maxPixels,
      )
    }

    const allowedKeys = new Set(['format', 'uri'])
    if (Object.keys(record).some(key => !allowedKeys.has(key))) {
      return blocked('PDF image request options are blocked for local assets.')
    }

    return resolveLocalImage(
      record.uri,
      assets,
      maxBytes,
      maxPixels,
      record.format,
    )
  }

  if (hasOwn(record, 'data')) {
    const format = claimedFormat(record.format)

    if (!format) {
      return invalid('A byte-backed PDF image source must declare its format.')
    }

    return validateImageBytes(record.data, maxBytes, format, maxPixels)
  }

  return invalid(
    'The PDF image source must be bytes or a bundled local path.',
  )
}

const resolveImageBuffer = (
  source: unknown,
  assets: PdfImageAssetMap,
  limits: RenderLimits,
  remote: RemoteAssetPolicy | undefined,
  remoteState: RemoteRequestState,
  inflight: Map<string, Promise<Buffer>>,
  resolved: ImageResolutionCache,
  budget: ImageBudgetState,
): Promise<Buffer> => {
  const key = imageResolutionCacheKey(source)
  const existing = resolved.get(key)
  if (existing) return existing

  const promise = resolveImageSource(
    source,
    assets,
    limits.maxImageBytes,
    limits.maxImagePixels,
    remote,
    remoteState,
    inflight,
  ).then((image) => {
    budget.bytes += image.data.byteLength
    if (budget.bytes > limits.maxTotalImageBytes) {
      return imageLimitExceeded(
        `PDF image sources exceed pdf.limits.maxTotalImageBytes (${limits.maxTotalImageBytes}).`,
      )
    }

    budget.pixels += image.pixels
    if (budget.pixels > limits.maxTotalImagePixels) {
      return imageLimitExceeded(
        `PDF images exceed pdf.limits.maxTotalImagePixels (${limits.maxTotalImagePixels}).`,
      )
    }

    return image.data
  })
  resolved.set(key, promise)
  return promise
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

export const createPdfImageResolutionState = (
  limits: RenderLimits,
): PdfImageResolutionState => ({
  budget: { bytes: 0, pixels: 0 },
  inflight: new Map(),
  remote: createRemoteRequestState(limits),
  resolved: new Map(),
})

/**
 * Resolves every image on the canonical renderer tree before layout. The pass
 * is atomic: no image prop changes unless all image sources validate.
 */
export const resolvePdfImageAssets = async (
  document: PdfDocumentNode,
  options: ResolvePdfImageAssetsOptions,
): Promise<PdfDocumentNode> => {
  const limits = options.limits ?? createRenderLimits({
    ...DEFAULT_PDF_RENDER_LIMITS,
  })

  if (!options.assets || typeof options.assets !== 'object') {
    return invalid('A generated PDF image asset map is required.')
  }

  const state = options.state ?? createPdfImageResolutionState(limits)
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

  if (targets.length > limits.maxImages) {
    return imageLimitExceeded(
      `PDF mounted ${targets.length} images, exceeding pdf.limits.maxImages (${limits.maxImages}).`,
    )
  }

  let resolved: Buffer[]
  try {
    resolved = await Promise.all(targets.map(target =>
      resolveImageBuffer(
        target.node.props[target.prop],
        options.assets,
        limits,
        options.remote,
        state.remote,
        state.inflight,
        state.resolved,
        state.budget,
      ),
    ))
  }
  catch (error) {
    limits.abortController.abort(error)
    throw error
  }

  targets.forEach((target, index) => {
    const data = resolved[index]!
    target.node.props[target.prop] = data
    // Vue can leave this resolved Buffer on the host node when an authored
    // image prop is unchanged on the next feedback pass. Alias it to the
    // already-admitted result so render-wide budgets charge the image once.
    state.resolved.set(data, Promise.resolve(data))
  })

  return document
}
