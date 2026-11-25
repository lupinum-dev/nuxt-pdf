import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPdfSfc } from '../src/test'
import {
  longNameCertificate,
  sampleCertificate,
} from '../playground/shared/certificate'
import { playgroundFonts } from './fixtures/playground-fonts'
import { expectReviewedSnapshot } from './raster'

// The real playground certificate, compiled and rendered through the shipped
// test helper with the playground's font library. Proves the shipped showcase
// end-to-end from an authored SFC: single landscape page, the SVG seal inside
// the frame, and a graceful long-name scenario.
const certificateSource = resolve('playground/pdfs/certificate.vue')
const baselineRoot = resolve('test/fixtures/baselines/certificate')

describe('playground certificate.vue (SVG showcase)', () => {
  it('renders a single-page landscape certificate with the full authoring surface', async () => {
    // --- Sample: one landscape page carrying every load-bearing string. ---
    const { result: sample, parsed: sampleParsed } = await renderPdfSfc(
      certificateSource,
      { certificate: sampleCertificate },
      { fonts: playgroundFonts },
    )
    expect(sampleParsed.pageCount).toBe(1)

    const sampleText = sampleParsed.pages[0]!.text
    expect(sampleText).toContain('Certificate of completion')
    expect(sampleText).toContain(sampleCertificate.program)
    expect(sampleText).toContain(sampleCertificate.issuerTitle)
    expect(sampleText).toContain(sampleCertificate.credentialId)
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
      { fonts: playgroundFonts },
    )
    expect(longParsed.pageCount).toBe(1)
    const longText = longParsed.pages[0]!.text
    expect(longText).toContain(longNameCertificate.recipient)
    expect(longText).toContain(longNameCertificate.course)
    expect(longText).toContain('Certificate of completion')

    // --- Reviewed raster baselines (UPDATE_PDF_BASELINES policy), 150 DPI. ---
    const scale = 150 / 72
    await expectReviewedSnapshot(sample, resolve(baselineRoot, 'sample'), scale)
    await expectReviewedSnapshot(longResult, resolve(baselineRoot, 'long-name'), scale)
  }, 30_000)
})
