// The few `process` fields the library reads while its modules load (the
// render pool's worker options) or while it compiles (`process.cwd()`). It has
// no `versions`, so no package takes the worker for Node. Imported first by
// render.worker.ts, so it is in place before any library module runs.
const browserProcess = { cwd: () => "/playground", env: {}, execArgv: [] as string[], features: {} }

;(globalThis as { process?: unknown }).process ??= browserProcess;

export {};
