import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { sampleReport } from '../playground/shared/report'
import { getPdfOutline } from '../src/test/pdf'

// The real playground template, compiled and rendered through the shipped test
// helper. Proves the public helper follows the production SFC and registry path:
// composable auto-import, multi-pass activation, TOC page numbers, internal
// links, bookmarks/outline, and dynamic footers.
const reportSource = resolve('playground/pdfs/report.vue')
// The same report written with style objects instead of a <style> block.
const styleObjectSource = resolve('test/fixtures/report-style-objects/pdfs/report.vue')

// Creation date and the file ID derived from it differ between two renders.
const withoutVolatileFields = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('latin1')
    .replace(/\(D:\d{14}Z\)/g, '(D:date)')
    .replace(/\/ID \[<[\da-f]+> <[\da-f]+>\]/, '/ID []')

describe('playground report.vue (shipped TOC + bookmarks)', () => {
  it('auto-injects the composable import and renders a correct report', async () => {
    const { bytes, parsed, result } = await renderPdfSfc(
      reportSource,
      { report: sampleReport },
    )
    expect(result.diagnostics.passes).toBeGreaterThanOrEqual(2)

    // Contents page links resolve, and every section heading prints on the TOC.
    const tocText = parsed.pages[0]!.text
    for (const title of ['Executive summary', 'Method', 'Results', 'Appendix']) {
      expect(tocText).toContain(title)
    }
    // The Method section is long enough to span pages, so a later section's
    // printed number proves pagination-driven numbering (not 1:1 with order).
    const methodStart = parsed.pages.find(p => p.text.includes('Sampling') && p.text.includes('paragraph 1.'))!.number
    const resultsStart = parsed.pages.find(p => p.text.includes('Counts') && p.text.includes('paragraph 1.'))!.number
    expect(resultsStart).toBeGreaterThan(methodStart + 1)

    // Each TOC entry pairs ITS title with ITS located page number (a bare
    // toContain(number) would pass even with swapped labels).
    for (const [title, page] of [['Method', methodStart], ['Results', resultsStart]] as const) {
      expect(tocText).toMatch(new RegExp(`${title}[\\s.·]*${page}\\b`))
    }

    // Internal links exist on the TOC page and target the section ids.
    const tocLinks = parsed.pages[0]!.annotations.filter(a => a.subtype === 'Link')
    expect(tocLinks.some(a => a.destination === 'method')).toBe(true)

    // The outline nests subsection bookmarks under their section bookmark.
    const outline = await getPdfOutline(bytes)
    const method = outline.find(item => item.title === 'Method')
    expect(method).toBeDefined()
    expect(method!.children.map(child => child.title)).toEqual(['Sampling', 'Instruments'])

    // Dynamic footers show each page's own number.
    for (const page of parsed.pages) {
      expect(page.text).toContain(`${page.number} / ${parsed.pageCount}`)
    }
  }, 30_000)

  // Catches a class compiled to a different style than the object it replaces:
  // a shorthand expanded to the wrong sides, a lost unit, or classes applied
  // in the wrong order. Equal bytes mean equal pages, text and layout boxes.
  it('renders the <style> classes exactly like the style-object version', async () => {
    const [classes, objects] = await Promise.all([
      renderPdfSfc(reportSource, { report: sampleReport }),
      renderPdfSfc(styleObjectSource, { report: sampleReport }),
    ])

    expect(classes.parsed.pageCount).toBe(objects.parsed.pageCount)
    expect(classes.parsed.pages.map(page => page.text)).toEqual(objects.parsed.pages.map(page => page.text))
    expect(withoutVolatileFields(classes.bytes)).toBe(withoutVolatileFields(objects.bytes))
  }, 30_000)
})
