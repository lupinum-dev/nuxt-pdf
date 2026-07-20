import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'test/production.test.ts',
      'test/serverless-build.test.ts',
    ],
    fileParallelism: false,
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
})
