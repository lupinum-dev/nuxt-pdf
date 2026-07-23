import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  PdfDocument,
  PdfImage,
  PdfPage,
  PdfText,
} from '../src/runtime/components'
import { usePdfPageNumbers } from '../src/runtime/composables'
import { createPdfTemplate } from '../src/runtime/server/registry'
import {
  DEFAULT_PDF_MAX_PAGES,
  DEFAULT_PDF_RENDER_LIMITS,
  DEFAULT_PDF_TIMEOUT_MS,
  normalizePdfLimits,
  type PdfLimitsOptions,
} from '../src/runtime/server/engine/limits'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import { parsePdf } from './utils/pdf'

const asTemplate = (component: Component): Component =>
  Object.assign(component, { [PDF_DEFINITION_PROPERTY]: {} })

const renderLimits = (
  overrides: Partial<typeof DEFAULT_PDF_RENDER_LIMITS>,
) => ({ ...DEFAULT_PDF_RENDER_LIMITS, ...overrides })

// A tiny page forces the same modest body to paginate into many pages, so a low
// `maxPages` cap is exceeded without any large content.
const ManyPageDoc = asTemplate(defineComponent({
  name: 'ManyPageDoc',
  setup() {
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, { size: [140, 90], style: { padding: 6, fontSize: 12 } }, {
        default: () => Array.from({ length: 40 }, (_, index) =>
          h(PdfText, { key: index }, { default: () => `Line ${index + 1}` })),
      }),
    })
  },
}))

const OnePageDoc = asTemplate(defineComponent({
  name: 'OnePageDoc',
  setup() {
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
        default: () => h(PdfText, { style: { fontSize: 18 } }, { default: () => 'Hello' }),
      }),
    })
  },
}))

const LateTreeDoc = asTemplate(defineComponent({
  name: 'LateTreeDoc',
  setup() {
    const pages = usePdfPageNumbers()
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, {}, {
        default: () => [
          h(PdfText, { id: 'target' }, { default: () => 'Target' }),
          ...(pages.target === undefined
            ? []
            : Array.from({ length: 20 }, (_, index) =>
                h(PdfText, { key: index }, { default: () => `Late ${index}` }))),
        ],
      }),
    })
  },
}))

const lateImageBytes = readFileSync(fileURLToPath(new URL(
  './fixtures/assets/sample.png',
  import.meta.url,
)))
const lateImagePath = fileURLToPath(new URL(
  './fixtures/assets/sample.png',
  import.meta.url,
))

const lateImageDocument = (source: string): Component => asTemplate(defineComponent({
  name: 'LateImageDocument',
  setup() {
    const pages = usePdfPageNumbers()
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, {}, {
        default: () => [
          h(PdfText, { id: 'target' }, { default: () => 'Target' }),
          ...(pages.target === undefined
            ? []
            : [h(PdfImage, {
                src: source,
                style: { height: 100, width: 100 },
              })]),
        ],
      }),
    })
  },
}))

const MultiPassImageDoc = asTemplate(defineComponent({
  name: 'MultiPassImageDocument',
  setup() {
    const pages = usePdfPageNumbers()
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, {}, {
        default: () => [
          h(PdfText, { id: 'target' }, {
            default: () => `Target ${pages.target ?? ''}`,
          }),
          h(PdfImage, {
            src: 'sample.png',
            style: { height: 100, width: 100 },
          }),
        ],
      }),
    })
  },
}))

describe('render limits', () => {
  it('applies the generous built-in defaults to a normal render', async () => {
    const template = createPdfTemplate('normal', OnePageDoc, {})
    const parsed = await parsePdf(await (await template.render({})).toUint8Array())

    expect(parsed.pageCount).toBe(1)
  })

  it('fails with PDF_LIMIT_EXCEEDED when the laid-out page count exceeds maxPages', async () => {
    // Learn the real page count first, so the assertion tracks the fixture.
    const measured = await parsePdf(
      await (await createPdfTemplate('measure', ManyPageDoc, {}).render({})).toUint8Array(),
    )
    const pageCount = measured.pageCount
    expect(pageCount).toBeGreaterThan(3)

    const template = createPdfTemplate('capped', ManyPageDoc, {
      file: 'pdfs/capped.vue',
      limits: {
        ...DEFAULT_PDF_RENDER_LIMITS,
        maxPages: 3,
        timeoutMs: DEFAULT_PDF_TIMEOUT_MS,
      },
    })

    const error = await template.render({}).catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      templateKey: 'capped',
      templateFile: 'pdfs/capped.vue',
    })
    const message = (error as Error).message
    expect(message).toContain(`${pageCount} pages`)
    expect(message).toContain('3-page limit')
    expect(message).toContain('pdf.limits.maxPages')
  })

  it('fails with PDF_LIMIT_EXCEEDED when the render exceeds the time budget', async () => {
    const template = createPdfTemplate('slow', OnePageDoc, {
      file: 'pdfs/slow.vue',
      limits: {
        ...DEFAULT_PDF_RENDER_LIMITS,
        maxPages: DEFAULT_PDF_MAX_PAGES,
        timeoutMs: 0,
      },
    })

    const error = await template.render({}).catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      templateKey: 'slow',
    })
    const message = (error as Error).message
    expect(message).toContain('0ms time budget')
    expect(message).toContain('pdf.limits.timeoutMs')
  })

  it.each([
    ['maxNodes', { maxNodes: 3 }, 'more than 3 nodes'],
    ['maxTreeDepth', { maxTreeDepth: 2 }, 'tree depth exceeded 2'],
    ['maxTextCharacters', { maxTextCharacters: 4 }, 'text exceeded 4 characters'],
  ] as const)('enforces the pre-layout %s admission budget', async (
    _name,
    override,
    message,
  ) => {
    const template = createPdfTemplate('admission', OnePageDoc, {
      limits: renderLimits(override),
    })

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining(message),
      templateKey: 'admission',
    })
  })

  it('destroys serialization when output exceeds maxOutputBytes', async () => {
    const template = createPdfTemplate('output-cap', OnePageDoc, {
      limits: renderLimits({ maxOutputBytes: 100 }),
    })

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('pdf.limits.maxOutputBytes (100)'),
      templateKey: 'output-cap',
    })
  })

  it('re-applies tree admission after page-number feedback changes the tree', async () => {
    const template = createPdfTemplate('late-tree', LateTreeDoc, {
      limits: renderLimits({ maxNodes: 10 }),
    })

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('more than 10 nodes'),
      templateKey: 'late-tree',
    })
  })

  it('re-applies image admission after page-number feedback introduces an image', async () => {
    const template = createPdfTemplate('late-image', lateImageDocument('sample.png'), {
      assets: {
        'sample.png': {
          data: lateImageBytes,
          format: 'png',
        },
      },
      limits: renderLimits({
        maxImageBytes: 100,
        maxTotalImageBytes: 100,
      }),
    })

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('100-byte source limit'),
      templateKey: 'late-image',
    })
  })

  it('blocks an absolute image introduced after page-number feedback', async () => {
    const template = createPdfTemplate(
      'late-absolute-image',
      lateImageDocument(lateImagePath),
    )

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_ASSET_BLOCKED',
      message: expect.stringContaining('relative local asset path'),
      templateKey: 'late-absolute-image',
    })
  })

  it('charges a stable image once across multi-pass re-admission', async () => {
    const template = createPdfTemplate('multi-pass-image', MultiPassImageDoc, {
      assets: {
        'sample.png': {
          data: lateImageBytes,
          format: 'png',
        },
      },
      limits: renderLimits({
        maxImageBytes: lateImageBytes.byteLength,
        maxTotalImageBytes: lateImageBytes.byteLength,
      }),
    })

    const result = await template.render({})
    expect(result.diagnostics.passes).toBeGreaterThanOrEqual(2)
    expect(result.diagnostics.pageCount).toBe(1)
  })
})

describe('normalizePdfLimits', () => {
  it('returns undefined when no limits are configured', () => {
    expect(normalizePdfLimits(undefined)).toBeUndefined()
  })

  it('fills per-field defaults for a partial configuration', () => {
    expect(normalizePdfLimits({ maxPages: 10 })).toEqual({
      ...DEFAULT_PDF_RENDER_LIMITS,
      maxPages: 10,
    })
    expect(normalizePdfLimits({ timeoutMs: 5000 })).toEqual({
      ...DEFAULT_PDF_RENDER_LIMITS,
      timeoutMs: 5000,
    })
  })

  it('rejects non-positive, non-integer, and non-numeric values', () => {
    expect(() => normalizePdfLimits({ maxPages: 0 }))
      .toThrow('pdf.limits.maxPages must be a positive safe integer.')
    expect(() => normalizePdfLimits({ maxPages: -1 }))
      .toThrow('pdf.limits.maxPages must be a positive safe integer.')
    expect(() => normalizePdfLimits({ timeoutMs: 1.5 }))
      .toThrow('pdf.limits.timeoutMs must be a positive safe integer.')
    expect(() => normalizePdfLimits({ timeoutMs: Number.NaN }))
      .toThrow('pdf.limits.timeoutMs must be a positive safe integer.')
    expect(() => normalizePdfLimits({ maxPages: '2000' as unknown as number }))
      .toThrow('pdf.limits.maxPages must be a positive safe integer.')
    expect(() => normalizePdfLimits({ maxOutputBytes: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow('pdf.limits.maxOutputBytes must be a positive safe integer.')
  })

  it('rejects invalid containers and unknown fields', () => {
    expect(() => normalizePdfLimits(null as unknown as undefined))
      .toThrow('pdf.limits must be an object.')
    expect(() => normalizePdfLimits({ legacyCap: 1 } as PdfLimitsOptions))
      .toThrow('pdf.limits.legacyCap is not supported.')
  })
})
