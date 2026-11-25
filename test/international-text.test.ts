import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { bundlePdfFonts } from '../src/build/fonts'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { ROBOTO } from './fixtures/tagged-document'
import { pdfjsArabicLetters } from './pdfjs-arabic'
import { expectReviewedSnapshot } from './raster'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

const internationalRoot = resolve('test/fixtures/fonts/international')
const baselineRoot = resolve('test/fixtures/baselines/international-text')

const TypographyCalibration = defineComponent({
  name: 'TypographyCalibration',
  setup: () => () => h(PdfDocument, { language: 'en' }, {
    default: () => [
      h(PdfPage, { size: 'A4', style: { padding: 44, hyphens: 'auto' } }, {
        default: () => [
          h(PdfText, { style: { fontFamily: 'Roboto Calibration', fontSize: 18, marginBottom: 14 } }, {
            default: () => 'Typography calibration — 18 pt',
          }),
          h(PdfText, { style: { fontFamily: 'Roboto Calibration', fontSize: 12, lineHeight: 1.4, marginBottom: 10 } }, {
            default: () => 'Latin Extended: Zażółć gęślą jaźń — € 1.234,56',
          }),
          h(PdfText, { style: { fontFamily: 'Roboto Calibration', fontSize: 12, marginBottom: 10 } }, {
            default: () => 'Combining: Cafe\u0301, A\u030Angstro\u0308m',
          }),
          h(PdfText, { style: { fontFamily: 'Roboto Calibration', fontSize: 12, marginBottom: 10 } }, {
            default: () => 'Greek: Ελληνικά — Καλημέρα κόσμε',
          }),
          h(PdfText, { style: { fontFamily: 'Roboto Calibration', fontSize: 12, marginBottom: 10 } }, {
            default: () => 'Cyrillic: Кириллица — Привет мир',
          }),
          h(PdfText, { style: { fontFamily: 'Source Code Variable', fontSize: 12 } }, {
            default: () => 'Variable font: punctuation []{} / 0123456789',
          }),
        ],
      }),
      h(PdfPage, { size: 'A4', style: { padding: 44, hyphens: 'auto' } }, {
        default: () => [
          h(PdfText, { style: { fontFamily: 'Noto CJK Subset', fontSize: 16, marginBottom: 16 } }, {
            default: () => '中文测试，你好世界。日本語',
          }),
          h(PdfText, { style: { fontFamily: 'Noto Arabic Subset', fontSize: 18, marginBottom: 16, textAlign: 'right' } }, {
            default: () => 'العربية مرحبا 123 ABC',
          }),
          h(PdfText, { style: { fontFamily: 'Noto Emoji Subset', fontSize: 22 } }, {
            default: () => '😀 🚀 ❤️',
          }),
        ],
      }),
    ],
  }),
})

describe('international typography evidence', () => {
  it('renders, extracts, shapes, and rasterizes the claimed script boundary', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'nuxt-pdf-typography-'))
    const fontRoot = join(staging, 'pdfs', 'fonts')
    await mkdir(fontRoot, { recursive: true })
    await Promise.all([
      copyFile(resolve('test/fixtures/assets/Roboto-Regular.ttf'), join(fontRoot, 'Roboto-Regular.ttf')),
      copyFile(resolve(internationalRoot, 'NotoSansCJKsc-Subset.ttf'), join(fontRoot, 'NotoSansCJKsc-Subset.ttf')),
      copyFile(resolve(internationalRoot, 'NotoSansArabic-Subset.ttf'), join(fontRoot, 'NotoSansArabic-Subset.ttf')),
      copyFile(resolve(internationalRoot, 'NotoEmoji-Subset.ttf'), join(fontRoot, 'NotoEmoji-Subset.ttf')),
      copyFile(resolve('node_modules/source-code-pro/VF/SourceCodeVF-Upright.ttf'), join(fontRoot, 'SourceCodeVF-Upright.ttf')),
    ])

    try {
      const fonts = await bundlePdfFonts([
        { family: 'Roboto Calibration', src: 'Roboto-Regular.ttf' },
        { family: 'Noto CJK Subset', src: 'NotoSansCJKsc-Subset.ttf' },
        { family: 'Noto Arabic Subset', src: 'NotoSansArabic-Subset.ttf' },
        { family: 'Noto Emoji Subset', src: 'NotoEmoji-Subset.ttf' },
        { family: 'Source Code Variable', src: 'SourceCodeVF-Upright.ttf' },
      ], { fontRoots: [fontRoot] })
      const rendered = await renderPreparedPdfTemplate(TypographyCalibration, {}, { fonts })
      const [first, second] = rendered.parsed.pages

      expect(rendered.result.diagnostics.registeredFontFaces.map(face => face.family)).toEqual([
        'Roboto Calibration',
        'Noto CJK Subset',
        'Noto Arabic Subset',
        'Noto Emoji Subset',
        'Source Code Variable',
      ])

      expect(first?.text).toContain('Zażółć gęślą jaźń')
      expect(first?.text.normalize('NFC')).toContain('Combining: Café')
      // Roboto has no U+030A and U+0308, but Å and ö: it draws those (D40).
      expect(first?.text.normalize('NFC')).toContain('Combining: Café, Ångström')
      expect(rendered.result.diagnostics.layoutWarnings).toEqual([])
      expect(first?.text).toContain('Ελληνικά — Καλημέρα κόσμε')
      expect(first?.text).toContain('Кириллица — Привет мир')
      expect(first?.text).toContain('Variable font: punctuation []{} / 0123456789')
      expect(second?.text).toContain('中文测试，你好世界。日本語')
      // The subset draws the dots of ب, ي and ة as glyphs without characters, so pdf.js shows the
      // letters only (pdfjsArabicLetters); Poppler reads the line exactly (test/invariants).
      expect(pdfjsArabicLetters(second!.text.replace(/\P{Script=Arabic}/gu, ''))).toBe(pdfjsArabicLetters('العربية مرحبا'))
      expect(second?.text).toMatch(/ABC.*123|123.*ABC/)
      // Characters outside the BMP come from the emoji font, one code point each (D40).
      // The subset has no space, so the spaces paint nothing and pdf.js guesses them from the gaps.
      expect(second?.text).toMatch(/😀 ?🚀 ?❤️/u)

      const arabic = second?.textRuns.find(run => run.text.includes('العرب'))
      expect(arabic).toMatchObject({ direction: 'rtl', fontSize: 18 })
      expect(arabic?.x).toBeGreaterThan(300)

      await expectReviewedSnapshot(rendered.bytes, baselineRoot, 1.5)
    }
    finally {
      await rm(staging, { force: true, recursive: true })
    }
  }, 30_000)
})

describe('Arabic glyph positions in the content stream', () => {
  const fonts = [{ family: 'Noto Arabic', src: `data:font/ttf;base64,${readFileSync(resolve(internationalRoot, 'NotoSansArabic-Subset.ttf')).toString('base64')}` as PdfFontDataUrl }]

  /** Each text position of the page's one text run, as x and y from the run's baseline start. */
  const textPositions = async (string: string): Promise<number[][]> => {
    const ArabicLine = defineComponent(() => () => h(PdfDocument, { language: 'ar' }, () => [
      h(PdfPage, { size: [300, 100], style: { padding: 10 } }, () => [h(PdfText, { style: { fontFamily: 'Noto Arabic', fontSize: 50 } }, () => string)]),
    ]))
    const { bytes } = await renderPreparedPdfTemplate(ArabicLine, {}, { fonts })
    const source = Buffer.from(bytes).toString('latin1')
    const content = [...source.matchAll(/stream\n/g)].map((match) => {
      const start = match.index + match[0].length
      try {
        return inflateSync(Buffer.from(source.slice(start, source.indexOf('\nendstream', start)), 'latin1')).toString('latin1')
      }
      catch {
        return ''
      }
    }).find(text => text.includes(' Tf'))!
    // The run's text matrix starts at y = page height (100); every other Tm is a glyph offset or the return from one.
    return [...content.matchAll(/^1 0 0 1 (\S+) (\S+) Tm$/gm)].map(([, x, y]) => [Number(x), Math.round((Number(y) - 100) * 1000) / 1000])
  }

  it('reads Arabic words without glyphs that lack characters exactly in pdf.js', async () => {
    // ع, ل, م, ح, ر and ا have no dots: every glyph maps to its character, and pdf.js reads the words as written.
    const ArabicLine = defineComponent(() => () => h(PdfDocument, { language: 'ar' }, () => [
      h(PdfPage, { size: [300, 100], style: { padding: 10 } }, () => [h(PdfText, { style: { fontFamily: 'Noto Arabic', fontSize: 18 } }, () => 'علم عمل حرم مال')]),
    ]))
    const { parsed } = await renderPreparedPdfTemplate(ArabicLine, {}, { fonts })
    expect(parsed.pages[0]!.text).toBe('علم عمل حرم مال')
  }, 30_000)

  it('writes a glyph offset from shaping in points, like its advance', async () => {
    // Noto Sans Arabic moves the final ر of مرحبا by -40 units: -2 pt at 50 pt, after ا, ب and ح (61.15 pt).
    // The writer used to scale the offset by the font size a second time, so ر stood at 61.05 pt.
    // The dot of ب, a glyph without code points, stands 94 units (4.7 pt) right of ب's pen at 14.55 pt.
    expect(await textPositions('مرحبا')).toEqual([[0, 0], [19.25, -0.15], [14.55, 0], [59.15, 0], [78.95, 0]])
  }, 30_000)

  it('draws a glyph above or below the baseline where the font puts it', async () => {
    // The dot of a final ب sits 387 units right of the letter and 23 units below the baseline: 19.35 pt and -1.15 pt at 50 pt.
    // Shaping used to drop every y offset, so the dot stood on the letter's baseline.
    expect(await textPositions('حب')).toEqual([[0, 0], [19.35, -1.15], [0, 0]])
  }, 30_000)
})

describe('characters that no font of the text has', () => {
  // Catches a missing character that warns once per occurrence, per page or
  // not at all, an astral character counted as two, or a .notdef glyph whose
  // text reads as nothing instead of U+FFFD (D40).
  it('warns once per character with its first page and reads it as U+FFFD', async () => {
    const page = (texts: string[]) => h(PdfPage, { size: 'A6', style: { fontFamily: 'Roboto', padding: 20 } }, () => texts.map(text => h(PdfText, null, () => text)))
    const document = defineComponent(() => () => h(PdfDocument, null, () => [page(['aꙮb 𝄞 ꙮ']), page(['ꙮ', 'c𝄞'])]))
    const rendered = await renderPreparedPdfTemplate(document, {}, { fonts: [ROBOTO] })
    const [first, second] = rendered.parsed.pages

    expect(rendered.result.diagnostics.layoutWarnings).toEqual([
      { code: 'PDF_GLYPH_MISSING', pageNumber: 1, codePoint: 0xA66E, fontFamily: 'Roboto' },
      { code: 'PDF_GLYPH_MISSING', pageNumber: 1, codePoint: 0x1D11E, fontFamily: 'Roboto' },
    ])
    expect(first?.text).toContain('a\uFFFDb \uFFFD \uFFFD')
    expect(second?.text).toContain('c\uFFFD')
  })

  // Catches a hidden fallback font: a letter that the named font lacks
  // painted in Helvetica, which the template never named and PDF/A cannot
  // embed. It shows the named font's .notdef and warns.
  it('paints a letter the named font lacks as that font\'s .notdef, not in Helvetica', async () => {
    const arabic = { family: 'Noto Arabic', src: `data:font/ttf;base64,${readFileSync(join(internationalRoot, 'NotoSansArabic-Subset.ttf')).toString('base64')}` as PdfFontDataUrl }
    const document = defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A6' }, () => h(PdfText, { style: { fontFamily: 'Noto Arabic' } }, () => 'مرحبا Q'))))
    const rendered = await renderPreparedPdfTemplate(document, {}, { fonts: [arabic] })

    expect(rendered.result.diagnostics.layoutWarnings).toEqual([{ code: 'PDF_GLYPH_MISSING', pageNumber: 1, codePoint: 0x51, fontFamily: 'Noto Arabic' }])
    expect(Buffer.from(rendered.bytes).toString('latin1')).not.toContain('/BaseFont /Helvetica')
  })
})

describe('blank characters', () => {
  // Catches a bidi control painted: Helvetica has no glyph for U+202E, and
  // its WinAnsi code is the low byte, 0x2E, so it painted a '.'. A control
  // takes no room either.
  it('paints no glyph for a bidi control that the font lacks', async () => {
    const page = (text: string) => defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A6' }, () => h(PdfText, null, () => text))))
    const runsOf = async (text: string) => (await renderPreparedPdfTemplate(page(text), {}, {})).parsed.pages[0]!.textRuns.map(run => [run.text, run.width])

    expect(await runsOf('A\u202EB\u202C C')).toEqual(await runsOf('AB C'))
  })

  // Catches a space that the font lacks shown as its .notdef box (or failing
  // PDF/A), or painted in Helvetica: the CJK subset has no space. The space
  // paints nothing and keeps the standard space width, 0.278 em.
  it('paints no glyph for a space that the font lacks and keeps its width', async () => {
    const cjk = { family: 'Noto CJK', src: `data:font/ttf;base64,${readFileSync(join(internationalRoot, 'NotoSansCJKsc-Subset.ttf')).toString('base64')}` as PdfFontDataUrl }
    const document = defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: 'A6' }, () => [
      h(PdfText, { style: { fontFamily: 'Noto CJK', fontSize: 10 } }, () => '世 中'),
      h(PdfText, { style: { fontFamily: 'Noto CJK', fontSize: 10 } }, () => '世中'),
    ])))
    const rendered = await renderPreparedPdfTemplate(document, {}, { fonts: [cjk] })
    const [spaced, plain] = rendered.parsed.pages[0]!.textRuns

    expect(rendered.result.diagnostics.layoutWarnings).toEqual([])
    expect(Buffer.from(rendered.bytes).toString('latin1')).not.toContain('/BaseFont /Helvetica')
    expect(spaced!.text.replace(' ', '')).toBe('世中')
    expect(spaced!.width - plain!.width).toBeCloseTo(2.78, 2)
  })
})
