// Invariants on generated documents (internals/harness-plan.md).
//
// Saved regression cases run first, then new documents from a seed.
//
//   pnpm test:invariants                                       fixed seed, CI size (its own CI job)
//   pnpm test                                                  saved cases and one document per rule
//   NUXT_PDF_INVARIANT_RUNS=2000 NUXT_PDF_INVARIANT_SEED=7 pnpm test:invariants
//   NUXT_PDF_INVARIANT_CASE=test/invariants/regressions/<file>.json pnpm test:invariants
//   NUXT_PDF_INVARIANT_CASE=<file> NUXT_PDF_INVARIANT_REDUCE=1 pnpm test:invariants
//   NUXT_PDF_INVARIANT_KEEP_GOING=1 …   collect every failure instead of stopping at the first
//   NUXT_PDF_INVARIANT_NO_REDUCE=1 …    report a failure without reducing and saving it
//   NUXT_PDF_INVARIANT_PROFILE=fixed NUXT_PDF_INVARIANT_INDEX=24 …   one generated document
//   NUXT_PDF_INVARIANT_IGNORE_KNOWN=1 …  also check the documents saved expected failures came from
//   NUXT_PDF_INVARIANT_PROFILE=invalid …  only the invalid documents (I15); `isolation` and `limits` select I11 and I12
//
// A failing document is reduced and saved under regressions/ as
// `pending-<profile>-<seed>-<rule>-<index>.json`. Triage it: rename it, and
// for an engine bug add `expectedFailure` with the reason. A case with
// `expectedFailure` keeps the suite green while the engine still fails it, and
// the run skips the generated document it came from (`origin`).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { mountPdfComponent, type PdfNode } from '../../src/runtime/renderer'
import { PDF_PRIMITIVES } from '../../src/runtime/primitives'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../src/runtime/shared/errors'
import { readPdf, renderPublic, specComponent, RENDER_TIMEOUT_MS, RETRY_TIMEOUT_MS, type Lengths, type ReadPdf, type Unit } from './document'
import { FAULTS, faultKind, normalizeInvalid, rawInvalidDocument, type RawInvalidDocument } from './faults'
import { expectationsOf, normalizeDocument, rawDocument, shortDocument, type DocumentSpec, type NodeSpec, type Profile, type RawDocument, type ViewSpec } from './generator'
import {
  checkDocument,
  checkEnds,
  checkInvalid,
  checkIsolated,
  checkLimit,
  checkRendered,
  checkSameBytes,
  checkSamePositions,
  checkTypedError,
  type InvariantId,
  type LimitKey,
  type Violation,
} from './invariants'
import { reduceDocument } from './reduce'

const REGRESSIONS = resolve(import.meta.dirname, 'regressions')
const DEFAULT_SEED = 20_261_116

const envNumber = (name: string): number | undefined => {
  const value = process.env[name]
  if (value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isInteger(number)) throw new TypeError(`${name} must be an integer, got ${JSON.stringify(value)}`)
  return number
}

const SEED = envNumber('NUXT_PDF_INVARIANT_SEED') ?? DEFAULT_SEED
const RUNS = envNumber('NUXT_PDF_INVARIANT_RUNS')
const ONLY_CASE = process.env.NUXT_PDF_INVARIANT_CASE
const REDUCE_CASE = process.env.NUXT_PDF_INVARIANT_REDUCE === '1'
const KEEP_GOING = process.env.NUXT_PDF_INVARIANT_KEEP_GOING === '1'
/** Report the first failing document as it is, without reducing or saving it. */
const NO_REDUCE = process.env.NUXT_PDF_INVARIANT_NO_REDUCE === '1'
  // The run over the known failures reports them; it must not save them again.
  || process.env.NUXT_PDF_INVARIANT_IGNORE_KNOWN === '1'
/** Check only this document of the seed (with NUXT_PDF_INVARIANT_PROFILE). */
const ONLY_INDEX = envNumber('NUXT_PDF_INVARIANT_INDEX')
const ONLY_PROFILE = process.env.NUXT_PDF_INVARIANT_PROFILE
const REDUCE_BUDGET = { budgetMs: 4 * 60_000, maxChecks: 2000 }

type Rule = 'documents' | 'bytes' | 'pairs'

/**
 * `pnpm test:invariants` sets NUXT_PDF_INVARIANT_SIZE=ci: the CI size below,
 * about 150 s on a developer machine, too long for `pnpm test`, which checks
 * the saved cases and one document per rule. A run for one document
 * (NUXT_PDF_INVARIANT_INDEX) samples the CI size, so the index means the same
 * document in both.
 */
const CI_SIZE = process.env.NUXT_PDF_INVARIANT_SIZE === 'ci' || ONLY_INDEX !== undefined
const sized = (ci: number): number => CI_SIZE ? ci : Math.min(1, ci)

/** Documents per profile and rule at CI size. */
const CI_RUNS: Record<Profile, Record<Rule, number>> = {
  flow: { documents: 100, bytes: 10, pairs: 0 },
  fixed: { documents: 100, bytes: 10, pairs: 0 },
  table: { documents: 40, bytes: 3, pairs: 0 },
  mixed: { documents: 40, bytes: 4, pairs: 8 },
}
/** Document pairs (I11) and documents under small limits (I12) in the fixed-seed run; the invalid run tries each fault kind once (I15). */
const CI_ISOLATION = 3
const CI_LIMITS = 6

/** Room for the worker to start and the deadline error to arrive. */
const SETTLE_EXTRA_MS = 5_000

interface CaseBase {
  invariants: InvariantId[]
  /** Set while the current engine fails this case; says why. */
  expectedFailure?: string
  note?: string
}

/** A valid document of a profile (I1 to I10, I14). */
interface ProfileCase extends CaseBase {
  profile: Profile
  /** The generated document it was reduced from. */
  origin: { seed: number, index: number, rule: Rule }
  raw: RawDocument
}

/** An invalid document (I15). */
interface InvalidCase extends CaseBase {
  profile: 'invalid'
  origin: { seed: number, index: number, rule: 'invalid' }
  raw: RawInvalidDocument
}

export type RegressionCase = ProfileCase | InvalidCase

type Settled<T> = { settled: true, value: T } | { settled: true, error: unknown } | { settled: false }

const settleWithin = async <T>(promise: Promise<T>, ms: number): Promise<Settled<T>> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<Settled<T>>((done) => {
    timer = setTimeout(() => done({ settled: false }), ms)
  })
  try {
    return await Promise.race([
      promise.then((value): Settled<T> => ({ settled: true, value }), (error: unknown): Settled<T> => ({ settled: true, error })),
      timeout,
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

type CheckOptions = { retry?: boolean, label?: string, index?: number }

const renderOnce = async (spec: DocumentSpec, timeoutMs: number) => {
  const start = performance.now()
  const outcome = await settleWithin(renderPublic(spec, { inProcess: false, timeoutMs }), timeoutMs + SETTLE_EXTRA_MS)
  return { outcome, elapsedMs: performance.now() - start, settleMs: timeoutMs + SETTLE_EXTRA_MS }
}

/** The render did not settle, or the engine stopped it at its time budget. */
const hitTimeLimit = (outcome: Settled<Uint8Array>): boolean =>
  !outcome.settled
  || ('error' in outcome && outcome.error instanceof NuxtPdfError
    && outcome.error.code === PDF_ERROR_CODES.LimitExceeded && outcome.error.message.includes('time budget'))

/** Documents that needed the rerun and ended in it, per run (logged, not a failure). */
const slowDocuments: string[] = []

/**
 * I1 to I8 on one document, rendered on the production path (pool worker).
 *
 * Wall time alone cannot tell a slow render from one that does not end: under
 * load a document that takes 2 s idle can pass the 10 s limit. A render that
 * hits the limit is rerun once with a limit six times longer. Only a render
 * that still hits it counts (I1, or a rejected valid document as with the
 * fixed finding F5);
 * one that ends is slow and is checked like any other. `retry: false` keeps
 * one attempt, for replays of saved cases that must still fail.
 */
const checkSpec = async (spec: DocumentSpec, { retry = true, label = '' }: CheckOptions = {}): Promise<Violation[]> => {
  let { outcome, elapsedMs, settleMs } = await renderOnce(spec, RENDER_TIMEOUT_MS)
  if (retry && hitTimeLimit(outcome)) {
    ;({ outcome, elapsedMs, settleMs } = await renderOnce(spec, RETRY_TIMEOUT_MS))
    if (!hitTimeLimit(outcome)) slowDocuments.push(`${label} (${Math.round(elapsedMs)} ms in the rerun)`)
  }
  const ends = checkEnds(elapsedMs, outcome.settled, settleMs)
  if (!outcome.settled) return ends
  if ('error' in outcome) return [...ends, ...checkTypedError(outcome.error), ...checkRendered(outcome.error)]
  const expectations = expectationsOf(spec)
  const navigation = { ids: expectations.links.flatMap(link => link.id === undefined ? [] : [link.id]), outline: expectations.bookmarks.length > 0 }
  return [...ends, ...checkDocument(spec, expectations, await readPdf(outcome.value, navigation, { details: spec.profile === 'mixed' }))]
}

/**
 * I10: twice in sequence, then five in parallel, through the worker pool. The
 * rule is about bytes, not time, so every render gets the long limit. A
 * rejection, or a render that does not settle, is left to the documents rule
 * (I1); this rule must not wait for it forever.
 */
const checkBytes = async (spec: DocumentSpec): Promise<Violation[]> => {
  const render = async (): Promise<Uint8Array> => {
    const outcome = await settleWithin(renderPublic(spec, { inProcess: false, timeoutMs: RETRY_TIMEOUT_MS }), RETRY_TIMEOUT_MS + SETTLE_EXTRA_MS)
    if (outcome.settled && 'value' in outcome) return outcome.value
    throw new Error('no PDF')
  }
  try {
    const first = await render()
    const second = await render()
    const parallel = await Promise.all(Array.from({ length: 5 }, render))
    return [
      ...checkSameBytes('sequential', first, [second]),
      ...checkSameBytes('parallel', first, parallel),
    ]
  }
  catch {
    return []
  }
}

// Invented; never shown in a message or the record.
const PAIR_PASSWORD = 'Hx4-invented-pair'
const PAIR_UNITS = ['mm', 'cm', 'in'] as const satisfies readonly Unit[]

/** The spec with one neutral PdfView (no style, breakable) around node `pick` of a page or view; undefined without a node. */
const withWrapper = (spec: DocumentSpec, pick: number): { spec: DocumentSpec, label: string } | undefined => {
  const copy = structuredClone(spec)
  const lists: NodeSpec[][] = []
  const collect = (nodes: NodeSpec[]) => {
    lists.push(nodes)
    for (const node of nodes) if (node.kind === 'view') collect(node.children)
  }
  for (const page of copy.pages) collect(page.children)
  const slots = lists.flatMap(list => list.map((_, index) => ({ list, index })))
  const slot = slots[pick % Math.max(1, slots.length)]
  if (!slot) return undefined
  const node = slot.list[slot.index]!
  const wrapper: ViewSpec = { kind: 'view', margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], border: 0, minHeight: 0, wrap: true, brk: false, children: [node], estimate: 0 }
  slot.list[slot.index] = wrapper
  return { spec: copy, label: `${node.kind} ${pick % slots.length} of ${slots.length}` }
}

/**
 * I13, metamorphic pairs on the production path: the document in mm, cm or in
 * (by index) against the same document in pt with the numbers the engine gets
 * from those strings (`Lengths`), the document with one neutral PdfView around
 * a node, and with `protection` (read with the password), each against the
 * plain pt document. The rule is about positions, not time, so every render
 * gets the long limit. A reference that does not render is left to the
 * documents rule; a variant that does not render while its reference does is
 * a violation.
 */
const checkPairs = async (spec: DocumentSpec, { index = 0 }: CheckOptions = {}): Promise<Violation[]> => {
  const render = async (document: DocumentSpec, lengths?: Lengths): Promise<{ bytes: Uint8Array } | { error: string }> => {
    const outcome = await settleWithin(renderPublic(document, { inProcess: false, timeoutMs: RETRY_TIMEOUT_MS, ...(lengths === undefined ? {} : { lengths }) }), RETRY_TIMEOUT_MS + SETTLE_EXTRA_MS)
    if (outcome.settled && 'value' in outcome) return { bytes: outcome.value }
    return { error: outcome.settled && 'error' in outcome ? String(outcome.error instanceof Error ? outcome.error.message : outcome.error).slice(0, 200) : 'did not settle' }
  }
  const read = async (document: DocumentSpec, lengths?: Lengths) => {
    const result = await render(document, lengths)
    return 'bytes' in result ? readPdf(result.bytes, undefined, { details: true }) : undefined
  }
  const reference = await read(spec)
  if (!reference) return []
  const found: Violation[] = []
  const compare = async (label: string, expected: ReadPdf, document: DocumentSpec, { lengths, password }: { lengths?: Lengths, password?: string } = {}) => {
    const result = await render(document, lengths)
    if (!('bytes' in result)) {
      found.push({ invariant: 'I13', message: `${label}: did not render: ${result.error}` })
      return
    }
    found.push(...checkSamePositions(label, expected, await readPdf(result.bytes, undefined, { details: true, ...(password === undefined ? {} : { password }) })))
  }
  const unit = PAIR_UNITS[index % PAIR_UNITS.length]!
  const points = await read(spec, { pointsOf: unit })
  if (points) await compare(`in ${unit}`, points, spec, { lengths: unit })
  else found.push({ invariant: 'I13', message: `in pt as ${unit} gives it: did not render` })
  const wrapped = withWrapper(spec, index)
  if (wrapped) await compare(`a wrapper around ${wrapped.label}`, reference, wrapped.spec)
  await compare('protected', reference, { ...spec, patch: { props: { protection: { openPassword: PAIR_PASSWORD } } } }, { password: PAIR_PASSWORD })
  return found
}

const CHECKS: Record<Rule, (spec: DocumentSpec, options?: CheckOptions) => Promise<Violation[]>> = { documents: checkSpec, bytes: checkBytes, pairs: checkPairs }

const describeViolations = (found: readonly Violation[]): string =>
  found.map(violation => `${violation.invariant}: ${violation.message}`).join('\n')

const loadCases = (): Array<{ file: string, entry: RegressionCase }> => {
  mkdirSync(REGRESSIONS, { recursive: true })
  const files = ONLY_CASE
    ? [resolve(ONLY_CASE)]
    : readdirSync(REGRESSIONS).filter(name => name.endsWith('.json')).sort().map(name => join(REGRESSIONS, name))
  return files.map(file => ({ file, entry: JSON.parse(readFileSync(file, 'utf8')) as RegressionCase }))
}

const reduceFailure = async (raw: RawDocument, profile: Profile, invariants: readonly InvariantId[], rule: Rule, index: number) =>
  reduceDocument(raw, async (candidate) => {
    const spec = normalizeDocument(candidate, profile)
    const found = await CHECKS[rule](spec, { index })
    return found.some(violation => invariants.includes(violation.invariant))
  }, REDUCE_BUDGET)

const cases = loadCases()

/**
 * The generated documents that saved expected failures came from. The run
 * skips them; the saved case above replays each finding. With
 * NUXT_PDF_INVARIANT_IGNORE_KNOWN=1 the run checks them too, to see which
 * findings a change fixed.
 */
const knownOrigins = process.env.NUXT_PDF_INVARIANT_IGNORE_KNOWN === '1'
  ? new Set<string>()
  : new Set(cases
      .filter(({ entry }) => entry.expectedFailure !== undefined)
      .map(({ entry }) => `${entry.profile}/${entry.origin.rule}/${entry.origin.seed}/${entry.origin.index}`))

/**
 * Fault kinds with a saved expected failure. The invalid run leaves them out:
 * every document with that fault would report the same finding again. The
 * saved case replays it.
 */
const knownFaults = new Set(cases.flatMap(({ entry }) =>
  entry.profile === 'invalid' && entry.expectedFailure !== undefined && process.env.NUXT_PDF_INVARIANT_IGNORE_KNOWN !== '1' ? [entry.raw.fault] : []))

const runGenerated = async (profile: Profile, rule: Rule, numRuns: number): Promise<void> => {
  const raws = fc.sample(rawDocument(profile), { seed: SEED, numRuns })
  const reports: string[] = []
  let skipped = 0
  for (const [index, raw] of raws.entries()) {
    if (ONLY_INDEX !== undefined && index !== ONLY_INDEX) continue
    if (knownOrigins.has(`${profile}/${rule}/${SEED}/${index}`)) {
      skipped += 1
      continue
    }
    const spec = normalizeDocument(raw, profile)
    const found = await CHECKS[rule](spec, { label: `${profile} ${index}`, index })
    if (found.length === 0) continue
    if (NO_REDUCE) {
      reports.push(`${profile} ${rule}: document ${index} of seed ${SEED} fails (${index + 1} documents).\n${describeViolations(found)}`)
      if (KEEP_GOING) continue
      break
    }
    const invariants = [...new Set(found.map(violation => violation.invariant))]
    const reduced = await reduceFailure(raw, profile, invariants, rule, index)
    const violations = await CHECKS[rule](normalizeDocument(reduced.raw, profile), { index })
    const entry: RegressionCase = {
      profile,
      invariants: [...new Set(violations.map(violation => violation.invariant))],
      origin: { seed: SEED, index, rule },
      raw: reduced.raw,
    }
    const file = join(REGRESSIONS, `pending-${profile}-${SEED}-${rule}-${index}.json`)
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`)
    reports.push(
      `${profile} ${rule}: document ${index} of seed ${SEED} fails; reduced in ${reduced.steps} steps (${reduced.checks} renders).\n`
      + `${describeViolations(violations)}\nSaved: ${file}\nReproduce: NUXT_PDF_INVARIANT_CASE=${file} pnpm test:invariants`,
    )
    if (!KEEP_GOING) break
  }
  const slow = slowDocuments.splice(0)
  console.log(`${profile} ${rule}: seed ${SEED}, ${raws.length} documents, ${skipped} skipped as triaged, ${slow.length} slow but ending${slow.length > 0 ? ` (${slow.join(', ')})` : ''}, ${reports.length} new failures`)
  if (reports.length > 0) throw new Error(reports.join('\n\n'))
}

describe.runIf(cases.length > 0)('saved regression cases', () => {
  it.each(cases.map(({ file, entry }) => ({ file, name: file.slice(REGRESSIONS.length + 1), entry })))('$name', async ({ file, entry }) => {
    const found = entry.profile === 'invalid'
      ? await replayInvalid(file, entry)
      : await replayProfile(file, entry)
    if (entry.expectedFailure === undefined) {
      expect(describeViolations(found)).toBe('')
      return
    }
    // A known failure must still fail one of its invariants. When it passes,
    // the mark is stale: remove expectedFailure.
    expect(found.filter(violation => entry.invariants.includes(violation.invariant)), `expected failure no longer fails: ${entry.expectedFailure}`)
      .not.toEqual([])
  }, REDUCE_CASE ? 2 * REDUCE_BUDGET.budgetMs : 2 * (RENDER_TIMEOUT_MS + RETRY_TIMEOUT_MS + 2 * SETTLE_EXTRA_MS))
})

async function replayProfile(file: string, entry: ProfileCase): Promise<Violation[]> {
  let { raw } = entry
  if (REDUCE_CASE) {
    const reduced = await reduceFailure(raw, entry.profile, entry.invariants, entry.origin.rule, entry.origin.index)
    raw = reduced.raw
    writeFileSync(file, `${JSON.stringify({ ...entry, raw }, null, 2)}\n`)
    console.log(`reduced ${file} in ${reduced.steps} steps (${reduced.checks} renders)`)
  }
  // A saved known failure needs one attempt: failing at the first limit is
  // enough to show the engine still fails it.
  return CHECKS[entry.origin.rule](normalizeDocument(raw, entry.profile), { retry: entry.expectedFailure === undefined, index: entry.origin.index })
}

async function replayInvalid(file: string, entry: InvalidCase): Promise<Violation[]> {
  let { raw } = entry
  if (REDUCE_CASE) {
    const reduced = await reduceInvalid(raw, entry.invariants)
    raw = reduced
    writeFileSync(file, `${JSON.stringify({ ...entry, raw }, null, 2)}\n`)
  }
  return checkInvalidDocument(raw)
}

// ---------------------------------------------------------------------------
// I15: invalid documents.

const settledOutcome = (outcome: Settled<Uint8Array>): { rendered: Uint8Array } | { error: unknown } | undefined =>
  !outcome.settled ? undefined : 'value' in outcome ? { rendered: outcome.value } : { error: outcome.error }

/**
 * I15 on one invalid document: the fault gives its typed error naming the
 * element, and the same document without the fault renders. The fault fails
 * in tree validation, before layout, so its render is short.
 */
async function checkInvalidDocument(raw: RawInvalidDocument): Promise<Violation[]> {
  const document = normalizeInvalid(raw)
  const start = performance.now()
  const faulted = await settleWithin(renderPublic(document.spec, { inProcess: false }), RENDER_TIMEOUT_MS + SETTLE_EXTRA_MS)
  const outcome = settledOutcome(faulted)
  if (!outcome) return checkEnds(performance.now() - start, false, RENDER_TIMEOUT_MS + SETTLE_EXTRA_MS)
  const found = [...checkInvalid(document.expected, outcome), ...('error' in outcome ? checkTypedError(outcome.error) : [])]
  const valid = await settleWithin(renderPublic(document.valid, { inProcess: false, timeoutMs: RETRY_TIMEOUT_MS }), RETRY_TIMEOUT_MS + SETTLE_EXTRA_MS)
  if (!valid.settled || !('value' in valid)) {
    found.push({ invariant: 'I15', message: `the document without the fault did not render: ${valid.settled && 'error' in valid ? String(valid.error).slice(0, 200) : 'no result'}` })
  }
  return found
}

/** Reduce the valid document under the fault; the fault kind and pick stay. */
const reduceInvalid = async (raw: RawInvalidDocument, invariants: readonly InvariantId[]): Promise<RawInvalidDocument> => {
  const reduced = await reduceDocument(raw.raw, async (candidate) => {
    const found = await checkInvalidDocument({ ...raw, raw: candidate })
    return found.some(violation => invariants.includes(violation.invariant))
  }, REDUCE_BUDGET)
  return { ...raw, raw: reduced.raw }
}

/**
 * Document `index` of the invalid run: the fault kinds in FAULTS order, one
 * after the other, so a run of FAULTS.length documents tries every kind once.
 * Each document has its own seed, so an index always gives the same document.
 */
const invalidAt = (index: number): RawInvalidDocument =>
  fc.sample(rawInvalidDocument([FAULTS[index % FAULTS.length]!.id]), { seed: SEED + index, numRuns: 1 })[0]!

const runInvalid = async (numRuns: number): Promise<void> => {
  const reports: string[] = []
  let skipped = 0
  let known = 0
  for (let index = 0; index < numRuns; index += 1) {
    if (ONLY_INDEX !== undefined && index !== ONLY_INDEX) continue
    const raw = invalidAt(index)
    if (knownFaults.has(raw.fault)) {
      known += 1
      continue
    }
    if (knownOrigins.has(`invalid/invalid/${SEED}/${index}`)) {
      skipped += 1
      continue
    }
    const found = await checkInvalidDocument(raw)
    if (found.length === 0) continue
    const head = `invalid: document ${index} of seed ${SEED} (fault ${faultKind(raw).id}, base ${raw.base}) fails`
    if (NO_REDUCE) {
      reports.push(`${head}.\n${describeViolations(found)}`)
      if (KEEP_GOING) continue
      break
    }
    const reduced = await reduceInvalid(raw, [...new Set(found.map(violation => violation.invariant))])
    const violations = await checkInvalidDocument(reduced)
    const entry: InvalidCase = {
      profile: 'invalid',
      invariants: [...new Set(violations.map(violation => violation.invariant))],
      origin: { seed: SEED, index, rule: 'invalid' },
      raw: reduced,
    }
    const file = join(REGRESSIONS, `pending-invalid-${SEED}-${faultKind(raw).id}-${index}.json`)
    writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`)
    reports.push(`${head}.\n${describeViolations(violations)}\nSaved: ${file}`)
    if (!KEEP_GOING) break
  }
  console.log(`invalid: seed ${SEED}, ${numRuns} documents over ${FAULTS.length} fault kinds, ${known} left out (fault kinds with a saved finding: ${[...knownFaults].join(', ') || 'none'}), ${skipped} skipped as triaged, ${reports.length} new failures`)
  if (reports.length > 0) throw new Error(reports.join('\n\n'))
}

// ---------------------------------------------------------------------------
// I11 and I12: renders that share the worker pool.

/** Short valid documents of any profile, for the pool rules. */
const rawAnyDocument = fc.constantFrom<Profile>('flow', 'fixed', 'table')
  .chain(profile => rawDocument(profile).map(raw => ({ profile, raw: shortDocument(raw) })))

/** A render on the production path (the shared worker pool); a result that does not settle counts as an error. */
const renderPool = async (spec: DocumentSpec, limits: Parameters<typeof renderPublic>[1]['limits'] = {}): Promise<{ rendered: Uint8Array } | { error: unknown }> => {
  const timeoutMs = limits.timeoutMs ?? RETRY_TIMEOUT_MS
  const outcome = settledOutcome(await settleWithin(renderPublic(spec, { inProcess: false, timeoutMs, limits }), timeoutMs + SETTLE_EXTRA_MS))
  return outcome ?? { error: new Error(`did not settle within ${timeoutMs + SETTLE_EXTRA_MS} ms`) }
}

const wordsOf = async (bytes: Uint8Array, password?: string): Promise<string[]> =>
  (await readPdf(bytes, undefined, password === undefined ? {} : { password })).words.map(word => word.text)

/** Flow and fixed tokens of a spec. */
const tokensOf = (spec: DocumentSpec): Set<string> => new Set(expectationsOf(spec).tokens.keys())

// Invented; never shown in a message or the record.
const ISOLATION_PASSWORD = 'Rk5-invented-isolation'
/** The limit of the B render that must time out; its row below loops until the deadline. */
const LOOP_TIMEOUT_MS = 500

/**
 * A block that paginates until the deadline: a fixed node higher than any page
 * above the content of a column in a row (test/engine.test.ts, "ends
 * pagination at the deadline"). The worker is terminated in the middle of
 * layout.
 */
const loopingRow = () => h(PDF_COMPONENTS.PdfView, { style: { flexDirection: 'row' } }, () => [
  h(PDF_COMPONENTS.PdfView, { style: { flexGrow: 1 } }, () => [
    h(PDF_COMPONENTS.PdfView, { fixed: true, style: { height: 5000 } }),
    h(PDF_COMPONENTS.PdfText, () => 'xloop'),
  ]),
  h(PDF_COMPONENTS.PdfView, { style: { flexGrow: 1 } }, () => [h(PDF_COMPONENTS.PdfText, () => 'xbeside')]),
])

/**
 * I11: A, then B, then A again, through the same worker pool; between the A
 * renders, B as a valid, an invalid, a timed-out and a protected document.
 * The timed-out B holds a block that loops, so the deadline stops its worker
 * in the middle of layout. Every A render must equal the first in bytes and
 * hold no token of B. B's
 * tokens start with "x", so no token of A can be one of them. The protected B
 * is encrypted with a random key, so its bytes are not compared; its text,
 * read with the password, holds B's tokens and none of A.
 */
const checkIsolation = async (index: number): Promise<Violation[]> => {
  const [pair] = fc.sample(fc.tuple(rawAnyDocument, rawAnyDocument), { seed: SEED + index, numRuns: 1 })
  const [first, second] = pair!
  const a = normalizeDocument(first.raw, first.profile)
  const b = normalizeDocument(second.raw, second.profile, { prefix: 'x' })
  const foreign = tokensOf(b)
  const reference = await renderPool(a)
  if (!('rendered' in reference)) return [{ invariant: 'I11', message: `A did not render: ${String(reference.error).slice(0, 200)}` }]
  const found: Violation[] = []
  const againA = async (label: string): Promise<void> => {
    const again = await renderPool(a)
    if (!('rendered' in again)) {
      found.push({ invariant: 'I11', message: `${label}: A did not render: ${String(again.error).slice(0, 200)}` })
      return
    }
    const same = Buffer.from(again.rendered).equals(Buffer.from(reference.rendered))
    found.push(...checkIsolated(label, reference.rendered, again.rendered, same ? [] : await wordsOf(again.rendered), foreign))
  }

  await renderPool(b)
  await againA('after B')

  const invalidB = normalizeDocument(second.raw, second.profile, { prefix: 'x' })
  invalidB.patch = { props: { colour: 'red' } }
  const rejected = await renderPool(invalidB)
  if ('rendered' in rejected) found.push({ invariant: 'I11', message: 'the invalid B rendered' })
  await againA('after an invalid B')

  const loopingB = normalizeDocument(second.raw, second.profile, { prefix: 'x' })
  loopingB.pages[0]!.patch = { append: () => [loopingRow()] }
  const timedOut = await renderPool(loopingB, { timeoutMs: LOOP_TIMEOUT_MS })
  if (!('error' in timedOut) || !(timedOut.error instanceof NuxtPdfError) || timedOut.error.code !== PDF_ERROR_CODES.LimitExceeded) {
    found.push({ invariant: 'I11', message: `the looping B did not end at its deadline: ${'error' in timedOut ? String(timedOut.error).slice(0, 200) : 'it rendered'}` })
  }
  await againA('after a timed-out B')

  const protectedB = normalizeDocument(second.raw, second.profile, { prefix: 'x' })
  protectedB.patch = { props: { protection: { openPassword: ISOLATION_PASSWORD } } }
  const locked = await renderPool(protectedB)
  if ('rendered' in locked) {
    const words = new Set(await wordsOf(locked.rendered, ISOLATION_PASSWORD))
    const own = tokensOf(a)
    const missing = [...foreign].filter(token => !words.has(token))
    const leaked = [...words].filter(word => own.has(word))
    if (missing.length > 0) found.push({ invariant: 'I11', message: `the protected B misses its tokens: ${missing.slice(0, 5).join(', ')}` })
    if (leaked.length > 0) found.push({ invariant: 'I11', message: `the protected B holds tokens of A: ${leaked.slice(0, 5).join(', ')}` })
  }
  else {
    found.push({ invariant: 'I11', message: `the protected B did not render: ${String(locked.error).slice(0, 200)}` })
  }
  await againA('after a protected B')
  return found
}

/** Mounted tree nodes, counted as `enforceTreeLimits` counts them (every element and text node). */
const mountedNodes = async (spec: DocumentSpec): Promise<number> => {
  const mounted = await mountPdfComponent(specComponent(spec))
  try {
    const pending: PdfNode[] = [mounted.take()]
    let count = 0
    while (pending.length > 0) {
      const node = pending.pop()!
      count += 1
      if (node.type !== PDF_PRIMITIVES.TextInstance) pending.push(...node.children)
    }
    return count
  }
  finally {
    mounted.unmount()
  }
}

const TIME_LIMITS = [1, 25, 250] as const

/**
 * I12: one document under a small `maxPages`, `maxNodes` and `timeoutMs`.
 * The page and node limits are the document's own size or one less, so a
 * check off by one in either direction fails. After every render under a
 * limit, the next normal render in the same pool gives the reference bytes.
 */
const checkLimits = async (index: number): Promise<Violation[]> => {
  const [entry] = fc.sample(rawAnyDocument, { seed: SEED + 1000 + index, numRuns: 1 })
  const spec = normalizeDocument(entry!.raw, entry!.profile)
  const reference = await renderPool(spec)
  if (!('rendered' in reference)) return [{ invariant: 'I12', message: `the document did not render: ${String(reference.error).slice(0, 200)}` }]
  const pages = (await readPdf(reference.rendered)).parsed.pages.length
  const nodes = await mountedNodes(spec)
  const found: Violation[] = []
  const pagesOf = async (bytes: Uint8Array): Promise<number> =>
    Buffer.from(bytes).equals(Buffer.from(reference.rendered)) ? pages : (await readPdf(bytes)).parsed.pages.length
  const under = async (key: LimitKey, limit: number, size: number | undefined): Promise<void> => {
    const start = performance.now()
    const outcome = await renderPool(spec, { [key]: limit })
    const elapsed = performance.now() - start
    if (key === 'timeoutMs' && elapsed > limit + SETTLE_EXTRA_MS) found.push({ invariant: 'I12', message: `timeoutMs ${limit}: settled after ${Math.round(elapsed)} ms` })
    found.push(...checkLimit(key, limit, size, 'rendered' in outcome ? { pages: await pagesOf(outcome.rendered) } : outcome))
    if ('rendered' in outcome && !Buffer.from(outcome.rendered).equals(Buffer.from(reference.rendered))) {
      found.push({ invariant: 'I12', message: `${key} ${limit}: the render inside the limit differs from the reference` })
    }
    const next = await renderPool(spec)
    if (!('rendered' in next) || !Buffer.from(next.rendered).equals(Buffer.from(reference.rendered))) {
      found.push({ invariant: 'I12', message: `${key} ${limit}: the next render ${'rendered' in next ? 'differs from the reference' : `failed: ${String(next.error).slice(0, 200)}`}` })
    }
  }
  const offset = index % 2
  await under('maxPages', Math.max(1, pages - offset), pages)
  await under('maxNodes', nodes - offset, nodes)
  await under('timeoutMs', TIME_LIMITS[index % TIME_LIMITS.length]!, undefined)
  return found
}

/** The pool rules on `numRuns` documents; a failure is reported with its index, not reduced. */
const runPoolRule = async (name: string, numRuns: number, check: (index: number) => Promise<Violation[]>): Promise<void> => {
  const reports: string[] = []
  for (let index = 0; index < numRuns; index += 1) {
    if (ONLY_INDEX !== undefined && index !== ONLY_INDEX) continue
    const found = await check(index)
    if (found.length === 0) continue
    reports.push(`${name}: document ${index} of seed ${SEED} fails.\n${describeViolations(found)}`)
    if (!KEEP_GOING) break
  }
  console.log(`${name}: seed ${SEED}, ${numRuns} documents, ${reports.length} failures`)
  if (reports.length > 0) throw new Error(reports.join('\n\n'))
}

describe.skipIf(ONLY_CASE !== undefined)('generated documents', () => {
  console.log(`invariants: seed ${SEED}, ${RUNS ?? (CI_SIZE ? 'CI size' : 'one document per rule')}`)

  const RULES: Record<Profile, string> = { flow: 'I1–I6 I14', fixed: 'I1–I8 I14', table: 'I1–I6 I9 I14', mixed: 'I1–I9 I14 I16–I19' }
  const runsOf = (ci: number): number => RUNS === undefined ? sized(ci) : Math.ceil(RUNS / 10)

  it.runIf(ONLY_PROFILE === undefined || ONLY_PROFILE === 'invalid')('invalid: I15', async () => {
    await runInvalid(RUNS ?? sized(FAULTS.length))
  }, 60 * 60_000)

  it.runIf(ONLY_PROFILE === undefined || ONLY_PROFILE === 'isolation')('isolation: I11', async () => {
    await runPoolRule('isolation', runsOf(CI_ISOLATION), checkIsolation)
  }, 60 * 60_000)

  it.runIf(ONLY_PROFILE === undefined || ONLY_PROFILE === 'limits')('limits: I12', async () => {
    await runPoolRule('limits', runsOf(CI_LIMITS), checkLimits)
  }, 60 * 60_000)
  for (const profile of ['flow', 'fixed', 'table', 'mixed'] as const) {
    if (ONLY_PROFILE !== undefined && profile !== ONLY_PROFILE) continue
    it(`${profile}: ${RULES[profile]}`, async () => {
      await runGenerated(profile, 'documents', RUNS ?? sized(CI_RUNS[profile].documents))
    }, 60 * 60_000)

    it(`${profile}: I10 same bytes`, async () => {
      await runGenerated(profile, 'bytes', RUNS === undefined ? sized(CI_RUNS[profile].bytes) : Math.ceil(RUNS / 20))
    }, 60 * 60_000)

    it.runIf(CI_RUNS[profile].pairs > 0)(`${profile}: I13 metamorphic pairs`, async () => {
      await runGenerated(profile, 'pairs', RUNS === undefined ? sized(CI_RUNS[profile].pairs) : Math.ceil(RUNS / 10))
    }, 60 * 60_000)
  }
})
