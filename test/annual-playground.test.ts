import { Buffer } from 'node:buffer'
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
import { barModel, donutModel, ledgerView, lineModel } from '../playground/pdfs/components/annual/models'
import { decodePngPage, rasterizePdf } from '../src/test/pdf'
import { actualTexts, pageContents } from './fixtures/tagged-document'
import { playgroundFonts } from './fixtures/playground-fonts'
import { expectReviewedPage } from './raster'

// The real playground annual-report template, compiled and rendered through the
// shipped test helper with the playground's Inter/Lora font library. Proves the
// whole showcase end-to-end: SVG charts, KPI tiles, the ledger table, section
// bookmarks, dynamic footers — plus a reviewed per-page raster baseline.
const templateSource = resolve('playground/pdfs/annual-report.vue')
const baselineDirectory = resolve('test/fixtures/baselines/annual')
const updateBaselines = process.env.UPDATE_PDF_BASELINES === '1'

/**
 * The tagged structure of each page as a reader meets it: headings with their
 * text (the `/ActualText` where the page has one, as assistive technology
 * reads it), figures with their alt text and caption, the size of each list
 * and table, and last the number of paragraphs outside them.
 */
const structureOutline = async (bytes: Uint8Array): Promise<string[][]> => {
  const contents = pageContents(bytes)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const doc = await task.promise
  try {
    const pages: string[][] = []
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      // Marked-content id → its text, so a heading can be named by what it says.
      const texts = new Map<string, string>()
      // pdfjs names a sequence `p<page ref>R_mc<MCID>`; ActualText wins over the glyphs.
      const sourceTexts = new Map(actualTexts(contents[number - 1]!).map(item => [item.mcid, item.text]))
      const textOfId = (id: string) => sourceTexts.get(Number(/_mc(\d+)$/.exec(id)?.[1])) ?? texts.get(id) ?? ''
      const open: (string | undefined)[] = []
      for (const item of (await page.getTextContent({ includeMarkedContent: true })).items) {
        if ('type' in item) {
          if (item.type === 'endMarkedContent') open.pop()
          else open.push(item.id)
          continue
        }
        const id = open.findLast(entry => entry !== undefined)
        if (id !== undefined) texts.set(id, `${texts.get(id) ?? ''}${item.str}${item.hasEOL ? ' ' : ''}`)
      }
      type Node = { role?: string, alt?: string, type?: string, id?: string, children?: Node[] }
      const textOf = (node: Node): string => node.type === 'content'
        ? textOfId(node.id!)
        : (node.children ?? []).map(textOf).join('')
      const outline: string[] = []
      let paragraphs = 0
      const walk = (node: Node) => {
        const role = node.role ?? ''
        if (/^H[1-6]$/.test(role)) outline.push(`${role} ${textOf(node).trim()}`)
        else if (role === 'Figure') {
          const caption = node.children?.find(child => child.role === 'Caption')
          outline.push(`Figure ${node.alt}${caption === undefined ? '' : ` | Caption ${textOf(caption).trim()}`}`)
        }
        else if (role === 'L' || role === 'Table') outline.push(`${role} of ${node.children?.length}`)
        else if (role === 'P') paragraphs += 1
        else node.children?.forEach(walk)
      }
      walk(await page.getStructTree() as Node)
      pages.push([...outline, `P × ${paragraphs}`])
    }
    return pages
  }
  finally {
    await task.destroy()
  }
}

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
    expect(parsed.pages[0]!.text).toContain('Fieldnote Studio')
    expect(parsed.pages[0]!.text).toContain('2025')

    // The letter carries the signature and the recurring-revenue figure.
    expect(allText).toContain('Mara Voss')
    expect(allText).toContain('Managing Director')

    // KPI tiles: derived headline values are present.
    const kpis = buildKpis(sampleAnnualReport.current, sampleAnnualReport.prior)
    const revenueKpi = kpis.find(k => k.id === 'revenue')!
    const marginKpi = kpis.find(k => k.id === 'margin')!
    expect(revenueKpi.value).toBe('$2.90M')
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
    expect(allText).toContain('$2.90M')

    // Line chart: endpoint MRR labels.
    expect(allText).toContain('$84K')

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
    // Catches a ledger row lost by the PdfTable, or its cells out of column order:
    // every row prints its label, then the current, then the prior figure.
    const financialItems = parsed.pages[4]!.textItems.filter(item => item.trim())
    const ledgerRows = ledgerView(current, sampleAnnualReport.prior)
    expect(ledgerRows.map((row) => {
      const at = financialItems.indexOf(row.label)
      return financialItems.slice(at, at + 3)
    })).toEqual(ledgerRows.map(row => [row.label, row.current, row.prior]))

    // Outline: one bookmark per section, cover first.
    const outlineTitles = parsed.outline.map(item => item.title)
    expect(outlineTitles).toEqual([
      'Annual Report 2025',
      'From the Managing Director',
      'The Year in Figures',
      'Performance',
      'Financial Statements',
    ])

    // Accessible document (PDF/A-3a and PDF/UA-1; veraPDF checks the rules in
    // test:pdfa, this checks what the template decides). Catches a heading
    // that lost its tag, a chart whose alt text no longer matches its data, a
    // caption outside its figure, chart labels that are no longer decorative
    // (they would read as stray paragraphs or list items), headings in
    // capitals without their source text, and a dropped claim (no structure
    // tree).
    const report = sampleAnnualReport
    expect(await structureOutline(bytes)).toEqual([
      ['H1 Evidence, made legible.', 'P × 6'],
      ['H2 From the Managing Director', 'P × 6'],
      ['H2 The year in figures', 'L of 6', 'P × 2'],
      [
        'H2 Where the revenue came from',
        'H3 Revenue by quarter',
        `Figure ${barModel(report.quarters).alt} | Caption Consulting and licensing, USD thousands`,
        'H3 Recurring revenue',
        `Figure ${lineModel(report.monthly).alt} | Caption Monthly, USD thousands`,
        'H3 Revenue by client sector',
        // The legend beside the donut is part of the figure; the alt text gives the shares.
        `Figure ${donutModel(report.sectors).alt} | Caption Share of total, USD thousands`,
        // The eyebrow.
        'P × 1',
      ],
      ['H2 Statement of operations', `Table of ${ledgerRows.length + 1}`, 'H3 Basis of preparation', 'P × 3'],
    ])
    // The ledger's first column: one row header per statement line.
    expect(Buffer.from(bytes).toString('latin1').match(/\/Scope \/Row\b/g)).toHaveLength(ledgerRows.length)
    // Headings and figures set with tight letter spacing carry their template
    // text (Vue keeps one space around multi-line template text).
    expect(pageContents(bytes).map(content => actualTexts(content).map(item => item.text))).toEqual([
      ['Fieldnote Studio', '2025', 'Evidence, made legible.'],
      ['To our partners and shareholders,'],
      [' The year in figures ', '$2.90M', '$529K', '24.3%', '$930K', '18', '38'],
      [' Where the revenue came from ', ' Revenue by quarter ', ' Recurring revenue ', ' Revenue by client sector '],
      [' Statement of operations '],
    ])
    expect(barModel(report.quarters).alt).toBe('Grouped bar chart of revenue by quarter, in USD thousands. Consulting: Q1 420, Q2 460, Q3 510, Q4 580. Licensing: Q1 180, Q2 210, Q3 240, Q4 300.')
    expect(lineModel(report.monthly).alt).toBe('Line chart of monthly recurring revenue, in USD thousands: it rises every month, from $58K in January to $84K in December.')

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
      await expectReviewedPage(page, baseline, 'annual')
    }
  }, 60_000)
})
