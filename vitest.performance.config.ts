import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/performance.test.ts'],
    pool: 'forks',
    // The test forces collections to measure the retained heap; the flag on
    // the vitest command line does not reach the test process.
    execArgv: ['--expose-gc'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 120_000,
  },
})
