import { Buffer } from 'node:buffer'
import type { Readable } from 'node:stream'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../src/runtime/components'
import {
  createPdfRegistry,
  createPdfTemplate,
  type PdfPreviewRender,
} from '../src/runtime/server/registry'
import { usePdfPageNumbers } from '../src/runtime/composables/use-pdf-page-numbers'
import { renderPdfPreview } from '../src/runtime/server/preview'
import { NuxtPdfError } from '../src/runtime/shared/errors'
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

const previewRender = (
  overrides: Partial<PdfPreviewRender['diagnostics']> = {},
): PdfPreviewRender => ({
  bytes: new TextEncoder().encode('%PDF-preview'),
  title: 'Preview invoice',
  filename: 'invoice.pdf',
  diagnostics: {
    durationMs: 12,
    byteLength: 12,
    pageCount: 1,
    passes: 1,
    warnings: [],
    ...overrides,
  },
})

const createPreviewTemplate = (
  options: {
    key?: string
    sampleData?: object
    scenarios?: Readonly<Record<string, object>>
    renderForPreview?: (props: object) => Promise<PdfPreviewRender>
  } = {},
) => {
  const key = options.key ?? 'invoice'
  const sampleData = options.sampleData
  const scenarios = options.scenarios ?? {}
  const render = vi.fn(async () => createPdfRenderResult(
    new TextEncoder().encode('%PDF-preview'),
    'invoice.pdf',
  ))
  const renderForPreview = vi.fn(
    options.renderForPreview ?? (async () => previewRender()),
  )
  const template = {
    key,
    file: `pdfs/${key}.vue`,
    definition: { sampleData, scenarios },
    sampleData,
    scenarios,
    scenarioNames: Object.keys(scenarios).sort(),
    getPreviewProps(scenario?: string) {
      return scenario === undefined ? sampleData : scenarios[scenario]
    },
    resolveMetadata() {
      return { title: 'Preview invoice', filename: 'invoice.pdf' }
    },
    render,
    renderForPreview,
  } satisfies PdfTemplate<object> & {
    file: string
    renderForPreview: (props: object) => Promise<PdfPreviewRender>
  }

  return { render, renderForPreview, template }
}

const getPreviewRenderToken = async (response: Response): Promise<string> => {
  const token = /[?&](?:amp;)?render=([^"&]+)/.exec(await response.text())?.[1]
  expect(token).toBeDefined()
  return token!
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

  const templateComponent = (render: () => ReturnType<typeof h>) => {
    const component = defineComponent(() => render)
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: { sampleData: {} } satisfies PdfDefinition<object>,
    })
    return component
  }

  it('attributes font failures to the template file as a layout error', async () => {
    const component = templateComponent(() =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { size: 'A4' }, {
          default: () => h(PdfText, {
            style: { fontFamily: 'Missing Font' },
          }, () => 'x'),
        }),
      }),
    )
    const template = createPdfTemplate('invoice', component, {
      file: 'pdfs/invoice.vue',
    })

    const error = await template.render({}).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: 'PDF_LAYOUT_ERROR',
      templateKey: 'invoice',
      templateFile: 'pdfs/invoice.vue',
    })
    expect((error as NuxtPdfError).message).toContain('pdfs/invoice.vue')
    expect((error as NuxtPdfError).message).toContain(
      'Font family not registered',
    )
  })

  it('attributes construction-time validation errors to name and file exactly once', async () => {
    // A bare component that never called definePdf.
    const component = defineComponent({
      setup: () => () => h(PdfDocument),
    })

    const error = (() => {
      try {
        createPdfTemplate('invoice', component, { file: 'pdfs/invoice.vue' })
        return undefined
      }
      catch (cause) {
        return cause
      }
    })()

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: 'PDF_TEMPLATE_INVALID',
      templateKey: 'invoice',
      templateFile: 'pdfs/invoice.vue',
    })
    // Exactly one attribution: the file appears once and the key exactly once.
    const message = (error as NuxtPdfError).message
    expect(message).toBe(
      'Invalid PDF template "invoice" (pdfs/invoice.vue): definePdf metadata is missing. Add one top-level definePdf({...}) call.',
    )
  })

  it('does not re-wrap render-time template errors that are already attributed', async () => {
    const component = templateComponent(() => h(PdfDocument))
    const template = createPdfTemplate('invoice', component, {
      file: 'pdfs/invoice.vue',
    })

    const error = await template
      .render(null as unknown as Record<string, never>)
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect((error as NuxtPdfError).message).toBe(
      'Invalid PDF template "invoice" (pdfs/invoice.vue): render props must be an object.',
    )
  })

  it('wraps unknown render failures with template context', async () => {
    const component = templateComponent(() => {
      throw new Error('boom in render')
    })
    const template = createPdfTemplate('invoice', component, {
      file: 'pdfs/invoice.vue',
    })

    const error = await template.render({}).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: 'PDF_RENDER_ERROR',
      templateKey: 'invoice',
      templateFile: 'pdfs/invoice.vue',
    })
    expect((error as NuxtPdfError).cause).toBeInstanceOf(Error)
    expect(((error as NuxtPdfError).cause as Error).message).toBe(
      'boom in render',
    )
  })

  it('prefixes render warnings with the template name and file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const component = templateComponent(() =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, { size: 'A4' }, {
          default: () => h(PdfView, null, {
            default: () => h(PdfPage, { key: 'nested' }),
          }),
        }),
      }),
    )
    const template = createPdfTemplate('invoice', component, {
      file: 'pdfs/invoice.vue',
    })

    await template.render({})

    expect(warn).toHaveBeenCalledWith(
      'PDF template "invoice" (pdfs/invoice.vue): Invalid PDF nesting: <PdfView> cannot contain <PdfPage>. The <PdfPage> child was ignored.',
    )

    warn.mockRestore()
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
    expect(await page.text()).toMatch(/src="\/_pdf\/invoice\.pdf\?render=[^"&]+"/)
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

  it('switches scenarios with active tabs and swaps the iframe source', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      scenarios: { long: { id: 'long' }, compact: { id: 'lin' } },
    })
    const registry = { invoice: template }

    const def = await (await renderPdfPreview(registry, { path: 'invoice' })).text()
    const long = await (await renderPdfPreview(registry, {
      path: 'invoice',
      scenario: 'long',
    })).text()

    // Every scenario plus the default sample data is offered as a tab.
    expect(def).toContain('>Default<')
    expect(def).toContain('>long<')
    expect(def).toContain('>compact<')

    // Active state tracks the selected scenario.
    expect(def).toMatch(/class="active" aria-current="page">Default</)
    expect(long).toMatch(/class="active" aria-current="page">long</)

    // The iframe source swaps with the scenario.
    expect(def).toMatch(/src="\/_pdf\/invoice\.pdf\?render=[^"&]+"/)
    expect(long).toMatch(/src="\/_pdf\/invoice\.pdf\?scenario=long&(amp;)?render=[^"&]+"/)
  })

  it('uses opaque, non-sequential parked-render tokens', async () => {
    const { template } = createPreviewTemplate({ sampleData: { id: 'sample' } })
    const registry = { invoice: template }

    const first = await getPreviewRenderToken(
      await renderPdfPreview(registry, { path: 'invoice' }),
    )
    const second = await getPreviewRenderToken(
      await renderPdfPreview(registry, { path: 'invoice' }),
    )

    for (const token of [first, second]) {
      expect(token).toMatch(/^[\w-]+$/)
      expect(token.length).toBeGreaterThanOrEqual(32)
      expect(token).not.toMatch(/^\d+$/)
    }
    expect(second).not.toBe(first)
  })

  it('serves the exact diagnosed bytes to the iframe via the parked render', async () => {
    const diagnosedBytes = new TextEncoder().encode('%PDF-diagnosed-render')
    const { render, template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      renderForPreview: async () => ({
        ...previewRender(),
        bytes: diagnosedBytes,
      }),
    })
    const registry = { invoice: template }

    const viewer = await renderPdfPreview(registry, { path: 'invoice' })
    const token = await getPreviewRenderToken(viewer)

    // The tokened raw route serves the very bytes the diagnostics describe —
    // no second render happens for the embedded viewer.
    const raw = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: token,
    })
    expect(raw.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(diagnosedBytes)
    expect(render).not.toHaveBeenCalled()

    // Successful retrieval consumes the token, so replay falls back to a fresh
    // render instead of serving the parked bytes again.
    const replay = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: token,
    })
    expect(Buffer.from(await replay.arrayBuffer()).toString()).toBe('%PDF-preview')
    expect(render).toHaveBeenCalledTimes(1)

    // A missing/evicted token follows the same fresh-render path.
    const fallback = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: '999999',
    })
    expect(fallback.status).toBe(200)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('binds parked renders to their template and scenario', async () => {
    const diagnosedBytes = new TextEncoder().encode('%PDF-bound-render')
    const scenarios = { long: { id: 'long' } }
    const invoice = createPreviewTemplate({
      sampleData: { id: 'sample' },
      scenarios,
      renderForPreview: async () => ({
        ...previewRender(),
        bytes: diagnosedBytes,
      }),
    })
    const other = createPreviewTemplate({
      key: 'other',
      sampleData: { id: 'sample' },
      scenarios,
    })
    const registry = { invoice: invoice.template, other: other.template }

    const token = await getPreviewRenderToken(await renderPdfPreview(registry, {
      path: 'invoice',
      scenario: 'long',
    }))

    const wrongTemplate = await renderPdfPreview(registry, {
      path: 'other.pdf',
      scenario: 'long',
      render: token,
    })
    expect(new Uint8Array(await wrongTemplate.arrayBuffer())).not.toEqual(diagnosedBytes)
    expect(other.render).toHaveBeenCalledOnce()

    const wrongScenario = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: token,
    })
    expect(new Uint8Array(await wrongScenario.arrayBuffer())).not.toEqual(diagnosedBytes)
    expect(invoice.render).toHaveBeenCalledOnce()

    // Rejected lookups do not consume another template/scenario's token.
    const correct = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      scenario: 'long',
      render: token,
    })
    expect(new Uint8Array(await correct.arrayBuffer())).toEqual(diagnosedBytes)
    expect(invoice.render).toHaveBeenCalledOnce()
  })

  it('expires parked renders before serving them', async () => {
    vi.useFakeTimers()
    try {
      const diagnosedBytes = new TextEncoder().encode('%PDF-expiring-render')
      const { render, template } = createPreviewTemplate({
        sampleData: { id: 'sample' },
        renderForPreview: async () => ({
          ...previewRender(),
          bytes: diagnosedBytes,
        }),
      })
      const registry = { invoice: template }
      const token = await getPreviewRenderToken(
        await renderPdfPreview(registry, { path: 'invoice' }),
      )

      vi.advanceTimersByTime(60_000)

      const expired = await renderPdfPreview(registry, {
        path: 'invoice.pdf',
        render: token,
      })
      expect(new Uint8Array(await expired.arrayBuffer())).not.toEqual(diagnosedBytes)
      expect(render).toHaveBeenCalledOnce()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('reports render diagnostics including passes and collected warnings', async () => {
    const component = defineComponent({
      setup() {
        const pages = usePdfPageNumbers()
        return () => h(PdfDocument, null, {
          default: () => [
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => [
                h(PdfLink, { src: '#sec', style: { color: 'black' } }, () =>
                  `Section ..... ${pages.sec ?? ''}`),
                // Invalid nesting: forces exactly one warning at mount time.
                h(PdfView, null, { default: () => h(PdfPage, { key: 'bad' }) }),
              ],
            }),
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => h(PdfText, { id: 'sec' }, () => 'Section body'),
            }),
          ],
        })
      },
    })
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: { sampleData: {} } satisfies PdfDefinition<object>,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const template = createPdfTemplate('report', component, {
      file: 'pdfs/report.vue',
    })

    const render = await (template as unknown as {
      renderForPreview(props: object): Promise<PdfPreviewRender>
    }).renderForPreview({})

    // usePdfPageNumbers() activates the multi-pass loop; it converges in two.
    expect(render.diagnostics.passes).toBeGreaterThanOrEqual(2)
    expect(render.diagnostics.pageCount).toBe(2)
    expect(render.diagnostics.byteLength).toBeGreaterThan(0)
    expect(render.diagnostics.durationMs).toBeGreaterThan(0)
    // The warn callback is threaded into a collected array, not the console.
    expect(render.diagnostics.warnings).toContainEqual(
      'PDF template "report" (pdfs/report.vue): Invalid PDF nesting: <PdfView> cannot contain <PdfPage>. The <PdfPage> child was ignored.',
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('renders an error panel with code, template, and file when a render fails', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      renderForPreview: async () => {
        throw new NuxtPdfError(
          'PDF_LAYOUT_ERROR',
          'PDF template "invoice" (pdfs/invoice.vue): PDF layout failed: Font family not registered: Roboto',
          { templateKey: 'invoice', templateFile: 'pdfs/invoice.vue' },
        )
      },
    })

    const response = await renderPdfPreview({ invoice: template }, {
      path: 'invoice',
    })
    const body = await response.text()

    // The viewer stays a readable HTML page — the raw route keeps the 500.
    expect(response.status).toBe(200)
    expect(body).toContain('This template failed to render')
    expect(body).toContain('PDF_LAYOUT_ERROR')
    expect(body).toContain('invoice')
    expect(body).toContain('pdfs/invoice.vue')
    expect(body).toContain('Font family not registered')
    // No iframe and no stack dump surface for a failed render.
    expect(body).not.toContain('<iframe')
  })
})
