import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/serverless-build.test.ts'],
    pool: 'forks',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
