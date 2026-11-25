import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
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
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { DocumentNode } from '../src/runtime/server/engine/layout/index'
import { PDF_PRIMITIVES } from '../src/runtime/primitives'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundlePdfFonts,
  DEFAULT_MAX_PDF_FONT_BYTES,
} from '../src/build/fonts'
import { renderDocument } from './engine-render'
import { parsePdf, rasterizePdf } from '../src/test/pdf'
import { embeddedTrueTypeFonts } from './font-programs'
import { createPdfFontStore, fontStoreOf } from '../src/runtime/server/engine/fonts'
import { layoutParagraphs } from '../src/runtime/server/engine/text'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { WIN_ANSI } from '../src/runtime/shared/win-ansi'
import { standardFont, type StandardFontName } from '../src/runtime/server/engine/standard-fonts'

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
  type: PDF_PRIMITIVES.Document,
  props: {},
  children: [
    {
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 32 },
      props: { size: 'A4' },
      children: [
        {
          type: PDF_PRIMITIVES.Text,
          box: {},
          style: { fontFamily: family, fontSize: 16 },
          props: {},
          children: [
            { type: PDF_PRIMITIVES.TextInstance, value: 'Embedded font proof' },
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

  // Catches the two builds drifting apart again: the Nuxt module skipped a
  // layer without pdfs/fonts and the standalone build failed on it, and each
  // named a missing directory in its own words.
  it('skips a layer without pdfs/fonts and resolves the font in the next one', async () => {
    const missingRoot = join(dirname(await createFontRoot()), 'missing/pdfs/fonts')
    const fontRoot = await createFontRoot()
    await installFixtureFont(fontRoot)

    const [descriptor] = await bundlePdfFonts([{ family: 'Layer Font', src: 'Roboto-Regular.ttf' }], {
      fontRoots: [missingRoot, fontRoot],
    })

    expect(descriptor!.family).toBe('Layer Font')
  })

  it.each([
    ['is missing', async (_root: string) => {}],
    ['is a file', async (root: string) => writeFile(root, '')],
  ])('names where to put the fonts when pdfs/fonts %s', async (_name, create) => {
    const parent = dirname(await createFontRoot())
    await rm(join(parent, 'fonts'), { recursive: true })
    const root = join(parent, 'fonts')
    await create(root)

    await expect(bundlePdfFonts([{ family: 'Brand', src: 'brand.ttf' }], { fontRoots: [root] })).rejects.toThrow(
      `PDF fonts are declared, but there is no pdfs/fonts directory. Put the font files in "${root}".`,
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

  // Catches: a render that parses the font file again (each render decoded and
  // parsed every font, 50 to 160 ms per document with three custom weights),
  // and a font object built from the shared data that paints wrong glyphs in
  // a later render. Each render keeps its own font object (#83).
  it.each([
    ['TTF', fixtureFont, 'ttf'],
    ['TTF-flavoured WOFF2', fixtureTrueTypeWoff2Font, 'woff2'],
    ['OTF-flavoured WOFF2', fixtureOpenTypeWoff2Font, 'woff2'],
  ])('shares the parsed %s font data between renders', async (_, fixture, format) => {
    const src = `data:font/${format};base64,${(await readFile(fixture)).toString('base64')}` as PdfFontDataUrl
    const descriptors = [{ family: 'Shared Data', src, fontStyle: 'normal', fontWeight: 400 }] as const
    const texts: string[] = []
    const fonts: unknown[] = []
    for (let render = 0; render < 2; render += 1) {
      const fontStore = createPdfFontStore(descriptors)
      const result = await renderDocument(createFontDocument('Shared Data'), { fontStore })
      texts.push((await parsePdf(result.bytes)).pages[0]!.text)
      fonts.push(fontStoreOf(fontStore).getFont({ fontFamily: 'Shared Data' }).data)
    }
    const [first, second] = fonts as { head: object }[]

    expect(texts).toEqual(['Embedded font proof', 'Embedded font proof'])
    expect(second).not.toBe(first)
    expect(second!.head).toBe(first!.head)
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
    await copyFile(resolve('node_modules/source-code-pro/VF/SourceCodeVF-Upright.otf'), join(fontRoot, 'variable.otf'))

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
    // Accepted before and failed in the render with an untyped TypeError.
    await expect(bundlePdfFonts(
      [{ family: 'Variable CFF2', src: 'variable.otf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('Invalid PDF font "variable.otf": CFF2 variable fonts are not supported. Use the TrueType variable font (.ttf) or one static .otf file per weight.')
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
    // The WOFF2 decoder's error, thrown as the documented TypeError.
    const truncated = bundlePdfFonts(
      [{ family: 'Truncated WOFF2', src: 'font.woff2' }],
      { fontRoots: [fontRoot] },
    )
    await expect(truncated).rejects.toBeInstanceOf(TypeError)
    await expect(truncated).rejects.toThrow('Invalid PDF font "font.woff2": the WOFF2 header is corrupt or truncated.')
    await expect(bundlePdfFonts(
      [{ family: 'Directory', src: 'directory.ttf' }],
      { fontRoots: [fontRoot] },
    )).rejects.toThrow('must be a regular file')

    expect(DEFAULT_MAX_PDF_FONT_BYTES).toBe(5 * 1024 * 1024)
  })

  // Catches a header read past the end of a short file: Node's raw
  // RangeError, without the font name, instead of "Invalid PDF font".
  it.each([
    ['ttf', fixtureFont],
    ['otf', fixtureOpenTypeFont],
    ['woff2', fixtureTrueTypeWoff2Font],
  ])('rejects a truncated .%s file with its name at every header length', async (extension, fixture) => {
    const fontRoot = await createFontRoot()
    const bytes = await readFile(fixture)
    for (const length of [0, 5, 11, 12, 100]) {
      const name = `truncated-${length}.${extension}`
      await writeFile(join(fontRoot, name), bytes.subarray(0, length))
      const error = await bundlePdfFonts([{ family: 'Truncated', src: name }], { fontRoots: [fontRoot] })
        .then(() => undefined, (cause: unknown) => cause)
      expect(error, name).toBeInstanceOf(TypeError)
      expect((error as Error).message, name).toMatch(new RegExp(`^Invalid PDF font "${name}": `))
    }
  })

  // Catches a font whose cmap names glyphs it does not have: it passed the
  // build, and every render then failed in the PDF writer without its name.
  it.each([0, 2])('rejects a font whose cmap names glyphs beyond its %i glyphs', async (numGlyphs) => {
    const fontRoot = await createFontRoot()
    const bytes = Buffer.from(await readFile(fixtureFont))
    const tables = bytes.readUInt16BE(4)
    const maxp = Array.from({ length: tables }, (_, index) => 12 + index * 16)
      .find(record => bytes.toString('latin1', record, record + 4) === 'maxp')!
    bytes.writeUInt16BE(numGlyphs, bytes.readUInt32BE(maxp + 8) + 4)
    await writeFile(join(fontRoot, 'few-glyphs.ttf'), bytes)

    await expect(bundlePdfFonts([{ family: 'Few', src: 'few-glyphs.ttf' }], { fontRoots: [fontRoot] }))
      .rejects.toThrow(new RegExp(`^Invalid PDF font "few-glyphs\\.ttf": the cmap table maps U\\+[0-9A-F]{4,6} to glyph \\d+, but the font has ${numGlyphs} glyphs\\.$`))
  })

  // Catches a required table left out of the check: the cmap read that
  // follows it fails with Node's raw TypeError, without the font name.
  it.each([
    { extension: 'ttf', fixture: fixtureFont, tag: 'head' },
    { extension: 'ttf', fixture: fixtureFont, tag: 'maxp' },
    { extension: 'ttf', fixture: fixtureFont, tag: 'cmap' },
    { extension: 'ttf', fixture: fixtureFont, tag: 'glyf' },
    { extension: 'otf', fixture: fixtureOpenTypeFont, tag: 'CFF ' },
  ])('rejects a $extension font without its $tag table', async ({ extension, fixture, tag }) => {
    const fontRoot = await createFontRoot()
    const bytes = Buffer.from(await readFile(fixture))
    const record = Array.from({ length: bytes.readUInt16BE(4) }, (_, index) => 12 + index * 16)
      .find(position => bytes.toString('latin1', position, position + 4) === tag)!
    bytes.write('zzzz', record, 'latin1')
    await writeFile(join(fontRoot, `renamed.${extension}`), bytes)

    await expect(bundlePdfFonts([{ family: 'Renamed', src: `renamed.${extension}` }], { fontRoots: [fontRoot] }))
      .rejects.toThrow(`Invalid PDF font "renamed.${extension}": the font is missing required SFNT tables.`)
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
    // A standard face is a family of its own name too.
    for (const family of ['Helvetica', 'Times-Bold']) {
      await expect(bundlePdfFonts([
        { family, src: 'Roboto-Regular.ttf' },
      ], { fontRoots: [fontRoot] })).rejects.toThrow(
        `family "${family}" is reserved by a standard PDF font.`,
      )
    }
    // A weight name that is an object key is no weight.
    const objectKeyWeight = { family: 'Roboto', src: 'Roboto-Regular.ttf', fontWeight: 'normal' as const }
    Reflect.set(objectKeyWeight, 'fontWeight', 'constructor')
    await expect(bundlePdfFonts([objectKeyWeight], { fontRoots: [fontRoot] })).rejects.toThrow(
      'unsupported fontWeight "constructor".',
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

// Catches: a regenerated metrics file or a change to `encode` that moves text
// in a standard font. Only Helvetica appears in the byte-pinned documents
// (pdfa.test.ts, tagged.test.ts); no other test lays out Times or Courier.
// A weight of a variable font paints that `wght` instance
// (instance-subset.ts); before, every weight painted the default instance
// (ExtraLight for Source Code VF). Source Code Pro is monospaced, so its
// advances are equal at every weight and the outlines show the weight.
describe('variable font weights', () => {
  const VARIABLE = resolve('node_modules/source-code-pro/VF/SourceCodeVF-Upright.ttf')
  const TEXT = 'Weight ABC xyz 0123'

  const textDocument = (family: string, fontWeight?: number): DocumentNode => ({
    type: PDF_PRIMITIVES.Document,
    props: { creationDate: new Date(Date.UTC(2026, 10, 2)) },
    children: [{
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 10 },
      props: { size: [300, 50] },
      children: [{ type: PDF_PRIMITIVES.Text, box: {}, style: { fontFamily: family, fontWeight, fontSize: 20 }, props: {}, children: [{ type: PDF_PRIMITIVES.TextInstance, value: TEXT }] }],
    }],
  } as DocumentNode)

  /** The mean channel difference of two equal-size pictures. */
  const distance = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let sum = 0
    for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index]! - b[index]!)
    return sum / a.length
  }

  // Catches a weight outside the axis painted as the end of the range: a
  // template that asks for a face the file cannot paint fails instead.
  it('paints each weight inside the axis with its instance, and fails outside it', async () => {
    const fontRoot = await createFontRoot()
    await copyFile(VARIABLE, join(fontRoot, 'SourceCodeVF-Upright.ttf'))
    for (const name of ['Regular', 'Bold', 'ExtraLight', 'Black']) await copyFile(resolve(`node_modules/source-code-pro/TTF/SourceCodePro-${name}.ttf`), join(fontRoot, `${name}.ttf`))
    const fonts = await bundlePdfFonts([
      { family: 'VF', src: './SourceCodeVF-Upright.ttf', fontWeight: 400 },
      ...['Regular', 'Bold'].map(name => ({ family: name, src: `./${name}.ttf` })),
    ], { fontRoots: [fontRoot] })
    // One store per render, as the render worker makes it (worker-entry.ts).
    const render = async (family: string, fontWeight?: number) => (await renderDocument(textDocument(family, fontWeight), { fontStore: createPdfFontStore(fonts) })).bytes
    const pixels = async (bytes: Uint8Array) => (await rasterizePdf(bytes, { scale: 2 }))[0]!.pixels
    /** The width of the embedded A's box, in font units. */
    const widthOfA = (bytes: Uint8Array) => {
      const [embedded] = embeddedTrueTypeFonts(bytes)
      const id = [...embedded!.text].find(([, text]) => text === 'A')![0]
      const { minX, maxX } = embedded!.font.getGlyph(id).cbox
      return maxX - minX
    }

    const vf400 = await render('VF', 400)
    const vf700 = await render('VF', 700)
    const [p400, p700, pRegular, pBold] = [await pixels(vf400), await pixels(vf700), await pixels(await render('Regular')), await pixels(await render('Bold'))]
    expect(distance(p400, pRegular)).toBeLessThan(distance(p400, p700) / 4)
    expect(distance(p700, pBold)).toBeLessThan(distance(p700, p400) / 4)
    expect([widthOfA(vf400), widthOfA(vf700)]).toEqual([536, 582])
    // Below and above the axis (200 to 900), no face paints the weight.
    for (const fontWeight of [100, 1000]) {
      await expect(render('VF', fontWeight)).rejects.toMatchObject({
        code: 'PDF_LAYOUT_ERROR',
        message: `<PdfText> asks for VF in fontStyle normal, fontWeight ${fontWeight}, but VF has no normal face of weight ${fontWeight} (registered: normal 200 to 900). Register the normal ${fontWeight} face of VF in \`pdf.fonts\`, or use a registered weight.`,
      })
    }
    expect((await parsePdf(vf700)).pages[0]!.text).toContain(TEXT)
    expect(Buffer.from(await render('VF', 700)).equals(Buffer.from(vf700))).toBe(true)
  }, 60_000)

  // Inter Variable is proportional, so its advances change with the weight.
  // The reference is fontkit's own instance of the file. Catches the
  // realistic wrong instance: the default master's advances (400) with the
  // instance's outlines, in the layout, in the embedded `hmtx`, or in the `W`
  // widths a PDF reader measures with.
  const INTER = resolve('test/fixtures/fonts/variable/InterVariable.ttf')
  // fontkit 2.0 ships no types.
  const fontkit = createRequire(import.meta.url)('fontkit') as {
    openSync: (path: string) => {
      unitsPerEm: number
      getVariation: (settings: Record<string, number>) => {
        layout: (text: string) => { advanceWidth: number }
        glyphForCodePoint: (codePoint: number) => { advanceWidth: number, cbox: { minX: number, maxX: number } }
      }
    }
  }
  // Renders take one store each, as the render worker makes them (worker-entry.ts).
  const interFonts = async (weights: readonly number[]) => {
    const fontRoot = await createFontRoot()
    await copyFile(INTER, join(fontRoot, 'InterVariable.ttf'))
    return bundlePdfFonts(weights.map(fontWeight => ({ family: 'Inter', src: './InterVariable.ttf', fontWeight })), { fontRoots: [fontRoot] })
  }

  it('lays out, embeds and reads each weight of a proportional variable font with that instance\'s advances', async () => {
    const fonts = await interFonts([400, 700])
    const store = fontStoreOf(createPdfFontStore(fonts))
    const inter = fontkit.openSync(INTER)
    const widths: number[] = []
    for (const fontWeight of [400, 700]) {
      const instance = inter.getVariation({ wght: fontWeight })
      const expected = instance.layout(TEXT).advanceWidth * 20 / inter.unitsPerEm
      await store.load({ fontFamily: 'Inter', fontWeight })
      const font = store.getFont({ fontFamily: 'Inter', fontWeight }).data!
      const style = { fonts: [font], fontSize: 20, color: 'black', underline: false, strike: false, underlineColor: 'black', strikeColor: 'black' }
      const [line, ...rest] = layoutParagraphs([{ string: TEXT, style }], { x: 0, y: 0, width: 500, height: Infinity }, { hyphenate: false })
      expect(rest).toEqual([])
      expect(line!.xAdvance, `layout at ${fontWeight}`).toBeCloseTo(expected, 6)
      widths.push(line!.xAdvance)

      const { bytes } = await renderDocument(textDocument('Inter', fontWeight), { fontStore: createPdfFontStore(fonts) })
      const [embedded] = embeddedTrueTypeFonts(bytes)
      const used = [...embedded!.text].filter(([id, text]) => id > 0 && text.trim() !== '')
      expect(used.length).toBeGreaterThan(10)
      for (const [id, text] of used) {
        expect(embedded!.font.getGlyph(id).advanceWidth, `hmtx of ${text} at ${fontWeight}`).toBe(Math.round(instance.glyphForCodePoint(text.codePointAt(0)!).advanceWidth))
      }
      const runs = (await parsePdf(bytes)).pages[0]!.textRuns
      const read = Math.max(...runs.map(run => run.x + run.width)) - Math.min(...runs.map(run => run.x))
      expect(read, `pdf.js width at ${fontWeight}`).toBeCloseTo(expected, 2)
    }
    // 202.7 pt and 209.4 pt: the two weights do not share advances.
    expect(widths[1]! - widths[0]!).toBeGreaterThan(6)
  }, 60_000)

  it('fails at a registered weight outside the axis, and gives an instance the default optical size', async () => {
    const fonts = await interFonts([50, 700])
    const render = async (fontWeight: number) => Buffer.from((await renderDocument(textDocument('Inter', fontWeight), { fontStore: createPdfFontStore(fonts) })).bytes)
    // Catches a registered weight that the axis (100 to 900) does not hold
    // painted as the end of the range.
    await expect(render(50)).rejects.toMatchObject({ code: 'PDF_LAYOUT_ERROR', message: expect.stringContaining('but Inter has no normal face of weight 50 (registered: normal 100 to 900)') })
    // `opsz` (14 to 32) stays at its default, 14: the embedded A at 700 is
    // fontkit's instance at wght 700 and opsz 14, not at opsz 32. Catches an
    // instance that sets the second axis too, or reads it from the font size.
    const inter = fontkit.openSync(INTER)
    const [embedded] = embeddedTrueTypeFonts(await render(700))
    const id = [...embedded!.text].find(([, text]) => text === 'A')![0]
    const { minX, maxX } = embedded!.font.getGlyph(id).cbox
    const widthAt = (opsz: number) => {
      const { cbox } = inter.getVariation({ wght: 700, opsz }).glyphForCodePoint(65)
      return Math.round(cbox.maxX) - Math.round(cbox.minX)
    }
    expect([maxX - minX, widthAt(14), widthAt(32)]).toEqual([1431, 1431, 1442])
  }, 60_000)
})

// pdfkit kept one font object per PostScript name, so a second font file of
// the same name painted its text with the first file's glyphs.
describe('two fonts with one PostScript name', () => {
  /** The same name (14 characters) in the Mac (ASCII) and Windows (UTF-16BE) name records. */
  const renamed = (bytes: Buffer, from: string, to: string): Buffer => {
    let result = bytes
    for (const encode of [(text: string) => Buffer.from(text, 'latin1'), (text: string) => Buffer.from(text, 'utf16le').swap16()]) {
      const [needle, replacement] = [encode(from), encode(to)]
      for (let at = result.indexOf(needle); at !== -1; at = result.indexOf(needle, at + 1)) {
        result = Buffer.concat([result.subarray(0, at), replacement, result.subarray(at + needle.length)])
      }
    }
    return result
  }

  const lines = (second: string): DocumentNode => ({
    type: PDF_PRIMITIVES.Document,
    props: { creationDate: new Date(Date.UTC(2026, 10, 2)) },
    children: [{
      type: PDF_PRIMITIVES.Page,
      box: {},
      style: { padding: 10 },
      props: { size: [320, 80] },
      children: [['Roboto', 'Roboto: the quick brown fox'], [second, 'Inter: invoice total 1.234,56']].map(([fontFamily, value]) => ({
        type: PDF_PRIMITIVES.Text, box: {}, style: { fontFamily, fontSize: 16 }, props: {}, children: [{ type: PDF_PRIMITIVES.TextInstance, value }],
      })),
    }],
  } as DocumentNode)

  it('paints each file with its own glyphs', async () => {
    const fontRoot = await createFontRoot()
    const inter = await readFile(resolve('playground/pdfs/fonts/Inter-600.ttf'))
    const sameName = renamed(inter, 'Inter-SemiBold', 'Roboto-Regular')
    expect(sameName.equals(inter)).toBe(false)
    await copyFile(fixtureFont, join(fontRoot, 'Roboto-Regular.ttf'))
    await writeFile(join(fontRoot, 'Inter.ttf'), inter)
    await writeFile(join(fontRoot, 'Inter-Renamed.ttf'), sameName)
    const fonts = await bundlePdfFonts([
      { family: 'Roboto', src: './Roboto-Regular.ttf' },
      { family: 'Inter', src: './Inter.ttf' },
      { family: 'Inter Renamed', src: './Inter-Renamed.ttf' },
    ], { fontRoots: [fontRoot] })
    // One store per render, as the render worker makes it (worker-entry.ts).
    const pixels = async (family: string) => (await rasterizePdf((await renderDocument(lines(family), { fontStore: createPdfFontStore(fonts) })).bytes, { scale: 2 }))[0]!.pixels

    expect(Buffer.from(await pixels('Inter Renamed')).equals(Buffer.from(await pixels('Inter')))).toBe(true)
  }, 30_000)
})

// The obliques measure as their uprights, and the four Couriers alike.
// The digests were taken when `@react-pdf/font`'s `StandardFont` measured
// every code unit and pair the same (test/standard-fonts.test.ts, removed
// with that package).
describe('standard font metrics', () => {
  const units = [...Array.from({ length: 256 }, (_, unit) => unit), ...WIN_ANSI.keys(), 0x4E2D, 0xAD]
  const everyPair = units.flatMap(left => units.map(right => String.fromCharCode(left, right))).join('')
  const digest = (name: StandardFontName) => {
    const font = standardFont(name)
    const measured = [font.ascent, font.descent, font.lineGap, font.unitsPerEm, font.encode(everyPair), units.map(unit => font.hasGlyphForCodePoint(unit))]
    return createHash('sha256').update(JSON.stringify(measured)).digest('hex').slice(0, 16)
  }

  it.each([
    ['Courier', 'fd2d6721f39bc180'],
    ['Courier-Bold', 'fd2d6721f39bc180'],
    ['Courier-Oblique', 'fd2d6721f39bc180'],
    ['Courier-BoldOblique', 'fd2d6721f39bc180'],
    ['Helvetica', '631ae374c2a586c0'],
    ['Helvetica-Bold', '05b56aa33f5ee249'],
    ['Helvetica-Oblique', '631ae374c2a586c0'],
    ['Helvetica-BoldOblique', '05b56aa33f5ee249'],
    ['Times-Roman', '1422e9075065fa5a'],
    ['Times-Bold', '6dc36f385f0e4222'],
    ['Times-Italic', '6c76d235f831581e'],
    ['Times-BoldItalic', '836fcf7c8f19c8a4'],
  ] as const)('%s measures every code and pair as pinned', (name, expected) => {
    expect(digest(name)).toBe(expected)
  })
})

describe('tabular figures', () => {
  // Inter's digits are proportional ('1' is 833 units, '4' 1323); its `tnum`
  // feature gives each 1328. Catches the key lost on the way from the style
  // to fontkit: in inheritance from the view, in the text's style or in the
  // run's shaping. pdf.js reads the widths the embedded glyphs give.
  it('gives every digit the same advance with fontVariantNumeric tabular-nums, inherited from a view', async () => {
    const fontRoot = await createFontRoot()
    await copyFile(resolve('playground/pdfs/fonts/Inter-400.ttf'), join(fontRoot, 'Inter.ttf'))
    const fonts = await bundlePdfFonts([{ family: 'Inter', src: './Inter.ttf' }], { fontRoots: [fontRoot] })
    const widths = async (fontVariantNumeric?: 'tabular-nums') => {
      const document = {
        type: PDF_PRIMITIVES.Document,
        props: { creationDate: new Date(Date.UTC(2026, 10, 25)) },
        children: [{
          type: PDF_PRIMITIVES.Page,
          box: {},
          style: { padding: 10 },
          props: { size: [200, 100] },
          children: [{
            type: PDF_PRIMITIVES.View,
            box: {},
            style: { fontVariantNumeric },
            props: {},
            children: ['1111', '4444'].map(value => ({ type: PDF_PRIMITIVES.Text, box: {}, style: { fontFamily: 'Inter', fontSize: 10 }, props: {}, children: [{ type: PDF_PRIMITIVES.TextInstance, value }] })),
          }],
        }],
      } as DocumentNode
      const { bytes } = await renderDocument(document, { fontStore: createPdfFontStore(fonts) })
      return (await parsePdf(bytes)).pages[0]!.textRuns.map(run => Math.round(run.width * 100) / 100)
    }
    expect(await widths()).toEqual([16.27, 25.84])
    expect(await widths('tabular-nums')).toEqual([25.94, 25.94])
  }, 60_000)
})
