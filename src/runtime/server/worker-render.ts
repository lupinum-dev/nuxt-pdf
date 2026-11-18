import { availableParallelism } from 'node:os'
import { Worker, isMarkedAsUntransferable } from 'node:worker_threads'
import { resolvedPosition } from '../authoring'
import { PDF_PRIMITIVES } from '../primitives'
import type { BundledPdfFontDescriptor } from '../fonts'
import type { PdfElementNode, PdfNode } from '../renderer'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type {
  PlainRenderOutput,
  WorkerRenderFailure,
  WorkerRenderRequest,
  WorkerRenderResponse,
} from './engine/worker-protocol'
import { plainRenderLimits, renderDeadlineError, type RenderLimits } from './render-limits'

// Where layout and serialization run. One engine adapter, two places:
//
// - A worker thread from a small pool, by default. At the render deadline the
//   worker is terminated, which stops layout even inside one engine step; the
//   pool starts a fresh worker for the next render.
// - In-process, when the build has no worker chunk (`PDF_WORKER_URL` is
//   undefined: a production preset that inlines dynamic imports). The deadline
//   is then checked between engine stages only.
//
// The decision is recorded in internals/decisions.md ("Render worker").

/**
 * Renders one worker serves before the pool retires it. The engine keeps
 * module-level caches that no API clears (the hyphenation cache holds every
 * word it has split), so a long-lived worker would grow toward its memory cap
 * and keep words of one render for later ones. A fresh worker bounds both, and
 * one cold start per 200 renders is a small share of the render time.
 */
export const PDF_WORKER_MAX_RENDERS = 200

/**
 * Internal test seam, not a module option. Tests set `inProcess` to cover the
 * path that inlined builds use, and `maxRendersPerWorker` to see a worker
 * retire. Nothing outside tests writes it.
 */
export const pdfRenderPlacement = {
  inProcess: false,
  maxRendersPerWorker: PDF_WORKER_MAX_RENDERS,
}

/** V8 old-generation cap for one render worker. */
export const PDF_WORKER_MEMORY_MB = 1024

/** Warm workers kept by the pool: one core stays free for the server. */
export const PDF_WORKER_POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1))

// Running from TypeScript source (tests, `nuxt dev` with the module stub), the
// worker loads `.ts` files through Node's type stripping. Source imports omit
// file extensions, so a small resolve hook adds them (`.js` for the generated
// layout copy, engine/layout/index.js).
const SOURCE_RESOLVE_HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) }
  catch (error) {
    if (!specifier.startsWith('.') || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error?.code)) throw error
    try { return await next(specifier + '.ts', context) }
    catch {
      try { return await next(specifier + '/index.ts', context) }
      catch { return next(specifier + '.js', context) }
    }
  }
}`
const SOURCE_REGISTER = `import { register } from 'node:module'
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(SOURCE_RESOLVE_HOOK)}))`

/**
 * Node arguments that load this runtime from TypeScript source. Node strips
 * types by default from 22.18 and 23.6 (`process.features.typescript` is
 * `'strip'`); an older supported Node (22.14 to 22.17) needs the flag. The
 * runtime uses only erasable syntax (no enum, namespace or parameter
 * property), which is all that stripping supports.
 */
export const pdfSourceExecArgv = (
  features: { readonly typescript?: 'strip' | false } = process.features,
  parentExecArgv: readonly string[] = process.execArgv,
): readonly string[] => [
  // A process that was itself started with the flag reports 'strip', but the
  // worker's explicit execArgv replaces the inherited one, so pass it on.
  ...!features.typescript || parentExecArgv.includes('--experimental-strip-types') ? ['--experimental-strip-types'] : [],
  '--import',
  `data:text/javascript,${encodeURIComponent(SOURCE_REGISTER)}`,
]

export const PDF_SOURCE_EXEC_ARGV: readonly string[] = pdfSourceExecArgv()

const loadWorkerEntry = () => import('./engine/worker-entry')

// ---------------------------------------------------------------------------
// Pool. A worker is either idle (unref'd, so it never keeps the process
// alive) or leased to one render. Renders beyond the pool size wait in a FIFO
// queue; the wait counts against their deadline.

interface WorkerWaiter {
  resolve(worker: Worker): void
  reject(error: unknown): void
}

const liveWorkers = new Set<Worker>()
const idleWorkers: Worker[] = []
const waiters: WorkerWaiter[] = []
const renderCounts = new WeakMap<Worker, number>()

const removeIdle = (worker: Worker): void => {
  const index = idleWorkers.indexOf(worker)
  if (index >= 0) idleWorkers.splice(index, 1)
}

const spawnWorker = async (url: string, marker: string): Promise<Worker> => {
  const fromSource = url.endsWith('.ts')
  const worker = new Worker(new URL(url), {
    execArgv: fromSource ? [...PDF_SOURCE_EXEC_ARGV] : [],
    resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB },
    workerData: { [marker]: true },
  })
  liveWorkers.add(worker)
  // An `error` event with no listener throws in the main thread and ends the
  // server process. A leased worker also has the render's own listener; this
  // one covers the idle time (a late rejection after the response, say) and
  // retires the worker.
  worker.on('error', () => {
    removeIdle(worker)
    void worker.terminate()
  })
  // A worker that dies while idle (out of memory, crash) leaves the pool.
  worker.once('exit', () => {
    liveWorkers.delete(worker)
    removeIdle(worker)
    startQueued(url, marker)
  })
  return worker
}

const lease = (worker: Worker, waiter: WorkerWaiter): void => {
  worker.ref()
  waiter.resolve(worker)
}

const startFor = (waiter: WorkerWaiter, url: string, marker: string): void => {
  spawnWorker(url, marker).then(
    worker => lease(worker, waiter),
    (error: unknown) => waiter.reject(error),
  )
}

// A slot freed up (a worker exited): start a worker for the next waiter.
const startQueued = (url: string, marker: string): void => {
  while (waiters.length > 0 && liveWorkers.size < PDF_WORKER_POOL_SIZE) {
    startFor(waiters.shift()!, url, marker)
  }
}

const requestWorker = (waiter: WorkerWaiter, url: string, marker: string): void => {
  const idle = idleWorkers.pop()
  if (idle) lease(idle, waiter)
  else if (liveWorkers.size < PDF_WORKER_POOL_SIZE) startFor(waiter, url, marker)
  else waiters.push(waiter)
}

const cancelWait = (waiter: WorkerWaiter): void => {
  const index = waiters.indexOf(waiter)
  if (index >= 0) waiters.splice(index, 1)
}

/** Return a healthy worker: to the next waiter, or to the idle list. */
const releaseWorker = (worker: Worker): void => {
  const next = waiters.shift()
  if (next) {
    next.resolve(worker)
    return
  }
  idleWorkers.push(worker)
  worker.unref()
}

/** Stop a worker that timed out or failed; its exit frees the slot. */
const discardWorker = (worker: Worker): void => {
  void worker.terminate()
}

/** A render finished: reuse the worker, or retire it after its last render. */
const finishRender = (worker: Worker): void => {
  const count = (renderCounts.get(worker) ?? 0) + 1
  renderCounts.set(worker, count)
  if (count >= pdfRenderPlacement.maxRendersPerWorker) discardWorker(worker)
  else releaseWorker(worker)
}

/** Pool counts, for tests and benchmarks. */
export const pdfWorkerPoolState = () => ({
  live: liveWorkers.size,
  idle: idleWorkers.length,
  waiting: waiters.length,
})

// ---------------------------------------------------------------------------

// Resolved image bytes are copies made for this render, so their memory can
// move to the worker. Only a buffer that owns its whole ArrayBuffer is
// transferred; Node's Buffer pool memory is marked untransferable, and the
// clone copies it instead.
const transferableImageBuffers = (document: PdfElementNode): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  const visit = (node: PdfNode): void => {
    if (node.type === PDF_PRIMITIVES.TextInstance) return
    const src = node.props.src
    if (
      node.type === PDF_PRIMITIVES.Image
      && src instanceof Uint8Array
      && src.buffer instanceof ArrayBuffer
      && src.byteOffset === 0
      && src.byteLength === src.buffer.byteLength
      && !isMarkedAsUntransferable(src.buffer)
    ) {
      buffers.add(src.buffer)
    }
    for (const child of node.children) visit(child)
  }
  visit(document)
  return [...buffers]
}

export interface PlainTreeRenderOptions {
  fonts?: readonly BundledPdfFontDescriptor[]
  limits: RenderLimits
  maxPasses?: number
}

export const deadlineError = (limits: Pick<RenderLimits, 'timeoutMs' | 'deadline'>): unknown => {
  try {
    limits.deadline.check()
  }
  catch (error) {
    return error
  }
  // The timer fired a fraction of a millisecond before the deadline clock:
  // the same error, so the author still reads which option to raise.
  return renderDeadlineError(limits.timeoutMs, limits.timeoutMs - limits.deadline.remainingMs())
}

const holdsFlowFixed = (node: PdfElementNode): boolean =>
  node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance
    && resolvedPosition(child.style) !== 'absolute'
    && (child.props.fixed === true || holdsFlowFixed(child)))

/**
 * The deadline error of a render the worker did not finish. The worker runs
 * no page guard (plain-tree.ts, `guardsPagination`), so a document whose
 * in-flow `fixed` content leaves no room for the next block repeats the same
 * page until this timer ends it. The plain tree is read only here, after
 * the deadline: it says whether that cause is possible, not that it happened.
 */
const workerDeadlineError = (limits: RenderLimits, document: PdfElementNode): unknown => {
  const error = deadlineError(limits)
  if (!(error instanceof NuxtPdfError) || !holdsFlowFixed(document)) return error
  return new NuxtPdfError(
    error.code,
    `${error.message} The document has in-flow fixed content. When it leaves less room than a block that cannot break `
    + '(an SVG, image or canvas), or a fixed node in a row leaves no room beside it, every page repeats the one before and pagination does not end.',
  )
}

const workerFailure = (error: unknown): unknown =>
  error instanceof Error
  && (error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
    ? new NuxtPdfError(
        PDF_ERROR_CODES.LimitExceeded,
        `PDF render exceeded the ${PDF_WORKER_MEMORY_MB} MB render worker memory limit.`,
        { cause: error },
      )
    : error

/** Rebuild an error the worker sent back, with its code, stack and cause. */
export const errorFromWorker = (failure: WorkerRenderFailure): Error => {
  const cause = failure.cause && Object.assign(new Error(failure.cause.message), {
    name: failure.cause.name,
    stack: failure.cause.stack,
  })
  const error = failure.code
    ? new NuxtPdfError(failure.code, failure.message, { cause, source: failure.source, issues: failure.issues })
    : Object.assign(new Error(failure.message, { cause }), { name: failure.name })
  if (failure.stack) error.stack = failure.stack
  return error
}

const renderInWorker = (
  request: WorkerRenderRequest,
  limits: RenderLimits,
  url: string,
  marker: string,
): Promise<PlainRenderOutput> => new Promise((resolve, reject) => {
  let settled = false
  let worker: Worker | undefined

  const settle = (action: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (worker) {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    action()
  }

  const onMessage = (response: WorkerRenderResponse) => settle(() => {
    finishRender(worker!)
    if (response.ok) resolve(response.output)
    else reject(errorFromWorker(response))
  })
  const onError = (error: unknown) => settle(() => {
    discardWorker(worker!)
    reject(workerFailure(error))
  })
  const onExit = (exitCode: number) => settle(() => {
    reject(new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      `The PDF render worker stopped unexpectedly (exit code ${exitCode}).`,
    ))
  })

  const waiter: WorkerWaiter = {
    resolve(leased) {
      if (settled) {
        releaseWorker(leased)
        return
      }
      worker = leased
      worker.on('message', onMessage)
      worker.on('error', onError)
      worker.on('exit', onExit)
      try {
        worker.postMessage(
          { ...request, elapsedMs: limits.timeoutMs - limits.deadline.remainingMs() },
          transferableImageBuffers(request.document),
        )
      }
      catch (error) {
        settle(() => {
          releaseWorker(leased)
          reject(new NuxtPdfError(
            PDF_ERROR_CODES.TreeInvalid,
            `The PDF tree could not be sent to the render worker: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ))
        })
      }
    },
    reject: error => settle(() => reject(error)),
  }

  // The hard deadline, for the wait in the queue and for the render: a leased
  // worker is terminated, which stops layout even inside one engine step.
  const timer = setTimeout(() => settle(() => {
    if (worker) discardWorker(worker)
    else cancelWait(waiter)
    const error = worker ? workerDeadlineError(limits, request.document) : deadlineError(limits)
    limits.abortController.abort(error)
    reject(error)
  }), limits.deadline.remainingMs() + 1)

  requestWorker(waiter, url, marker)
})

/**
 * Lay out and serialize an admitted plain-data tree: in a pool worker, or
 * in-process when the build has no worker chunk. In the worker case the image
 * buffers are transferred, so the caller must not read them afterwards.
 */
export const renderPlainTree = async (
  document: PdfElementNode,
  options: PlainTreeRenderOptions,
): Promise<PlainRenderOutput> => {
  const { limits } = options
  limits.deadline.check()
  const entry = await loadWorkerEntry()
  const request: WorkerRenderRequest = {
    document,
    fonts: options.fonts ?? [],
    limits: plainRenderLimits(limits),
    elapsedMs: 0,
    maxPasses: options.maxPasses,
  }

  if (pdfRenderPlacement.inProcess || entry.PDF_WORKER_URL === undefined) {
    return entry.renderPlainRequest(request, limits)
  }
  return renderInWorker(request, limits, entry.PDF_WORKER_URL, entry.PDF_WORKER_MARKER)
}
