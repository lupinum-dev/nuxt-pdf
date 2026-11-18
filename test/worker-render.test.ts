import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { defineComponent, h, type Component } from 'vue'
import { Worker, type Worker as NodeWorker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { RENDER_WORKER_MARKER } from '../src/runtime/server/engine/plain-tree'
import { describeError, PDF_WORKER_MARKER } from '../src/runtime/server/engine/worker-entry'
import { createPdfTemplate } from '../src/runtime/server/registry'
import { DEFAULT_PDF_RENDER_LIMITS } from '../src/runtime/server/render-limits'
import {
  PDF_SOURCE_EXEC_ARGV,
  PDF_WORKER_MAX_RENDERS,
  PDF_WORKER_POOL_SIZE,
  errorFromWorker,
  deadlineError,
  pdfSourceExecArgv,
  pdfRenderPlacement,
  pdfWorkerPoolState,
} from '../src/runtime/server/worker-render'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_DEFINITION_PROPERTY, type PdfDefinition } from '../src/runtime/shared/template'
import { parsePdf } from '../src/test/pdf'

const { PdfDocument, PdfPage, PdfPageRef, PdfText, PdfView } = PDF_COMPONENTS

const asTemplate = (component: Component, definition: PdfDefinition = {}): Component =>
  Object.assign(component, { [PDF_DEFINITION_PROPERTY]: definition })

const Invoice = asTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
  h(PdfPage, { size: 'A4', style: { padding: 40 } }, () => [
    h(PdfText, { style: { fontSize: 24 } }, () => 'Invoice 42'),
    ...Array.from({ length: 40 }, (_, index) =>
      h(PdfText, { style: { fontSize: 10 } }, () => `Line ${index + 1}: EUR ${(index + 1) * 12}.00`)),
  ]))))

// About 0.3 s of layout, so parallel renders overlap.
const Pages = asTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
  Array.from({ length: 30 }, (_, page) => h(PdfPage, { size: 'A4', style: { padding: 40 } }, () =>
    Array.from({ length: 30 }, (_, line) =>
      h(PdfText, { style: { fontSize: 10 } }, () => `Page ${page + 1}, line ${line + 1}`)))))))

// Every pool worker this file starts, so a test can act on an idle one. The
// subclass only records; it changes no behavior.
const spawned = vi.hoisted(() => ({ alive: new Set<NodeWorker>() }))
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>()
  class RecordedWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args)
      spawned.alive.add(this)
      this.once('exit', () => spawned.alive.delete(this))
    }
  }
  return { ...actual, Worker: RecordedWorker }
})

const workerEntry = fileURLToPath(
  new URL('../src/runtime/server/engine/worker-entry.ts', import.meta.url),
)

describe('PDF render worker', () => {
  // Catches an engine import that pulls in the renderer facade (and with it
  // Vue): the worker would load Vue, and a template module could leak in.
  it('does not reach vue from the worker entry', async () => {
    const result = await build({
      entryPoints: [workerEntry],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
    })
    const external = new Set<string>()
    for (const input of Object.values(result.metafile.inputs)) {
      for (const entry of input.imports) {
        if (entry.external) external.add(entry.path)
      }
    }
    const localFiles = Object.keys(result.metafile.inputs)

    expect([...external].filter(path => path === 'vue' || path.startsWith('@vue/')))
      .toEqual([])
    expect(localFiles.filter(file => /renderer\/(?:index|render-component|node-ops)\.ts$/.test(file)))
      .toEqual([])
    // The engine itself is in the graph, so the check looks at the right file.
    expect(localFiles.filter(file => file.endsWith('engine/layout/index.js'))).toHaveLength(1)
    expect([...external]).toContain('@react-pdf/render')
  })

  // Catches a deadline that is only checked between engine stages: one layout
  // of these rows runs for minutes on the main thread (611 s measured with a
  // 2 s budget), so only terminating the worker settles in time.
  it('stops a long layout at the deadline and renders the next document', async () => {
    const Rows = asTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, null, () => h(PdfView, null, () =>
        Array.from({ length: 16_000 }, (_, index) =>
          h(PdfView, { key: index }, () => h(PdfText, null, () => `Row ${index}`))))))))
    const Small = asTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, null, () => h(PdfText, null, () => 'Next')))))
    const limits = { ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 1_500 }

    const start = performance.now()
    await expect(createPdfTemplate('rows', Rows, { limits }).render({}))
      .rejects.toMatchObject({ code: 'PDF_LIMIT_EXCEEDED' })
    expect(performance.now() - start).toBeLessThan(4_000)

    const next = await createPdfTemplate('small', Small, { limits }).render({})
    expect(next.diagnostics.pageCount).toBe(1)
  }, 15_000)

  // Catches a timeout in the worker (which runs no page guard) that only says
  // the time ran out, and a page guard that runs in the worker: its accessor
  // costs about 20 % of every render with in-flow fixed content there.
  it('names in-flow fixed content when a render in the worker times out', async () => {
    expect(RENDER_WORKER_MARKER).toBe(PDF_WORKER_MARKER)
    const Loop = asTemplate(defineComponent(() => () => h(PdfDocument, null, () =>
      h(PdfPage, { size: 'A6' }, () => [
        h(PdfView, { fixed: true, style: { height: 300 } }),
        h(PDF_COMPONENTS.PdfSvg, { width: 100, height: 200, viewBox: '0 0 100 200' }),
      ]))))
    const limits = { ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 3_000 }

    await expect(createPdfTemplate('loop', Loop, { limits }).render({})).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: expect.stringMatching(/exceeded its 3000ms time budget .* this slow\. The document has in-flow fixed content\. When it leaves less room than a block that cannot break \(an SVG, image or canvas\), or a fixed node in a row leaves no room beside it, every page repeats the one before and pagination does not end\.$/),
    })
  }, 15_000)

  // Catches the timer firing a fraction of a millisecond before the deadline
  // clock: the fallback error must still name the option to raise (found by
  // invariant I12 on a slow machine).
  it('names pdf.limits.timeoutMs when the timer fires before the deadline clock', () => {
    const error = deadlineError({ timeoutMs: 25, deadline: { check() {}, remainingMs: () => 0.4 } })
    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      message: 'PDF render exceeded its 25ms time budget (elapsed 25ms). Raise pdf.limits.timeoutMs if this document is legitimately this slow.',
    })
  })

  // Catches an error that crosses the thread boundary as a plain Error: the
  // code would turn into PDF_RENDER_ERROR and the stack would point at the
  // main thread instead of the engine.
  it('keeps the code, message and engine stack of a worker error', async () => {
    const Toc = asTemplate(defineComponent(() => () => h(PdfDocument, null, () => [
      h(PdfPage, null, () => h(PdfText, null, () => ['Intro ', h(PdfPageRef, { to: 'intro' })])),
      h(PdfPage, null, () => h(PdfText, { id: 'intro' }, () => 'Intro')),
    ])), { maxPasses: 1 })

    const error = await createPdfTemplate('toc', Toc).render({})
      .then(() => null, (failure: unknown) => failure)

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: PDF_ERROR_CODES.LimitExceeded,
      message: expect.stringContaining('did not stabilize'),
    })
    // The registry adds the template prefix and keeps the worker error as cause.
    const cause = (error as Error).cause as Error
    expect(cause.stack).toContain('layout-passes')
  })

  // Catches a cause, a source position or invoice issues that are dropped on
  // the way back from the worker (an error found after layout, such as a font
  // that is not embedded in a PDF/A document, would lose its template
  // position).
  it('rebuilds a worker error with its cause message, stack, source and issues', () => {
    const issues = [{ rule: 'BR-DE-15', path: 'invoice.buyerReference', message: 'XRechnung needs the buyer reference.' }]
    const original = new NuxtPdfError(PDF_ERROR_CODES.RenderError, 'Layout failed.', {
      cause: new RangeError('Maximum call stack size exceeded'),
      source: { file: 'pdfs/report.vue', line: 4, column: 7 },
      issues,
    })

    const rebuilt = errorFromWorker(structuredClone(describeError(original)))

    expect(rebuilt).toBeInstanceOf(NuxtPdfError)
    expect(rebuilt).toMatchObject({ code: PDF_ERROR_CODES.RenderError, message: 'Layout failed.' })
    expect(rebuilt.stack).toBe(original.stack)
    expect((rebuilt as NuxtPdfError).source).toEqual({ file: 'pdfs/report.vue', line: 4, column: 7 })
    expect((rebuilt as NuxtPdfError).issues).toEqual(issues)
    expect(rebuilt.cause).toMatchObject({
      name: 'RangeError',
      message: 'Maximum call stack size exceeded',
    })
  })

  // Catches a pool that starts one worker per render: memory and cold starts
  // would grow with concurrency instead of staying bounded.
  it('runs parallel renders on at most the pool size of reused workers', async () => {
    const template = createPdfTemplate('pages', Pages)
    const renders = Array.from({ length: PDF_WORKER_POOL_SIZE * 2 + 1 }, () => template.render({}))
    let peak = 0
    const sampler = setInterval(() => {
      peak = Math.max(peak, pdfWorkerPoolState().live)
    }, 5)

    const results = await Promise.all(renders).finally(() => clearInterval(sampler))

    expect(results.every(result => result.diagnostics.pageCount === 30)).toBe(true)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(PDF_WORKER_POOL_SIZE)
    // Every worker went back to the pool; nothing waits.
    const state = pdfWorkerPoolState()
    expect(state.idle).toBe(state.live)
    expect(state.waiting).toBe(0)
  }, 30_000)

  // Catches a deadline that does not cover the wait for a busy pool: the
  // queued render must reject while every worker is still busy, not only once
  // a worker frees up and sees the spent budget.
  it('rejects a render that waits for a worker past its deadline', async () => {
    const busy = Array.from({ length: PDF_WORKER_POOL_SIZE }, () =>
      createPdfTemplate('pages', Pages).render({}))
    let workerFreed = false
    void Promise.race(busy).then(() => {
      workerFreed = true
    })
    const queued = createPdfTemplate('queued', Invoice, {
      limits: { ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: 50 },
    }).render({})

    await expect(queued).rejects.toMatchObject({ code: PDF_ERROR_CODES.LimitExceeded })
    expect(workerFreed).toBe(false)
    await Promise.all(busy)
    expect(pdfWorkerPoolState().waiting).toBe(0)
  }, 30_000)

  // Catches an idle worker without an `error` listener: Node throws the event
  // in the main thread and the server process exits (a late rejection in the
  // worker after its response is enough).
  it('retires an idle worker that emits an error', async () => {
    await createPdfTemplate('invoice', Invoice).render({})
    expect(pdfWorkerPoolState().idle).toBeGreaterThan(0)

    for (const worker of spawned.alive) worker.emit('error', new Error('late rejection'))

    await vi.waitFor(() => expect(pdfWorkerPoolState()).toMatchObject({ live: 0, idle: 0 }))
    const next = await createPdfTemplate('invoice', Invoice).render({})
    expect(next.diagnostics.pageCount).toBe(1)
  }, 20_000)

  // Catches a worker that lives forever: engine module state (the hyphenation
  // cache) would grow without bound and keep words of one render for later
  // ones. With one render per worker, every finished render retires its worker.
  it('retires a worker after its render limit and starts a new one on demand', async () => {
    pdfRenderPlacement.maxRendersPerWorker = 1
    try {
      const template = createPdfTemplate('invoice', Invoice)
      // Serial renders lease every idle worker once, so all of them retire.
      for (let index = 0; index <= PDF_WORKER_POOL_SIZE; index++) await template.render({})
      await vi.waitFor(() => expect(pdfWorkerPoolState()).toMatchObject({ live: 0, idle: 0 }))
    }
    finally {
      pdfRenderPlacement.maxRendersPerWorker = PDF_WORKER_MAX_RENDERS
    }
    const next = await createPdfTemplate('invoice', Invoice).render({})
    expect(next.diagnostics.pageCount).toBe(1)
    expect(pdfWorkerPoolState()).toMatchObject({ live: 1, idle: 1 })
  }, 20_000)

  // Catches an idle worker that keeps the process alive: a CLI or script that
  // renders a PDF would never exit.
  it('lets the process exit with an idle worker in the pool', async () => {
    const script = fileURLToPath(new URL('./fixtures/worker-exit/render-once.ts', import.meta.url))
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...PDF_SOURCE_EXEC_ARGV, script],
      { timeout: 15_000 },
    )

    expect(JSON.parse(stdout)).toEqual({ pages: 1, live: 1, idle: 1, waiting: 0 })
  }, 20_000)
})

describe('the worker started from TypeScript source', () => {
  const WORKER_ENTRY = new URL('../src/runtime/server/engine/worker-entry.ts', import.meta.url)

  /** Load the worker module graph (without the marker it only loads and exits); the error code, or 'loaded'. */
  const load = (execArgv: readonly string[]): Promise<string> => new Promise((resolve) => {
    const worker = new Worker(WORKER_ENTRY, { execArgv: [...execArgv] })
    worker.once('error', (error: Error & { code?: string }) => resolve(error.code ?? error.message))
    worker.once('exit', code => resolve(code === 0 ? 'loaded' : `exit ${code}`))
  })

  // Catches the Node 22.14 floor failure (ERR_UNKNOWN_FILE_EXTENSION in the
  // worker): a Node that does not strip types by default gets the flag.
  it.each([
    ['strip', { typescript: 'strip' }, []],
    ['false', { typescript: false }, ['--experimental-strip-types']],
    ['absent (Node 22.14)', {}, ['--experimental-strip-types']],
  ] as const)('adds the strip-types flag when features.typescript is %s', (_case, features, flag) => {
    expect(pdfSourceExecArgv(features, []).slice(0, -2)).toEqual(flag)
  })

  // Catches the last Node 22.14 failure: a child process started with the
  // flag reports 'strip', and its worker lost the flag (ERR_UNKNOWN_FILE_EXTENSION).
  it('passes the flag on when the process itself was started with it', () => {
    expect(pdfSourceExecArgv({ typescript: 'strip' }, ['--experimental-strip-types', '--import', 'x']).slice(0, -2))
      .toEqual(['--experimental-strip-types'])
  })

  // `--no-experimental-strip-types` turns this Node into one that does not
  // strip types, as Node 22.14 to 22.17: the arguments for such a Node load
  // the worker, the arguments for a stripping Node do not.
  it('loads the worker on a Node that does not strip types by default', async () => {
    expect(await load(['--no-experimental-strip-types', ...pdfSourceExecArgv({ typescript: 'strip' }, [])])).toBe('ERR_UNKNOWN_FILE_EXTENSION')
    expect(await load(['--no-experimental-strip-types', ...pdfSourceExecArgv({ typescript: false }, [])])).toBe('loaded')
  }, 20_000)
})

describe('in-process rendering', () => {
  afterEach(() => {
    pdfRenderPlacement.inProcess = false
  })

  // Catches a broken fallback: builds that inline dynamic imports render here.
  it('writes the same PDF as the worker', async () => {
    const worker = await parsePdf(await (await createPdfTemplate('invoice', Invoice).render({})).toUint8Array())
    pdfRenderPlacement.inProcess = true
    const inProcess = await parsePdf(await (await createPdfTemplate('invoice', Invoice).render({})).toUint8Array())

    expect(inProcess.pages.map(page => page.text)).toEqual(worker.pages.map(page => page.text))
    expect(inProcess.pageCount).toBe(1)
  })
})
