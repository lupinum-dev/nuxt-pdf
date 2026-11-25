// The floats profile (test/invariants/floats.ts): generated floats in the
// page flow, in column containers and in sections, checked with I28. A
// failure is shrunk by fast-check and printed with its seed.
//
//   pnpm test                                               a few documents
//   NUXT_PDF_INVARIANT_SIZE=ci node_modules/.bin/vitest run test/invariants/floats.test.ts
//   NUXT_PDF_INVARIANT_SEED=7 NUXT_PDF_INVARIANT_RUNS=500 …
import fc from 'fast-check'
import { describe, it } from 'vitest'
import { checkFloats, normalizeFloats, rawFloats, renderFloats, type FloatSpec } from './floats'

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : Number(value)
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? 20_261_125
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS') ?? (process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' ? 60 : 4)

// Specs the generator found, each a bug fixed since: checked on every run.
const SAVED: Array<[string, FloatSpec]> = [
  ['a spanning top float after a column float that waits for the last page', { spacer: 286, columns: 2, gap: 6, items: [{ kind: 'heading' }, { kind: 'text', lines: 26 }, { kind: 'section', items: [{ kind: 'float', side: 'bottom', height: 246, note: true }, { kind: 'float', side: 'top', height: 153, note: false }, { kind: 'float', side: 'top', height: 55, note: false }, { kind: 'text', lines: 1 }] }, { kind: 'float', side: 'top', height: 20, note: false, span: true }, { kind: 'text', lines: 1 }, { kind: 'text', lines: 1 }] }],
  ['a spanning bottom float on a page whose column float waits for room for its note', { spacer: 388, columns: 2, gap: 6, items: [{ kind: 'float', side: 'bottom', height: 201, note: false, span: true }, { kind: 'section', items: [{ kind: 'heading' }, { kind: 'heading' }] }, { kind: 'text', lines: 10 }, { kind: 'float', side: 'top', height: 129, note: true }, { kind: 'text', lines: 1 }, { kind: 'text', lines: 1 }] }],
  ['spanning bottom floats in a part that goes on with a waiting float only', { spacer: 113, columns: 2, gap: 6, items: [{ kind: 'section', items: [{ kind: 'float', side: 'bottom', height: 283, note: false }] }, { kind: 'float', side: 'bottom', height: 186, note: false, span: true }, { kind: 'float', side: 'bottom', height: 63, note: false, span: true }, { kind: 'float', side: 'bottom', height: 117, note: false, span: true }] }],
  ['page bottom floats with notes when the page is filled again', { spacer: 0, columns: 0, gap: 6, items: [{ kind: 'text', lines: 8 }, { kind: 'text', lines: 24 }, { kind: 'text', lines: 1 }, { kind: 'text', lines: 9 }, { kind: 'float', side: 'bottom', height: 207, note: true }, { kind: 'section', items: [{ kind: 'float', side: 'bottom', height: 51, note: true }, { kind: 'float', side: 'bottom', height: 20, note: false }] }] }],
  ['a column bottom float with a note in a section when the page is filled again', { spacer: 549, columns: 2, gap: 6, items: [{ kind: 'text', lines: 22 }, { kind: 'section', items: [{ kind: 'float', side: 'bottom', height: 136, note: true }, { kind: 'text', lines: 16 }] }, { kind: 'text', lines: 1 }, { kind: 'text', lines: 1 }] }],
  ['column bottom floats with notes when the page is filled again', { spacer: 575, columns: 2, gap: 6, items: [{ kind: 'section', items: [{ kind: 'float', side: 'bottom', height: 160, note: true }, { kind: 'text', lines: 14 }] }, { kind: 'float', side: 'bottom', height: 20, note: true }, { kind: 'text', lines: 1 }] }],
  ['a spanning top float that would push an earlier column bottom float behind a spanning bottom float', { spacer: 0, columns: 2, gap: 6, items: [{ kind: 'text', lines: 22 }, { kind: 'float', side: 'bottom', height: 158, note: false }, { kind: 'float', side: 'bottom', height: 296, note: false, span: true }, { kind: 'float', side: 'top', height: 264, note: false, span: true }, { kind: 'text', lines: 1 }, { kind: 'text', lines: 1 }] }],
  ['a page that holds only the spanning floats that wait, a top one after a bottom one', { spacer: 298, columns: 3, gap: 6, items: [{ kind: 'text', lines: 26 }, { kind: 'text', lines: 26 }, { kind: 'float', side: 'bottom', height: 147, note: false, span: true }, { kind: 'float', side: 'bottom', height: 97, note: true, span: true }, { kind: 'text', lines: 21 }, { kind: 'float', side: 'top', height: 20, note: false, span: true }] }],
]

describe('floats profile (I28)', () => {
  it.each(SAVED)('holds for the saved spec: %s', async (_name, spec) => {
    const messages = await renderFloats(spec).then(rendered => checkFloats(spec, rendered), (error: unknown) => [String(error)])
    if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
  })

  it('holds for generated floats in pages, columns and sections', async () => {
    await fc.assert(fc.asyncProperty(rawFloats, async (raw) => {
      const spec = normalizeFloats(raw)
      const messages = await renderFloats(spec).then(rendered => checkFloats(spec, rendered), (error: unknown) => [String(error)])
      if (messages.length > 0) throw new Error(`${messages.join('\n')}\nspec: ${JSON.stringify(spec)}`)
    }), { seed: SEED, numRuns: RUNS })
  }, 600_000)
})
