import { Buffer } from 'node:buffer'
import type { Readable } from 'node:stream'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  PdfDocument,
  PdfPage,
  PdfText,
} from '../src/runtime/components'
import {
  createPdfRegistry,
  createPdfTemplate,
} from '../src/runtime/server/registry'
import { renderPdfPreview } from '../src/runtime/server/preview'
import {
  createPdfRenderResult,
  sanitizePdfFilename,
} from '../src/runtime/server/result'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
  type PdfTemplate,
} from '../src/runtime/shared/template'

vi.mock('#pdf', () => ({ pdf: {} }))

type FixtureProps = {
  name: string
}

const createFixture = () => {
  const component = defineComponent({
    props: {
      name: { type: String, required: true },
    },
    setup(props) {
      return () => h(PdfDocument, null, {
        default: () => h(PdfPage, {
          size: 'A4',
          style: { padding: 32 },
        }, {
          default: () => h(PdfText, {
            style: { fontFamily: 'Helvetica', fontSize: 18 },
          }, () => `Hello ${props.name}`),
        }),
      })
    },
  })
  const sampleData = { name: 'Ada' }
  const scenarios = {
    long: { name: 'Grace Hopper' },
    compact: { name: 'Lin' },
  }
  const definition: PdfDefinition<FixtureProps> = {
    title: props => `Greeting for ${props.name}`,
    filename: props => `greeting-${props.name}.pdf`,
    language: 'en-GB',
    sampleData,
    scenarios,
  }

  Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
    value: definition,
  })

  return { component, definition, sampleData, scenarios }
}

const collectStream = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const createPreviewTemplate = (
  options: {
    sampleData?: object
    scenarios?: Readonly<Record<string, object>>
  } = {},
) => {
  const sampleData = options.sampleData
  const scenarios = options.scenarios ?? {}
  const render = vi.fn(async () => createPdfRenderResult(
    new TextEncoder().encode('%PDF-preview'),
    'invoice.pdf',
  ))
  const template: PdfTemplate<object> = {
    key: 'invoice',
    definition: { sampleData, scenarios },
    sampleData,
    scenarios,
    scenarioNames: Object.keys(scenarios).sort(),
    getPreviewProps(scenario) {
      return scenario === undefined ? sampleData : scenarios[scenario]
    },
    resolveMetadata() {
      return { title: 'Preview invoice', filename: 'invoice.pdf' }
    },
    render,
  }

  return { render, template }
}

describe('PDF render result', () => {
  it('shares one byte execution across every conversion', async () => {
    let executions = 0
    const source = Promise.resolve().then(() => {
      executions += 1
      return new TextEncoder().encode('%PDF-result')
    })
    const result = createPdfRenderResult(source, 'result.pdf')

    const bytes = await result.toUint8Array()
    const buffer = await result.toBuffer()
    const stream = await collectStream(await result.toStream())
    const response = await result.response()

    expect(executions).toBe(1)
    expect(Buffer.from(bytes)).toEqual(buffer)
    expect(stream).toEqual(buffer)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(buffer)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(
      'filename="result.pdf"',
    )
  })

  it('prevents filename header injection and forces the PDF content type', async () => {
    expect(sanitizePdfFilename('../report')).toBe('_report.pdf')

    const result = createPdfRenderResult(new Uint8Array([1, 2, 3]))
    const response = await result.response({
      filename: '../invoice\r\nX-Evil: yes/δοκιμή',
      headers: {
        'content-disposition': 'attachment; filename="unsafe"',
        'content-type': 'text/plain',
      },
    })
    const disposition = response.headers.get('content-disposition') || ''

    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('x-evil')).toBeNull()
    expect(disposition).toMatch(/^attachment; filename=/)
    expect(disposition).toContain(`filename*=UTF-8''`)
    expect(disposition).not.toMatch(/[\r\n]/)
  })
})

describe('PDF runtime registry', () => {
  it('uses attached definePdf metadata and the direct engine pipeline', async () => {
    const fixture = createFixture()
    const template = createPdfTemplate<FixtureProps>(
      'reports/greeting',
      fixture.component,
    )
    const registry = createPdfRegistry({ reportsGreeting: template })

    expect(template.definition).toBe(fixture.definition)
    expect(template.sampleData).toBe(fixture.sampleData)
    expect(template.scenarios).toBe(fixture.scenarios)
    expect(template.scenarioNames).toEqual(['compact', 'long'])
    expect(template.getPreviewProps('long')).toBe(fixture.scenarios.long)
    expect(template.getPreviewProps('missing')).toBeUndefined()
    expect(template.resolveMetadata({ name: 'Ada' })).toEqual({
      title: 'Greeting for Ada',
      filename: 'greeting-Ada.pdf',
      language: 'en-GB',
    })

    expect(registry.pdf).toEqual({ reportsGreeting: template })
    expect(registry.pdfTemplateKeys).toEqual(['reports/greeting'])
    expect(registry.getPdfTemplate('reports/greeting')).toBe(template)

    const result = await registry.renderPdf(
      'reports/greeting',
      { name: 'Ada' },
    )
    const bytes = await result.toUint8Array()
    const response = await result.response()

    expect(Buffer.from(bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(500)
    expect(response.headers.get('content-disposition')).toContain(
      'filename="greeting-Ada.pdf"',
    )
  })

  it('fails usefully for missing metadata and unknown canonical keys', async () => {
    const component = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage),
      }),
    )

    expect(() => createPdfTemplate('broken', component)).toThrow(
      'definePdf metadata is missing',
    )

    const fixture = createFixture()
    const registry = createPdfRegistry({
      greeting: createPdfTemplate<FixtureProps>('greeting', fixture.component),
    })

    await expect(registry.renderPdf('missing', {})).rejects.toMatchObject({
      code: 'PDF_TEMPLATE_NOT_FOUND',
      templateKey: 'missing',
    })
  })
})

describe('development PDF preview', () => {
  it('renders a standalone index and native viewer page', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      scenarios: { long: { id: 'long' } },
    })
    const registry = { invoice: template }

    const index = await renderPdfPreview(registry)
    const page = await renderPdfPreview(registry, { path: 'invoice' })

    expect(index.status).toBe(200)
    expect(await index.text()).toContain('href="/_pdf/invoice"')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('src="/_pdf/invoice.pdf"')
  })

  it('renders raw scenario bytes through the template render path', async () => {
    const long = { id: 'long' }
    const { render, template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      scenarios: { long },
    })

    const response = await renderPdfPreview(
      { invoice: template },
      { path: 'invoice.pdf', scenario: 'long' },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      '%PDF-preview',
    )
    expect(render).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledWith(long)
  })

  it('returns actionable status pages for invalid preview input', async () => {
    const { template } = createPreviewTemplate()
    const registry = { invoice: template }

    const missingData = await renderPdfPreview(registry, { path: 'invoice' })
    const missingScenario = await renderPdfPreview(registry, {
      path: 'invoice',
      scenario: 'long',
    })
    const missingTemplate = await renderPdfPreview(registry, {
      path: 'missing',
    })

    expect(missingData.status).toBe(422)
    expect(await missingData.text()).toContain('Add sampleData to definePdf()')
    expect(missingScenario.status).toBe(404)
    expect(await missingScenario.text()).toContain('Available scenarios: none')
    expect(missingTemplate.status).toBe(404)
  })
})
