// The forms profile (test/invariants/forms.ts): generated documents of form
// fields, untagged and tagged, through the public render. A failure is
// shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few documents of each
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/forms.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkFormFields, checkFormTagged, normalizeForm, rawFormItems, readForm, renderForm } from './forms'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_122
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 40 : 3)

describe('forms profile (F1 form-fields, F2 form-tagged)', () => {
  it.each([false, true])('holds for generated form documents, tagged: %s', async (tagged) => {
    await fc.assert(fc.asyncProperty(rawFormItems, async (raw) => {
      const spec = normalizeForm(tagged, raw)
      const read = await readForm(await renderForm(spec))
      const messages = [...checkFormFields(spec, read), ...checkFormTagged(spec, read)]
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), { seed: SEED, numRuns: RUNS })
  }, 600_000)
})
