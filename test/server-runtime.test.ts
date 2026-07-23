import { Buffer } from 'node:buffer'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  PdfDocument,
  PdfLink,
  PdfPage,
  PdfText,
} from '../src/runtime/components'
import {
  createPdfPreviewEntry,
  createPdfRegistry,
  createPdfTemplate,
  type PdfRenderDiagnostics,
} from '../src/runtime/server/registry'
import { usePdfPageNumbers } from '../src/runtime/composables/use-pdf-page-numbers'
import { DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/engine/limits'
import { renderPdfPreview } from '../src/runtime/server/preview'
import { NuxtPdfError } from '../src/runtime/shared/errors'
import {
  createContentDisposition,
  createPdfRenderResult,
  sanitizePdfFilename,
} from '../src/runtime/server/result'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
  type PdfTemplate,
} from '../src/runtime/shared/template'
import { installPdfCanvasGlobals } from './utils/pdf'

vi.mock('#pdf', () => ({ pdfPreview: {} }))

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

type DiagnosticsInput = Omit<PdfRenderDiagnostics, 'byteLength'>

const renderDiagnostics = (
  overrides: Partial<DiagnosticsInput> = {},
): DiagnosticsInput => ({
  durationMs: 12,
  pageCount: 1,
  passes: 1,
  registeredFontFaces: [],
  ...overrides,
})

const previewResult = (
  options: {
    bytes?: Uint8Array
    diagnostics?: Partial<DiagnosticsInput>
  } = {},
): ReturnType<typeof createPdfRenderResult> =>
  createPdfRenderResult(
    options.bytes ?? new TextEncoder().encode('%PDF-preview'),
    { filename: 'invoice.pdf', title: 'Preview invoice' },
    renderDiagnostics(options.diagnostics),
  )

const createPreviewTemplate = (
  options: {
    key?: string
    sampleData?: object
    scenarios?: Readonly<Record<string, object>>
    render?: (props: object) => Promise<ReturnType<typeof createPdfRenderResult>>
  } = {},
) => {
  const key = options.key ?? 'invoice'
  const sampleData = options.sampleData
  const scenarios = options.scenarios ?? {}
  const render = vi.fn(async (_props: object) => createPdfRenderResult(
    new TextEncoder().encode('%PDF-preview'),
    { filename: 'invoice.pdf', title: 'Preview invoice' },
    renderDiagnostics(),
  ))
  if (options.render) render.mockImplementation(options.render)

  const resolveMetadata = vi.fn(() => ({
    title: 'Preview invoice',
    filename: 'invoice.pdf',
  }))
  const handle = Object.freeze({
    key,
    resolveMetadata,
    render,
  }) satisfies PdfTemplate<object>

  const component = defineComponent(() => () => h(PdfDocument))
  Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
    value: { sampleData, scenarios } satisfies PdfDefinition<object>,
  })
  const template = createPdfPreviewEntry(handle, component, {
    file: `pdfs/${key}.vue`,
  })

  return { handle, render, resolveMetadata, template }
}

const getPreviewRenderToken = async (response: Response): Promise<string> => {
  const token = /[?&](?:amp;)?render=([^"&]+)/.exec(await response.text())?.[1]
  expect(token).toBeDefined()
  return token!
}

const readPdfMetadata = async (
  bytes: Uint8Array,
): Promise<{ language?: string, title?: string }> => {
  installPdfCanvasGlobals()
  const pdfJs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfJs.getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    stopAtErrors: true,
    useWorkerFetch: false,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    const { info } = await document.getMetadata()
    const record = info as Record<string, unknown>
    return {
      language: typeof record.Language === 'string' ? record.Language : undefined,
      title: typeof record.Title === 'string' ? record.Title : undefined,
    }
  }
  finally {
    await task.destroy()
  }
}

describe('PDF render result', () => {
  it('keeps completed bytes and diagnostics immutable across conversions', async () => {
    const source = new TextEncoder().encode('%PDF-result')
    const expected = Buffer.from(source)
    const faces = [{ family: 'Roboto', fontWeight: 400 as const }]
    const measurements = {
      ...renderDiagnostics({ registeredFontFaces: faces }),
      content: 'must not escape',
      props: { secret: true },
      url: 'https://private.example/asset.png',
    }
    const metadata = {
      filename: 'result.pdf',
      language: 'en-GB',
      title: 'Immutable result',
    }
    const result = createPdfRenderResult(source, metadata, measurements)

    source.fill(0)
    metadata.title = 'Late mutation'
    faces.push({ family: 'Late', fontWeight: 700 })

    const bytes = await result.toUint8Array()
    bytes.fill(1)
    const buffer = await result.toBuffer()
    const response = await result.response()

    expect(buffer).toEqual(expected)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(expected)
    expect(await result.toUint8Array()).toEqual(new Uint8Array(expected))
    expect(result).not.toHaveProperty('toStream')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.metadata)).toBe(true)
    expect(Object.isFrozen(result.diagnostics)).toBe(true)
    expect(Object.isFrozen(result.diagnostics.registeredFontFaces)).toBe(true)
    expect(result.diagnostics).toEqual({
      byteLength: expected.byteLength,
      durationMs: 12,
      pageCount: 1,
      passes: 1,
      registeredFontFaces: [{ family: 'Roboto', fontWeight: 400 }],
    })
    expect(result.metadata).toEqual({
      filename: 'result.pdf',
      language: 'en-GB',
      title: 'Immutable result',
    })
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-length')).toBe(String(expected.byteLength))
    expect(response.headers.get('content-disposition')).toContain(
      'filename="result.pdf"',
    )
  })

  it('isolates concurrent conversions from one completed result', async () => {
    const expected = new TextEncoder().encode('%PDF-concurrent-result')
    const result = createPdfRenderResult(
      expected,
      { filename: 'concurrent.pdf' },
      renderDiagnostics(),
    )

    const [first, second, buffer, response] = await Promise.all([
      result.toUint8Array(),
      result.toUint8Array(),
      result.toBuffer(),
      result.response(),
    ])
    first.fill(1)
    second.fill(2)
    buffer.fill(3)

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected)
    expect(await result.toUint8Array()).toEqual(expected)
  })

  it('always emits bounded safe PDF response headers', async () => {
    expect(sanitizePdfFilename('../report')).toBe('_report.pdf')

    const result = createPdfRenderResult(
      new Uint8Array([1, 2, 3]),
      {},
      renderDiagnostics(),
    )
    const defaultResponse = await result.response()
    const response = await result.response({
      filename: '../invoice\r\nX-Evil: yes/δοκιμή',
      headers: {
        'content-length': '999999',
        'content-disposition': 'attachment; filename="unsafe"',
        'content-type': 'text/plain',
      },
    })
    const disposition = response.headers.get('content-disposition') || ''

    expect(defaultResponse.headers.get('content-disposition')).toContain(
      'filename="document.pdf"',
    )
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-length')).toBe('3')
    expect(response.headers.get('x-evil')).toBeNull()
    expect(disposition).toMatch(/^attachment; filename=/)
    expect(disposition).toContain(`filename*=UTF-8''`)
    expect(disposition).not.toMatch(/[\r\n]/)

    const inline = await result.response({ disposition: 'inline', filename: '' })
    expect(inline.headers.get('content-disposition')).toContain(
      'inline; filename="document.pdf"',
    )
  })

  it('keeps arbitrary Unicode filenames well-formed and header-bounded', () => {
    let state = 0x6D2B79F5
    const random = (): number => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return state >>> 0
    }

    for (let sample = 0; sample < 500; sample += 1) {
      const length = random() % 320
      let input = ''
      for (let index = 0; index < length; index += 1) {
        input += String.fromCharCode(random() & 0xFFFF)
      }

      const filename = sanitizePdfFilename(input)
      const disposition = createContentDisposition('attachment', input)
      const encoded = disposition.split(`filename*=UTF-8''`)[1]!

      expect(filename).toBe(filename.toWellFormed())
      expect(filename).toMatch(/\.pdf$/)
      expect(() => decodeURIComponent(encoded)).not.toThrow()
      expect(decodeURIComponent(encoded)).toBe(filename)
      expect(encoded.length).toBeLessThanOrEqual(600)
      expect(disposition.length).toBeLessThan(1024)
      expect(disposition).not.toMatch(/[\r\n]/)
    }
  })
})

describe('PDF runtime registry', () => {
  it('uses attached definePdf metadata and the direct engine pipeline', async () => {
    const fixture = createFixture()
    const template = createPdfTemplate<FixtureProps>(
      'reports/greeting',
      fixture.component,
    )
    const registry = createPdfRegistry({ 'reports/greeting': template })
    const preview = createPdfPreviewEntry(template, fixture.component, {
      file: 'pdfs/reports/greeting.vue',
    })

    expect(Object.keys(template).sort()).toEqual([
      'key',
      'render',
      'resolveMetadata',
    ])
    expect(preview.template).toBe(template)
    expect(preview.file).toBe('pdfs/reports/greeting.vue')
    expect(preview.scenarioNames).toEqual(['compact', 'long'])
    expect(preview.getPreviewProps()).toBe(fixture.sampleData)
    expect(preview.getPreviewProps('long')).toBe(fixture.scenarios.long)
    expect(preview.getPreviewProps('missing')).toBeUndefined()
    expect(template.resolveMetadata({ name: 'Ada' })).toEqual({
      title: 'Greeting for Ada',
      filename: 'greeting-Ada.pdf',
      language: 'en-GB',
    })
    expect(() => template.resolveMetadata(null as never)).toThrow(
      'metadata props must be an object',
    )

    expect(registry.pdf).toEqual({ 'reports/greeting': template })
    expect(registry.pdfTemplateKeys).toEqual(['reports/greeting'])
    expect(registry.getPdfTemplate('reports/greeting')).toBe(template)
    expect(registry.pdf['reports/greeting']).toBe(template)

    const result = await registry.renderPdf(
      'reports/greeting',
      { name: 'Ada' },
    )
    const bytes = await result.toUint8Array()
    const response = await result.response()

    expect(Buffer.from(bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(500)
    expect(result.diagnostics).toMatchObject({
      byteLength: bytes.byteLength,
      pageCount: 1,
      passes: 1,
    })
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0)
    expect(Object.keys(result.diagnostics).sort()).toEqual([
      'byteLength',
      'durationMs',
      'pageCount',
      'passes',
      'registeredFontFaces',
    ])
    expect(JSON.stringify(result.diagnostics)).not.toContain('Ada')
    expect(Object.isFrozen(result.diagnostics)).toBe(true)
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
    expect(response.headers.get('content-disposition')).toContain(
      'filename="greeting-Ada.pdf"',
    )
  })

  it('writes definePdf title and language over conflicting PdfDocument metadata', async () => {
    const component = defineComponent(() => () =>
      h(PdfDocument, {
        language: 'de-AT',
        title: 'Document fallback',
      }, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, null, () => 'Metadata conflict'),
        }),
      }),
    )
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: {
        language: 'en-GB',
        title: 'Definition wins',
      } satisfies PdfDefinition<object>,
    })

    const result = await createPdfTemplate('metadata-conflict', component).render({})
    const metadata = await readPdfMetadata(await result.toUint8Array())

    expect(metadata).toEqual({
      language: 'en-GB',
      title: 'Definition wins',
    })
    expect(result.metadata).toEqual({
      filename: undefined,
      language: 'en-GB',
      title: 'Definition wins',
    })
  })

  it('preserves PdfDocument metadata when definePdf leaves it absent', async () => {
    const component = defineComponent(() => () =>
      h(PdfDocument, {
        language: 'de-AT',
        title: 'Document fallback',
      }, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, null, () => 'Metadata fallback'),
        }),
      }),
    )
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: { filename: 'fallback.pdf' } satisfies PdfDefinition<object>,
    })

    const result = await createPdfTemplate('metadata-fallback', component).render({})
    const metadata = await readPdfMetadata(await result.toUint8Array())

    expect(metadata).toEqual({
      language: 'de-AT',
      title: 'Document fallback',
    })
    expect(result.metadata).toEqual({
      filename: 'fallback.pdf',
      language: 'de-AT',
      title: 'Document fallback',
    })
  })

  it('includes metadata evaluation in the render deadline and duration', async () => {
    const component = defineComponent(() => () =>
      h(PdfDocument, null, {
        default: () => h(PdfPage, null, {
          default: () => h(PdfText, null, () => 'Timed metadata'),
        }),
      }),
    )
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: {
        title: () => {
          const start = performance.now()
          while (performance.now() - start < 120) {
            // Synchronous metadata is part of the public render operation.
          }
          return 'Timed metadata'
        },
      } satisfies PdfDefinition<object>,
    })

    const timedOut = createPdfTemplate('metadata-timeout', component, {
      limits: {
        ...DEFAULT_PDF_RENDER_LIMITS,
        timeoutMs: 50,
      },
    })
    await expect(timedOut.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      templateKey: 'metadata-timeout',
    })

    const measured = await createPdfTemplate('metadata-duration', component).render({})
    expect(measured.diagnostics.durationMs).toBeGreaterThanOrEqual(120)
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
})

describe('development PDF preview', () => {
  it('renders a standalone index and native viewer page', async () => {
    const sampleData = { id: 'sample' }
    const { render, resolveMetadata, template } = createPreviewTemplate({
      sampleData,
      scenarios: { long: { id: 'long' } },
    })
    const registry = { invoice: template }

    const index = await renderPdfPreview(registry)
    const page = await renderPdfPreview(registry, { path: 'invoice' })

    expect(index.status).toBe(200)
    expect(await index.text()).toContain('href="/_pdf/invoice"')
    expect(page.status).toBe(200)
    expect(await page.text()).toMatch(/src="\/_pdf\/invoice\.pdf\?render=[^"&]+"/)
    expect(resolveMetadata).not.toHaveBeenCalled()
    expect(render).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledWith(sampleData)
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
    expect(long).toContain('createHotContext(\'/_pdf\').on(\'nuxt-pdf:update\'')
    expect(long).toContain('location.reload()')
  })

  it('offers distinct inline and download actions', async () => {
    const { template } = createPreviewTemplate({ sampleData: { id: 'sample' } })
    const registry = { invoice: template }
    const page = await (await renderPdfPreview(registry, { path: 'invoice' })).text()
    const download = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      download: true,
    })

    expect(page).toContain('>Raw PDF<')
    expect(page).toContain('invoice.pdf?download=1')
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('shows safe registered font-face facts without paths or font bytes', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      render: async () => previewResult({
        diagnostics: {
          registeredFontFaces: [{
            family: 'Invoice <Sans>',
            fontStyle: 'italic',
            fontWeight: 600,
          }],
        },
      }),
    })
    const page = await (await renderPdfPreview({ invoice: template }, { path: 'invoice' })).text()

    expect(page).toContain('Registered font faces')
    expect(page).toContain('Invoice &lt;Sans&gt; — 600 italic')
    expect(page).not.toContain('data:font')
    expect(page).not.toContain('/pdfs/fonts/')
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
    let renderCount = 0
    const { render, template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      render: async () => previewResult({
        bytes: renderCount++ === 0
          ? diagnosedBytes
          : new TextEncoder().encode('%PDF-preview'),
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
    expect(render).toHaveBeenCalledOnce()

    // Successful retrieval consumes the token, so replay falls back to a fresh
    // render instead of serving the parked bytes again.
    const replay = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: token,
    })
    expect(Buffer.from(await replay.arrayBuffer()).toString()).toBe('%PDF-preview')
    expect(render).toHaveBeenCalledTimes(2)

    // A missing/evicted token follows the same fresh-render path.
    const fallback = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: '999999',
    })
    expect(fallback.status).toBe(200)
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('binds parked renders to their template and scenario', async () => {
    const diagnosedBytes = new TextEncoder().encode('%PDF-bound-render')
    const scenarios = { long: { id: 'long' } }
    let invoiceRenderCount = 0
    const invoice = createPreviewTemplate({
      sampleData: { id: 'sample' },
      scenarios,
      render: async () => previewResult({
        bytes: invoiceRenderCount++ === 0
          ? diagnosedBytes
          : new TextEncoder().encode('%PDF-preview'),
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
    expect(invoice.render).toHaveBeenCalledTimes(2)

    // Rejected lookups do not consume another template/scenario's token.
    const correct = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      scenario: 'long',
      render: token,
    })
    expect(new Uint8Array(await correct.arrayBuffer())).toEqual(diagnosedBytes)
    expect(invoice.render).toHaveBeenCalledTimes(2)
  })

  it('expires parked renders before serving them', async () => {
    vi.useFakeTimers()
    try {
      const diagnosedBytes = new TextEncoder().encode('%PDF-expiring-render')
      let renderCount = 0
      const { render, template } = createPreviewTemplate({
        sampleData: { id: 'sample' },
        render: async () => previewResult({
          bytes: renderCount++ === 0
            ? diagnosedBytes
            : new TextEncoder().encode('%PDF-preview'),
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
      expect(render).toHaveBeenCalledTimes(2)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps definePdf metadata authoritative through every multi-pass update', async () => {
    const component = defineComponent({
      setup() {
        const pages = usePdfPageNumbers()
        return () => h(PdfDocument, {
          language: 'de-AT',
          title: 'Document fallback',
        }, {
          default: () => [
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => h(
                PdfLink,
                { src: '#sec', style: { color: 'black' } },
                () => `Section ..... ${pages.sec ?? ''}`,
              ),
            }),
            h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
              default: () => h(PdfText, { id: 'sec' }, () => 'Section body'),
            }),
          ],
        })
      },
    })
    Object.defineProperty(component, PDF_DEFINITION_PROPERTY, {
      value: {
        language: 'en-GB',
        sampleData: {},
        title: 'Definition survives feedback',
      } satisfies PdfDefinition<object>,
    })
    const template = createPdfTemplate('report', component, {
      file: 'pdfs/report.vue',
    })

    const result = await template.render({})
    const diagnostics = result.diagnostics
    const metadata = await readPdfMetadata(await result.toUint8Array())

    // usePdfPageNumbers() activates the multi-pass loop; it converges in two.
    expect(diagnostics.passes).toBeGreaterThanOrEqual(2)
    expect(diagnostics.pageCount).toBe(2)
    expect(diagnostics.byteLength).toBeGreaterThan(0)
    expect(diagnostics.durationMs).toBeGreaterThan(0)
    expect(Object.isFrozen(diagnostics)).toBe(true)
    expect(Object.isFrozen(diagnostics.registeredFontFaces)).toBe(true)
    expect((await result.toUint8Array()).byteLength).toBe(
      diagnostics.byteLength,
    )
    expect(metadata).toEqual({
      language: 'en-GB',
      title: 'Definition survives feedback',
    })
  })

  it('renders an error panel with code, template, and file when a render fails', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      render: async () => {
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
    expect(body).toContain('Check the server output for details')
    // No iframe and no stack dump surface for a failed render.
    expect(body).not.toContain('<iframe')
  })

  it('marks the previous successful render stale after an error', async () => {
    let shouldFail = false
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      render: async () => {
        if (shouldFail) {
          throw new NuxtPdfError('PDF_LAYOUT_ERROR', 'PDF layout failed safely.')
        }
        return previewResult({ bytes: new TextEncoder().encode('%PDF-last-good') })
      },
    })
    const registry = { invoice: template }

    await renderPdfPreview(registry, { path: 'invoice' })
    shouldFail = true
    const failed = await renderPdfPreview(registry, { path: 'invoice' })
    const body = await failed.text()
    const token = await getPreviewRenderToken(new Response(body))
    const stale = await renderPdfPreview(registry, {
      path: 'invoice.pdf',
      render: token,
    })

    expect(body).toContain('previous successful PDF')
    expect(body).toContain('(stale)')
    expect(Buffer.from(await stale.arrayBuffer()).toString()).toBe('%PDF-last-good')
  })

  it('redacts unsafe detail from preview errors', async () => {
    const { template } = createPreviewTemplate({
      sampleData: { id: 'sample' },
      render: async () => {
        throw new NuxtPdfError(
          'PDF_RENDER_ERROR',
          'Customer Ada failed at https://private.example/orders/ada?token=secret in /Users/ada/private.pdf',
          { templateFile: '/Users/ada/private.vue', templateKey: 'invoice' },
        )
      },
    })
    const body = await (await renderPdfPreview(
      { invoice: template },
      { path: 'invoice' },
    )).text()

    expect(body).not.toContain('token=secret')
    expect(body).not.toContain('/Users/ada')
    expect(body).not.toContain('private.example/orders')
    expect(body).not.toContain('Customer Ada')
    expect(body).toContain('Check the server output for details')
  })
})
