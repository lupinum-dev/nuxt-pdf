import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PDF_ASSET_ERROR_CODES,
  loadPdfImageAsset,
  resolvePdfImageAssets,
  type PdfImageAssetMap,
} from '../src/runtime/server/assets/resolve-asset'
import {
  createRenderLimits,
  DEFAULT_PDF_RENDER_LIMITS,
} from '../src/runtime/server/render-limits'
import type {
  PdfDocumentNode,
  PdfElementNode,
} from '../src/runtime/renderer/types'
import { PDF_PRIMITIVES } from '../src/runtime/authoring'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
  'base64',
)

const JPEG = readFileSync(fileURLToPath(new URL(
  './fixtures/corpus/images-sample.jpg',
  import.meta.url,
)))

const temporaryDirectories: string[] = []

const imageLimits = (
  overrides: Partial<typeof DEFAULT_PDF_RENDER_LIMITS>,
) => createRenderLimits({ ...DEFAULT_PDF_RENDER_LIMITS, ...overrides })

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-assets-'))
  temporaryDirectories.push(directory)
  return directory
}

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
    style: {},
    props: {},
    children,
  }],
})

const expectAssetError = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({
    name: 'PdfAssetError',
    code,
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('local PDF image loading', () => {
  it('loads a canonical relative key and validated bytes at module time', async () => {
    const root = await createTemporaryDirectory()
    await mkdir(join(root, 'images'))
    await writeFile(join(root, 'images', 'logo.png'), PNG)

    const asset = await loadPdfImageAsset('./images\\logo.png', {
      roots: [root],
    })

    expect(asset).toMatchObject({
      key: 'images/logo.png',
      format: 'png',
    })
    expect(Buffer.isBuffer(asset.data)).toBe(true)
    expect(asset.data).toEqual(PNG)
  })

  it.each([
    '/etc/passwd',
    '../outside.png',
    'https://example.com/logo.png',
    'data:image/png;base64,AAAA',
    'file:///tmp/logo.png',
    'C:\\temp\\logo.png',
  ])('blocks non-local or escaping path %s', async (source) => {
    const root = await createTemporaryDirectory()

    await expectAssetError(
      loadPdfImageAsset(source, { roots: [root] }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
  })

  it('blocks a symlink whose real path escapes the configured root', async () => {
    const directory = await createTemporaryDirectory()
    const root = join(directory, 'root')
    const outside = join(directory, 'outside.png')
    await mkdir(root)
    await writeFile(outside, PNG)
    await symlink(outside, join(root, 'escape.png'))

    const promise = loadPdfImageAsset('escape.png', { roots: [root] })

    await expectAssetError(promise, PDF_ASSET_ERROR_CODES.Blocked)
    await expect(promise).rejects.not.toThrow(directory)
  })

  it('checks size before accepting local bytes', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'large.png'), PNG)

    await expectAssetError(
      loadPdfImageAsset('large.png', {
        roots: [root],
        maxBytes: PNG.byteLength - 1,
      }),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
  })

  it('rejects misleading extensions and signatures', async () => {
    const root = await createTemporaryDirectory()
    await writeFile(join(root, 'not-a-jpeg.jpg'), PNG)
    await writeFile(join(root, 'not-an-image.png'), Buffer.from('not an image'))

    await expectAssetError(
      loadPdfImageAsset('not-a-jpeg.jpg', { roots: [root] }),
      PDF_ASSET_ERROR_CODES.Invalid,
    )
    await expectAssetError(
      loadPdfImageAsset('not-an-image.png', { roots: [root] }),
      PDF_ASSET_ERROR_CODES.Invalid,
    )
  })

  it('rejects truncated and header-valid but structurally invalid images', async () => {
    const root = await createTemporaryDirectory()
    const pngWithoutImageData = Buffer.concat([
      PNG.subarray(0, 33),
      PNG.subarray(PNG.byteLength - 12),
    ])
    await writeFile(join(root, 'truncated.png'), PNG.subarray(0, -1))
    await writeFile(join(root, 'empty.png'), pngWithoutImageData)
    await writeFile(join(root, 'truncated.jpg'), JPEG.subarray(0, -2))

    for (const file of ['truncated.png', 'empty.png', 'truncated.jpg']) {
      await expectAssetError(
        loadPdfImageAsset(file, { roots: [root] }),
        PDF_ASSET_ERROR_CODES.Invalid,
      )
    }
  })
})

describe('PDF image tree resolution', () => {
  it('resolves bundled paths and byte sources without creating another tree', async () => {
    const images = [
      image({ src: './images/logo.png' }),
      image({ src: { uri: 'images/photo.jpeg', format: 'jpeg' } }),
      image({ src: new Uint8Array(PNG) }),
      image({
        src: {
          data: JPEG.buffer.slice(
            JPEG.byteOffset,
            JPEG.byteOffset + JPEG.byteLength,
          ),
          format: 'jpg',
        },
      }),
    ]
    const document = documentWith(...images)
    const assets: PdfImageAssetMap = Object.freeze({
      'images/logo.png': Object.freeze({ dataB64: PNG.toString('base64'), format: 'png' }),
      'images/photo.jpeg': Object.freeze({ dataB64: JPEG.toString('base64'), format: 'jpg' }),
    })

    const resolved = await resolvePdfImageAssets(document, { assets })

    expect(resolved).toBe(document)
    expect(images.map(node =>
      Buffer.isBuffer(node.props.src),
    )).toEqual([true, true, true, true])
    expect(images.map(node =>
      Buffer.from(node.props.src as Uint8Array),
    )).toEqual([PNG, JPEG, PNG, JPEG])
  })

  it('resolves disk-root entries and picks up edited files without a restart', async () => {
    const root = await createTemporaryDirectory()
    const imagesDirectory = join(root, 'images')
    await mkdir(imagesDirectory, { recursive: true })
    const logoPath = join(imagesDirectory, 'logo.png')
    await writeFile(logoPath, PNG)

    const assets: PdfImageAssetMap = Object.freeze({
      'images/logo.png': Object.freeze({ format: 'png', root }),
    })

    const first = image({ src: 'images/logo.png' })
    await resolvePdfImageAssets(documentWith(first), { assets })
    expect(Buffer.from(first.props.src as Uint8Array)).toEqual(PNG)

    // Edit the file on disk: the next render must observe the new bytes.
    await writeFile(logoPath, JPEG.subarray(0, 2) /* invalid on purpose */)
    await expect(resolvePdfImageAssets(documentWith(image({ src: 'images/logo.png' })), { assets }))
      .rejects.toMatchObject({ code: PDF_ASSET_ERROR_CODES.Invalid })

    await writeFile(logoPath, PNG)
    const third = image({ src: 'images/logo.png' })
    await resolvePdfImageAssets(documentWith(third), { assets })
    expect(Buffer.from(third.props.src as Uint8Array)).toEqual(PNG)
  })

  it('shares repeated image buffers within one render but isolates renders', async () => {
    const assets: PdfImageAssetMap = Object.freeze({
      'images/logo.png': Object.freeze({ dataB64: PNG.toString('base64'), format: 'png' }),
    })
    const firstImages = [
      image({ src: 'images/logo.png' }),
      image({ src: 'images/logo.png' }),
    ]
    const secondImages = [
      image({ src: 'images/logo.png' }),
      image({ src: 'images/logo.png' }),
    ]

    await Promise.all([
      resolvePdfImageAssets(documentWith(...firstImages), { assets }),
      resolvePdfImageAssets(documentWith(...secondImages), { assets }),
    ])

    const first = firstImages[0]!.props.src
    const repeatedFirst = firstImages[1]!.props.src
    const second = secondImages[0]!.props.src
    const repeatedSecond = secondImages[1]!.props.src

    expect(Buffer.isBuffer(first)).toBe(true)
    expect(first).toBe(repeatedFirst)
    expect(second).toBe(repeatedSecond)
    expect(second).not.toBe(first)
    expect(first).not.toBe(PNG)
    expect(second).not.toBe(PNG)
  })

  it('charges a repeated named source once against aggregate budgets', async () => {
    const assets: PdfImageAssetMap = Object.freeze({
      'images/logo.png': Object.freeze({ dataB64: PNG.toString('base64'), format: 'png' }),
    })
    const images = [
      image({ src: 'images/logo.png' }),
      image({ src: 'images/logo.png' }),
    ]

    await expect(resolvePdfImageAssets(documentWith(...images), {
      assets,
      limits: imageLimits({
        maxTotalImageBytes: PNG.byteLength,
        maxTotalImagePixels: 1,
      }),
    })).resolves.toBeDefined()
  })

  it.each([
    'https://example.com/image.png',
    'data:image/png;base64,AAAA',
    '/absolute/image.png',
    '../escape.png',
    { uri: 'https://example.com/image.png' },
    { uri: 'images/logo.png', headers: { authorization: 'secret' } },
    () => PNG,
    Promise.resolve(PNG),
  ])('blocks fetch-capable image source %#', async (source) => {
    const document = documentWith(image({ src: source }))

    await expectAssetError(
      resolvePdfImageAssets(document, { assets: {} }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
  })

  it('blocks srcSet so layout cannot select an unresolved URL', async () => {
    const document = documentWith(image({
      src: 'images/logo.png',
      srcSet: 'https://example.com/logo.png 2x',
    }))

    await expectAssetError(
      resolvePdfImageAssets(document, {
        assets: { 'images/logo.png': { dataB64: PNG.toString('base64'), format: 'png' } },
      }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
  })

  it('revalidates generated assets and direct-byte limits', async () => {
    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: 'images/logo.png' })),
        {
          assets: { 'images/logo.png': { dataB64: JPEG.toString('base64'), format: 'png' } },
        },
      ),
      PDF_ASSET_ERROR_CODES.Invalid,
    )

    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: PNG })),
        {
          assets: {},
          limits: imageLimits({
            maxImageBytes: PNG.byteLength - 1,
          }),
        },
      ),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
  })

  it('fails atomically when a later image is blocked', async () => {
    const first = image({ src: 'images/logo.png' })
    const document = documentWith(
      first,
      image({ src: 'https://example.com/image.png' }),
    )

    await expectAssetError(
      resolvePdfImageAssets(document, {
        assets: { 'images/logo.png': { dataB64: PNG.toString('base64'), format: 'png' } },
      }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
    expect(first.props.src).toBe('images/logo.png')
  })

  it('enforces image count, aggregate bytes, and decoded pixel budgets', async () => {
    const twoImages = () => documentWith(
      image({ src: Buffer.from(PNG) }),
      image({ src: Buffer.from(PNG) }),
    )

    await expectAssetError(
      resolvePdfImageAssets(twoImages(), {
        assets: {},
        limits: imageLimits({ maxImages: 1 }),
      }),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
    await expectAssetError(
      resolvePdfImageAssets(twoImages(), {
        assets: {},
        limits: imageLimits({
          maxTotalImageBytes: PNG.byteLength * 2 - 1,
        }),
      }),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
    await expectAssetError(
      resolvePdfImageAssets(twoImages(), {
        assets: {},
        limits: imageLimits({ maxTotalImagePixels: 1 }),
      }),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
  })

  it('rejects oversized decoded dimensions before layout', async () => {
    const oversized = Buffer.from(PNG)
    oversized.writeUInt32BE(10_000, 16)
    oversized.writeUInt32BE(10_000, 20)

    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({ src: oversized })), {
        assets: {},
        limits: imageLimits({ maxImagePixels: 25_000_000 }),
      }),
      PDF_ASSET_ERROR_CODES.LimitExceeded,
    )
  })

  it('rejects missing generated assets and ambiguous image props', async () => {
    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: 'images/missing.png' })),
        { assets: {} },
      ),
      PDF_ASSET_ERROR_CODES.Invalid,
    )

    await expectAssetError(
      resolvePdfImageAssets(documentWith(image({} as never)), {
        assets: {},
      }),
      PDF_ASSET_ERROR_CODES.Invalid,
    )
  })
})
