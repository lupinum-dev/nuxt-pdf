import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePdfSfc } from '../src/build/pdf-sfc-plugin'
import { bundlePdfFonts } from '../src/build/fonts'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import { sampleEbook } from '../playground/shared/ebook'
import {
  comparePageImages,
  decodePngPage,
  getPdfOutline,
  parsePdf,
  rasterizePdf,
} from './utils/pdf'

// The shipped ebook showcase, compiled through the SFC plugin exactly as the
// Nuxt build does (auto-injecting the usePdfPageNumbers import) and rendered
// through the registry. Proves the flagship usePdfPageNumbers story end-to-end:
// multi-pass numbering feeds BOTH the Contents dot-leaders and the chapter-aware
// running foot, plus the per-chapter outline and internal links.
const ebookSource = resolve('playground/pdfs/ebook.vue')
const composablesImport = resolve('src/runtime/composables/index')
// Sits beside the source so its `../shared/ebook` import resolves unchanged.
const compiledFile = resolve('playground/pdfs/.ebook.compiled.mjs')

const baselineDirectory = fileURLToPath(new URL('./fixtures/baselines/ebook', import.meta.url))
const updatePdfBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = { channelThreshold: 25, maxChangedPixelRatio: 0.005 } as const

interface PdfDefinitionModule {
  default: object
}

afterEach(async () => {
  await rm(compiledFile, { force: true })
})

describe('playground ebook.vue (usePdfPageNumbers showcase)', () => {
  it('auto-injects the composable, resolves the TOC + chapter-aware foot, and matches its raster baseline', async () => {
    const source = await readFile(ebookSource, 'utf8')
    const compiled = await compilePdfSfc(source, ebookSource, 'template', false, composablesImport)

    // The plugin injected the auto-imported composable.
    expect(compiled.code).toContain('usePdfPageNumbers')
    expect(compiled.code).toContain(JSON.stringify(composablesImport))

    await writeFile(compiledFile, compiled.code)
    const module = await import(`${pathToFileURL(compiledFile).href}?v=1`) as PdfDefinitionModule
    const component = module.default as { [PDF_DEFINITION_PROPERTY]?: object }
    expect(component[PDF_DEFINITION_PROPERTY]).toBeTypeOf('object')

    // Bundle the same Inter/Lora files the playground registers in nuxt.config,
    // so the render resolves the exact families the SFC references.
    const fonts = await bundlePdfFonts([
      { family: 'Inter', src: './Inter-400.ttf', fontWeight: 400 },
      { family: 'Inter', src: './Inter-500.ttf', fontWeight: 500 },
      { family: 'Inter', src: './Inter-600.ttf', fontWeight: 600 },
      { family: 'Inter', src: './Inter-700.ttf', fontWeight: 700 },
      { family: 'Inter', src: './Inter-800.ttf', fontWeight: 800 },
      { family: 'Lora', src: './Lora-400.ttf', fontWeight: 400 },
      { family: 'Lora', src: './Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' },
      { family: 'Lora', src: './Lora-600.ttf', fontWeight: 600 },
      { family: 'Lora', src: './Lora-700.ttf', fontWeight: 700 },
    ], { fontRoots: [resolve('playground/pdfs/fonts')] })

    const template = createPdfTemplate('ebook', component, { fonts })
    const bytes = await (await template.render({ ebook: sampleEbook })).toUint8Array()
    const parsed = await parsePdf(bytes)

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
    const migrationsStart = startPageOf('sky in October the way water comes down the cut')

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
      const regression = comparePageImages(rasters[n - 1]!, baseline, rasterThresholds)
      expect(regression, `page ${n} reviewed baseline mismatch`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
      })
    }
  }, 60_000)
})
