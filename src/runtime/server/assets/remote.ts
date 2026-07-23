import { Buffer } from 'node:buffer'
import {
  PDF_ASSET_ERROR_CODES,
  PdfAssetError,
} from './errors'
import type { RenderLimits } from '../engine/limits'

/** Opt-in policy for runtime image requests. Remote fonts are not supported. */
export interface RemoteAssetOptions {
  /** Exact `https://host/path/` prefixes. Wildcard hosts are rejected. */
  allow: readonly string[]
  /** Per-hop timeout, bounded by the remaining render deadline. */
  timeoutMs?: number
}

export interface RemoteAssetRule {
  readonly host: string
  readonly port: string
  readonly pathPrefix: string
}

/** JSON-serializable policy generated once during Nuxt module setup. */
export interface RemoteAssetPolicy {
  readonly allow: readonly RemoteAssetRule[]
  readonly timeoutMs: number
}

export const DEFAULT_REMOTE_TIMEOUT_MS = 10_000
export const MAX_REMOTE_REDIRECTS = 3

/** Runtime URL label safe for logs, preview diagnostics, and attributed errors. */
export const redactUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}/…`
  }
  catch {
    return '<redacted-url>'
  }
}

const configError = (message: string): never => {
  throw new TypeError(message)
}

const blocked = (message: string, cause?: unknown): never => {
  throw new PdfAssetError(PDF_ASSET_ERROR_CODES.Blocked, message, { cause })
}

const limitExceeded = (message: string): never => {
  throw new PdfAssetError(PDF_ASSET_ERROR_CODES.LimitExceeded, message)
}

const positiveSafeInteger = (
  value: number | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    return configError(`pdf.remote.${name} must be a positive safe integer.`)
  }
  return value
}

const parseAllowEntry = (entry: unknown): RemoteAssetRule => {
  if (typeof entry !== 'string' || entry.trim() === '') {
    return configError('pdf.remote.allow entries must be non-empty https://host/path/ prefixes.')
  }

  let parsed: URL
  try {
    parsed = new URL(entry)
  }
  catch {
    return configError('A pdf.remote.allow entry is not a valid URL prefix.')
  }

  if (parsed.protocol !== 'https:') {
    return configError('pdf.remote.allow entries must use the https:// scheme.')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return configError('pdf.remote.allow entries must not embed credentials.')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return configError('pdf.remote.allow entries must not include a query or fragment.')
  }
  if (parsed.hostname === '' || parsed.hostname.includes('*')) {
    return configError('pdf.remote.allow entries must name one exact host without wildcards.')
  }
  if (!parsed.pathname.endsWith('/')) {
    return configError('pdf.remote.allow entries must end with a path slash (/).')
  }

  return Object.freeze({
    host: parsed.hostname.toLowerCase(),
    port: parsed.port,
    pathPrefix: parsed.pathname,
  })
}

export const normalizeRemoteAssetPolicy = (
  options: RemoteAssetOptions | undefined,
): RemoteAssetPolicy | undefined => {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object') {
    return configError('pdf.remote must be an object with an allow list.')
  }
  if (!Array.isArray(options.allow) || options.allow.length === 0) {
    return configError('pdf.remote.allow must list at least one https://host/path/ prefix.')
  }
  const unknownKey = Object.keys(options).find(key =>
    key !== 'allow' && key !== 'timeoutMs')
  if (unknownKey) {
    return configError(`pdf.remote.${unknownKey} is not supported.`)
  }

  return Object.freeze({
    allow: Object.freeze(options.allow.map(parseAllowEntry)),
    timeoutMs: positiveSafeInteger(
      options.timeoutMs,
      DEFAULT_REMOTE_TIMEOUT_MS,
      'timeoutMs',
    ),
  })
}

/** Revalidate scheme, credentials, fragment, host, port, and path on every hop. */
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
  if (parsed.hash !== '') return false

  const hostname = parsed.hostname.toLowerCase()
  return policy.allow.some(rule =>
    hostname === rule.host
    && parsed.port === rule.port
    && parsed.pathname.startsWith(rule.pathPrefix),
  )
}

type RemoteWaiter = {
  reject(error: unknown): void
  resolve(): void
}

/** Mutable request accounting owned by exactly one render. */
export interface RemoteRequestState {
  readonly limits: RenderLimits
  active: number
  requests: number
  readonly waiters: RemoteWaiter[]
}

export const createRemoteRequestState = (
  limits: RenderLimits,
): RemoteRequestState => ({ limits, active: 0, requests: 0, waiters: [] })

const acquireRequestSlot = async (state: RemoteRequestState): Promise<void> => {
  state.limits.deadline.check()
  if (state.limits.abortController.signal.aborted) {
    throw state.limits.abortController.signal.reason
  }
  state.requests += 1
  if (state.requests > state.limits.maxRemoteRequests) {
    return limitExceeded(
      `PDF remote requests exceed pdf.limits.maxRemoteRequests (${state.limits.maxRemoteRequests}).`,
    )
  }
  if (state.active < state.limits.maxRemoteConcurrency) {
    state.active += 1
    return
  }

  await new Promise<void>((resolve, reject) => {
    const signal = state.limits.abortController.signal
    const waiter: RemoteWaiter = {
      reject,
      resolve: () => {
        signal.removeEventListener('abort', onAbort)
        state.active += 1
        resolve()
      },
    }
    const onAbort = () => {
      const index = state.waiters.indexOf(waiter)
      if (index >= 0) state.waiters.splice(index, 1)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    state.waiters.push(waiter)
  })
}

const releaseRequestSlot = (state: RemoteRequestState): void => {
  state.active -= 1
  state.waiters.shift()?.resolve()
}

const readCapped = async (
  response: Response,
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
      return limitExceeded(
        `A remote PDF image exceeds pdf.limits.maxImageBytes (${maxBytes}).`,
      )
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, total)
}

const fetchOnce = async (
  url: string,
  policy: RemoteAssetPolicy,
  maxBytes: number,
  state: RemoteRequestState,
): Promise<{ redirectTo: string } | { buffer: Buffer }> => {
  await acquireRequestSlot(state)
  const controller = new AbortController()
  const renderSignal = state.limits.abortController.signal
  const abortFromRender = () => controller.abort(renderSignal.reason)
  renderSignal.addEventListener('abort', abortFromRender, { once: true })
  let timedOut = false
  const remaining = state.limits.deadline.remainingMs()
  const timeoutMs = Math.min(policy.timeoutMs, Math.max(1, Math.ceil(remaining)))
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

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
        return blocked(`The remote PDF image from ${redactUrl(url)} returned a redirect without a Location.`)
      }
      return { redirectTo: new URL(location, url).toString() }
    }
    if (response.status !== 200) {
      await response.body?.cancel()
      return blocked(`The remote PDF image from ${redactUrl(url)} returned HTTP ${response.status}.`)
    }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      controller.abort()
      return limitExceeded(
        `A remote PDF image exceeds pdf.limits.maxImageBytes (${maxBytes}).`,
      )
    }
    return { buffer: await readCapped(response, maxBytes, controller) }
  }
  catch (error) {
    if (error instanceof PdfAssetError) throw error
    if (renderSignal.aborted) throw renderSignal.reason
    if (timedOut) {
      if (state.limits.deadline.remainingMs() <= 0) {
        state.limits.deadline.check()
      }
      return blocked(`The remote PDF image from ${redactUrl(url)} timed out after ${timeoutMs}ms.`)
    }
    return blocked(`The remote PDF image from ${redactUrl(url)} could not be fetched.`, error)
  }
  finally {
    clearTimeout(timer)
    renderSignal.removeEventListener('abort', abortFromRender)
    releaseRequestSlot(state)
  }
}

const fetchResolved = async (
  initialUrl: string,
  policy: RemoteAssetPolicy,
  maxBytes: number,
  state: RemoteRequestState,
): Promise<Buffer> => {
  let url = initialUrl
  for (let redirects = 0; redirects <= MAX_REMOTE_REDIRECTS; redirects += 1) {
    if (!matchesAllowlist(url, policy)) {
      return blocked(
        `The remote PDF image from ${redactUrl(url)} is not permitted by pdf.remote.allow.`,
      )
    }
    const outcome = await fetchOnce(url, policy, maxBytes, state)
    if ('buffer' in outcome) return outcome.buffer
    url = outcome.redirectTo
  }
  return blocked(
    `The remote PDF image from ${redactUrl(initialUrl)} exceeded the ${MAX_REMOTE_REDIRECTS}-redirect limit.`,
  )
}

export interface FetchRemoteResourceOptions {
  readonly policy: RemoteAssetPolicy
  readonly maxBytes: number
  readonly state: RemoteRequestState
  /** Per-render dedup map so a repeated URL is fetched once. */
  readonly inflight?: Map<string, Promise<Buffer>>
}

/** Fetch one allowlisted image under the render-wide deadline and budgets. */
export const fetchRemoteResource = (
  url: string,
  options: FetchRemoteResourceOptions,
): Promise<Buffer> => {
  const { policy, maxBytes, state, inflight } = options
  const existing = inflight?.get(url)
  if (existing) return existing

  const promise = fetchResolved(url, policy, maxBytes, state)
  inflight?.set(url, promise)
  return promise
}
