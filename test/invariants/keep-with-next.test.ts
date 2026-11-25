// The keepWithNext profile (test/invariants/keep-with-next.ts): generated
// columns of keeps through the public render, checked with I26. A
// failure is shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few columns
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/keep-with-next.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkKeep, normalizeKeep, rawKeeps, renderKeep } from './keep-with-next'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_123
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 60 : 4)

describe('keepWithNext profile (I26)', () => {
  it('holds for generated columns with keepWithNext', async () => {
    await fc.assert(fc.asyncProperty(rawKeeps, async (raw) => {
      const spec = normalizeKeep(raw)
      const messages = await checkKeep(spec, await renderKeep(spec))
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), { seed: SEED, numRuns: RUNS })
  }, 600_000)
})
