// Greedy reduction of a failing raw document.
//
// fast-check's own shrinking of the recursive tree is slow on rendered
// documents (minutes) and stops at large documents. This pass tries direct
// simplifications instead: drop a page, a fixed node, a node, a table row,
// cell or column, replace a view or block link by its children, lower a
// number, take the simple value of a flag. It keeps
// a step when the document still fails one of the original invariants, and
// repeats until no step helps or the budget ends. Every candidate is a raw
// document, so `normalizeDocument` keeps it valid.
import type { RawDocument, RawLink, RawNode, RawTable, RawView } from './generator'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** The simple value of each flag: the one most documents use. */
const SIMPLE_FLAGS: Record<string, boolean> = { wrap: true }
/** Numbers that must stay at least 1. */
const MINIMUM: Record<string, number> = { n: 1 }

const clone = <T>(value: T): T => structuredClone(value)

// A candidate is a clone, so a node keeps its kind at its position.
const lostStructure = (): never => {
  throw new Error('reduce: a node changed its kind in a clone')
}
const viewAt = (node: RawNode): RawView => node.t === 'view' ? node : lostStructure()
const linkAt = (node: RawNode): RawLink => node.t === 'link' ? node : lostStructure()
const tableAt = (node: RawNode): RawTable => node.t === 'table' ? node : lostStructure()

/** Candidate documents one step simpler than `raw`, most aggressive first. */
function* simplifications(raw: RawDocument): Generator<RawDocument> {
  // Structure: pages, fixed nodes, flow nodes.
  for (let page = 0; page < raw.pages.length && raw.pages.length > 1; page += 1) {
    const next = clone(raw)
    next.pages.splice(page, 1)
    yield next
  }
  for (let page = 0; page < raw.pages.length; page += 1) {
    for (let fixed = 0; fixed < raw.pages[page]!.fixed.length; fixed += 1) {
      const next = clone(raw)
      next.pages[page]!.fixed.splice(fixed, 1)
      yield next
    }
  }
  // Node lists (a view or block link in them can give way to its children)
  // and other lists that can lose an item: a block link's texts, a table's
  // rows, columns, header cells and the cells of each row.
  const nodeLists: Array<(document: RawDocument) => RawNode[]> = []
  const lists: Array<(document: RawDocument) => unknown[]> = []
  const collect = (nodes: RawNode[], locate: (document: RawDocument) => RawNode[]) => {
    nodeLists.push(locate)
    lists.push(locate)
    nodes.forEach((node, index) => {
      const at = (document: RawDocument): RawNode => locate(document)[index]!
      if (node.t === 'view') collect(node.children, document => viewAt(at(document)).children)
      if (node.t === 'link') lists.push(document => linkAt(at(document)).children)
      if (node.t === 'table') {
        const table = (document: RawDocument) => tableAt(at(document))
        lists.push(document => table(document).rows, document => table(document).columns, document => table(document).headerCells)
        node.rows.forEach((_, row) => lists.push(document => table(document).rows[row]!.cells))
      }
    })
  }
  raw.pages.forEach((page, index) => collect(page.children, document => document.pages[index]!.children))
  for (const locate of lists) {
    const length = locate(raw).length
    // Halves first, then single nodes.
    if (length > 1) {
      for (const [start, count] of [[0, Math.ceil(length / 2)], [Math.ceil(length / 2), Math.floor(length / 2)]] as const) {
        const next = clone(raw)
        locate(next).splice(start, count)
        yield next
      }
    }
    for (let index = 0; index < length; index += 1) {
      const next = clone(raw)
      locate(next).splice(index, 1)
      yield next
    }
  }
  for (const locate of nodeLists) {
    for (const [index, node] of locate(raw).entries()) {
      if (node.t !== 'view' && node.t !== 'link') continue
      const flat = clone(raw)
      locate(flat).splice(index, 1, ...clone(node.children))
      yield flat
    }
  }
  // Values: every number toward its minimum, every flag to its simple value.
  const paths: Array<Array<string | number>> = []
  const walk = (value: Json, path: Array<string | number>) => {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, index]))
    else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, [...path, key]))
    else paths.push(path)
  }
  walk(raw as unknown as Json, [])
  for (const path of paths) {
    const key = [...path].reverse().find(part => typeof part === 'string') ?? ''
    const current = path.reduce<Json>((value, part) => (value as Record<string | number, Json>)[part]!, raw as unknown as Json)
    const replacements: Json[] = []
    if (typeof current === 'number') {
      const minimum = MINIMUM[key] ?? 0
      if (current > minimum) replacements.push(minimum)
      const half = key === 'offset' ? current / 2 : Math.floor((current + minimum) / 2)
      if (half > minimum && half < current) replacements.push(half)
      if (current - 1 > minimum && key !== 'offset') replacements.push(current - 1)
    }
    else if (typeof current === 'boolean') {
      const simple = SIMPLE_FLAGS[key] ?? false
      if (current !== simple) replacements.push(simple)
    }
    for (const replacement of replacements) {
      const next = clone(raw) as unknown as Json
      const parent = path.slice(0, -1).reduce<Json>((value, part) => (value as Record<string | number, Json>)[part]!, next)
      ;(parent as Record<string | number, Json>)[path.at(-1)!] = replacement
      yield next as unknown as RawDocument
    }
  }
}

export interface ReduceResult {
  raw: RawDocument
  checks: number
  steps: number
}

/** Reduce `raw` while `fails` holds. `fails` must be true for `raw` itself. */
export const reduceDocument = async (
  raw: RawDocument,
  fails: (candidate: RawDocument) => Promise<boolean>,
  { budgetMs, maxChecks }: { budgetMs: number, maxChecks: number },
): Promise<ReduceResult> => {
  const deadline = performance.now() + budgetMs
  let current = raw
  let checks = 0
  let steps = 0
  // After a kept step, go on from the same candidate position in the new
  // document instead of from the start: earlier positions already failed to
  // help, and a restart costs a render each. A pass that keeps nothing ends.
  let position = 0
  let passStart = true
  while (true) {
    let index = 0
    let kept = false
    for (const candidate of simplifications(current)) {
      if (index++ < position) continue
      if (performance.now() > deadline || checks >= maxChecks) return { raw: current, checks, steps }
      checks += 1
      if (await fails(candidate)) {
        current = candidate
        steps += 1
        position = index - 1
        kept = true
        break
      }
    }
    if (kept) {
      passStart = false
      continue
    }
    // End of the candidates: one more pass from the start, unless this pass
    // already started there.
    if (passStart) break
    position = 0
    passStart = true
  }
  return { raw: current, checks, steps }
}
