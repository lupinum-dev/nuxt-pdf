// The automatic columns profile (test/invariants/auto-columns.ts): generated
// tables with 'auto' columns through the public render, checked with I9c. A
// failure is shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few tables
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/auto-columns.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkAutoColumns, normalizeAutoTable, rawAutoTables, renderAutoTable } from './auto-columns'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_123
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 60 : 4)

describe('automatic columns profile (I9c)', () => {
  it('holds for generated tables with \'auto\' columns', async () => {
    await fc.assert(fc.asyncProperty(rawAutoTables, async (raw) => {
      const spec = normalizeAutoTable(raw)
      const messages = await checkAutoColumns(spec, await renderAutoTable(spec))
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), { seed: SEED, numRuns: RUNS })
  }, 600_000)
})
