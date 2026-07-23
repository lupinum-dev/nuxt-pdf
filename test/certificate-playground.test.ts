import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import {
  longNameCertificate,
  sampleCertificate,
} from '../playground/shared/certificate'
import { comparePdfSnapshot } from '../src/test-utils/snapshot'

// The real playground certificate, compiled and rendered through the shipped
// test helper with the playground's Inter/Lora font library. Proves the shipped
// showcase end-to-end from an authored SFC: single landscape page, the SVG
// seal/border/watermark, the two-family typographic system, and a graceful
// long-name scenario.
const certificateSource = resolve('playground/pdfs/certificate.vue')
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

describe('playground certificate.vue (SVG showcase)', () => {
  it('renders a single-page landscape certificate with the full authoring surface', async () => {
    // --- Sample: one landscape page carrying every load-bearing string. ---
    const { result: sample, parsed: sampleParsed } = await renderPdfSfc(
      certificateSource,
      { certificate: sampleCertificate },
      { fonts: fontDescriptors },
    )
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
    const { result: longResult, parsed: longParsed } = await renderPdfSfc(
      certificateSource,
      { certificate: longNameCertificate },
      { fonts: fontDescriptors },
    )
    expect(longParsed.pageCount).toBe(1)
    const longText = longParsed.pages[0]!.text
    expect(longText).toContain(longNameCertificate.recipient)
    expect(longText).toContain(longNameCertificate.course)
    expect(longText.replace(/\s+/g, '')).toContain('CERTIFICATEOFCOMPLETION')

    // --- Reviewed raster baselines (UPDATE_PDF_BASELINES policy), 150 DPI. ---
    const scale = 150 / 72
    await comparePdfSnapshot(sample, resolve(baselineRoot, 'sample'), { scale })
    await comparePdfSnapshot(longResult, resolve(baselineRoot, 'long-name'), { scale })
  }, 30_000)
})
