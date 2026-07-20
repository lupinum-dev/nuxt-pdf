import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/production.test.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
})
