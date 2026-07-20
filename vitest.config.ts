import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'test/production.test.ts',
    ],
    fileParallelism: false,
    pool: 'forks',
    setupFiles: ['./test/setup.ts'],
  },
})
