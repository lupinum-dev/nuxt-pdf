import { Buffer } from 'node:buffer'
import type {
  PdfDocumentNode,
  PdfElementNode,
} from '../../renderer'
import { PDF_PRIMITIVES } from '../../primitives'
import { parsePdfSourcePosition, withPdfSource } from '../../shared/errors'
import type { PdfImageWarning } from '../../shared/template'
import {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
  blocked,
  imageLimitExceeded,
  invalid,
} from './errors'
import {
  asBuffer,
  canonicalAssetKey,
  claimedFormat,
  formatFromExtension,
  loadPdfImageAsset,
  validateImageBytes,
  type PdfImageAssetMap,
  type ResolvedPdfImageAsset,
} from './local-image'
import {
  createRemoteRequestState,
  fetchRemoteResource,
  matchesAllowlist,
  redactUrl,
  type RemoteAssetPolicy,
  type RemoteRequestState,
} from './remote'
import {
  DEFAULT_PDF_RENDER_LIMITS,
  createRenderLimits,
  type RenderLimits,
} from '../render-limits'

// The images of one render: source-shape dispatch, one promise per source,
// the render's byte and pixel budget, and the tree walk that writes the
// admitted bytes into every PdfImage (`resolvePdfImageAssets`).

interface ResolvePdfImageAssetsOptions {
  assets: PdfImageAssetMap
  limits?: RenderLimits
  remote?: RemoteAssetPolicy
}

type ImageBudgetState = {
  bytes: number
  pixels: number
}

type ImageResolutionCache = Map<unknown, Promise<Buffer>>

/** The image resolution of one render: what it reads and what it has spent. */
interface ImageRender {
  readonly assets: PdfImageAssetMap
  readonly limits: RenderLimits
  readonly remote: RemoteAssetPolicy | undefined
  readonly remoteState: RemoteRequestState
  /** One promise per source (`imageResolutionCacheKey`). */
  readonly resolved: ImageResolutionCache
  readonly budget: ImageBudgetState
}

type ImageTarget = {
  node: PdfElementNode
  parent: PdfElementNode
}

/** A refused rich text image source: the error a PdfImage with it fails with. */
type Refused = { readonly refused: PdfAssetError }

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

// Embedded production entries are immutable and shared by registry identity.
const embeddedImageCache = new WeakMap<object, Map<string, ResolvedPdfImageAsset>>()

const resolveLocalImage = async (
  source: string,
  { assets, limits }: ImageRender,
  declaredFormat?: unknown,
): Promise<ResolvedPdfImageAsset> => {
  const { maxTotalImageBytes: maxBytes, maxTotalImagePixels: maxPixels } = limits
  const key = canonicalAssetKey(source)
  const pathFormat = formatFromExtension(key)
  const sourceFormat = claimedFormat(declaredFormat)

  if (sourceFormat && sourceFormat !== pathFormat) {
    return invalid('The PDF image path and declared format must agree.')
  }

  if (!hasOwn(assets, key)) {
    return invalid(
      `The local PDF image "${key}" was not found under pdfs/assets. Add the file or fix the path.`,
    )
  }

  const entry = assets[key]!

  if (!entry || typeof entry !== 'object') {
    return invalid('The generated PDF image asset is invalid.')
  }

  const assetFormat = claimedFormat(entry.format)

  if (!assetFormat || assetFormat !== pathFormat) {
    return invalid(
      'The generated PDF image format does not match its asset key.',
    )
  }

  if ('dataB64' in entry) {
    // Embedded production bytes are immutable for the life of the process and
    // the generated registry freezes exactly one entry object per asset, so
    // identity is a safe outer cache key. Limits still participate: a hit
    // must never bypass the calling render's own budgets. Decoded results are
    // retained (bounded by the project's asset set) but every caller gets a
    // private copy.
    const limitsKey = `${maxBytes}\0${maxPixels}`
    let byLimits = embeddedImageCache.get(entry)
    if (!byLimits) {
      byLimits = new Map()
      embeddedImageCache.set(entry, byLimits)
    }

    const cached = byLimits.get(limitsKey)
    if (cached) return { ...cached, data: Buffer.from(cached.data) }

    const resolved = validateImageBytes(
      Buffer.from(entry.dataB64, 'base64'),
      maxBytes,
      assetFormat,
      maxPixels,
    )
    byLimits.set(limitsKey, resolved)
    return { ...resolved, data: Buffer.from(resolved.data) }
  }

  // Revalidate disk resources on every render. File metadata cannot prove
  // content identity or containment after a file or symlink changes. The
  // bytes are this render's own read, so they need no copy.
  const loaded = await loadPdfImageAsset(key, {
    roots: [entry.root],
    maxBytes,
    maxPixels,
  })

  return Object.freeze({
    data: loaded.data,
    format: assetFormat,
    height: loaded.height,
    pixels: loaded.pixels,
    width: loaded.width,
  }) satisfies ResolvedPdfImageAsset
}

const isRemoteCandidate = (source: string): boolean =>
  /^https?:/i.test(source)

// Deduplicate the source forms authors naturally repeat in one document without
// hashing image bytes. A remote URL has one key, as a string or as `{ uri }`,
// so it is fetched once. A local string path shares by value; `{ uri, format }`
// keeps the declared format in the key so caching can never bypass its
// path/format agreement check. Byte-backed sources share only when the same
// object is reused, and so does a record with keys the checks refuse: a cached
// result never stands in for a source that its own checks would reject.
const imageResolutionCacheKey = (source: unknown): unknown => {
  if (typeof source === 'string') return isRemoteCandidate(source) ? `remote\0${source}` : `string\0${source}`
  if (!source || typeof source !== 'object') return source

  const record = source as Record<string, unknown>
  if (typeof record.uri !== 'string') return source
  const keys = Object.keys(record)
  if (isRemoteCandidate(record.uri)) return keys.length === 1 ? `remote\0${record.uri}` : source
  return keys.every(key => key === 'uri' || key === 'format')
    ? `local\0${record.uri}\0${String(record.format ?? '')}`
    : source
}

const resolveRemoteImage = async (
  url: string,
  { remote, remoteState, limits }: ImageRender,
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
    maxBytes: limits.maxTotalImageBytes,
    state: remoteState,
  })

  return validateImageBytes(bytes, limits.maxTotalImageBytes, undefined, limits.maxTotalImagePixels)
}

const resolveImageSource = async (
  source: unknown,
  render: ImageRender,
): Promise<ResolvedPdfImageAsset> => {
  const { maxTotalImageBytes: maxBytes, maxTotalImagePixels: maxPixels } = render.limits
  if (typeof source === 'function') {
    return blocked('Dynamic PDF image source functions are blocked.')
  }

  if (typeof source === 'string') {
    return isRemoteCandidate(source)
      ? resolveRemoteImage(source, render)
      : resolveLocalImage(source, render)
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

      return resolveRemoteImage(record.uri, render)
    }

    const allowedKeys = new Set(['format', 'uri'])
    if (Object.keys(record).some(key => !allowedKeys.has(key))) {
      return blocked('PDF image request options are blocked for local assets.')
    }

    return resolveLocalImage(record.uri, render, record.format)
  }

  if (hasOwn(record, 'data')) {
    const format = claimedFormat(record.format)

    if (!format) {
      return invalid('A byte-backed PDF image source must declare its format.')
    }

    const data = asBuffer(record.data) ?? invalid('The PDF image source does not contain bytes.')
    return validateImageBytes(data, maxBytes, format, maxPixels)
  }

  return invalid(
    'The PDF image source must be bytes or a bundled local path.',
  )
}

const resolveImageBuffer = (source: unknown, render: ImageRender): Promise<Buffer> => {
  const { limits, resolved, budget } = render
  const key = imageResolutionCacheKey(source)
  const existing = resolved.get(key)
  if (existing) return existing

  const promise = resolveImageSource(source, render).then((image) => {
    // One image is checked against the whole budget while it loads; the sum
    // of all images of the render is checked here.
    budget.bytes += image.data.byteLength
    if (budget.bytes > limits.maxTotalImageBytes) {
      return imageLimitExceeded(
        `PDF images of this render exceed pdf.limits.maxTotalImageBytes (${limits.maxTotalImageBytes} bytes in total).`,
      )
    }

    budget.pixels += image.pixels
    if (budget.pixels > limits.maxTotalImagePixels) {
      return imageLimitExceeded(
        `PDF images of this render exceed pdf.limits.maxTotalImagePixels (${limits.maxTotalImagePixels} decoded pixels in total).`,
      )
    }

    return image.data
  })
  resolved.set(key, promise)
  return promise
}

const collectImageNodes = (document: PdfDocumentNode): ImageTarget[] => {
  const images: ImageTarget[] = []
  // Depth first, in tree order: children are pushed in reverse.
  const pending: Array<{ node: PdfElementNode, parent: PdfElementNode | undefined }> = [{ node: document, parent: undefined }]

  while (pending.length > 0) {
    const { node, parent } = pending.pop()!

    if (node.type === PDF_PRIMITIVES.Image && parent !== undefined) images.push({ node, parent })

    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]
      if (child && child.type !== PDF_PRIMITIVES.TextInstance) {
        pending.push({ node: child, parent: node })
      }
    }
  }

  return images
}

/**
 * The source errors a rich text image prints its placeholder for: the source
 * rules refused it (a blocked scheme, path or host, a failed request) or its
 * bytes are not an image. A limit (`PDF_LIMIT_EXCEEDED`) and an aborted render
 * still fail the render: they protect the server, whoever wrote the source.
 */
const isRefusedSource = (error: unknown): error is PdfAssetError =>
  error instanceof PdfAssetError
  && (error.code === PDF_ASSET_ERROR_CODES.Blocked || error.code === PDF_ASSET_ERROR_CODES.Invalid)

/**
 * Keep the image or the placeholder of a rich text image block. The rich text
 * renders the placeholder right after its image (`PdfRichText`); without a
 * placeholder (`brokenImages="error"`) there is nothing to remove.
 */
const settleRichImage = (target: ImageTarget, keep: 'image' | 'placeholder'): void => {
  const siblings = target.parent.children
  const at = siblings.indexOf(target.node)
  const next = siblings[at + 1]
  const hasPlaceholder = next !== undefined && next.type !== PDF_PRIMITIVES.TextInstance
    && next.richImage?.role === 'placeholder' && next.richImage.path === target.node.richImage?.path
  if (keep === 'image') {
    if (hasPlaceholder) siblings.splice(at + 1, 1)
    return
  }
  siblings.splice(at, 1)
}

/**
 * Resolves every image on the canonical renderer tree before layout. The pass
 * is atomic: no image prop changes unless all image sources validate. A rich
 * text image (`node.richImage`) whose source the rules refuse is the one
 * exception: with `brokenImages: 'placeholder'` it is removed and its
 * placeholder stays, and the returned warnings record it; with `'error'` the
 * error names its path in the rich text.
 */
export const resolvePdfImageAssets = async (
  document: PdfDocumentNode,
  options: ResolvePdfImageAssetsOptions,
): Promise<{ warnings: PdfImageWarning[] }> => {
  const limits = options.limits ?? createRenderLimits({
    ...DEFAULT_PDF_RENDER_LIMITS,
  })

  if (!options.assets || typeof options.assets !== 'object') {
    return invalid('A generated PDF image asset map is required.')
  }

  const render: ImageRender = {
    assets: options.assets,
    limits,
    remote: options.remote,
    remoteState: createRemoteRequestState(limits),
    resolved: new Map(),
    budget: { bytes: 0, pixels: 0 },
  }
  const targets: ImageTarget[] = []

  for (const target of collectImageNodes(document)) {
    const { node } = target
    if (hasOwn(node.props, 'srcSet') && node.props.srcSet !== undefined) {
      return blocked('PDF image srcSet sources are blocked.')
    }

    if (!hasOwn(node.props, 'src') || node.props.src === undefined) {
      return invalid('Each PDF image must have a src prop.')
    }

    targets.push(target)
  }

  let resolved: Array<Buffer | Refused>
  try {
    resolved = await Promise.all(targets.map((target) => {
      const loading = resolveImageBuffer(target.node.props.src, render)
      const mark = target.node.richImage
      if (mark?.role !== 'image') return loading
      return loading.catch((error: unknown): Refused => {
        if (!isRefusedSource(error)) throw error
        if (mark.brokenImages === 'placeholder') return { refused: error }
        throw withPdfSource(new PdfAssetError(
          error.code === PDF_ASSET_ERROR_CODES.Blocked ? PDF_ASSET_ERROR_CODES.Blocked : PDF_ASSET_ERROR_CODES.Invalid,
          `<PdfRichText> image ${mark.path}: ${error.message}`,
          { cause: error },
        ), target.node.source)
      })
    }))
  }
  catch (error) {
    limits.abortController.abort(error)
    throw error
  }

  // Rich text images that printed their placeholder, in tree order.
  const warnings: PdfImageWarning[] = []
  targets.forEach((target, index) => {
    const result = resolved[index]!
    if (!('refused' in result)) {
      target.node.props.src = result
      if (target.node.richImage?.role === 'image') settleRichImage(target, 'image')
      return
    }
    settleRichImage(target, 'placeholder')
    const source = target.node.source === undefined ? undefined : parsePdfSourcePosition(target.node.source)
    warnings.push(Object.freeze({
      code: 'PDF_RICH_TEXT_IMAGE_REPLACED',
      reason: result.refused.code === PDF_ASSET_ERROR_CODES.Blocked ? 'PDF_ASSET_BLOCKED' : 'PDF_ASSET_INVALID',
      path: target.node.richImage!.path,
      ...(source === undefined ? {} : { source }),
    }))
  })

  return { warnings }
}
