import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfLimitsOptions } from '../src/module'
import { checkPdfModuleKeys } from '../src/build/registry-inputs'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { DEFAULT_PDF_RENDER_LIMITS, normalizePdfLimits } from '../src/runtime/server/render-limits'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import { parsePdf } from '../src/test/pdf'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

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

describe('render limits', () => {
  it('applies the generous built-in defaults to a normal render', async () => {
    const template = createPdfTemplate('normal', OnePageDoc, {})
    const parsed = await parsePdf(await (await template.render({})).toUint8Array())

    expect(parsed.pageCount).toBe(1)
  })

  // The cap is checked as each page starts: the render stops at page 4, not
  // after laying out all pages. Catches a cap checked only after the layout,
  // which lets a pagination without end run into the deadline or out of
  // memory first (the message would name all pages).
  it('fails with PDF_LIMIT_EXCEEDED as pagination starts the page after maxPages', async () => {
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
      },
    })

    const error = await template.render({}).catch((cause: unknown) => cause)
    expect(error).toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      templateKey: 'capped',
      templateFile: 'pdfs/capped.vue',
    })
    const message = (error as Error).message
    expect(message).toContain('4 pages')
    expect(message).toContain('3-page limit')
    expect(message).toContain('pdf.limits.maxPages')
  })

  it('fails with PDF_LIMIT_EXCEEDED when the render exceeds the time budget', async () => {
    const template = createPdfTemplate('slow', OnePageDoc, {
      file: 'pdfs/slow.vue',
      limits: {
        ...DEFAULT_PDF_RENDER_LIMITS,
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

  it('fails with PDF_LIMIT_EXCEEDED before layout when the tree exceeds maxNodes', async () => {
    const template = createPdfTemplate('admission', OnePageDoc, {
      limits: renderLimits({ maxNodes: 3 }),
    })

    await expect(template.render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringContaining('more than 3 nodes'),
      templateKey: 'admission',
    })
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
    const counts = 'must be a whole number from 1 to 9,007,199,254,740,991'
    expect(() => normalizePdfLimits({ maxPages: 0 }))
      .toThrow(`pdf.limits.maxPages ${counts}, found 0.`)
    expect(() => normalizePdfLimits({ maxPages: -1 }))
      .toThrow(`pdf.limits.maxPages ${counts}, found -1.`)
    expect(() => normalizePdfLimits({ timeoutMs: 1.5 }))
      .toThrow('pdf.limits.timeoutMs must be a whole number from 1 to 2,147,483,647 ms, found 1.5.')
    expect(() => normalizePdfLimits({ timeoutMs: Number.NaN }))
      .toThrow('pdf.limits.timeoutMs must be a whole number from 1 to 2,147,483,647 ms, found NaN.')
    expect(() => normalizePdfLimits({ maxPages: '2000' as unknown as number }))
      .toThrow(`pdf.limits.maxPages ${counts}, found "2000".`)
    expect(() => normalizePdfLimits({ maxRemoteRequests: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow(`pdf.limits.maxRemoteRequests ${counts}, found 9007199254740992.`)
  })

  // Catches a time limit above what a Node timer can wait: the timer fires
  // after 1 ms, and every render fails at once with "elapsed 1ms".
  it.each(['timeoutMs', 'markdownTimeoutMs'] as const)('limits %s to the longest Node timer', (key) => {
    expect(normalizePdfLimits({ [key]: 2 ** 31 - 1 })?.[key]).toBe(2 ** 31 - 1)
    expect(() => normalizePdfLimits({ [key]: 2 ** 31 }))
      .toThrow(`pdf.limits.${key} must be a whole number from 1 to 2,147,483,647 ms, found 2147483648.`)
  })

  it('rejects invalid containers and unknown fields', () => {
    expect(() => normalizePdfLimits(null as unknown as undefined))
      .toThrow('pdf.limits must be an object.')
    expect(() => normalizePdfLimits({ legacyCap: 1 } as PdfLimitsOptions))
      .toThrow('pdf.limits.legacyCap is not supported.')
    // An inherited name is not an option either.
    expect(() => normalizePdfLimits({ toString: 5 } as PdfLimitsOptions))
      .toThrow('pdf.limits.toString is not supported.')
  })

  // Catches a misspelled or foreign top-level key that does nothing: module
  // setup must name it and the keys it reads.
  it('rejects an unknown top-level pdf key', () => {
    expect(() => checkPdfModuleKeys({ fonts: [], font: [] }))
      .toThrow('pdf.font is not supported. The pdf options are fonts, limits, remote.')
    expect(() => checkPdfModuleKeys({ fonts: [], limits: {}, remote: { allow: [] } })).not.toThrow()
  })

  // Catches a removed option that is silently ignored, or kept under an old
  // name with a new meaning: an operator who set it must learn what to set.
  it.each([
    ['maxImageBytes', 'there is no per-image cap any more. Set pdf.limits.maxTotalImageBytes'],
    ['maxImagePixels', 'there is no per-image cap any more. Set pdf.limits.maxTotalImagePixels'],
    ['maxAttachmentBytes', 'rename it to pdf.limits.maxTotalAttachmentBytes.'],
    ['maxTreeDepth', 'remove it. pdf.limits.maxNodes bounds the tree.'],
    ['maxTextCharacters', 'remove it.'],
    ['maxImages', 'remove it.'],
    ['maxRemoteConcurrency', 'remove it. A render runs at most four remote requests at a time'],
    ['maxOutputBytes', 'remove it.'],
  ])('rejects the removed option %s with what to do instead', (key, hint) => {
    expect(() => normalizePdfLimits({ [key]: 1 } as PdfLimitsOptions))
      .toThrow(`pdf.limits.${key} was removed: ${hint}`)
  })

  it.each([
    'maxTotalImageBytes',
    'maxTotalImagePixels',
    'maxTotalAttachmentBytes',
  ] as const)('accepts the total budget %s', (key) => {
    expect(normalizePdfLimits({ [key]: 7 })?.[key]).toBe(7)
  })

  it('keeps eight options', () => {
    expect(Object.keys(DEFAULT_PDF_RENDER_LIMITS)).toEqual([
      'timeoutMs',
      'markdownTimeoutMs',
      'maxPages',
      'maxNodes',
      'maxTotalImageBytes',
      'maxTotalImagePixels',
      'maxRemoteRequests',
      'maxTotalAttachmentBytes',
    ])
  })
})
