import { describe, expect, it } from 'vitest'
import type { DestinationPageMap } from '../src/runtime/server/engine/layout-passes'
import { renderTocDocument, tocSections } from './fixtures/toc-document'
import { parsePdf } from './utils/pdf'

// A realistic multi-section report: a table of contents with dotted leaders and
// internal links, section id targets (one section long enough to span pages so
// the numbers come from real pagination, not section order), and dynamic page
// footers. React PDF has no table-of-contents mechanism to pair against, so the
// portable oracle is the document's own located headings and link destinations.

const locateHeadingPages = (pages: { number: number, text: string }[]): DestinationPageMap => {
  const located: DestinationPageMap = {}
  for (const section of tocSections) {
    const page = pages.find(p => p.text.includes(section.title) && p.text.includes('paragraph 1.'))
    if (page) located[section.id] = page.number
  }
  return located
}

describe('table-of-contents conformance (Vue-only)', () => {
  it('converges, prints located page numbers, and links to section starts', async () => {
    const result = await renderTocDocument()

    // An ordinary document converges in exactly two passes: pass 1 discovers
    // the map, pass 2 confirms it is a fixed point.
    expect(result.passes).toBe(2)

    const parsed = await parsePdf(result.bytes)
    expect(parsed.pageCount).toBe(result.layout.children.length)

    // The long Architecture section pushes later sections past a naive 1:1 with
    // section order — proving the numbers come from pagination.
    const located = locateHeadingPages(parsed.pages)
    expect(Object.keys(located)).toHaveLength(tocSections.length)
    expect(result.pages).toEqual(located)
    expect(located.results!).toBeGreaterThan(located.architecture! + 1)

    // The TOC page prints exactly those page numbers.
    const tocText = parsed.pages[0]!.text
    for (const section of tocSections) {
      expect(tocText).toContain(`${section.title}`)
      expect(tocText).toContain(String(located[section.id]))
    }

    // Every dynamic footer shows its own page number.
    for (const page of parsed.pages) {
      expect(page.text).toContain(`Page ${page.number} of ${parsed.pageCount}`)
    }
  }, 30_000)
})
