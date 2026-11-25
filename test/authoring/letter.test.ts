import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expectPdf, renderPdfSfc } from '../../src/test/index'

const template = fileURLToPath(new URL('./pdfs/letter.vue', import.meta.url))

const fonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
]

describe('letter.vue', () => {
  it('prints a one-page A4 letter with a link and a mailto link', async () => {
    const { parsed, bytes } = await renderPdfSfc(template, {}, { fonts })

    // Catches a letter that spills onto a second page.
    expectPdf(parsed).toHavePageCount(1)

    // Catches a wrong default page size: A4 is 595.28 x 841.89 pt.
    expect(parsed.pages[0]!.width).toBeCloseTo(595.28, 0)
    expect(parsed.pages[0]!.height).toBeCloseTo(841.89, 0)

    // Catches a lost address block or body text.
    expectPdf(parsed)
      .toContainText('Anna Berger', { page: 1 })
      .toContainText('10115 Berlin', { page: 1 })
      .toContainText('Dear Ms Berger', { page: 1 })

    // Catches a link annotation that is missing or has a rewritten target.
    expectPdf(parsed)
      .toHaveLink({ url: 'https://example.com/terms', page: 1 })
      .toHaveLink({ url: 'mailto:hello@example.com', page: 1 })

    // Catches the language hyphenation splitting the e-mail address ("hello@ex-ample.com").
    expectPdf(parsed).toContainText('hello@example.com', { page: 1 })

    // Catches the SVG mark or the logo breaking the render (extra text would show up).
    expect(parsed.pages[0]!.textRuns.length).toBeGreaterThan(5)
    // Catches a creationDate that is ignored: the same document and date must give the same bytes.
    const again = await renderPdfSfc(template, {}, { fonts })
    expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('uses the registered font and its bold weight', async () => {
    const { parsed } = await renderPdfSfc(template, {}, { fonts })
    const subject = parsed.pages[0]!.textRuns.find(run => run.text.includes('Your project proposal'))
    const body = parsed.pages[0]!.textRuns.find(run => run.text.includes('Dear Ms Berger'))

    // Catches a font that silently falls back to Helvetica.
    expect(subject?.fontName).toBeTruthy()
    // Catches the 700 face not being used for the subject line (same face as the body).
    expect(subject?.fontName).not.toBe(body?.fontName)
  })
})
