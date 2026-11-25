import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES } from '../../../../primitives'
import { NuxtPdfError, parsePdfSourcePosition, PDF_ERROR_CODES } from '../../../../shared/errors'
import { COLUMN_CONTAINER_PROP, isColumnSegment } from '../columns'
import type { MeasuredNode } from '../types'
import { edgesBottom, edgesTop, gapOf, marginBottom, marginTop, stackHeight, sum, withoutBottom, withoutTop } from './boxes'
import { isAbsolute, isFixed, isText, pagesOf, SAFETY_THRESHOLD } from './rules'
import { elementsOf } from './split-parts'

// Floats (D49). A float is a piece of its reference list: the flow of a page,
// the children of a column galley (a column float), or the children of a
// column container (a spanning float: one with `columnSpan: 'all'`, or one
// inside a child with it). The mount checks (validate-floats.ts) let a float
// sit only in plain views between it and that list; before pagination each
// of them is split at the float as at a page break, so the float becomes a
// piece of the list between the parts. The builder places it (`fillArea` in
// builder.ts).

export type FloatSide = 'top' | 'bottom'

/** The side a piece floats to, `undefined` for a piece of the flow. */
export const floatOf = (node: MeasuredNode): FloatSide | undefined =>
  node.style.float === 'top' || node.style.float === 'bottom' ? node.style.float : undefined

/**
 * On each float of a page: its index among the page's floats in tree order.
 * The column floats and the spanning floats of a container share one queue
 * per side, and this order is that queue's order.
 */
const FLOAT_ORDER_PROP = '__nuxtPdfFloatOrder'

/** The tree order of a float among the floats of its page. */
export const floatOrderOf = (node: MeasuredNode): number => node.props[FLOAT_ORDER_PROP] as number

/** Whether a node is a column container: its children are segments, spanning children and spanning floats. */
export const isColumnContainer = (node: MeasuredNode): boolean => typeof node.props[COLUMN_CONTAINER_PROP] === 'number'

/** The room a piece takes in a stack: its margins and its height. */
export const extentOf = (node: MeasuredNode): number => marginTop(node) + node.box.height + marginBottom(node)

const holdsFloat = (node: MeasuredNode): boolean => !isText(node) && elementsOf(node).some(child => floatOf(child) !== undefined || holdsFloat(child))

const withMarginTop = (node: MeasuredNode, value: number): MeasuredNode =>
  ({ ...node, style: { ...node.style, marginTop: value }, box: { ...node.box, marginTop: value } })

/** `node` holding `children` in place of its own: its height changes by what they change. */
const holding = (node: MeasuredNode, children: MeasuredNode[]): MeasuredNode => {
  const before = stackHeight(elementsOf(node), gapOf(node))
  const height = typeof node.style.height === 'number' ? node.box.height : node.box.height + stackHeight(children, gapOf(node)) - before
  return { ...node, box: { ...node.box, height }, children }
}

/**
 * A float lifted out of `node` into the list `node` stands in: its width and
 * its x as they were inside `node` (a float keeps the width of its place). The
 * layout places it again in `node`'s parent, which may be wider.
 */
const liftedOut = (float: MeasuredNode, node: MeasuredNode): MeasuredNode => {
  const marginLeft = (node.box.marginLeft ?? 0) + float.box.left
  return {
    ...float,
    style: { ...float.style, width: float.box.width, alignSelf: 'flex-start', marginLeft, marginRight: 0 },
    box: { ...float.box, left: node.box.left + float.box.left, marginLeft, marginRight: 0 },
  }
}

/**
 * A plain view split at the floats among its pieces. The parts sit edge to
 * edge: only the first keeps the top edges and the bookmark, only the last the
 * bottom edges. Where two pieces of different children meet at a cut, the
 * second gets the view's rowGap less the list's as top margin, so the content
 * keeps its spacing (`gap` is the rowGap of the reference list).
 */
const splitAtFloats = (node: MeasuredNode, pieces: { piece: MeasuredNode, origin: number }[], gap: number): MeasuredNode[] => {
  const own = gapOf(node)
  const runs: ({ piece: MeasuredNode, origin: number }[] | MeasuredNode)[] = [[]]
  for (const entry of pieces) {
    if (floatOf(entry.piece) !== undefined) runs.push(liftedOut(entry.piece, node), [])
    else (runs.at(-1) as { piece: MeasuredNode, origin: number }[]).push(entry)
  }
  const groups = runs.filter((run): run is { piece: MeasuredNode, origin: number }[] => Array.isArray(run) && run.length > 0)
  // A view that holds floats alone stays as an empty part before them: its edges, id and bookmark keep a place.
  if (groups.length === 0) return [{ ...node, box: { ...node.box, height: edgesTop(node) + edgesBottom(node) }, children: [] }, ...runs.filter((run): run is MeasuredNode => !Array.isArray(run))]
  const first = groups[0]!
  const last = groups.at(-1)!
  let origin: number | undefined
  return runs.flatMap((run): MeasuredNode[] => {
    if (!Array.isArray(run)) return [run]
    if (run.length === 0) return []
    const children = run.map(entry => entry.piece)
    if (origin !== undefined && run[0]!.origin !== origin && own !== gap) children[0] = withMarginTop(children[0]!, marginTop(children[0]!) + own - gap)
    origin = run.at(-1)!.origin
    const atStart = run === first
    const atEnd = run === last
    let edges = { style: node.style, box: node.box }
    if (!atEnd) edges = withoutBottom({ ...node, ...edges })
    if (!atStart) edges = withoutTop({ ...node, ...edges })
    const height = (atStart ? edgesTop(node) : 0) + stackHeight(children, own) + (atEnd ? edgesBottom(node) : 0)
    return [{ ...node, ...edges, box: { ...edges.box, height }, props: atStart ? node.props : { ...node.props, bookmark: null }, children }]
  })
}

/** The pieces `node` becomes in a list whose rowGap is `gap`. */
const piecesOf = (node: MeasuredNode, gap: number): MeasuredNode[] => {
  if (floatOf(node) !== undefined || !holdsFloat(node)) return [node]
  // A column container is a reference list of its own: its spanning floats stay its children.
  if (isColumnContainer(node)) return [holding(node, hoistFloats(elementsOf(node), gapOf(node)))]
  if (isColumnSegment(node)) {
    // A galley is a reference list of its own.
    const galley = elementsOf(node)[0]!
    const held = holding(galley, hoistFloats(elementsOf(galley), gapOf(galley)))
    return [{ ...node, box: { ...node.box, height: node.box.height + held.box.height - galley.box.height }, children: [held] }]
  }
  const pieces = elementsOf(node).flatMap((child, origin) => piecesOf(child, gap).map(piece => ({ piece, origin })))
  if (!pieces.some(entry => floatOf(entry.piece) !== undefined)) return [holding(node, pieces.map(entry => entry.piece))]
  return splitAtFloats(node, pieces, gap)
}

/**
 * A reference list (a page's flow, a galley's or a column container's
 * children, rowGap `gap`) with each float in it a piece of the list. The
 * list itself when it holds none.
 */
const hoistFloats = (nodes: MeasuredNode[], gap: number): MeasuredNode[] =>
  nodes.some(holdsFloat) ? nodes.flatMap(node => piecesOf(node, gap)) : nodes

/** `node` with each float in it numbered in tree order (`FLOAT_ORDER_PROP`), from `next.value` on. */
const numbered = (node: MeasuredNode, next: { value: number }): MeasuredNode => {
  if (floatOf(node) !== undefined) return { ...node, props: { ...node.props, [FLOAT_ORDER_PROP]: next.value++ } }
  if (isText(node) || !holdsFloat(node)) return node
  return { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : numbered(child, next)) }
}

/**
 * The flow of a page (rowGap `gap`) with its floats numbered in tree order
 * and each a piece of its reference list. The flow itself when it holds none,
 * so a page without floats paginates as before.
 */
export const hoistPageFloats = (nodes: MeasuredNode[], gap: number): MeasuredNode[] => {
  if (!nodes.some(node => floatOf(node) !== undefined || holdsFloat(node))) return nodes
  const next = { value: 0 }
  return hoistFloats(nodes.map(node => numbered(node, next)), gap)
}

/** The room fixed nodes that show on every page take in a list with rowGap `gap`. */
const fixedRoom = (nodes: readonly MeasuredNode[], gap: number): number =>
  sum(nodes.filter(node => isFixed(node) && !isAbsolute(node) && pagesOf(node) === undefined).map(node => extentOf(node) + gap))

const points = (value: number) => Math.round(value * 100) / 100

type FloatArea = 'page' | 'column' | 'column container'

const tooHighError = (node: MeasuredNode, room: number, area: FloatArea): NuxtPdfError => {
  const source = parsePdfSourcePosition(node.source)
  const where = source ? ` at ${source.file}:${source.line}:${source.column}` : ''
  return new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `A <${PDF_PRIMITIVE_NAMES[node.type] ?? node.type}>${where} with float "${String(node.style.float)}" is ${points(extentOf(node))} pt high, but its ${area} has ${points(room)} pt for content. `
    + 'A float does not split: make it lower, or remove float so it breaks with the flow.',
    source ? { source } : {},
  )
}

/**
 * Fails a float higher than the most room its area gets on any page: the page
 * content area `room` less the fixed nodes that show on every page, for a
 * column also less its galley's edges and repeated rows; inside a column
 * container with a `height` or `maxHeight`, that height less its edges. A
 * spanning float has the room of its container. Every other float fits an
 * empty area, so the queues drain.
 */
export const checkFloatRoom = (nodes: readonly MeasuredNode[], room: number, gap: number, area: FloatArea = 'page'): void => {
  const free = room - fixedRoom(nodes, gap)
  for (const node of nodes) {
    if (floatOf(node) !== undefined) {
      if (extentOf(node) > free + SAFETY_THRESHOLD) throw tooHighError(node, free, area)
      continue
    }
    if (isText(node) || !holdsFloat(node)) continue
    if (isColumnContainer(node)) {
      const { height, maxHeight } = node.style
      const limit = typeof height === 'number' ? height : typeof maxHeight === 'number' ? maxHeight : undefined
      const own = limit === undefined ? free : Math.min(free, limit - edgesTop(node) - edgesBottom(node))
      checkFloatRoom(elementsOf(node), own, gapOf(node), limit === undefined ? area : 'column container')
      continue
    }
    if (isColumnSegment(node)) {
      // The galley has no edges of its own: columns/index.ts builds its style
      // from width, flex, gap and alignment only.
      const galley = elementsOf(node)[0]!
      checkFloatRoom(elementsOf(galley), free, gapOf(galley), 'column')
      continue
    }
    checkFloatRoom(elementsOf(node), free, gap, area)
  }
}
