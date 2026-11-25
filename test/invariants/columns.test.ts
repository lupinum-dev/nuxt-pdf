// The columns profile (test/invariants/columns.ts): generated column
// containers through the public render, checked with I27. A failure is
// shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few containers
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/columns.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkColumns, normalizeColumns, rawColumns, renderColumns } from './columns'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_123
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 60 : 4)

describe('columns profile (I27)', () => {
  it('holds for generated column containers', async () => {
    await fc.assert(fc.asyncProperty(rawColumns, async (raw) => {
      const spec = normalizeColumns(raw)
      const messages = await checkColumns(spec, await renderColumns(spec))
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), {
      seed: SEED,
      numRuns: RUNS,
      // Saved counterexamples, run first. Seed 23 (finding (am)): balanced at
      // 111 pt in column 1 alone, where a 5-line text and a 56 pt block fit
      // two columns of 55 and 56 pt.
      examples: [[{ spacer: 0, count: 3, gap: 0, auto: 1, items: [{ kind: 0, size: 44 }, { kind: 1, size: 611 }] }]],
    })
  }, 600_000)
})
