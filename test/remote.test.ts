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
import {
  bundlePdfFonts,
  DEFAULT_MAX_PDF_FONT_BYTES,
} from '../src/build/fonts'
import {
  matchesAllowlist,
  normalizeRemoteAssetPolicy,
  type RemoteAssetPolicy,
} from '../src/runtime/server/assets/remote'
import {
  DEFAULT_MAX_PDF_IMAGE_BYTES,
  resolvePdfImageAssets,
} from '../src/runtime/server/assets/resolve-asset'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/fonts'
import {
  PDF_PRIMITIVES,
  type PdfDocumentNode,
  type PdfElementNode,
} from '../src/runtime/renderer/types'

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
const TTF = readFileSync(fileURLToPath(new URL(
  './fixtures/assets/Roboto-Regular.ttf',
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
    case '/ttf':
      res.writeHead(200, {
        'content-type': 'font/ttf',
        'content-length': String(TTF.byteLength),
      })
      res.end(TTF)
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
    maxImageBytes: number
    maxFontBytes: number
    timeoutMs: number
  }> = {},
): RemoteAssetPolicy => normalizeRemoteAssetPolicy({
  allow: overrides.allow ?? [`${origin}/`],
  maxImageBytes: overrides.maxImageBytes,
  maxFontBytes: overrides.maxFontBytes,
  timeoutMs: overrides.timeoutMs ?? 2000,
}, {
  maxImageBytes: DEFAULT_MAX_PDF_IMAGE_BYTES,
  maxFontBytes: DEFAULT_MAX_PDF_FONT_BYTES,
})!

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

const resolvedSource = (node: PdfElementNode): { data: Buffer, format: string } =>
  (node.props.src ?? node.props.source) as { data: Buffer, format: string }

const expectAssetError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'PdfAssetError', code })
}

describe('remote allowlist matching', () => {
  it('admits only https, allowlisted host, port, and path prefix', () => {
    const policy = normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/assets/', 'https://*.images.example.com/img/'],
    }, { maxImageBytes: 1, maxFontBytes: 1 })!

    expect(matchesAllowlist('https://cdn.example.com/assets/logo.png?v=2', policy)).toBe(true)
    expect(matchesAllowlist('https://a.images.example.com/img/a.png', policy)).toBe(true)
    expect(matchesAllowlist('https://a.b.images.example.com/img/a.png', policy)).toBe(true)

    // wrong scheme, host, subdomain apex, path, port, or embedded credentials
    expect(matchesAllowlist('http://cdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com/other/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://evilcdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://images.example.com/img/a.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com:8443/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('https://user:pw@cdn.example.com/assets/logo.png', policy)).toBe(false)
    expect(matchesAllowlist('not a url', policy)).toBe(false)
  })

  it('matches path prefixes only on segment boundaries', () => {
    const policy = normalizeRemoteAssetPolicy({
      allow: ['https://cdn.example.com/avatars'],
    }, { maxImageBytes: 1, maxFontBytes: 1 })!

    expect(matchesAllowlist('https://cdn.example.com/avatars', policy)).toBe(true)
    expect(matchesAllowlist('https://cdn.example.com/avatars/a.png', policy)).toBe(true)
    expect(matchesAllowlist('https://cdn.example.com/avatars-private/a.png', policy)).toBe(false)
    expect(matchesAllowlist('https://cdn.example.com/avatarsx', policy)).toBe(false)
  })

  it('rejects unsafe allowlist entries at setup', () => {
    const defaults = { maxImageBytes: 1, maxFontBytes: 1 }
    expect(normalizeRemoteAssetPolicy(undefined, defaults)).toBeUndefined()
    expect(() => normalizeRemoteAssetPolicy({ allow: [] }, defaults))
      .toThrow(/at least one/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['http://cdn.example.com/'] }, defaults))
      .toThrow(/https/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://*/'] }, defaults))
      .toThrow(/explicit host/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://*.com/'] }, defaults))
      .toThrow(/registrable domain/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://*.co.uk/'] }, defaults))
      .toThrow(/public suffix/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://*.github.io/'] }, defaults))
      .toThrow(/public suffix/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://user:pw@cdn.example.com/'] }, defaults))
      .toThrow(/credentials/)
    expect(() => normalizeRemoteAssetPolicy({ allow: ['https://cdn.example.com/?x=1'] }, defaults))
      .toThrow(/query or fragment/)
    expect(() => normalizeRemoteAssetPolicy(
      { allow: ['https://cdn.example.com/'], maxImageBytes: 0 },
      defaults,
    )).toThrow(/positive safe integer/)
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
    expect(source.format).toBe('png')
    expect(Buffer.isBuffer(source.data)).toBe(true)
    expect(source.data.equals(SAMPLE_PNG)).toBe(true)
    expect(requests.filter(path => path === '/sample-png')).toHaveLength(1)

    const result = await renderDocument(document as unknown as DocumentNode, {
      fontStore: createPdfFontStore(),
    })
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it('accepts the { uri } source form', async () => {
    const node = image({ source: { uri: `${origin}/png` } })
    await resolvePdfImageAssets(documentWith(node), { assets: {}, remote: policyFor() })
    expect(resolvedSource(node).data.equals(PNG)).toBe(true)
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
        remote: policyFor({ maxImageBytes: 1024 }),
      }),
      'PDF_LIMIT_EXCEEDED',
    )
  })

  it('enforces the byte cap on a streamed body with no content-length', async () => {
    streamStats.sent = 0

    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: `${origin}/streamed-oversized` })), {
        assets: {},
        remote: policyFor({ maxImageBytes: 512 }),
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
    expect(resolvedSource(node).data.equals(PNG)).toBe(true)
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

  it('fetches a repeated URL once per render', async () => {
    requests = []
    const document = documentWith(
      image({ src: `${origin}/png` }),
      image({ src: `${origin}/png` }),
    )
    await resolvePdfImageAssets(document, { assets: {}, remote: policyFor() })
    expect(requests.filter(path => path === '/png')).toHaveLength(1)
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
})

describe('remote fonts', () => {
  it('embeds an allowlisted font as a validated data URL', async () => {
    const [font] = await bundlePdfFonts(
      [{ family: 'Remote Roboto', src: `${origin}/ttf` }],
      { fontRoots: [], remote: policyFor() },
    )
    expect(font?.family).toBe('Remote Roboto')
    expect(font?.src.startsWith('data:font/ttf;base64,')).toBe(true)
    expect(Buffer.from(font!.src.split(',')[1]!, 'base64').equals(TTF)).toBe(true)
  })

  it('rejects a non-allowlisted host', async () => {
    await expect(bundlePdfFonts(
      [{ family: 'Blocked', src: 'https://blocked.example.com/font.ttf' }],
      { fontRoots: [], remote: policyFor() },
    )).rejects.toThrow(/not permitted by pdf\.remote\.allow/)
  })

  it('rejects a remote font when pdf.remote is unconfigured', async () => {
    await expect(bundlePdfFonts(
      [{ family: 'Blocked', src: `${origin}/ttf` }],
      { fontRoots: [] },
    )).rejects.toThrow(/remote fonts are disabled/)
  })

  it('enforces the font byte cap', async () => {
    await expectAssetError(
      bundlePdfFonts(
        [{ family: 'Big', src: `${origin}/ttf` }],
        { fontRoots: [], remote: policyFor({ maxFontBytes: 1024 }) },
      ),
      'PDF_LIMIT_EXCEEDED',
    )
  })

  it('rejects bytes without a TTF or OTF signature', async () => {
    await expect(bundlePdfFonts(
      [{ family: 'NotAFont', src: `${origin}/not-a-font` }],
      { fontRoots: [], remote: policyFor() },
    )).rejects.toThrow(/unsupported TTF or OTF signature/)
  })
})
