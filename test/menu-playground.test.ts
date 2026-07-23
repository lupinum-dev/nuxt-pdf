import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { formatMenuPrice, formatWinePrice, sampleMenu } from '../playground/shared/menu'
import {
  comparePageImages,
  decodePngPage,
  getPdfOutline,
  rasterizePdf,
} from './utils/pdf'

// The real playground template, compiled and rendered through the shipped test
// helper. Proves the showcase menu end-to-end from an authored SFC: two A5
// pages, umlaut round-tripping, dish + price pairings, the wine list, the
// bookmark outline, and a reviewed raster baseline per page.
const menuSource = resolve('playground/pdfs/menu.vue')

// The Inter/Lora families the menu references, declared exactly as the
// playground registers them (playground/nuxt.config.ts pdf.fonts) so the render
// resolves every fontFamily + weight + style the template asks for.
const fontDeclarations = [
  { family: 'Inter', src: 'Inter-500.ttf', fontWeight: 500 },
  { family: 'Inter', src: 'Inter-600.ttf', fontWeight: 600 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
  { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
  { family: 'Lora', src: 'Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' as const },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]
const baselineDirectory = fileURLToPath(new URL(
  './fixtures/baselines/menu',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

describe('playground menu.vue (showcase A5 menu)', () => {
  it('renders a two-page menu with umlauts, priced dishes, wines, and an outline', async () => {
    const { bytes, parsed } = await renderPdfSfc(
      menuSource,
      { menu: sampleMenu },
      { fonts: fontDeclarations },
    )

    // Exactly two A5 pages.
    expect(parsed.pageCount).toBe(2)

    const page1 = parsed.pages[0]!.text
    const page2 = parsed.pages[1]!.text

    // The letterspaced small-caps heads extract as spaced uppercase glyphs
    // ("V O R S P E I S E N"), so compare with whitespace collapsed and cased.
    const collapse = (text: string): string => text.replace(/\s+/g, '').toUpperCase()
    const hasHead = (page: string, label: string): boolean =>
      collapse(page).includes(collapse(label))

    // Masthead and course heads land on the pages the layout intends.
    expect(page1).toContain(sampleMenu.name)
    expect(hasHead(page1, sampleMenu.starters.label)).toBe(true)
    expect(hasHead(page1, sampleMenu.mains.label)).toBe(true)
    expect(hasHead(page2, sampleMenu.desserts.label)).toBe(true)
    expect(hasHead(page2, sampleMenu.wines.label)).toBe(true)
    // Courses did not bleed onto the wrong page.
    expect(hasHead(page2, sampleMenu.starters.label)).toBe(false)
    expect(hasHead(page1, sampleMenu.desserts.label)).toBe(false)

    // Umlauts and diacritics round-trip through extraction (not mojibake).
    for (const needle of ['Kürbiscremesuppe', 'Käsespätzle', 'Schokoladensoufflé', 'Grüner Veltliner', 'Südsteiermark']) {
      const haystack = `${page1} ${page2}`
      expect(haystack).toContain(needle)
    }

    // Two dish + price pairings prove name and its own price sit together (a
    // bare toContain(price) would pass even if the columns were swapped).
    const pricePair = (name: string, price: number, text: string): void => {
      const money = formatMenuPrice(price).replace(',', '[.,]')
      expect(text).toMatch(new RegExp(`${name}[\\s.·]*${money}`))
    }
    pricePair('Kürbiscremesuppe', 9.5, page1)
    pricePair('Rehragout mit Preiselbeeren', 26.5, page1)

    // The wine list pairs a wine with its glass and bottle prices in order.
    const veltliner = sampleMenu.wines.entries[0]!
    expect(page2).toMatch(new RegExp(
      `${veltliner.name}[\\s\\S]*?${veltliner.region}[\\s·]*${veltliner.year}`
      + `[\\s\\S]*?${formatMenuPrice(veltliner.glass).replace(',', '[.,]')}`
      + `[\\s]*${formatWinePrice(veltliner.bottle)}`,
    ))

    // The outline exposes all four courses as top-level bookmarks.
    const outline = await getPdfOutline(bytes)
    expect(outline.map(item => item.title)).toEqual(['Starters', 'Mains', 'Desserts', 'Wine'])

    // Reviewed raster baseline, one PNG per page.
    const pages = await rasterizePdf(bytes, { scale: 2 })
    expect(pages).toHaveLength(2)

    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
    }

    for (const page of pages) {
      const baselinePath = resolve(baselineDirectory, `menu-page-${page.number}.png`)
      if (updatePdfBaselines) {
        await writeFile(baselinePath, page.png)
      }

      const baseline = await decodePngPage(await readFile(baselinePath), page.number)
      const regression = comparePageImages(page, baseline, rasterThresholds)
      expect(regression, `page ${page.number} reviewed baseline mismatch`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })
    }

    const expectedNames = pages.map(page => `menu-page-${page.number}.png`).sort()
    const actualNames = (await readdir(baselineDirectory))
      .filter(name => name.endsWith('.png'))
      .sort()
    expect(actualNames).toEqual(expectedNames)
  }, 30_000)
})
