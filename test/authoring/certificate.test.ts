import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/certificate.vue', import.meta.url))

const fonts = [
  { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]

describe('certificate.vue', () => {
  it('prints one landscape A4 page with the border and the seal', async () => {
    const { parsed, bytes } = await renderPdfSfc(template, {}, { fonts })
    const [page] = parsed.pages

    // Catches a border that is too tall and pushes the content onto a second page.
    expectPdf(parsed).toHavePageCount(1)

    // Catches orientation being ignored: landscape A4 is 841.89 x 595.28 pt.
    expect(page!.width).toBeCloseTo(841.89, 0)
    expect(page!.height).toBeCloseTo(595.28, 0)

    // Catches lost text blocks.
    expectPdf(parsed)
      .toContainText('Certificate of Completion', { page: 1 })
      .toContainText('Anna Berger', { page: 1 })
      .toContainText('Mara Fieldwork, Director', { page: 1 })

    // Catches SVG text in the seal being dropped (the docs say it stays in the page text).
    expectPdf(parsed).toContainText('VERIFIED 2026', { page: 1 })
    // Catches a creationDate that is ignored: the same document and date must give the same bytes.
    const again = await renderPdfSfc(template, {}, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('paints the page with exactly the two registered weights', async () => {
    const { parsed } = await renderPdfSfc(template, {}, { fonts })
    const runs = parsed.pages[0]!.textRuns
    const faces = new Set(runs.map(run => run.fontName))
    const title = runs.find(run => run.text.includes('Certificate of Completion'))
    const lead = runs.find(run => run.text.includes('This certifies'))
    const seal = runs.find(run => run.text.includes('VERIFIED'))

    // Catches a fallback to a third font (for example SVG text without its own family).
    expect(faces.size).toBe(2)
    // Catches the bold weight not being used for the title.
    expect(title?.fontName).not.toBe(lead?.fontName)
    // Catches the seal text ignoring its fontWeight 700 and using the regular face.
    expect(seal?.fontName).toBe(title?.fontName)
  })
})
