import { Buffer } from 'node:buffer'
import {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
} from './errors'

/**
 * Operator-facing `pdf.remote` module option. Absent means the module keeps its
 * default fail-closed, zero-network behavior.
 */
export interface RemoteAssetOptions {
  /**
   * Allowlisted `https://` URL prefixes. Each entry names an explicit host (or a
   * single leading `*.` subdomain wildcard) plus a pathname prefix. A remote
   * image or font URL is only fetched when it matches one of these prefixes.
   */
  allow: readonly string[]
  maxImageBytes?: number
  maxFontBytes?: number
  timeoutMs?: number
}

/** One normalized allowlist entry. `host` is a `.suffix` when `wildcard`. */
export interface RemoteAssetRule {
  readonly wildcard: boolean
  readonly host: string
  /** Port to match, or '' for the https default (443). */
  readonly port: string
  readonly pathPrefix: string
}

/**
 * Fully normalized, JSON-serializable remote policy. Built once at module setup
 * and threaded to both the render-time image resolver and the build-time font
 * bundler, so there is a single source of truth for reachability and caps.
 */
export interface RemoteAssetPolicy {
  readonly allow: readonly RemoteAssetRule[]
  readonly maxImageBytes: number
  readonly maxFontBytes: number
  readonly timeoutMs: number
}

export const DEFAULT_REMOTE_TIMEOUT_MS = 10_000

const MAX_REDIRECTS = 5

const configError = (message: string): never => {
  throw new TypeError(message)
}

const blocked = (message: string, cause?: unknown): never => {
  throw new PdfAssetError(PDF_ASSET_ERROR_CODES.Blocked, message, { cause })
}

const limitExceeded = (url: string, maxBytes: number): never => {
  throw new PdfAssetError(
    PDF_ASSET_ERROR_CODES.LimitExceeded,
    `The remote resource "${url}" exceeds the ${maxBytes}-byte limit.`,
  )
}

const parseAllowEntry = (entry: unknown): RemoteAssetRule => {
  if (typeof entry !== 'string' || entry.trim() === '') {
    return configError('pdf.remote.allow entries must be non-empty https:// URL prefixes.')
  }

  let parsed: URL
  try {
    parsed = new URL(entry)
  }
  catch {
    return configError(`pdf.remote.allow entry "${entry}" is not a valid URL.`)
  }

  if (parsed.protocol !== 'https:') {
    configError(`pdf.remote.allow entry "${entry}" must use the https:// scheme.`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    configError(`pdf.remote.allow entry "${entry}" must not embed credentials.`)
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    configError(`pdf.remote.allow entry "${entry}" must not include a query or fragment.`)
  }

  const hostname = parsed.hostname.toLowerCase()

  if (hostname === '' || hostname === '*') {
    configError(`pdf.remote.allow entry "${entry}" must name an explicit host.`)
  }

  if (hostname.startsWith('*.')) {
    const suffix = hostname.slice(1)
    if (!suffix.slice(1).includes('.')) {
      configError(
        `pdf.remote.allow entry "${entry}" must use a "*." wildcard on a registrable domain.`,
      )
    }
    if (suffix.slice(1).includes('*')) {
      configError(`pdf.remote.allow entry "${entry}" may only use a single leading "*." wildcard.`)
    }
    return { wildcard: true, host: suffix, port: parsed.port, pathPrefix: parsed.pathname }
  }

  if (hostname.includes('*')) {
    configError(`pdf.remote.allow entry "${entry}" may only use a single leading "*." wildcard.`)
  }

  return { wildcard: false, host: hostname, port: parsed.port, pathPrefix: parsed.pathname }
}

const resolveCap = (
  value: number | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    configError(`pdf.remote.${name} must be a positive safe integer.`)
  }
  return value
}

/**
 * Validates and normalizes `pdf.remote` once at module setup. Fails fast on a
 * non-https, credentialed, or bare-wildcard entry. Returns `undefined` when the
 * option is absent, which preserves the default zero-network behavior.
 */
export const normalizeRemoteAssetPolicy = (
  options: RemoteAssetOptions | undefined,
  defaults: { readonly maxImageBytes: number, readonly maxFontBytes: number },
): RemoteAssetPolicy | undefined => {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object') {
    return configError('pdf.remote must be an object with an allow list.')
  }
  if (!Array.isArray(options.allow) || options.allow.length === 0) {
    return configError('pdf.remote.allow must list at least one https:// URL prefix.')
  }

  return Object.freeze({
    allow: Object.freeze(options.allow.map(parseAllowEntry)),
    maxImageBytes: resolveCap(options.maxImageBytes, defaults.maxImageBytes, 'maxImageBytes'),
    maxFontBytes: resolveCap(options.maxFontBytes, defaults.maxFontBytes, 'maxFontBytes'),
    timeoutMs: resolveCap(options.timeoutMs, DEFAULT_REMOTE_TIMEOUT_MS, 'timeoutMs'),
  })
}

/**
 * Returns whether an absolute URL is admitted by the policy: https only, no
 * embedded credentials, an allowlisted host, and an allowlisted path prefix.
 * The query string is ignored for matching but preserved for the fetch.
 */
export const matchesAllowlist = (
  url: string,
  policy: RemoteAssetPolicy,
): boolean => {
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false

  const hostname = parsed.hostname.toLowerCase()
  const { pathname, port } = parsed

  return policy.allow.some(rule =>
    (rule.wildcard ? hostname.endsWith(rule.host) : hostname === rule.host)
    && port === rule.port
    && pathname.startsWith(rule.pathPrefix),
  )
}

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError'

const readCapped = async (
  response: Response,
  url: string,
  maxBytes: number,
  controller: AbortController,
): Promise<Buffer> => {
  const body = response.body
  if (!body) return Buffer.alloc(0)

  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > maxBytes) {
      controller.abort()
      limitExceeded(url, maxBytes)
    }
    chunks.push(Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

const fetchOnce = async (
  url: string,
  policy: RemoteAssetPolicy,
  maxBytes: number,
): Promise<{ redirectTo: string } | { buffer: Buffer }> => {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, policy.timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      credentials: 'omit',
    })

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) {
        blocked(`The remote resource "${url}" returned a redirect without a Location.`)
      }
      return { redirectTo: new URL(location!, url).toString() }
    }

    if (response.status !== 200) {
      await response.body?.cancel()
      return blocked(`The remote resource "${url}" returned HTTP ${response.status}.`)
    }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      controller.abort()
      limitExceeded(url, maxBytes)
    }

    return { buffer: await readCapped(response, url, maxBytes, controller) }
  }
  catch (error) {
    if (error instanceof PdfAssetError) throw error
    if (timedOut || isAbortError(error)) {
      return blocked(`The remote resource "${url}" timed out after ${policy.timeoutMs}ms.`)
    }
    return blocked(`The remote resource "${url}" could not be fetched.`, error)
  }
  finally {
    clearTimeout(timer)
  }
}

const fetchResolved = async (
  initialUrl: string,
  policy: RemoteAssetPolicy,
  maxBytes: number,
): Promise<Buffer> => {
  let url = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!matchesAllowlist(url, policy)) {
      blocked(
        `The remote resource "${url}" is not permitted by pdf.remote.allow.`,
      )
    }

    const outcome = await fetchOnce(url, policy, maxBytes)
    if ('buffer' in outcome) return outcome.buffer
    url = outcome.redirectTo
  }

  return blocked(
    `The remote resource "${initialUrl}" exceeded the ${MAX_REDIRECTS}-redirect limit.`,
  )
}

export interface FetchRemoteResourceOptions {
  readonly policy: RemoteAssetPolicy
  readonly maxBytes: number
  /** Per-render dedup map so a repeated URL is fetched once. */
  readonly inflight?: Map<string, Promise<Buffer>>
}

/**
 * The single remote fetch boundary. Resource-agnostic: it enforces the
 * allowlist (per hop), an https-only manual redirect chain, a per-hop timeout,
 * and a streamed byte cap, then returns the raw bytes. Callers validate those
 * bytes with the same signature checks used for local assets.
 */
export const fetchRemoteResource = (
  url: string,
  options: FetchRemoteResourceOptions,
): Promise<Buffer> => {
  const { policy, maxBytes, inflight } = options
  const existing = inflight?.get(url)
  if (existing) return existing

  const promise = fetchResolved(url, policy, maxBytes)
  inflight?.set(url, promise)
  return promise
}
