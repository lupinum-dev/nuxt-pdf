import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
// Import through the shipped public entry so the test exercises exactly what
// users get from `@lupinum/nuxt-pdf/test`.
import {
  PdfAssertionError,
  comparePdfSnapshot,
  expectPdf,
  parsePdf,
  renderPdfSfc,
  renderPdfTemplate,
  type RenderPdfSfcOptions,
  type RenderPdfTemplateOptions,
} from '../src/test/index'
import { sampleInvoice } from '../playground/shared/invoice'

// A realistic, self-contained template: two explicit pages, an internal link to
// a bookmarked section, and an external link — no Nuxt and no SFC.
const InvoiceDoc = defineComponent({
  name: 'InvoiceDoc',
  props: { customer: { type: String, required: true } },
  setup(props) {
    return () =>
      h(PdfDocument, {}, {
        default: () => [
          h(PdfPage, { size: 'A4', style: { padding: 40, fontFamily: 'Helvetica' } }, {
            default: () => [
              h(PdfText, { style: { fontSize: 20, marginBottom: 12 } }, { default: () => `Invoice for ${props.customer}` }),
              h(PdfLink, { href: '#terms', style: { fontSize: 12, marginBottom: 6 } }, { default: () => 'See the terms' }),
              h(PdfLink, { href: 'https://example.com', style: { fontSize: 12 } }, { default: () => 'Visit example.com' }),
            ],
          }),
          h(PdfPage, { size: 'A4', style: { padding: 40, fontFamily: 'Helvetica' } }, {
            default: () => h(PdfView, { id: 'terms', bookmark: { title: 'Terms' } }, {
              default: () => h(PdfText, { style: { fontSize: 14 } }, { default: () => 'Terms and conditions apply.' }),
            }),
          }),
        ],
      })
  },
})

function verifyPublicOptionTypes(): void {
  const templateOptions: RenderPdfTemplateOptions = {
    limits: { maxPages: 2 },
    remote: { allow: ['https://assets.example.com/pdf/'] },
  }
  const sfcOptions: RenderPdfSfcOptions = {
    ...templateOptions,
    fonts: [{ family: 'Invoice Sans', src: 'InvoiceSans-Regular.ttf' }],
  }
  void templateOptions
  void sfcOptions

  // @ts-expect-error Props are inferred from the component, so required props stay required.
  void renderPdfTemplate(InvoiceDoc, {})
  void renderPdfTemplate(InvoiceDoc, {
    customer: 'Acme Corp',
    // @ts-expect-error Vue vnode props are not accepted as authored template props.
    class: 'not-a-template-prop',
  })

  void renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' }, {
    // @ts-expect-error Prepared asset maps are registry internals, not user configuration.
    assets: {},
  })
  void renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' }, {
    // @ts-expect-error Embedded font descriptors are build output, not direct-template input.
    fonts: [],
  })
  void renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' }, {
    // @ts-expect-error Attribution is inferred instead of configured by callers.
    key: 'invoice',
  })
  void renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' }, {
    // @ts-expect-error Source attribution is inferred instead of configured by callers.
    file: 'pdfs/invoice.vue',
  })
  void renderPdfSfc('./pdfs/invoice.vue', {}, {
    // @ts-expect-error The application root is inferred from the SFC path.
    rootDir: '/tmp/app',
  })
  void renderPdfSfc('./pdfs/invoice.vue', {}, {
    // @ts-expect-error The template key is inferred from the SFC path.
    key: 'invoice',
  })
}
void verifyPublicOptionTypes

describe('@lupinum/nuxt-pdf/test public surface', () => {
  it('rejects removed registry options instead of silently ignoring them', async () => {
    const removedTemplateOptions = {
      assets: {},
      file: 'pdfs/invoice.vue',
      fonts: [],
      key: 'invoice',
    }
    for (const [key, value] of Object.entries(removedTemplateOptions)) {
      await expect(renderPdfTemplate(
        InvoiceDoc,
        { customer: 'Acme Corp' },
        { [key]: value } as RenderPdfTemplateOptions,
      )).rejects.toThrow(`renderPdfTemplate received unsupported option "${key}"`)
    }

    for (const key of ['key', 'rootDir']) {
      await expect(renderPdfSfc(
        './missing/pdfs/invoice.vue',
        {},
        { [key]: 'invoice' } as RenderPdfSfcOptions,
      )).rejects.toThrow(`renderPdfSfc received unsupported option "${key}"`)
    }
  })

  it('renders a template through the real pipeline and parses it', async () => {
    const { bytes, parsed, result } = await renderPdfTemplate(
      InvoiceDoc,
      { customer: 'Acme Corp' },
    )

    expect(bytes.length).toBeGreaterThan(0)
    expect(result.diagnostics).toMatchObject({
      byteLength: bytes.byteLength,
      layoutWarnings: [],
      pageCount: 2,
      passes: 1,
      registeredFontFaces: [],
    })
    expect(Object.isFrozen(result.diagnostics)).toBe(true)

    // The fluent assertions pass against a genuinely rendered document.
    expectPdf(parsed)
      .toHavePageCount(2)
      .toContainText('Invoice for Acme Corp', { page: 1 })
      .toContainText('Terms and conditions apply.', { page: 2 })
      .toHaveLink({ destination: 'terms', page: 1 })
      .toHaveLink({ url: 'https://example.com/' })
      .toHaveOutline([{ title: 'Terms' }])

    // parsePdf accepts the PdfRenderResult directly, awaiting its bytes.
    const fromResult = await parsePdf(result)
    expect(fromResult.pageCount).toBe(2)
    expect(fromResult.links.map(link => link.destination)).toContain('terms')
    expect(fromResult.pages[0]?.width).toBeCloseTo(595.28, 1)
    expect(fromResult.pages[0]?.height).toBeCloseTo(841.89, 1)
    expect(fromResult.pages[0]?.textRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fontSize: 20,
        text: 'Invoice for Acme Corp',
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    ]))
  }, 30_000)

  it('accepts and validates user-shaped remote and limit options', async () => {
    const rendered = await renderPdfTemplate(
      InvoiceDoc,
      { customer: 'Acme Corp' },
      {
        limits: { maxPages: 2 },
        remote: { allow: ['https://assets.example.com/pdf/'] },
      },
    )
    expect(rendered.result.diagnostics.pageCount).toBe(2)

    await expect(renderPdfTemplate(
      InvoiceDoc,
      { customer: 'Acme Corp' },
      { limits: { maxPages: 1 } },
    )).rejects.toThrow(/exceeding the 1-page limit/)

    await expect(renderPdfTemplate(
      InvoiceDoc,
      { customer: 'Acme Corp' },
      { remote: { allow: ['http://assets.example.com/pdf/'] } },
    )).rejects.toThrow(/pdf\.remote\.allow entries must use the https:\/\/ scheme/)

    await expect(renderPdfTemplate(
      InvoiceDoc,
      { customer: 'Acme Corp' },
      { limits: { maxPages: 0 } },
    )).rejects.toThrow(/pdf\.limits\.maxPages must be a positive safe integer/)
  }, 30_000)

  it('compiles a real nested PDF SFC graph with local resources', async () => {
    const rendered = await renderPdfSfc(
      resolve('playground/pdfs/invoice.vue'),
      { invoice: sampleInvoice },
      {
        fonts: [{ family: 'Fieldnote Sans', src: 'Roboto-Regular.ttf' }],
      },
    )

    expectPdf(rendered.parsed)
      .toContainText(sampleInvoice.number)
      .toContainText(sampleInvoice.customer.name)
    expect(rendered.result.diagnostics.pageCount).toBeGreaterThan(0)
  }, 30_000)

  it('throws PdfAssertionError with actionable messages on failure', async () => {
    const { parsed } = await renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' })

    expect(() => expectPdf(parsed).toHavePageCount(99))
      .toThrow(/Expected the PDF to have 99 page\(s\), but it has 2/)

    expect(() => expectPdf(parsed).toContainText('nowhere to be found', { page: 1 }))
      .toThrow(/Expected page 1 to contain "nowhere to be found"/)

    const missingLink = () => expectPdf(parsed).toHaveLink({ destination: 'missing' })
    expect(missingLink).toThrow(PdfAssertionError)
    expect(missingLink).toThrow(/Expected a link matching \{ destination="missing" \}/)

    expect(() => expectPdf(parsed).toHaveOutline([{ title: 'Wrong title' }]))
      .toThrow(/Outline did not match.*Wrong title/)
  }, 30_000)

  it('supports the reviewed raster baseline flow (write then compare)', async () => {
    const { bytes } = await renderPdfTemplate(InvoiceDoc, { customer: 'Acme Corp' })
    const baselineDir = await mkdtemp(join(tmpdir(), 'nuxt-pdf-snapshot-'))

    try {
      // Missing baseline is an actionable failure, not a silent pass.
      await expect(comparePdfSnapshot(bytes, join(baselineDir, 'absent')))
        .rejects.toThrow(/No reviewed PDF baseline found/)

      const written = await comparePdfSnapshot(bytes, baselineDir, { update: true })
      expect(written).toMatchObject({ updated: true, matches: true })

      const compared = await comparePdfSnapshot(bytes, baselineDir)
      expect(compared).toMatchObject({ updated: false, matches: true })
      expect(compared.pages).toHaveLength(2)

      // A materially different render must fail against the reviewed baseline.
      const { bytes: other } = await renderPdfTemplate(
        InvoiceDoc,
        { customer: 'A Completely Different Customer Name Entirely' },
      )
      const artifactDir = join(baselineDir, 'failure-artifacts')
      await expect(comparePdfSnapshot(other, baselineDir, { artifactDir }))
        .rejects.toThrow(/Expected, actual, diff, and metrics artifacts/)
      expect(await readdir(artifactDir)).toEqual(expect.arrayContaining([
        'metrics.json',
        'page-1-actual.png',
        'page-1-diff.png',
        'page-1-expected.png',
      ]))
      const metrics = JSON.parse(await readFile(join(artifactDir, 'metrics.json'), 'utf8'))
      expect(metrics.pages[0]).toMatchObject({
        matches: false,
        page: 1,
      })
    }
    finally {
      await rm(baselineDir, { force: true, recursive: true })
    }
  }, 30_000)
})
