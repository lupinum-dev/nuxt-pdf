import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import {
  createServer,
  type Server,
} from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DocumentNode } from '@react-pdf/layout'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import { bundlePdfFonts } from '../src/build/fonts'
import {
  matchesAllowlist,
  normalizeRemoteAssetPolicy,
  type RemoteAssetPolicy,
} from '../src/runtime/server/assets/remote'
import { resolvePdfImageAssets } from '../src/runtime/server/assets/resolve-asset'
import {
  createRenderLimits,
  DEFAULT_PDF_RENDER_LIMITS,
} from '../src/runtime/server/render-limits'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import type {
  PdfDocumentNode,
  PdfElementNode,
} from '../src/runtime/renderer/types'
import { PDF_PRIMITIVES } from '../src/runtime/authoring'

// The remote policy is https-only, so the fixtures are served over a real TLS
// loopback with a per-run self-signed cert. Client verification is disabled
// only while these tests run (restored in afterAll).
let previousTlsReject: string | undefined

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
  'base64',
)
const SAMPLE_PNG = readFileSync(fileURLToPath(new URL(
  './fixtures/assets/sample.png',
  import.meta.url,
)))
const HTML = Buffer.from('<!doctype html><title>not an image</title>')

let certDir: string
let server: Server
let origin: string

// Written by the /streamed-oversized route so the cap test can assert the
// client aborted mid-stream instead of buffering the whole body.
const streamStats = { sent: 0 }
let requests: string[] = []
let activeRequests = 0
let peakActiveRequests = 0
const openSockets = new Set<import('node:net').Socket>()

const routes = (req: IncomingMessage, res: ServerResponse): void => {
  const url = new URL(req.url ?? '/', origin)
  requests.push(url.pathname)
  res.on('error', () => {})

  switch (url.pathname) {
    case '/png':
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(PNG.byteLength),
      })
      res.end(PNG)
      return
    case '/sample-png':
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(SAMPLE_PNG.byteLength),
      })
      res.end(SAMPLE_PNG)
      return
    case '/wrong-signature':
      // HTML bytes deceptively served with an image content-type.
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(HTML.byteLength),
      })
      res.end(HTML)
      return
    case '/not-a-font':
      res.writeHead(200, { 'content-type': 'font/ttf' })
      res.end(HTML)
      return
    case '/declared-oversized':
      // Content-Length advertises a size over the cap; body never sent.
      res.writeHead(200, { 'content-length': String(50 * 1024 * 1024) })
      res.end(Buffer.alloc(64))
      return
    case '/streamed-oversized': {
      // No content-length: a long chunked body. The client must abort
      // mid-stream; streamStats.sent lets the test prove it did not
      // consume the whole body before checking the cap.
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      const chunk = Buffer.alloc(1024, 1)
      let remaining = 4096
      const writeMore = () => {
        while (remaining > 0) {
          remaining -= 1
          streamStats.sent += chunk.byteLength
          if (!res.write(chunk)) {
            res.once('drain', writeMore)
            return
          }
        }
        res.end()
      }
      res.once('close', () => {
        remaining = 0
      })
      writeMore()
      return
    }
    case '/redirect-internal':
      res.writeHead(302, { location: '/png' })
      res.end('go')
      return
    case '/redirect-external':
      res.writeHead(302, { location: 'https://blocked.example.com/evil.png' })
      res.end('go')
      return
    case '/redirect-loop':
      res.writeHead(302, { location: '/redirect-loop' })
      res.end('again')
      return
    case '/slow-png':
      activeRequests += 1
      peakActiveRequests = Math.max(peakActiveRequests, activeRequests)
      setTimeout(() => {
        activeRequests -= 1
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(PNG)
      }, 50)
      return
    case '/hang':
      // Never respond; the client-side timeout must abort it.
      return
    default:
      res.writeHead(404)
      res.end('missing')
  }
}

beforeAll(async () => {
  previousTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  certDir = mkdtempSync(join(tmpdir(), 'nuxt-pdf-remote-cert-'))
  const keyPath = join(certDir, 'key.pem')
  const certPath = join(certDir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { stdio: 'ignore' })

  server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    routes,
  )
  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      origin = `https://127.0.0.1:${port}`
      resolve()
    })
  })
})

afterAll(async () => {
  for (const socket of openSockets) socket.destroy()
  await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(certDir, { recursive: true, force: true })
  if (previousTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsReject
})

const policyFor = (
  overrides: Partial<{
    allow: string[]
    timeoutMs: number
  }> = {},
): RemoteAssetPolicy => normalizeRemoteAssetPolicy({
  allow: overrides.allow ?? [`${origin}/`],
  timeoutMs: overrides.timeoutMs ?? 2000,
})!

const imageLimits = (
  overrides: Partial<typeof DEFAULT_PDF_RENDER_LIMITS> = {},
) => createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, ...overrides })

const image = (props: Record<string, unknown>): PdfElementNode => ({
  type: PDF_PRIMITIVES.Image,
  box: {},
  style: {},
  props,
  children: [],
})

const documentWith = (...children: PdfElementNode[]): PdfDocumentNode => ({
  type: PDF_PRIMITIVES.Document,
  box: {},
  style: {},
  props: {},
  children: [{
    type: PDF_PRIMITIVES.Page,
    box: {},
    style: { padding: 16 },
    props: { size: 'A4' },
    children,
  }],
})

const resolvedSource = (node: PdfElementNode): Buffer =>
  (node.props.src ?? node.props.source) as Buffer

const expectAssetError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'PdfAssetError', code })
}

describe('remote allowlist matching', () => {
  it('admits only https, allowlisted host, port, and path prefix', () => {
    const policy = normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/assets/'],
    })!

    expect(matchesAllowlist('https://cdn.example.com/assets/logo.png?v=2', policy)).toBe(true)

    // wrong scheme, host, subdomain, path, port, credentials, or fragment
    expect(matchesAllowlist('http://cdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com/other/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://evilcdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://a.cdn.example.com/assets/a.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com:8443/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://user:pw@cdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com/assets/logo.png#fragment', policy)).toBe(false)
    expect(matchesAllowlist('not a url', policy)).toBe(false)
  })

  it('requires an explicit directory prefix', () => {
    const policy = normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/avatars/'],
    })!

    expect(matchesAllowlist('https://cdn.example.com/avatars/a.png', policy)).toBe(true)
    expect(matchesAllowlist('https://cdn.example.com/avatars-private/a.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com/avatarsx', policy)).toBe(false)
  })

  it('rejects unsafe allowlist entries at setup', () => {
    expect(normalizeRemoteAssetPolicy(undefined)).toBeUndefined()
    expect(() => normalizeRemoteAssetPolicy({ allow: [] }))
      .toThrow(/at least one/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['http://cdn.example.com/'] }))
      .toThrow(/https/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://*.example.com/'] }))
      .toThrow(/without wildcards/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://user:pw@cdn.example.com/'] }))
      .toThrow(/credentials/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://cdn.example.com/?x=1'] }))
      .toThrow(/query or fragment/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://cdn.example.com/assets'] }))
      .toThrow(/path slash/)
    expect(() => normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/'],
      timeoutMs: 0,
    })).toThrow(/positive safe integer/)
    expect(() => normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/'],
      maxImageBytes: 1,
    } as never)).toThrow(/maxImageBytes is not supported/)
  })
})

describe('remote images', () => {
  it('fetches an allowlisted image into embedded bytes and renders it', async () => {
    requests = []
    const node = image({ src: `${origin}/sample-png` })
    const document = documentWith(node)

    const resolved = await resolvePdfImageAssets(document, {
      assets: {},
      remote: policyFor(),
    })

    expect(resolved).toBe(document)
    const source = resolvedSource(node)
    expect(Buffer.isBuffer(source)).toBe(true)
    expect(source.equals(SAMPLE_PNG)).toBe(true)
    expect(requests.filter(path => path === '/sample-png')).toHaveLength(1)

    const result = await renderDocument(document as unknown as DocumentNode, {
      fontStore: createPdfFontStore(),
    })
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('accepts the { uri } source form', async () => {
    const node = image({ source: { uri: `${origin}/png` } })
    await resolvePdfImageAssets(documentWith(node), { assets: {}, remote: policyFor() })
    expect(resolvedSource(node).equals(PNG)).toBe(true)
  })

  it('blocks a non-allowlisted host', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: 'https://blocked.example.com/x.png' })), {
        assets: {},
        remote: policyFor(),
      }),
      'PDF_ASSET_BLOCKED',
    )
  })

  it('blocks http even when the host is otherwise allowlisted', async () => {
    const httpsAllowed = policyFor()
    const httpUrl = `${origin.replace('https:', 'http:')}/png`
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: httpUrl })), {
        assets: {},
        remote: httpsAllowed,
      }),
      'PDF_ASSET_BLOCKED',
    )
  })

  it('redacts query strings from remote error messages', async () => {
    try {
      await resolvePdfImageAssets(
        documentWith(image({ src: 'https://blocked.example.com/a.png?sig=SECRETTOKEN' })),
        { assets: {}, remote: policyFor() },
      )
      expect.unreachable()
    }
    catch (error) {
      expect((error as Error).message).not.toContain('SECRETTOKEN')
      expect((error as Error).message).toContain('blocked.example.com')
    }
  })

  it('trusts the byte signature over a deceptive content-type', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/wrong-signature` })), {
        assets: {},
        remote: policyFor(),
      }),
      'PDF_ASSET_INVALID',
    )
  })

  it('enforces the byte cap from a declared content-length', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/declared-oversized` })), {
        assets: {},
        limits: imageLimits({ maxImageBytes: 1024 }),
        remote: policyFor(),
      }),
      'PDF_LIMIT_EXCEEDED',
    )
  })

  it('enforces the byte cap on a streamed body with no content-length', async () => {
    streamStats.sent = 0

    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/streamed-oversized` })), {
        assets: {},
        limits: imageLimits({ maxImageBytes: 512 }),
        remote: policyFor(),
      }),
      'PDF_LIMIT_EXCEEDED',
    )

    // The route offers 4 MiB; a client that buffered the whole body before
    // checking the cap would have consumed it all. Mid-stream abort must stop
    // the transfer well short of that (socket buffers still admit some slack).
    expect(streamStats.sent).toBeLessThan(1024 * 1024)
  })

  it('re-validates the allowlist on every redirect hop', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/redirect-external` })), {
        assets: {},
        remote: policyFor(),
      }),
      'PDF_ASSET_BLOCKED',
    )

    const node = image({ src: `${origin}/redirect-internal` })
    await resolvePdfImageAssets(documentWith(node), { assets: {}, remote: policyFor() })
    expect(resolvedSource(node).equals(PNG)).toBe(true)
  })

  it('fails closed with no network when pdf.remote is unconfigured', async () => {
    requests = []
    const promise = resolvePdfImageAssets(
      documentWith(image({ src: `${origin}/png` })),
      { assets: {} },
    )
    await expect(promise).rejects.toMatchObject({
      name: 'PdfAssetError',
      code: 'PDF_ASSET_BLOCKED',
      message: expect.stringContaining('disabled'),
    })
    expect(requests).toHaveLength(0)
  })

  it('shares a repeated URL buffer within one render but isolates renders', async () => {
    requests = []
    const firstImages = [
      image({ src: `${origin}/sample-png` }),
      image({ src: `${origin}/sample-png` }),
    ]
    const firstDocument = documentWith(...firstImages)
    const secondImage = image({ src: `${origin}/sample-png` })

    await resolvePdfImageAssets(
      firstDocument,
      { assets: {}, remote: policyFor() },
    )
    expect(requests.filter(path => path === '/sample-png')).toHaveLength(1)

    const first = resolvedSource(firstImages[0]!)
    expect(resolvedSource(firstImages[1]!)).toBe(first)
    const rendered = await renderDocument(firstDocument as unknown as DocumentNode)
    expect(Buffer.from(rendered.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')

    await resolvePdfImageAssets(
      documentWith(secondImage),
      { assets: {}, remote: policyFor() },
    )

    expect(requests.filter(path => path === '/sample-png')).toHaveLength(2)
    expect(resolvedSource(secondImage)).not.toBe(first)
  })

  it('aborts a hanging endpoint within the timeout', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/hang` })), {
        assets: {},
        remote: policyFor({ timeoutMs: 300 }),
      }),
      'PDF_ASSET_BLOCKED',
    )
  }, 5000)

  it('enforces render-wide request and concurrency budgets', async () => {
    await expectAssetError(
      resolvePdfImageAssets(documentWith(
        image({ src: `${origin}/redirect-internal` }),
      ), {
        assets: {},
        limits: imageLimits({ maxRemoteRequests: 1 }),
        remote: policyFor(),
      }),
      'PDF_LIMIT_EXCEEDED',
    )

    activeRequests = 0
    peakActiveRequests = 0
    await resolvePdfImageAssets(documentWith(
      ...Array.from({ length: 6 }, (_, index) =>
        image({ src: `${origin}/slow-png?case=${index}` })),
    ), {
      assets: {},
      limits: imageLimits({ maxRemoteConcurrency: 2 }),
      remote: policyFor(),
    })
    expect(peakActiveRequests).toBe(2)
  })

  it('uses a fixed three-redirect maximum', async () => {
    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: `${origin}/redirect-loop` })),
        { assets: {}, remote: policyFor() },
      ),
      'PDF_ASSET_BLOCKED',
    )
    expect(requests.filter(path => path === '/redirect-loop').length).toBeGreaterThanOrEqual(4)
  })

  it('aborts sibling requests after the first fatal resource failure', async () => {
    const start = performance.now()
    await expectAssetError(
      resolvePdfImageAssets(documentWith(
        image({ src: `${origin}/hang` }),
        image({ src: `${origin}/wrong-signature` }),
      ), {
        assets: {},
        remote: policyFor({ timeoutMs: 4000 }),
      }),
      'PDF_ASSET_INVALID',
    )
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

describe('remote fonts', () => {
  it('rejects remote fonts regardless of the image policy', async () => {
    await expect(bundlePdfFonts(
      [{ family: 'Blocked', src: `${origin}/ttf` }],
      { fontRoots: [] },
    )).rejects.toThrow(/remote fonts are unsupported/)
  })
})
