// The row-span profile (test/invariants/row-spans.ts): generated tables with
// cells over several rows through the public render, checked with I9b. A
// failure is shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few tables
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/row-spans.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkSpans, normalizeSpans, rawSpans, renderSpans } from './row-spans'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_123
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 60 : 4)

describe('row-span profile (I9b)', () => {
  it('holds for generated tables with cells over several rows', async () => {
    await fc.assert(fc.asyncProperty(rawSpans, async (raw) => {
      const spec = normalizeSpans(raw)
      const messages = await checkSpans(spec, await renderSpans(spec))
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), { seed: SEED, numRuns: RUNS })
  }, 600_000)
})
