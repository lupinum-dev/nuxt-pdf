import { Buffer } from 'node:buffer'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { DocumentNode } from '@react-pdf/layout'
import * as P from '@react-pdf/primitives'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundlePdfFonts,
  DEFAULT_MAX_PDF_FONT_BYTES,
} from '../src/build/fonts'
import { renderDocument } from '../src/runtime/server/engine/render-document'
import { createPdfFontStore } from '../src/runtime/server/engine/fonts'
import type { PdfFontDataUrl } from '../src/runtime/fonts'

const fixtureFont = resolve('test/fixtures/assets/Roboto-Regular.ttf')
const fixtureOpenTypeFont = resolve(
  'node_modules/source-code-pro/OTF/SourceCodePro-Regular.otf',
)
const fixtureLayerFont = resolve(
  'node_modules/source-code-pro/TTF/SourceCodePro-Regular.ttf',
)
const fixtureTrueTypeWoff2Font = resolve(
  'node_modules/source-code-pro/WOFF2/TTF/SourceCodePro-Regular.ttf.woff2',
)
const fixtureOpenTypeWoff2Font = resolve(
  'node_modules/source-code-pro/WOFF2/OTF/SourceCodePro-Regular.otf.woff2',
)
const temporaryDirectories: string[] = []

const createFontRoot = async (): Promise<string> => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-fonts-'))
  temporaryDirectories.push(temporaryRoot)
  const fontRoot = join(temporaryRoot, 'pdfs/fonts')
  await mkdir(fontRoot, { recursive: true })
  return fontRoot
}

const installFixtureFont = async (
  fontRoot: string,
  name = 'Roboto-Regular.ttf',
): Promise<string> => {
  const target = join(fontRoot, name)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(fixtureFont, target)
  return target
}

const createFontDocument = (family: string): DocumentNode => ({
  type: P.Document,
  props: {},
  children: [
    {
      type: P.Page,
      box: {},
      style: { padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: P.Text,
          box: {},
          style: { fontFamily: family, fontSize: 16 },
          props: {},
          children: [
            { type: P.TextInstance, value: 'Embedded font proof' },
          ],
        },
      ],
    },
  ],
} as DocumentNode)

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { force: true, recursive: true }),
  ))
})

describe('local PDF fonts', () => {
  it('resolves matching layer font paths from the project-first root order', async () => {
    const projectRoot = await createFontRoot()
    const baseRoot = await createFontRoot()
    await copyFile(fixtureFont, join(projectRoot, 'Shared.ttf'))
    await copyFile(fixtureLayerFont, join(baseRoot, 'Shared.ttf'))

    const [descriptor] = await bundlePdfFonts([{
      family: 'Layered Font',
      src: 'Shared.ttf',
    }], { fontRoots: [projectRoot, baseRoot] })
    const projectBytes = await readFile(join(projectRoot, 'Shared.ttf'))

    expect(Buffer.from(descriptor!.src.split(',')[1]!, 'base64')).toEqual(
      projectBytes,
    )
  })

  it('embeds a validated TTF and renders without reading the source tree', async () => {
    const fontRoot = await createFontRoot()
    const fontPath = await installFixtureFont(fontRoot)
    const descriptors = await bundlePdfFonts([
      {
        family: 'Bundled Roboto',
        src: './Roboto-Regular.ttf',
        fontStyle: 'normal',
        fontWeight: 'normal',
      },
    ], { fontRoots: [fontRoot] })
    const originalBytes = await readFile(fontPath)

    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({
      family: 'Bundled Roboto',
      fontStyle: 'normal',
      fontWeight: 400,
      src: expect.stringMatching(/^data:font\/ttf;base64,/),
    })
    expect(descriptors[0]?.src).not.toContain(fontPath)
    expect(Buffer.from(descriptors[0]!.src.split(',')[1]!, 'base64')).toEqual(
      originalBytes,
    )

    await rm(fontPath)
    const result = await renderDocument(createFontDocument('Bundled Roboto'), {
      fontStore: createPdfFontStore(descriptors),
    })

    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')).toBe(
      '%PDF-',
    )
  })

  it('embeds a structurally validated OTF and renders it', async () => {
    const fontRoot = await createFontRoot()
    const target = join(fontRoot, 'SourceCodePro-Regular.otf')
    await copyFile(fixtureOpenTypeFont, target)
    const descriptors = await bundlePdfFonts([{
      family: 'Bundled Source Code',
      src: 'SourceCodePro-Regular.otf',
    }], { fontRoots: [fontRoot] })

    expect(descriptors[0]?.src).toMatch(/^data:font\/otf;base64,/)
    await rm(target)
    const result = await renderDocument(
      createFontDocument('Bundled Source Code'),
      { fontStore: createPdfFontStore(descriptors) },
    )
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it.each([
    ['TTF-flavoured', fixtureTrueTypeWoff2Font],
    ['OTF-flavoured', fixtureOpenTypeWoff2Font],
  ])('embeds and renders a validated %s WOFF2 font', async (_, fixture) => {
    const fontRoot = await createFontRoot()
    const target = join(fontRoot, 'SourceCodePro-Regular.woff2')
    await copyFile(fixture, target)
    const descriptors = await bundlePdfFonts([{
      family: 'Bundled Source Code WOFF2',
      src: 'SourceCodePro-Regular.woff2',
    }], { fontRoots: [fontRoot] })

    expect(descriptors[0]?.src).toMatch(/^data:font\/woff2;base64,/)
    await rm(target)
    const result = await renderDocument(
      createFontDocument('Bundled Source Code WOFF2'),
      { fontStore: createPdfFontStore(descriptors) },
    )
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
  })

  it.each([
    '../Roboto-Regular.ttf',
    '/tmp/Roboto-Regular.ttf',
    'C:\\fonts\\Roboto-Regular.ttf',
    '\\\\server\\share\\Roboto-Regular.ttf',
    'file:///tmp/Roboto-Regular.ttf',
    'https://example.com/Roboto-Regular.ttf',
    'data:font/ttf;base64,AAAA',
  ])('rejects non-local relative source %s', async (src) => {
    const fontRoot = await createFontRoot()

    await expect(bundlePdfFonts(
      [{ family: 'Roboto', src }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow(
      /relative local path|parent path segments|remote fonts are unsupported/,
    )
  })

  it('rejects a symlink that resolves outside the explicit font root', async () => {
    const fontRoot = await createFontRoot()
    const externalRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-external-font-'))
    temporaryDirectories.push(externalRoot)
    const externalFont = await installFixtureFont(externalRoot)
    await symlink(externalFont, join(fontRoot, 'escape.ttf'))

    await expect(bundlePdfFonts(
      [{ family: 'Escaped', src: 'escape.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('resolved path escapes its pdfs/fonts root')
  })

  it('rejects a pdfs/fonts root symlink that escapes its pdfs directory', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-font-project-'))
    const externalRoot = await mkdtemp(join(tmpdir(), 'nuxt-pdf-font-root-'))
    temporaryDirectories.push(projectRoot, externalRoot)
    const pdfsRoot = join(projectRoot, 'pdfs')
    const fontRoot = join(pdfsRoot, 'fonts')
    await mkdir(pdfsRoot, { recursive: true })
    await installFixtureFont(externalRoot)
    await symlink(externalRoot, fontRoot)

    await expect(bundlePdfFonts(
      [{ family: 'Escaped', src: 'Roboto-Regular.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('resolves outside its pdfs directory')
  })

  it('requires a regular, signature-valid TTF, OTF, or WOFF2 within the byte limit', async () => {
    const fontRoot = await createFontRoot()
    await installFixtureFont(fontRoot, 'large.ttf')
    await writeFile(join(fontRoot, 'invalid.ttf'), 'not-a-font!!')
    const openTypeBytes = Buffer.concat([
      Buffer.from('OTTO'),
      Buffer.from([0, 1, 0, 0, 0, 0, 0, 0]),
      Buffer.from('head'),
      Buffer.alloc(4),
      Buffer.from([0, 0, 0, 64, 0, 0, 0, 32]),
    ])
    await writeFile(join(fontRoot, 'corrupt.otf'), openTypeBytes)
    await copyFile(fixtureFont, join(fontRoot, 'mismatch.otf'))
    await writeFile(join(fontRoot, 'collection.ttf'), 'ttcf00000000')
    await writeFile(join(fontRoot, 'font.woff'), 'wOFF00000000')
    await writeFile(join(fontRoot, 'font.woff2'), 'wOF200000000')
    await mkdir(join(fontRoot, 'directory.ttf'))

    await expect(bundlePdfFonts(
      [{ family: 'Large', src: 'large.ttf' }],
      { fontRoots: [fontRoot], maxBytes: 16 },
    )).rejects.toThrow('exceeds the 16-byte limit')
    await expect(bundlePdfFonts(
      [{ family: 'Invalid', src: 'invalid.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('unsupported font signature')
    await expect(bundlePdfFonts(
      [{ family: 'Corrupt', src: 'corrupt.otf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow(/table directory|required SFNT tables/)
    await expect(bundlePdfFonts(
      [{ family: 'Mismatch', src: 'mismatch.otf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('extension does not match')
    await expect(bundlePdfFonts(
      [{ family: 'Collection', src: 'collection.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('unsupported font signature')
    await expect(bundlePdfFonts(
      [{ family: 'WebFont', src: 'font.woff' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('only .ttf, .otf, and .woff2 files are supported')
    await expect(bundlePdfFonts(
      [{ family: 'Truncated WOFF2', src: 'font.woff2' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('WOFF2 header is corrupt or truncated')
    await expect(bundlePdfFonts(
      [{ family: 'Directory', src: 'directory.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('must be a regular file')

    expect(DEFAULT_MAX_PDF_FONT_BYTES).toBe(5 * 1024 * 1024)
  })

  it('rejects ambiguous registrations and non-embedded runtime sources', async () => {
    const fontRoot = await createFontRoot()
    await installFixtureFont(fontRoot)

    await expect(bundlePdfFonts([
      { family: 'Roboto', src: 'Roboto-Regular.ttf' },
      {
        family: 'Roboto',
        src: 'Roboto-Regular.ttf',
        fontStyle: 'normal',
        fontWeight: 400,
      },
    ], { fontRoots: [fontRoot] })).rejects.toThrow(
      'duplicates family "Roboto" with the same style and weight',
    )
    await expect(bundlePdfFonts([
      { family: '__proto__', src: 'Roboto-Regular.ttf' },
    ], { fontRoots: [fontRoot] })).rejects.toThrow('reserved object key')
    await expect(bundlePdfFonts([
      { family: 'Helvetica', src: 'Roboto-Regular.ttf' },
    ], { fontRoots: [fontRoot] })).rejects.toThrow(
      'reserved by a standard PDF font',
    )

    expect(() => createPdfFontStore([{
      family: 'Remote',
      src: 'https://example.com/font.ttf' as PdfFontDataUrl,
    }])).toThrow('must use a validated embedded font source')
  })

  it('requires explicit absolute pdfs/fonts roots', async () => {
    const fontRoot = await createFontRoot()
    const declaration = [{ family: 'Roboto', src: 'Roboto-Regular.ttf' }]

    await expect(bundlePdfFonts(declaration, { fontRoots: [] })).rejects.toThrow(
      'At least one absolute pdfs/fonts root is required',
    )
    await expect(bundlePdfFonts(declaration, {
      fontRoots: [dirname(fontRoot)],
    })).rejects.toThrow('must be an absolute pdfs/fonts directory')
    await expect(bundlePdfFonts([], { fontRoots: [] })).resolves.toEqual([])
  })
})
