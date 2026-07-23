import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/toc-raster.test.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
})
