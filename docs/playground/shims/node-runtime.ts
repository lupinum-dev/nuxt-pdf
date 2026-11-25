// `node:worker_threads`, `node:async_hooks` and `node:os` for the playground
// worker. The playground is itself a Web Worker and renders in-process
// (`pdfRenderPlacement.inProcess`), so the render pool never starts a thread.

export const parentPort = null;
export const workerData = undefined;
export const isMarkedAsUntransferable = (): boolean => false;

export class Worker {
  constructor() {
    throw new Error("The playground renders in its own Web Worker and starts no render threads.");
  }
}

/**
 * Counted work (engine/work.ts) is a test measure. Outside `run` nothing is
 * counted, which is all the playground needs.
 */
export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return undefined;
  }

  run<R>(_store: T, callback: () => R): R {
    return callback();
  }
}

export const availableParallelism = (): number => 1;
