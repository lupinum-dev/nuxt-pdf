import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc, type RenderPdfSfcOptions } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/menu.vue', import.meta.url))

const fonts: RenderPdfSfcOptions['fonts'] = [
  { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
  { family: 'Lora', src: 'Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]

describe('menu.vue', () => {
  it('fits nine dishes with German and French names on one page', async () => {
    const { parsed, bytes } = await renderPdfSfc(template, {}, { fonts })

    // Catches a menu that runs onto a second page.
    expectPdf(parsed).toHavePageCount(1)

    // Catches missing glyphs: a font without the diacritic would copy as U+FFFD or lose the letter.
    expectPdf(parsed)
      .toContainText('Käsespätzle mit Röstzwiebeln')
      .toContainText('Gebratene Forelle Müllerin Art')
      .toContainText('Soupe à l’oignon gratinée')
      .toContainText('Crème brûlée à la lavande')
      .toContainText('Œufs mayonnaise')
      .toContainText('Weiße Bohnen')
    expect(parsed.pages[0]!.text).not.toContain('�')
    // Catches a creationDate that is ignored: the same document and date must give the same bytes.
    const again = await renderPdfSfc(template, {}, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('puts every price at the same right edge', async () => {
    const { parsed } = await renderPdfSfc(template, {}, { fonts })
    const runs = parsed.pages[0]!.textRuns
    const prices = runs.filter(run => /^\d+,\d\d €$/.test(run.text.trim()))
    const edges = prices.map(run => run.x + run.width)
    const pageWidth = parsed.pages[0]!.width

    // Catches a missed price (a price glued to its dish name would not match the pattern).
    expect(prices).toHaveLength(9)
    // Catches prices that follow the text instead of being pushed to the right by the leader.
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(1)
    // Catches prices that stop short of the text box: the right edge is the page width minus the 38 pt padding.
    expect(Math.max(...edges)).toBeCloseTo(pageWidth - 38, 0)
  })

  it('has room between a dish name and its price for the leader', async () => {
    const { parsed } = await renderPdfSfc(template, {}, { fonts })
    const runs = parsed.pages[0]!.textRuns
    const name = runs.find(run => run.text.includes('Fondant au chocolat'))!
    const price = runs.find(run => run.text.includes('8,20 €'))!

    // Catches a leader that collapses to nothing (name and price touching).
    expect(price.x - (name.x + name.width)).toBeGreaterThan(40)
    // Catches the name and the price landing on different lines.
    expect(Math.abs(price.y - name.y)).toBeLessThan(1)
  })
})
