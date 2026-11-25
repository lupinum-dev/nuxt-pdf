import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { formatMenuPrice, formatWinePrice, sampleMenu } from '../playground/shared/menu'
import {
  decodePngPage,
  getPdfOutline,
  rasterizePdf,
} from '../src/test/pdf'
import { playgroundFonts } from './fixtures/playground-fonts'
import { expectReviewedPage } from './raster'

// The real playground template, compiled and rendered through the shipped test
// helper. Proves the showcase menu end-to-end from an authored SFC: two A5
// pages, umlaut round-tripping, dish + price pairings, the wine list, the
// bookmark outline, and a reviewed raster baseline per page.
const menuSource = resolve('playground/pdfs/menu.vue')

const baselineDirectory = fileURLToPath(new URL(
  './fixtures/baselines/menu',
  import.meta.url,
))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

describe('playground menu.vue (showcase A5 menu)', () => {
  it('renders a two-page menu with umlauts, priced dishes, wines, and an outline', async () => {
    const { bytes, parsed } = await renderPdfSfc(
      menuSource,
      { menu: sampleMenu },
      { fonts: playgroundFonts },
    )

    // Exactly two A5 pages.
    expect(parsed.pageCount).toBe(2)

    const page1 = parsed.pages[0]!.text
    const page2 = parsed.pages[1]!.text

    // Compare course heads with whitespace collapsed and cased, so a change of
    // letter spacing or case in the template does not hide them.
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
      await expectReviewedPage(page, baseline, 'menu')
    }

    const expectedNames = pages.map(page => `menu-page-${page.number}.png`).sort()
    const actualNames = (await readdir(baselineDirectory))
      .filter(name => name.endsWith('.png'))
      .sort()
    expect(actualNames).toEqual(expectedNames)
  }, 30_000)
})
