// The layout profile (test/invariants/layout.ts): generated documents with
// one layout feature each. The measurement renders each document and reports
// per feature its errors and failed checks.
//
//   NUXT_PDF_LAYOUT_MEASURE=1 NUXT_PDF_LAYOUT_RUNS=40 node_modules/.bin/vitest run test/invariants/layout.test.ts
import { writeFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { pdfRenderPlacement } from '../../src/runtime/server/worker-pool'
import { checkLayout, FEATURES, normalizeLayout, rawLayout, renderLayout, type Failure, type Feature, type LayoutSpec } from './layout'

const SEED = Number(process.env.NUXT_PDF_INVARIANT_SEED ?? 20_261_125)
const RUNS = Number(process.env.NUXT_PDF_LAYOUT_RUNS ?? 40)
const ONLY = process.env.NUXT_PDF_LAYOUT_FEATURE as Feature | undefined
const OUT = process.env.NUXT_PDF_LAYOUT_OUT

type Outcome = { error: string } | { bytes: Uint8Array, failures: Failure[] }

const render = async (spec: LayoutSpec): Promise<Outcome> => {
  try {
    const bytes = await renderLayout(spec)
    return { bytes, failures: await checkLayout(spec, bytes) }
  }
  catch (error) {
    return { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }
  }
}

describe.runIf(process.env.NUXT_PDF_LAYOUT_MEASURE === '1')('layout profile: measurement', () => {
  it(`measures ${ONLY ?? 'every feature'}, seed ${SEED}, ${RUNS} documents each`, async () => {
    const previous = pdfRenderPlacement.inProcess
    pdfRenderPlacement.inProcess = true
    const report: Record<string, unknown> = {}
    try {
      for (const feature of ONLY ? [ONLY] : FEATURES) {
        const raws = fc.sample(rawLayout([feature]), { seed: SEED, numRuns: RUNS })
        const row = { documents: 0, errors: [] as string[], failures: {} as Record<string, number>, examples: [] as string[] }
        for (const [index, raw] of raws.entries()) {
          const spec = normalizeLayout(raw)
          row.documents += 1
          const outcome = await render(spec)
          if ('error' in outcome) {
            row.errors.push(`${index}: ${outcome.error}`)
            continue
          }
          for (const failure of outcome.failures) {
            row.failures[failure.check] = (row.failures[failure.check] ?? 0) + 1
            if (row.examples.length < 6) row.examples.push(`${index} v${spec.variant}: ${failure.message}`)
          }
        }
        report[feature] = row
        console.log(feature, JSON.stringify({ ...row, errors: row.errors.length }))
      }
    }
    finally {
      pdfRenderPlacement.inProcess = previous
    }
    if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1))
    expect(Object.keys(report).length).toBeGreaterThan(0)
  }, 1_800_000)
})
