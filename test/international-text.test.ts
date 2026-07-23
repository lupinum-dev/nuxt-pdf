import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { bundlePdfFonts } from '../src/build/fonts'
import { PdfDocument, PdfPage, PdfText } from '../src/runtime/components'
import { renderPdfTemplate } from '../src/test-utils/render-template'
import { comparePdfSnapshot } from '../src/test-utils/snapshot'

const internationalRoot = resolve('test/fixtures/fonts/international')
const baselineRoot = resolve('test/fixtures/baselines/international-text')

const TypographyCalibration = defineComponent({
  name: 'TypographyCalibration',
  setup: () => () => h(PdfDocument, { language: 'en' }, {
    default: () => [
      h(PdfPage, { size: 'A4', style: { padding: 44 } }, {
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
      h(PdfPage, { size: 'A4', style: { padding: 44 } }, {
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
      const rendered = await renderPdfTemplate(TypographyCalibration, {}, { fonts })
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
      expect(first?.text.normalize('NFC')).toContain('A ngstrom')
      expect(first?.text.normalize('NFC')).not.toContain('Ångström')
      expect(first?.text).toContain('Ελληνικά — Καλημέρα κόσμε')
      expect(first?.text).toContain('Кириллица — Привет мир')
      expect(first?.text).toContain('Variable font: punctuation []{} / 0123456789')
      expect(second?.text).toContain('中文测试，你好世界。日本語')
      expect(second?.text).toContain('ABC العربية مرحبا 123')
      expect(second?.text).not.toContain('😀')
      expect(second?.text).not.toContain('🚀')
      expect(second?.text).toContain('❤️')

      const arabic = second?.textRuns.find(run => run.text.includes('العربية'))
      expect(arabic).toMatchObject({ direction: 'rtl', fontSize: 18 })
      expect(arabic?.x).toBeGreaterThan(300)

      await comparePdfSnapshot(rendered.bytes, baselineRoot, {
        scale: 1.5,
        update: process.env.UPDATE_PDF_BASELINES === '1',
      })
    }
    finally {
      await rm(staging, { force: true, recursive: true })
    }
  }, 30_000)
})
