import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import { sampleEbook } from '../playground/shared/ebook'
import { playgroundFonts } from './fixtures/playground-fonts'
import {
  decodePngPage,
  getPdfOutline,
  rasterizePdf,
} from '../src/test/pdf'
import { expectReviewedPage } from './raster'

/** The roles of the structure tree of one page, depth first, as `role` or `  role` per level. */
const structureOf = async (bytes: Uint8Array, pageNumber: number): Promise<string[]> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const roles: string[] = []
    const walk = (node: unknown, depth: number) => {
      if (typeof node !== 'object' || node === null || !('role' in node)) return
      roles.push(`${'  '.repeat(depth)}${String(node.role)}`)
      if ('children' in node && Array.isArray(node.children)) for (const child of node.children) walk(child, depth + 1)
    }
    walk(await (await (await task.promise).getPage(pageNumber)).getStructTree(), 0)
    return roles
  }
  finally {
    await task.destroy()
  }
}

// The shipped ebook showcase, compiled and rendered through the shipped test
// helper. Proves the page-reference story end-to-end: `PdfPageRef` numbers
// feed the Contents dot-leaders, each chapter prints its own running foot,
// plus the per-chapter outline and internal links.
const ebookSource = resolve('playground/pdfs/ebook.vue')

const baselineDirectory = fileURLToPath(new URL('./fixtures/baselines/ebook', import.meta.url))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'

describe('playground ebook.vue (PdfPageRef showcase)', () => {
  it('auto-injects the composable, resolves the TOC + chapter-aware foot, and matches its raster baseline', async () => {
    const { bytes, parsed, result } = await renderPdfSfc(
      ebookSource,
      { ebook: sampleEbook },
      { fonts: playgroundFonts },
    )
    // The docs gallery renders this sample and stops on any warning, such as a keep the template cannot get (scripts/docs-gallery.mjs).
    expect([...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings]).toEqual([])

    // Multi-pass activation proves the auto-injected composable ran.
    expect(result.diagnostics.passes).toBeGreaterThanOrEqual(2)

    // Cover + title + contents + a multi-page body: several chapters span pages,
    // so the page count comfortably exceeds one-page-per-chapter.
    expect(parsed.pageCount).toBeGreaterThanOrEqual(12)
    expect(parsed.pageCount).toBeLessThanOrEqual(24)

    // Locate every chapter's true start page by a distinctive phrase from the
    // first paragraph's body — unique to the opening page, and (unlike the
    // letter-spaced small-caps lead-in) extracted as contiguous text.
    const startPageOf = (phrase: string): number => {
      const page = parsed.pages.find(p => p.text.includes(phrase))
      if (!page) throw new Error(`chapter start not found for phrase: ${phrase}`)
      return page.number
    }
    const reedStart = startPageOf('the reeds keep that no fence could hold to')
    const waterStart = startPageOf('The field to the west drinks and lets go within the day')
    const fogStart = startPageOf('breathing out. It comes on the mornings when the water is warmer')
    const migrationsStart = startPageOf('comes down the cut, in pulses, on their own weather')

    // Chapters genuinely span pages, so a later chapter starts more than one page
    // after an earlier one — the numbers come from pagination, not chapter order.
    expect(waterStart).toBeGreaterThan(reedStart + 1)
    expect(fogStart).toBeGreaterThan(waterStart + 1)

    // The Contents page pairs at least two chapter titles with THEIR resolved
    // start page (a bare toContain(number) would pass even with swapped labels).
    const contentsText = parsed.pages[2]!.text
    for (const [title, page] of [
      ['The Reed Line', reedStart],
      ['Water Remembers', waterStart],
      ['The Weight of Fog', fogStart],
    ] as const) {
      expect(contentsText).toMatch(new RegExp(`${title}[\\s.·]*${page}\\b`))
    }

    // Contents links target each chapter id.
    const contentsLinks = parsed.pages[2]!.annotations.filter(a => a.subtype === 'Link')
    for (const id of ['ch-reed-line', 'ch-water-remembers', 'ch-weight-of-fog']) {
      expect(contentsLinks.some(a => a.destination === id)).toBe(true)
    }

    // Chapter-aware running foot: a MID-chapter page (one strictly inside the fog
    // chapter, after its opener) prints the fog chapter's title next to its folio
    // — the foot's title is derived from the resolved map, not the opener text.
    const fogMidPage = parsed.pages.find(
      p => p.number > fogStart && p.number < migrationsStart,
    )
    expect(fogMidPage, 'the fog chapter should span at least two pages').toBeDefined()
    // 'The Weight of Fog' appears contiguous only in the foot here (the body of
    // this page never repeats the chapter title), so this proves the foot.
    expect(fogMidPage!.text).toContain(`The Weight of Fog · ${fogMidPage!.number}`)

    // The template claims PDF/UA-1 (veraPDF checks it in test/pdfa.test.ts).
    // The cover title is the one h1; the contents are a list of links; a
    // chapter is a section with its label, its h2 and its paragraphs, and the
    // cover drawing, the running head and the running foot are artifacts.
    expect((await structureOf(bytes, 1)).slice(0, 4)).toEqual(['Root', '  Document', '    P', '    H1'])
    expect((await structureOf(bytes, 3)).slice(0, 8)).toEqual([
      'Root', '  Document', '    H2', '    L', '      LI', '        LBody', '          Link', '      LI',
    ])
    expect(await structureOf(bytes, reedStart)).toEqual([
      'Root', '  Document', '    Sect', '      P', '      H2', '      P', '      P', '      P', '      P',
    ])

    // The outline carries one entry per chapter, in reading order.
    const outline = await getPdfOutline(bytes)
    expect(outline.map(item => item.title)).toEqual([
      'The Reed Line',
      'Water Remembers',
      'The Weight of Fog',
      'Migrations',
      'Ice and After',
    ])

    // Reviewed raster baselines: cover, contents, and a chapter-opener page.
    const pagesToBaseline = [1, 3, reedStart]
    const rasters = await rasterizePdf(bytes, { scale: 2 })

    // Leave the full document + every page on disk for out-of-band review.
    if (process.env.EBOOK_DUMP_DIR) {
      const dir = process.env.EBOOK_DUMP_DIR
      await mkdir(dir, { recursive: true })
      await writeFile(`${dir}/ebook.pdf`, bytes)
      await Promise.all(rasters.map(r => writeFile(`${dir}/page-${String(r.number).padStart(2, '0')}.png`, r.png)))
    }
    if (updatePdfBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
      await Promise.all(
        pagesToBaseline.map(n =>
          writeFile(`${baselineDirectory}/page-${n}.png`, rasters[n - 1]!.png),
        ),
      )
    }
    for (const n of pagesToBaseline) {
      const baseline = await decodePngPage(
        await readFile(`${baselineDirectory}/page-${n}.png`),
        n,
      )
      await expectReviewedPage(rasters[n - 1]!, baseline, 'ebook')
    }
  }, 60_000)
})
