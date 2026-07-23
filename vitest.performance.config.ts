import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/performance.test.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 120_000,
  },
})
