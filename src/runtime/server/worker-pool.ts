import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type { WorkerRenderFailure, WorkerRequest, WorkerResponse } from './engine/worker-protocol'

// The pool of render workers that worker-render.ts sends its requests to:
// how a worker starts (from TypeScript source in tests and `nuxt dev`), the
// lease and the FIFO queue, the retirement after `PDF_WORKER_MAX_RENDERS`,
// and `runInWorker`, the one path every request kind takes.

/**
 * Requests (renders and Markdown parses) one worker serves before the pool
 * retires it. The engine keeps
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
const PDF_WORKER_MEMORY_MB = 1024

/** Warm workers kept by the pool: one core stays free for the server. */
export const PDF_WORKER_POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1))

// Running from TypeScript source (tests, `nuxt dev` with the module stub), the
// worker loads `.ts` files through Node's type stripping. Source imports omit
// file extensions, so a small resolve hook adds them.
const SOURCE_RESOLVE_HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) }
  catch (error) {
    if (!specifier.startsWith('.') || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error?.code)) throw error
    try { return await next(specifier + '.ts', context) }
    catch {
      return next(specifier + '/index.ts', context)
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

/** A request finished: reuse the worker, or retire it after its last request. */
const finishRequest = (worker: Worker): void => {
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

/** One request on the pool: what to send, and how its deadline and failures read. */
export interface PoolRequest {
  /** Built when a worker is leased, so the wait in the queue counts. */
  message(): WorkerRequest
  transfer: readonly ArrayBuffer[]
  /** Time left; the hard deadline fires 1 ms after it. */
  remainingMs(): number
  /** The error at the deadline. */
  deadlineError(): unknown
  /** The error when the message cannot be cloned to the worker. */
  sendError(error: unknown): unknown
}

/**
 * Run one request in a pool worker. Every request kind takes this path: the
 * FIFO wait, the hard deadline (the leased worker is terminated, which stops
 * it even inside one synchronous step, and the pool starts a fresh one), and
 * the failure path.
 */
export const runInWorker = <Output>(
  pool: PoolRequest,
  url: string,
  marker: string,
): Promise<Output> => new Promise((resolve, reject) => {
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

  const onMessage = (response: WorkerResponse<Output>) => settle(() => {
    finishRequest(worker!)
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
        worker.postMessage(pool.message(), [...pool.transfer])
      }
      catch (error) {
        settle(() => {
          releaseWorker(leased)
          reject(pool.sendError(error))
        })
      }
    },
    reject: error => settle(() => reject(error)),
  }

  // The hard deadline, for the wait in the queue and for the work: a leased
  // worker is terminated, which stops it even inside one engine step.
  const timer = setTimeout(() => settle(() => {
    if (worker) discardWorker(worker)
    else cancelWait(waiter)
    reject(pool.deadlineError())
  }), pool.remainingMs() + 1)

  requestWorker(waiter, url, marker)
})
