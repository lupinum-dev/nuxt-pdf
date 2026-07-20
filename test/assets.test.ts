import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PDF_ASSET_ERROR_CODES,
  loadPdfImageAsset,
  resolvePdfImageAssets,
  type PdfImageAssetMap,
} from '../src/runtime/server/assets/resolve-asset'
import {
  PDF_PRIMITIVES,
  type PdfDocumentNode,
  type PdfElementNode,
} from '../src/runtime/renderer/types'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
  'base64',
)

const JPEG = Buffer.from([
  0xFF,
  0xD8,
  0xFF,
  0xE0,
  0x00,
  0x04,
  0x4A,
  0x46,
  0x49,
  0x46,
  0xFF,
  0xD9,
])

const temporaryDirectories: string[] = []

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
})

describe('PDF image tree resolution', () => {
  it('resolves bundled paths and byte sources without creating another tree', async () => {
    const images = [
      image({ src: './images/logo.png' }),
      image({ source: { uri: 'images/photo.jpeg', format: 'jpeg' } }),
      image({ src: new Uint8Array(PNG) }),
      image({
        source: {
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
      'images/logo.png': Object.freeze({ data: PNG, format: 'png' }),
      'images/photo.jpeg': Object.freeze({ data: JPEG, format: 'jpg' }),
    })

    const resolved = await resolvePdfImageAssets(document, { assets })

    expect(resolved).toBe(document)
    expect(images.map((node) => {
      const source = (node.props.src ?? node.props.source) as {
        data: Uint8Array
        format: string
      }
      return [source.format, Buffer.isBuffer(source.data)]
    })).toEqual([
      ['png', true],
      ['jpg', true],
      ['png', true],
      ['jpg', true],
    ])
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
        assets: { 'images/logo.png': { data: PNG, format: 'png' } },
      }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
  })

  it('revalidates generated assets and direct-byte limits', async () => {
    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: 'images/logo.png' })),
        {
          assets: { 'images/logo.png': { data: JPEG, format: 'png' } },
        },
      ),
      PDF_ASSET_ERROR_CODES.Invalid,
    )

    await expectAssetError(
      resolvePdfImageAssets(
        documentWith(image({ src: PNG })),
        { assets: {}, maxBytes: PNG.byteLength - 1 },
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
        assets: { 'images/logo.png': { data: PNG, format: 'png' } },
      }),
      PDF_ASSET_ERROR_CODES.Blocked,
    )
    expect(first.props.src).toBe('images/logo.png')
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
      resolvePdfImageAssets(
        documentWith(image({ src: PNG, source: PNG })),
        { assets: {} },
      ),
      PDF_ASSET_ERROR_CODES.Invalid,
    )
  })
})
