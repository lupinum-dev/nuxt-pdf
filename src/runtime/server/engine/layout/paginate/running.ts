import { PDF_PRIMITIVES } from '../../../../primitives'
import type { MeasuredNode, PageInfo, RunningValues } from '../types'
import { isFixed } from './rules'

// Running values (`running` on a `PdfText` or a `PdfTableRow`, printed by
// `PdfRunningText`). By default a page shows the value set by the node at its
// very top, otherwise the last value set before the page (the GCPM `start`
// rule); `at="before"` shows the value before the page, `at="end"` the last
// value set on it (GCPM `last`), else the value before it. Pagination knows
// the first two before it splits a page: the pages before it are done, and
// its top node is the first node of the rest. The end is known after the
// split. All three are kept for the round with the total.

/**
 * On a text or a table row that sets a running value (plain-tree.ts): its
 * name and the value. The engine copies props to every part of a split node,
 * so a part on a later page sets the value again. That changes nothing: it
 * is the same value, and no setter follows it on the page before. So a split
 * row counts on the page of its first part.
 */
export const RUNNING_PROP = '__nuxtPdfRunning'
export type RunningSetter = { readonly name: string, readonly text: string }

const isSetter = (value: unknown): value is RunningSetter =>
  typeof value === 'object' && value !== null
  && 'name' in value && typeof value.name === 'string'
  && 'text' in value && typeof value.text === 'string'

const setterOf = (node: MeasuredNode): RunningSetter | undefined => {
  const setter = node.props[RUNNING_PROP]
  return isSetter(setter) ? setter : undefined
}

type Child = MeasuredNode['children'][number]

const isElement = (node: Child): node is MeasuredNode => node.type !== PDF_PRIMITIVES.TextInstance

/** A child in the flow of its parent: not fixed, not positioned on its own. */
const inFlow = (node: Child): node is MeasuredNode => isElement(node) && !isFixed(node) && node.style?.position !== 'absolute'

/** Every value each running name is set to in `nodes` and below, in tree order, each once. */
export const runningValuesIn = (nodes: readonly Child[]): Map<string, string[]> => {
  const values = new Map<string, string[]>()
  const walk = (node: Child) => {
    if (!isElement(node)) return
    const setter = setterOf(node)
    if (setter !== undefined) {
      const known = values.get(setter.name) ?? []
      if (!known.includes(setter.text)) values.set(setter.name, [...known, setter.text])
    }
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return values
}

/**
 * The running values of one pagination: `enter` gives the values of a page
 * from the flow that starts it, `leave` counts the setters of a page that is
 * done, and `of` gives the values a page was entered with.
 */
export const createRunningValues = () => {
  let current: Record<string, string> = {}
  const pages = new Map<number, RunningValues>()
  // The page entered last: `leave` always finishes it.
  let entered: number | undefined

  const set = (setter: RunningSetter) => {
    current = { ...current, [setter.name]: setter.text }
  }

  /** The page info of a page entered before. */
  const of = (pageNumber: number, info: Omit<PageInfo, 'pageNumber'> = {}): PageInfo => {
    const running = pages.get(pageNumber)
    return { ...info, pageNumber, ...(running === undefined ? {} : { running }) }
  }

  return {
    of,
    /**
     * The page info of page `pageNumber`, whose flow is `flow`: the values
     * after the pages before it, and with the value of a setter at its very
     * top, found down the first child in the flow of each container.
     */
    enter(pageNumber: number, flow: readonly Child[]): PageInfo {
      const before = current
      let top = flow.find(inFlow)
      while (top !== undefined) {
        const setter = setterOf(top)
        if (setter !== undefined) {
          set(setter)
          break
        }
        top = top.type === PDF_PRIMITIVES.Text ? undefined : top.children.find(inFlow)
      }
      pages.set(pageNumber, { top: current, before })
      entered = pageNumber
      return of(pageNumber)
    },
    /** Counts the setters of the page entered last, which is done, in tree order. */
    leave(flow: readonly Child[]): void {
      const walk = (node: MeasuredNode) => {
        const setter = setterOf(node)
        if (setter !== undefined) set(setter)
        for (const child of node.children) if (isElement(child)) walk(child)
      }
      for (const node of flow) if (isElement(node) && !isFixed(node)) walk(node)
      const page = entered === undefined ? undefined : pages.get(entered)
      if (entered !== undefined && page !== undefined) pages.set(entered, { ...page, end: current })
    },
  }
}
