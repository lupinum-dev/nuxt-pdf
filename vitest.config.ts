import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'test/production.test.ts',
      'test/performance.test.ts',
      'test/serverless-build.test.ts',
    ],
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
})
