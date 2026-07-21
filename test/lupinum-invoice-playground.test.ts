import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePdfSfc } from '../src/build/pdf-sfc-plugin'
import { bundlePdfFonts } from '../src/build/fonts'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import {
  formatLupinumMoney,
  longLupinumInvoice,
  lupinumInvoiceDueDate,
  lupinumInvoiceLineDetail,
  lupinumInvoiceTotals,
  resolveLupinumInvoiceCopy,
  sampleLupinumInvoice,
} from '../playground/shared/lupinum-invoice'
import { comparePageImages, decodePngPage, parsePdf, rasterizePdf } from './utils/pdf'

const templateSource = resolve('playground/pdfs/lupinum-invoice.vue')
const compiledFile = resolve('playground/pdfs/.lupinum-invoice.compiled.mjs')
const fontRoot = resolve('playground/pdfs/fonts')
const logoPath = resolve('playground/pdfs/assets/lupinum-logo.png')
const baselinePath = resolve('test/fixtures/baselines/lupinum-invoice/page-1.png')
const outputPath = resolve('output/pdf/lupinum-invoice.pdf')
const updateBaselines = process.env.UPDATE_PDF_BASELINES === '1'

const fontDeclarations = [
  { family: 'Lupinum Sans', src: 'Geist-Light.otf', fontWeight: 300 },
  { family: 'Lupinum Sans', src: 'Geist-Medium.otf', fontWeight: 500 },
  { family: 'Lupinum Sans', src: 'Geist-Bold.otf', fontWeight: 700 },
  { family: 'Lupinum Mono', src: 'GeistMono-Regular.otf', fontWeight: 400 },
  { family: 'Lupinum Mono', src: 'GeistMono-SemiBold.otf', fontWeight: 600 },
  { family: 'Lupinum Mono', src: 'GeistMono-Bold.otf', fontWeight: 700 },
]

interface PdfDefinitionModule {
  default: object
}

afterEach(async () => {
  await rm(compiledFile, { force: true })
})

const loadTemplate = async () => {
  const source = await readFile(templateSource, 'utf8')
  const compiled = await compilePdfSfc(source, templateSource, 'template')
  await writeFile(compiledFile, compiled.code)
  const module = await import(`${pathToFileURL(compiledFile).href}?v=${Date.now()}`) as PdfDefinitionModule
  const component = module.default as { [PDF_DEFINITION_PROPERTY]?: object }
  const fonts = await bundlePdfFonts(fontDeclarations, { fontRoots: [fontRoot] })
  const logo = await readFile(logoPath)

  expect(component[PDF_DEFINITION_PROPERTY]).toBeTypeOf('object')
  return createPdfTemplate('lupinum-invoice', component, {
    assets: {
      'lupinum-logo.png': { data: logo, format: 'png' },
    },
    fonts,
  })
}

describe('playground lupinum-invoice.vue', () => {
  it('keeps pricing, dates, and editable copy in plain invoice data', () => {
    const invoice = {
      ...sampleLupinumInvoice,
      copy: { totalLabel: 'Gesamtbetrag' },
      discount: { kind: 'percentage' as const, percentage: 10, label: 'Treuerabatt' },
      lines: [
        { id: 'fixed', kind: 'fixed' as const, title: 'Konzept', amount: 100 },
        { id: 'units', kind: 'quantity' as const, title: 'Druck', quantity: 5, unitPrice: 20, unitLabel: 'Exemplare' },
      ],
    }

    expect(lupinumInvoiceTotals(invoice)).toEqual({
      discount: 20,
      net: 180,
      subtotal: 200,
      total: 216,
      vat: 36,
    })
    expect(lupinumInvoiceDueDate(invoice)).toBe('2026-06-10')
    expect(resolveLupinumInvoiceCopy(invoice).totalLabel).toBe('Gesamtbetrag')
    expect(lupinumInvoiceLineDetail(invoice.lines[1]!, invoice.locale)).toBe(
      '5 Exemplare × 20,00 €',
    )
    expect(formatLupinumMoney(3432, invoice.locale)).toBe('3\u00A0432,00\u00A0€')
  })

  it('renders the editable GlasPro reference invoice with reviewed fidelity', async () => {
    const template = await loadTemplate()
    const result = await template.render({ invoice: sampleLupinumInvoice })
    const bytes = await result.toUint8Array()
    const parsed = await parsePdf(bytes)
    const totals = lupinumInvoiceTotals(sampleLupinumInvoice)

    expect(parsed.pageCount).toBe(1)
    expect(totals).toEqual({
      discount: 0,
      net: 2860,
      subtotal: 2860,
      total: 3432,
      vat: 572,
    })

    const text = parsed.pages[0]!.text
    for (const expected of [
      'RECHNUNG RE-260527-1',
      'Glaspro GmbH',
      'Videoproduktion und Schnitt',
      'Entwicklung und Design PDF & Rechner',
      '2 860,00 €',
      '572,00 €',
      '3 432,00 €',
      sampleLupinumInvoice.payment.iban,
      sampleLupinumInvoice.number,
    ]) {
      expect(text).toContain(expected)
    }
    expect(text.replaceAll(/\s/g, '')).toContain('Seite1/1')

    const [page] = await rasterizePdf(bytes, { scale: 2 })
    expect(page).toBeDefined()
    if (updateBaselines) {
      await mkdir(resolve(baselinePath, '..'), { recursive: true })
      await writeFile(baselinePath, page!.png)
      await mkdir(resolve(outputPath, '..'), { recursive: true })
      await writeFile(outputPath, bytes)
    }
    const baseline = await decodePngPage(await readFile(baselinePath), 1)
    expect(comparePageImages(page!, baseline, {
      channelThreshold: 25,
      maxChangedPixelRatio: 0.005,
    })).toMatchObject({
      dimensionsMatch: true,
      matches: true,
      pageNumbersMatch: true,
    })
  }, 30_000)

  it('paginates a long keyed line-item list without losing content', async () => {
    const template = await loadTemplate()
    const bytes = await (await template.render({ invoice: longLupinumInvoice })).toUint8Array()
    const parsed = await parsePdf(bytes)
    const text = parsed.pages.map(page => page.text).join(' ')

    expect(parsed.pageCount).toBeGreaterThan(1)
    for (const line of longLupinumInvoice.lines) {
      expect(text).toContain(line.title)
    }
    for (const page of parsed.pages) {
      expect(page.text.replaceAll(/\s/g, '')).toContain(
        `Seite${page.number}/${parsed.pageCount}`,
      )
    }
    expect(text).toContain('Rechnungsbetrag')
    expect(text).toContain(longLupinumInvoice.payment.iban)
  }, 30_000)
})
