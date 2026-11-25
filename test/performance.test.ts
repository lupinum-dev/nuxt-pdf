import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { pdfRenderPlacement } from '../src/runtime/server/worker-pool'
import { hundredPages, invoice, multiPassReport, realInvoice, realInvoiceOptions, terms, termsColumns } from './fixtures/performance/workloads'

type Metrics = Record<string, number>

const baselinePath = resolve('test/fixtures/performance/linux-node24.json')
const reportPath = resolve('reports/performance.json')
/** The wall-time ceiling as a multiple of the reviewed value. */
const WALL_TIME_CEILING = 3
/**
 * Peak RSS is a loose ceiling too: it follows how far V8 lets the heaps grow
 * before it collects (a real-shaped invoice leaves a few hundred MB of
 * garbage), not what a render keeps. The retained heap is the exact budget.
 */
const PEAK_RSS_CEILING = 1.5
/**
 * The most the general terms in two columns may take against the same text
 * in one column: a column
 * fill and its balance add relayouts, not a second layout of the text.
 */
const COLUMNS_TIME_CEILING = 2
/** What renders may keep in total after warm-up: anything above is a leak. */
const RETAINED_HEAP_GROWTH_LIMIT = 5_000_000
/** The built runtime the cold render loads; `nuxt-module-build build` writes it. */
const builtRuntime = resolve('dist/runtime/server/registry.js')
const coldRenderScript = resolve('test/fixtures/performance/cold-render.mjs')

const elapsed = async (render: () => Promise<unknown>): Promise<number> => {
  const start = performance.now()
  await render()
  return performance.now() - start
}

const median = (values: number[]): number =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!

/**
 * One render to warm up (fonts, caches), then the median of three: one
 * render varied by up to 1.38 times (internals/performance.md).
 */
const warmMedian = async (render: () => Promise<unknown>): Promise<number> => {
  await render()
  const runs: number[] = []
  for (let index = 0; index < 3; index += 1) runs.push(await elapsed(render))
  return median(runs)
}

/**
 * The heap that survives two full collections with a turn of the event loop
 * between them (finalizers and pending callbacks release their objects
 * there). It repeats to 0.1 MB between runs (internals/performance.md).
 */
const retainedHeap = async (gc: () => void): Promise<number> => {
  for (let round = 0; round < 2; round += 1) {
    gc()
    await new Promise(resolve => setImmediate(resolve))
  }
  return process.memoryUsage().heapUsed
}

describe('fixed-environment performance evidence', () => {
  it('records the release workloads and enforces the Linux baseline', async () => {
    // vitest.performance.config.ts passes --expose-gc to the test process.
    // Without it every measured heap would hold uncollected garbage.
    const gc = globalThis.gc
    if (gc === undefined) throw new Error('The performance test needs --expose-gc in its test process (execArgv).')
    const gate = process.env.NUXT_PDF_PERF_GATE === '1'
    // The cold render runs first, while this machine is quiet.
    let cold: { coldRenderMs: number, byteLength: number } | undefined
    if (existsSync(builtRuntime)) {
      const { stdout } = await promisify(execFile)(process.execPath, [coldRenderScript])
      cold = JSON.parse(stdout)
    }
    else if (gate) throw new Error(`The performance gate needs the built runtime (${builtRuntime}): run nuxt-module-build build.`)
    else process.stdout.write('coldRenderMs skipped: no built runtime in dist/ (run nuxt-module-build build).\n')

    // Starts the worker for the warm runs, and proves the cold render's copy
    // of the invoice is the same document.
    const invoiceTemplate = createPdfTemplate<{ token: string }>('performance-invoice', invoice)
    const coldOutputBytes = (await invoiceTemplate.render({ token: 'cold' })).diagnostics.byteLength
    if (cold !== undefined) expect(cold.byteLength, 'cold-render.mjs renders another document than `invoice`').toBe(coldOutputBytes)
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
    const hundredPagesMs = await warmMedian(async () => {
      hundredOutputBytes = (await hundredTemplate.render({})).diagnostics.byteLength
    })

    const reportTemplate = createPdfTemplate('performance-multi-pass', multiPassReport)
    let multiPassOutputBytes = 0
    const multiPassReportMs = await warmMedian(async () => {
      const result = await reportTemplate.render({})
      expect(result.diagnostics.passes).toBe(2)
      multiPassOutputBytes = result.diagnostics.byteLength
    })

    const realTemplate = createPdfTemplate('performance-real-invoice', realInvoice, realInvoiceOptions)
    const realInvoiceMs = await warmMedian(() => realTemplate.render({}))

    // The general terms in one column and in two: one render each to load
    // the fonts, then the median of three, alternating.
    const termsTemplate = createPdfTemplate('performance-terms', terms)
    const termsColumnsTemplate = createPdfTemplate('performance-terms-columns', termsColumns)
    await termsTemplate.render({})
    await termsColumnsTemplate.render({})
    const termsRuns: number[] = []
    const termsColumnsRuns: number[] = []
    for (let index = 0; index < 3; index += 1) {
      termsRuns.push(await elapsed(() => termsTemplate.render({})))
      termsColumnsRuns.push(await elapsed(() => termsColumnsTemplate.render({})))
    }
    const termsMs = median(termsRuns)
    const termsColumnsMs = median(termsColumnsRuns)

    const peakRssBytes = process.resourceUsage().maxRSS * 1024

    // The retained heap, with renders in this process so the engine's heap
    // is visible (a render worker's heap is not). After warm-up the engine
    // holds its module state and the parsed fonts of the real invoice; more
    // renders must not add to it.
    let retainedHeapBytes: number
    let retainedHeapGrowthBytes: number
    pdfRenderPlacement.inProcess = true
    try {
      await invoiceTemplate.render({ token: 'in-process' })
      await realTemplate.render({})
      retainedHeapBytes = await retainedHeap(gc)
      for (let index = 0; index < 3; index += 1) await realTemplate.render({})
      for (let index = 0; index < 100; index += 1) {
        await invoiceTemplate.render({ token: `sequential-${index}` })
      }
      retainedHeapGrowthBytes = Math.max(0, await retainedHeap(gc) - retainedHeapBytes)
    }
    finally {
      pdfRenderPlacement.inProcess = false
    }

    const metrics: Metrics = {
      ...cold && { coldRenderMs: cold.coldRenderMs },
      hundredOutputBytes,
      hundredPagesMs,
      multiPassOutputBytes,
      multiPassReportMs,
      peakRssBytes,
      realInvoiceMs,
      retainedHeapBytes,
      retainedHeapGrowthBytes,
      termsColumnsMs,
      termsMs,
      warmInvoiceMs: median(warmRuns),
      warmOutputBytes,
    }

    const report = `${JSON.stringify({
      environment: { node: process.version, platform: process.platform },
      metrics,
    }, null, 2)}\n`
    await mkdir(resolve('reports'), { recursive: true })
    await writeFile(reportPath, report)
    // In the log too, so a CI run gives the values to review.
    process.stdout.write(`performance report:\n${report}`)

    if (process.env.UPDATE_PERFORMANCE_BASELINE === '1') {
      await mkdir(resolve(baselinePath, '..'), { recursive: true })
      const previous = JSON.parse(await readFile(baselinePath, 'utf8'))
      await writeFile(baselinePath, `${JSON.stringify({
        ...previous,
        environment: { node: process.version, platform: process.platform },
        // A skipped cold render keeps its reviewed value.
        metrics: { ...previous.metrics, ...metrics },
      }, null, 2)}\n`)
    }

    if (gate) {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as { metrics: Metrics }
      expect(retainedHeapGrowthBytes, `renders kept ${retainedHeapGrowthBytes} bytes after warm-up`).toBeLessThanOrEqual(RETAINED_HEAP_GROWTH_LIMIT)
      for (const [name, value] of Object.entries(metrics)) {
        if (name.endsWith('Ms') || name === 'retainedHeapGrowthBytes')
          continue
        const previous = baseline.metrics[name]
        expect(previous, `Missing performance baseline for ${name}`).toBeTypeOf('number')
        const ratio = name.endsWith('OutputBytes') ? 1.1 : name === 'peakRssBytes' ? PEAK_RSS_CEILING : 1.2
        expect(value, `${name} regressed from ${previous} to ${value}`).toBeLessThanOrEqual(previous! * ratio)
      }

      // Both measured in this process one after the other, so the runner's
      // speed cancels out of the ratio.
      expect(termsColumnsMs, `the terms in two columns took ${termsColumnsMs} ms, over ${COLUMNS_TIME_CEILING} times the ${termsMs} ms in one column`).toBeLessThanOrEqual(termsMs * COLUMNS_TIME_CEILING)

      // Wall time is only a loose ceiling: hosted runners have no fixed CPU
      // capacity, and the exact budget is the counted work of
      // test/work-budget.test.ts. Five runs on one machine spread by up to
      // 1.4 times (internals/performance.md); 3 times the reviewed value
      // catches a large regression and leaves room for a slower runner.
      for (const [name, value] of Object.entries(metrics)) {
        const previous = baseline.metrics[name]
        if (!name.endsWith('Ms') || previous === undefined) continue
        expect(value, `${name} took ${value} ms, over 3 times the reviewed ${previous} ms`).toBeLessThanOrEqual(previous * WALL_TIME_CEILING)
      }
    }
  }, 120_000)
})
