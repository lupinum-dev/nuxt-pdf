import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import {
  boardCutReport,
  buildKpis,
  buildLedger,
  ebitOf,
  netOf,
  opexOf,
  revenueOf,
  sampleAnnualReport,
} from '../playground/shared/annual'
import { comparePageImages, decodePngPage, rasterizePdf } from './utils/pdf'

// The real playground annual-report template, compiled and rendered through the
// shipped test helper with the playground's Inter/Lora font library. Proves the
// whole showcase end-to-end: SVG charts, KPI tiles, the ledger table, section
// bookmarks, dynamic footers — plus a reviewed per-page raster baseline.
const templateSource = resolve('playground/pdfs/annual-report.vue')
const baselineDirectory = resolve('test/fixtures/baselines/annual')
const updateBaselines = process.env.UPDATE_PDF_BASELINES === '1'
const rasterThresholds = {
  channelThreshold: 25,
  maxChangedPixelRatio: 0.005,
} as const

const playgroundFonts = [
  { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
  { family: 'Inter', src: 'Inter-500.ttf', fontWeight: 500 },
  { family: 'Inter', src: 'Inter-600.ttf', fontWeight: 600 },
  { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
  { family: 'Inter', src: 'Inter-800.ttf', fontWeight: 800 },
  { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
  { family: 'Lora', src: 'Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' as const },
  { family: 'Lora', src: 'Lora-600.ttf', fontWeight: 600 },
  { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
]

describe('playground annual-report.vue (showcase)', () => {
  it('renders the cover, letter, KPIs, SVG charts, ledger, and outline', async () => {
    // The sample data must be internally consistent: quarter and sector
    // breakdowns sum back to the yearly totals the ledger reports.
    const { current } = sampleAnnualReport
    const quarterConsulting = sampleAnnualReport.quarters.reduce((s, q) => s + q.consulting, 0)
    const quarterLicensing = sampleAnnualReport.quarters.reduce((s, q) => s + q.licensing, 0)
    const sectorTotal = sampleAnnualReport.sectors.reduce((s, sector) => s + sector.value, 0)
    expect(quarterConsulting).toBe(current.consulting)
    expect(quarterLicensing).toBe(current.licensing)
    expect(sectorTotal).toBe(revenueOf(current))
    // Exactly one sector is the highlighted segment.
    expect(sampleAnnualReport.sectors.filter(s => s.highlight)).toHaveLength(1)

    const { bytes, parsed } = await renderPdfSfc(
      templateSource,
      { report: sampleAnnualReport },
      { fonts: playgroundFonts },
    )

    // Cover, letter, highlights, performance, financials.
    expect(parsed.pageCount).toBe(5)

    const allText = parsed.pages.map(page => page.text).join(' · ')

    // Cover identity.
    expect(parsed.pages[0]!.text).toContain('Fieldnote Studio GmbH')
    expect(parsed.pages[0]!.text).toContain('2025')

    // The letter carries the signature and the recurring-revenue figure.
    expect(allText).toContain('Mara Voss')
    expect(allText).toContain('Managing Director')

    // KPI tiles: derived headline values are present.
    const kpis = buildKpis(sampleAnnualReport.current, sampleAnnualReport.prior)
    const revenueKpi = kpis.find(k => k.id === 'revenue')!
    const marginKpi = kpis.find(k => k.id === 'margin')!
    expect(revenueKpi.value).toBe('€2.90M')
    expect(allText).toContain(revenueKpi.value)
    expect(allText).toContain(revenueKpi.delta)
    expect(allText).toContain(marginKpi.value)

    // Bar chart: each quarter caption and at least one direct value label print.
    for (const quarter of sampleAnnualReport.quarters) {
      expect(allText).toContain(quarter.label)
    }
    expect(allText).toContain('580') // Q4 consulting bar, direct-labelled.
    expect(allText).toContain('Consulting')
    expect(allText).toContain('Licensing')

    // Donut: the highlighted sector and the centre total.
    expect(allText).toContain('Conservation')
    expect(allText).toContain('€2.90M')

    // Line chart: endpoint MRR labels.
    expect(allText).toContain('€84K')

    // Ledger: subtotal and bottom-line figures, derived and consistent.
    const ledger = buildLedger(sampleAnnualReport.current, sampleAnnualReport.prior)
    expect(revenueOf(current)).toBe(2900)
    expect(opexOf(current)).toBe(2195)
    expect(ebitOf(current)).toBe(705)
    expect(netOf(current)).toBe(529)
    const financials = parsed.pages[4]!.text
    expect(financials).toContain('Total revenue')
    expect(financials).toContain('2,900')
    expect(financials).toContain('Net result for the year')
    expect(financials).toContain('529')
    // The ledger renders one row per derived line.
    expect(ledger).toHaveLength(11)

    // Outline: one bookmark per section, cover first.
    const outlineTitles = parsed.outline.map(item => item.title)
    expect(outlineTitles).toEqual([
      'Annual Report 2025',
      'From the Managing Director',
      'The Year in Figures',
      'Performance',
      'Financial Statements',
    ])

    // Dynamic footers number every content page against the total.
    for (const page of parsed.pages.slice(1)) {
      expect(page.text).toContain(`${page.number} / ${parsed.pageCount}`)
    }

    // The board-briefing scenario renders a consistent, leaner variant: one
    // fewer sector, the spotlight on the public sector, still summing to total
    // revenue so every derived figure stays coherent.
    expect(boardCutReport.sectors).toHaveLength(sampleAnnualReport.sectors.length - 1)
    expect(boardCutReport.sectors.reduce((sum, s) => sum + s.value, 0)).toBe(revenueOf(current))
    expect(boardCutReport.sectors.filter(s => s.highlight).map(s => s.id)).toEqual(['public'])
    const { parsed: boardParsed } = await renderPdfSfc(
      templateSource,
      { report: boardCutReport },
      { fonts: playgroundFonts },
    )
    expect(boardParsed.pageCount).toBe(5)
    // The sample donut carries an 'Other' sector; the board cut folds it away,
    // so the rendered legend proves the scenario drives a different chart.
    const boardText = boardParsed.pages.map(page => page.text).join(' · ')
    expect(allText).toContain('Other')
    expect(boardText).not.toContain('Other')
    expect(boardText).toContain('Infrastructure')

    // Reviewed per-page raster baseline.
    const pages = await rasterizePdf(bytes, { scale: 2 })
    expect(pages).toHaveLength(5)

    if (updateBaselines) {
      await mkdir(baselineDirectory, { recursive: true })
    }

    for (const page of pages) {
      const baselinePath = resolve(baselineDirectory, `annual-page-${page.number}.png`)
      if (updateBaselines) {
        await writeFile(baselinePath, page.png)
      }
      const baseline = await decodePngPage(await readFile(baselinePath), page.number)
      const comparison = comparePageImages(page, baseline, rasterThresholds)
      expect(comparison, `annual baseline mismatch on page ${page.number}`).toMatchObject({
        dimensionsMatch: true,
        matches: true,
        pageNumbersMatch: true,
      })
    }
  }, 60_000)
})
