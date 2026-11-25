import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { samplePaper } from '../playground/shared/paper'
import { playgroundFonts } from './fixtures/playground-fonts'
import { expectReviewedSnapshot } from './raster'

// The playground research paper, compiled and rendered through the shipped
// test helper. Proves what a paper needs from the engine: a masthead on the
// first page and a running head from page 2, figure, table and citation
// labels that link to their targets, and one bookmark per section.
const paperSource = resolve('playground/pdfs/paper.vue')
const baselineRoot = resolve('test/fixtures/baselines/paper')

describe('playground paper.vue (two-column research paper)', () => {
  it('links its figures, tables and citations and bookmarks every section', async () => {
    const { result, parsed } = await renderPdfSfc(paperSource, { paper: samplePaper }, { fonts: playgroundFonts })
    const pages = parsed.pages.map(page => page.text.replace(/\s+/g, ' '))

    expect(parsed.pageCount).toBe(3)
    expect([...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings]).toEqual([])

    // The running head starts on page 2; page 1 carries the masthead instead.
    const runningHead = 'Fieldnote Ecology Reports 4 (2026) e2026.014'
    expect(pages[0]).not.toContain(runningHead)
    expect(pages[0]).toContain('Research article · Vol. 4 · 2026 · e2026.014')
    expect(pages[1]).toContain(`${runningHead} · 2`)
    expect(pages[2]).toContain(`${runningHead} · 3`)

    // Figure and table labels link to their captions, citation numbers to
    // their entries in the reference list.
    const destinations = new Set(parsed.pages.flatMap(page => page.annotations).map(annotation => annotation.destination))
    for (const target of ['fig-1', 'fig-2', 'table-1', 'table-2', 'ref-1', 'ref-3', 'ref-6', 'ref-9', 'ref-12']) {
      expect(destinations.has(target), target).toBe(true)
    }

    // Sub- and superscripts stay in the text layer next to their base.
    const allText = pages.join(' ')
    expect(allText).toContain('R2 = 0.82')
    expect(allText).toContain('CO2 footprint')

    expect(parsed.outline.map(item => item.title)).toEqual([
      'Introduction',
      'Methods',
      'Results',
      'Discussion',
      'Acknowledgements',
      'Author contributions',
      'Funding',
      'Competing interests',
      'Data availability',
      'References',
    ])

    // Reviewed raster baseline (UPDATE_PDF_BASELINES policy), 150 DPI.
    await expectReviewedSnapshot(result, baselineRoot, 150 / 72)
  }, 30_000)
})
