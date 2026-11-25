import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { sampleLetter } from '../playground/shared/letter'

// The real playground letter, rendered with the playground fonts.
const letterSource = resolve('playground/pdfs/letter.vue')
const mm = (value: number) => value * 72 / 25.4
const PAGE_HEIGHT = 841.89

describe('playground letter.vue (DIN 5008 business letter)', () => {
  // Catches a style change that moves the address out of the envelope window,
  // the return address out of its zone, or the letter onto a second page.
  it('prints one page with the address inside the DL window of DIN 5008 form B', async () => {
    const { parsed, result } = await renderPdfSfc(letterSource, { letter: sampleLetter })
    const runs = parsed.pages[0]!.textRuns.filter(run => run.text.trim() !== '')
    const run = (text: string) => runs.find(item => item.text.startsWith(text))!
    // pdf.js gives the baseline, measured from the bottom of the page.
    const fromTop = (text: string) => PAGE_HEIGHT - run(text).y

    expect(parsed.pageCount).toBe(1)
    expect(result.metadata.title).toBe('Planting plan for the north beds')
    // The docs gallery renders this sample and stops on any warning (scripts/docs-gallery.mjs).
    expect([...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings]).toEqual([])

    // The window: 20 mm from the left, 45 mm from the top, 85 × 45 mm. The
    // return address fills the top 17.7 mm, the address the lower 27.3 mm.
    const address = ['Riverside Community Garden e. V.', 'Ada Quillfeather', 'Uferweg 21', '12345 Musterstadt']
    for (const line of ['Kestrel & Moss · Kleestraße 7 · 12345 Musterstadt', ...address]) {
      expect(run(line).x).toBeCloseTo(mm(25), 2)
      expect(run(line).x + run(line).width).toBeLessThan(mm(105))
    }
    expect(fromTop('Kestrel & Moss · Kleestraße 7')).toBeGreaterThan(mm(45))
    expect(fromTop('Kestrel & Moss · Kleestraße 7')).toBeLessThan(mm(62.7))
    for (const line of address) {
      // Baseline at least the cap height (about 0.7 em in Inter) below the zone top.
      expect(fromTop(line) - run(line).height * 0.7).toBeGreaterThan(mm(62.7))
      expect(fromTop(line)).toBeLessThan(mm(90))
    }

    // The information block starts 125 mm from the left; the text block at 25 mm, below the window.
    expect(run('Your reference').x).toBeCloseTo(mm(125), 2)
    expect(run('Date').x).toBeCloseTo(mm(125), 2)
    expect(run('Planting plan for the north beds').x).toBeCloseTo(mm(25), 2)
    expect(fromTop('Planting plan for the north beds')).toBeGreaterThan(mm(98))
    expect(run('Planting plan for the north beds').fontName).not.toBe(run('Dear Ms Quillfeather,').fontName)

    // The signature block and the footer, in that order down the page. The
    // signer's name also stands in the information block; take the last one.
    const signer = runs.findLast(item => item.text.startsWith('Lio Brandt'))!
    expect(signer.x).toBeCloseTo(mm(25), 2)
    expect(PAGE_HEIGHT - signer.y).toBeGreaterThan(fromTop('Kind regards,') + 34)
    expect(fromTop('IBAN DE00 1234 5678 9012 3456 78')).toBeGreaterThan(PAGE_HEIGHT - mm(32))
  })
})
