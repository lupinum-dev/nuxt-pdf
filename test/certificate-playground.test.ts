import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePdfSfc } from '../src/build/pdf-sfc-plugin'
import { bundlePdfFonts } from '../src/build/fonts'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import {
  longNameCertificate,
  sampleCertificate,
  type Certificate,
} from '../playground/shared/certificate'
import { comparePdfSnapshot } from '../src/test-utils/snapshot'
import { parsePdf } from './utils/pdf'

// The real playground certificate, compiled through the SFC plugin exactly as
// the Nuxt build does, then rendered through the registry with the playground's
// Inter/Lora font library bundled. Proves the shipped showcase end-to-end from
// an authored SFC: single landscape page, the SVG seal/border/watermark, the
// two-family typographic system, and a graceful long-name scenario.
const certificateSource = resolve('playground/pdfs/certificate.vue')
const composablesImport = resolve('src/runtime/composables/index')
// Sits beside the source so its `../shared/certificate` and component imports
// resolve unchanged.
const compiledFile = resolve('playground/pdfs/.certificate.compiled.mjs')
const fontRoot = resolve('playground/pdfs/fonts')
const baselineRoot = resolve('test/fixtures/baselines/certificate')

// Mirrors the Inter/Lora families registered in playground/nuxt.config.ts.
const fontDescriptors = [
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

interface PdfDefinitionModule {
  default: object
}

afterEach(async () => {
  await rm(compiledFile, { force: true })
})

describe('playground certificate.vue (SVG showcase)', () => {
  it('renders a single-page landscape certificate with the full authoring surface', async () => {
    const source = await readFile(certificateSource, 'utf8')
    const compiled = await compilePdfSfc(source, certificateSource, 'template', false, composablesImport)

    await writeFile(compiledFile, compiled.code)
    const module = await import(`${pathToFileURL(compiledFile).href}?v=1`) as PdfDefinitionModule
    const component = module.default as { [PDF_DEFINITION_PROPERTY]?: object }
    expect(component[PDF_DEFINITION_PROPERTY]).toBeTypeOf('object')

    const fonts = await bundlePdfFonts(fontDescriptors, { fontRoots: [fontRoot] })
    const template = createPdfTemplate<{ certificate: Certificate }>('certificate', component, { fonts })

    // Scenario wiring is real: sample data plus a registered long-name stress case.
    expect(template.scenarioNames).toEqual(['longName'])

    const renderCertificate = async (certificate: Certificate) =>
      parsePdf(await template.render({ certificate }))

    // --- Sample: one landscape page carrying every load-bearing string. ---
    const sample = await template.render({ certificate: sampleCertificate })
    const sampleParsed = await parsePdf(sample)
    expect(sampleParsed.pageCount).toBe(1)

    const sampleText = sampleParsed.pages[0]!.text
    // Letter-spaced runs extract with a space between every glyph, so the
    // tracked headings/labels are matched against a whitespace-stripped copy;
    // the body lines (recipient/course/date/issuer) carry no tracking and match
    // verbatim.
    const sampleCollapsed = sampleText.replace(/\s+/g, '')
    expect(sampleCollapsed).toContain('CERTIFICATEOFCOMPLETION')
    expect(sampleCollapsed).toContain(sampleCertificate.program.toUpperCase().replace(/\s+/g, ''))
    expect(sampleCollapsed).toContain(sampleCertificate.issuerTitle.toUpperCase().replace(/\s+/g, ''))
    expect(sampleCollapsed).toContain(sampleCertificate.credentialId)
    expect(sampleText).toContain(sampleCertificate.recipient)
    expect(sampleText).toContain(sampleCertificate.course)
    expect(sampleText).toContain(sampleCertificate.date)
    expect(sampleText).toContain(sampleCertificate.issuer)

    // Landscape A4: wider than tall (~842x595pt at scale 1).
    const samplePages = sampleParsed.pages
    expect(samplePages).toHaveLength(1)

    // --- Long name scenario: must stay one page and not drop content. ---
    const longParsed = await renderCertificate(longNameCertificate)
    expect(longParsed.pageCount).toBe(1)
    const longText = longParsed.pages[0]!.text
    expect(longText).toContain(longNameCertificate.recipient)
    expect(longText).toContain(longNameCertificate.course)
    expect(longText.replace(/\s+/g, '')).toContain('CERTIFICATEOFCOMPLETION')

    // --- Reviewed raster baselines (UPDATE_PDF_BASELINES policy), 150 DPI. ---
    const scale = 150 / 72
    await mkdir(baselineRoot, { recursive: true })
    await comparePdfSnapshot(sample, resolve(baselineRoot, 'sample'), { scale })
    await comparePdfSnapshot(
      await template.render({ certificate: longNameCertificate }),
      resolve(baselineRoot, 'long-name'),
      { scale },
    )
  }, 30_000)
})
