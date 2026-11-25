import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { markdownArticle, sampleArticle } from '../playground/shared/article'
import { parseRichTextMarkdown } from '../src/runtime/rich-text'
import { playgroundFonts } from './fixtures/playground-fonts'

// The real playground article, compiled and rendered through the shipped test
// helper with the playground's Inter/Lora fonts: editor HTML from a CMS,
// printed by <PdfRichText> with a class on it and `styles` for the headings.
const articleSource = resolve('playground/pdfs/article.vue')

describe('playground article.vue (rich text from a CMS)', () => {
  // Catches a block type, the figure or its image source (pdfs/assets) that the playground article loses.
  it('prints the editor HTML with its headings, lists, quote, code, figure and link', async () => {
    const { bytes, parsed, result } = await renderPdfSfc(articleSource, { article: sampleArticle }, { fonts: playgroundFonts })
    const text = parsed.pages.map(page => page.text).join(' ').replace(/\s+/g, ' ')
    const runs = parsed.pages.flatMap(page => page.textRuns)
    const runWith = (part: string) => runs.find(run => run.text.includes(part))!

    expect(parsed.pageCount).toBe(2)
    for (const part of [
      'listening before pressing record',
      '1. Charge the recorder',
      '4. Write the date and place',
      '• Keep the road behind a hill or a hedge.',
      '- A hedge cuts traffic noise',
      'The first ten minutes are for the meadow to forget you.',
      '2026-04-02_wiesengrund_hedge take-01.wav take-02.wav',
      'details are on our events page.',
      'The view from the upper end of the meadow. Snow stays on the peak until June.',
    ]) expect(text).toContain(part)
    // The figure's image loads from pdfs/assets, no placeholder: the photo and its alpha mask.
    expect(Buffer.from(bytes).toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(2)
    // The docs gallery renders this sample and stops on any warning (scripts/docs-gallery.mjs).
    expect([...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings]).toEqual([])
    expect(parsed.outline.map(item => item.title)).toEqual(['Before you leave the house', 'Finding a spot', 'Settings we use', 'Share what you hear'])
    expect(parsed.links).toEqual([{ page: 2, url: 'https://fieldnote.example/evenings' }])
    // The class sets the base size: 9.5 pt text and 9.5 × 1.6 pt h2 headings in Cormorant.
    expect(runWith('Pack light.').fontSize).toBeCloseTo(9.5, 1)
    expect(runWith('Finding a spot').fontSize).toBeCloseTo(15.2, 1)
    expect(runWith('Finding a spot').fontName).not.toBe(runWith('Pack light.').fontName)
  })

  // Catches the Markdown path of the playground route: a comark component
  // that loses its mapping, its props or its content, or a construct that the
  // Markdown parse drops.
  it('prints a Markdown body with its mapped callout components', async () => {
    const { markdown, ...article } = markdownArticle
    const content = await parseRichTextMarkdown(markdown)
    const { parsed } = await renderPdfSfc(articleSource, { article: { ...article, content } }, { fonts: playgroundFonts })
    const text = parsed.pages.map(page => page.text).join(' ').replace(/\s+/g, ' ')

    expect(parsed.pageCount).toBe(1)
    for (const part of [
      'Recording rain on a tin roof',
      'Field tip Put the recorder on a folded towel. It stops the drum of the shelf below.',
      '1. Record two minutes of the roof before the rain.',
      'Watch out Never leave a recorder outside in a thunderstorm.',
      'The best rain recordings have a listener in them',
      'More notes are on our journal page.',
    ]) expect(text).toContain(part)
    expect(parsed.outline.map(item => item.title)).toEqual(['Where to stand'])
    expect(parsed.links).toEqual([{ page: 1, url: 'https://fieldnote.example/journal' }])
  })
})
