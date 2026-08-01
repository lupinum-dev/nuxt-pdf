import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  PdfDocument,
  PdfImage,
  PdfPage,
  PdfText,
} from '../src/runtime/components'
import { usePdfPageNumbers } from '../src/runtime/composables'
import { DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import { createPdfTemplate } from '../src/runtime/server/registry'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
} from '../src/runtime/shared/template'
import { parsePdf } from './utils/pdf'

const PNG = readFileSync(resolve('test/fixtures/assets/sample.png'))
const FONT_DATA = `data:font/ttf;base64,${readFileSync(
  resolve('test/fixtures/assets/Roboto-Regular.ttf'),
).toString('base64')}` as const

type StressProps = { token: string }

const asTemplate = (
  component: Component,
  definition: PdfDefinition<StressProps>,
): Component => Object.assign(component, {
  [PDF_DEFINITION_PROPERTY]: definition,
})

const stressComponent = (
  index: number,
  multiPass: boolean,
): Component => asTemplate(defineComponent({
  name: `ConcurrentStress${index}`,
  props: { token: { required: true, type: String } },
  setup(props) {
    const pages = multiPass ? usePdfPageNumbers() : undefined
    const destination = `destination-${index}`
    return () => h(PdfDocument, {}, {
      default: () => h(PdfPage, { size: 'A4', style: { padding: 32 } }, {
        default: () => [
          h(PdfText, {
            id: destination,
            bookmark: `Bookmark ${index}`,
            style: { fontFamily: `Stress Font ${index}`, fontSize: 14 },
          }, { default: () => `${props.token} page ${pages?.[destination] ?? 1}` }),
          h(PdfImage, {
            src: `images/unique-${index}.png`,
            style: { height: 8, width: 8 },
          }),
        ],
      }),
    })
  },
}), {
  filename: props => `stress-${props.token}.pdf`,
  title: props => `Stress ${props.token}`,
})

const invalidComponent = asTemplate(defineComponent({
  name: 'InvalidConcurrentStress',
  setup: () => () => h(PdfText, {}, { default: () => 'invalid root' }),
}), {})

const simpleStressComponent = asTemplate(defineComponent({
  name: 'SequentialStress',
  props: { token: { required: true, type: String } },
  setup: props => () => h(PdfDocument, {}, {
    default: () => h(PdfPage, { size: [160, 100] }, {
      default: () => h(PdfText, {}, { default: () => props.token }),
    }),
  }),
}), {
  title: props => `Stress ${props.token}`,
})

describe('render isolation stress', () => {
  it('isolates 20 mixed simultaneous renders, failures, and deadlines', async () => {
    const jobs = Array.from({ length: 20 }, (_, index) => {
      const token = `UNIQUE-${index.toString().padStart(2, '0')}`
      const mode = index % 5
      const component = mode === 3
        ? invalidComponent
        : stressComponent(index, mode === 1 || mode === 2)
      const template = createPdfTemplate<StressProps>(`stress/${index}`, component, {
        assets: {
          [`images/unique-${index}.png`]: { data: PNG, format: 'png' },
        },
        fonts: [{ family: `Stress Font ${index}`, src: FONT_DATA }],
        limits: mode === 4
          ? { ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 0 }
          : DEFAULT_PDF_RENDER_LIMITS,
      })
      return { index, mode, template, token }
    })

    const settled = await Promise.all(jobs.map(async job => ({
      ...job,
      result: await job.template.render({ token: job.token }),
    })).map(promise => promise.then(
      value => ({ status: 'fulfilled' as const, value }),
      reason => ({ status: 'rejected' as const, reason }),
    )))

    const successful = settled.flatMap(item =>
      item.status === 'fulfilled' ? [item.value] : [])
    const failed = settled.flatMap(item =>
      item.status === 'rejected' ? [item.reason] : [])

    expect(successful).toHaveLength(12)
    expect(failed).toHaveLength(8)
    expect(failed.map(error => error.code).sort()).toEqual([
      ...Array.from({ length: 4 }, () => 'PDF_LIMIT_EXCEEDED'),
      ...Array.from({ length: 4 }, () => 'PDF_TREE_INVALID'),
    ].sort())

    const parsed = await Promise.all(successful.map(async job => ({
      ...job,
      pdf: await parsePdf(await job.result.toUint8Array()),
    })))
    for (const job of parsed) {
      const text = job.pdf.pages.map(page => page.text).join('\n')
      expect(job.result.metadata).toEqual({
        filename: `stress-${job.token}.pdf`,
        language: undefined,
        title: `Stress ${job.token}`,
      })
      expect(job.result.diagnostics.passes).toBe(job.mode === 0 ? 1 : 2)
      expect(text).toContain(job.token)
      expect(job.pdf.outline).toMatchObject([{ title: `Bookmark ${job.index}` }])
      for (const other of jobs) {
        if (other.index !== job.index) expect(text).not.toContain(other.token)
      }
    }
  }, 60_000)

  it('keeps 100 sequential renders independent', async () => {
    const template = createPdfTemplate<StressProps>(
      'sequential',
      simpleStressComponent,
    )

    for (let index = 0; index < 100; index += 1) {
      const token = `SEQUENTIAL-${index}`
      const result = await template.render({ token })
      expect(result.metadata.title).toBe(`Stress ${token}`)
      expect(result.diagnostics.pageCount).toBe(1)
    }
  }, 60_000)

  it('renders an explicit 100-page document without state accumulation', async () => {
    const component = asTemplate(defineComponent({
      name: 'HundredPages',
      inheritAttrs: false,
      setup: () => () => h(PdfDocument, {}, {
        default: () => Array.from({ length: 100 }, (_, index) =>
          h(PdfPage, { key: index, size: [200, 200] }, {
            default: () => h(PdfText, {}, { default: () => `PAGE-${index + 1}` }),
          })),
      }),
    }), {})
    const result = await createPdfTemplate(
      'hundred-pages',
      component,
    ).render({})
    const parsed = await parsePdf(await result.toUint8Array())

    expect(result.diagnostics.pageCount).toBe(100)
    expect(parsed.pageCount).toBe(100)
    expect(parsed.pages[0]?.text).toContain('PAGE-1')
    expect(parsed.pages[99]?.text).toContain('PAGE-100')
  }, 60_000)
})
