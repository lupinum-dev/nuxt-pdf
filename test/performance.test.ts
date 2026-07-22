import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import { PdfDocument, PdfPage, PdfText } from '../src/runtime/components'
import { usePdfPageNumbers } from '../src/runtime/composables'
import { createPdfTemplate } from '../src/runtime/server/registry'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
} from '../src/runtime/shared/template'

type Metrics = Record<string, number>

const baselinePath = resolve('test/fixtures/performance/linux-node24.json')
const reportPath = resolve('reports/performance.json')

const asTemplate = (component: Component, definition: PdfDefinition = {}): Component =>
  Object.assign(component, { [PDF_DEFINITION_PROPERTY]: definition })

const invoice = asTemplate(defineComponent({
  name: 'PerformanceInvoice',
  props: { token: { required: true, type: String } },
  setup: props => () => h(PdfDocument, {}, {
    default: () => h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
      default: () => [
        h(PdfText, { style: { fontSize: 24, marginBottom: 16 } }, { default: () => `Invoice ${props.token}` }),
        ...Array.from({ length: 40 }, (_, index) =>
          h(PdfText, { style: { fontSize: 10, marginBottom: 3 } }, {
            default: () => `Line ${index + 1} — EUR ${(index + 1) * 12}.00`,
          })),
      ],
    }),
  }),
}), { title: 'Performance invoice' })

const hundredPages = asTemplate(defineComponent({
  name: 'PerformanceHundredPages',
  setup: () => () => h(PdfDocument, {}, {
    default: () => Array.from({ length: 100 }, (_, index) =>
      h(PdfPage, { size: [180, 120] }, {
        default: () => h(PdfText, {}, { default: () => `Page ${index + 1}` }),
      })),
  }),
}))

const multiPassReport = asTemplate(defineComponent({
  name: 'PerformanceMultiPass',
  setup() {
    const pages = usePdfPageNumbers()
    return () => h(PdfDocument, {}, {
      default: () => [
        h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
          default: () => h(PdfText, {}, { default: () => `Section ..... ${pages.section ?? ''}` }),
        }),
        h(PdfPage, { size: 'A4', style: { padding: 40 } }, {
          default: () => [
            h(PdfText, { id: 'section', style: { fontSize: 20 } }, { default: () => 'Section' }),
            ...Array.from({ length: 80 }, (_, index) =>
              h(PdfText, { style: { fontSize: 10 } }, { default: () => `Report row ${index + 1}` })),
          ],
        }),
      ],
    })
  },
}), { maxPasses: 4 })

const elapsed = async (render: () => Promise<unknown>): Promise<number> => {
  const start = performance.now()
  await render()
  return performance.now() - start
}

const median = (values: number[]): number =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!

describe('fixed-environment performance evidence', () => {
  it('records the release workloads and enforces the Linux baseline', async () => {
    globalThis.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const invoiceTemplate = createPdfTemplate<{ token: string }>('performance-invoice', invoice)
    const coldRenderMs = await elapsed(() => invoiceTemplate.render({ token: 'cold' }))
    const warmRuns: number[] = []
    let warmOutputBytes = 0

    for (let index = 0; index < 5; index += 1) {
      const start = performance.now()
      const result = await invoiceTemplate.render({ token: `warm-${index}` })
      warmRuns.push(performance.now() - start)
      warmOutputBytes = result.diagnostics.byteLength
    }

    const hundredTemplate = createPdfTemplate('performance-100-pages', hundredPages)
    let hundredOutputBytes = 0
    const hundredPagesMs = await elapsed(async () => {
      hundredOutputBytes = (await hundredTemplate.render({})).diagnostics.byteLength
    })

    const reportTemplate = createPdfTemplate('performance-multi-pass', multiPassReport)
    let multiPassOutputBytes = 0
    const multiPassReportMs = await elapsed(async () => {
      const result = await reportTemplate.render({})
      expect(result.diagnostics.passes).toBe(2)
      multiPassOutputBytes = result.diagnostics.byteLength
    })

    for (let index = 0; index < 100; index += 1) {
      await invoiceTemplate.render({ token: `sequential-${index}` })
    }
    globalThis.gc?.()
    const heapAfter = process.memoryUsage().heapUsed

    const metrics: Metrics = {
      coldRenderMs,
      heapTrendBytes: Math.max(0, heapAfter - heapBefore),
      hundredOutputBytes,
      hundredPagesMs,
      multiPassOutputBytes,
      multiPassReportMs,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      warmInvoiceMs: median(warmRuns),
      warmOutputBytes,
    }

    await mkdir(resolve('reports'), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify({
      environment: { node: process.version, platform: process.platform },
      metrics,
    }, null, 2)}\n`)

    if (process.env.UPDATE_PERFORMANCE_BASELINE === '1') {
      await mkdir(resolve(baselinePath, '..'), { recursive: true })
      const previous = JSON.parse(await readFile(baselinePath, 'utf8'))
      await writeFile(baselinePath, `${JSON.stringify({
        ...previous,
        environment: { node: process.version, platform: process.platform },
        metrics,
      }, null, 2)}\n`)
    }

    if (process.env.NUXT_PDF_PERF_GATE === '1') {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as { metrics: Metrics }
      for (const [name, value] of Object.entries(metrics)) {
        const previous = baseline.metrics[name]
        expect(previous, `Missing performance baseline for ${name}`).toBeTypeOf('number')
        const ratio = name.endsWith('OutputBytes') ? 1.1 : 1.2
        expect(value, `${name} regressed from ${previous} to ${value}`).toBeLessThanOrEqual(previous! * ratio)
      }
    }
  }, 120_000)
})
