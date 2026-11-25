import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES, PDF_ROW_SPAN_PROP } from '../../../../primitives'
import { NuxtPdfError, parsePdfSourcePosition, PDF_ERROR_CODES } from '../../../../shared/errors'
import { COLUMN_AUTO_FILL_PROP, COLUMN_ROW_PROP, COLUMN_SEGMENT_PROP, columnCountOf, columnHeightError, isColumnSegment } from '../columns'
import type { MeasuredDocument, MeasuredNode, PageInfo, ResolvedStyle } from '../types'
import { getPadding } from '../dimensions/edges'
import { percentOf, resolvePercent } from '../styles/percent'
import { dynamicTextCut, hasDynamicNodes, relabelPageTokens, resolveDynamicNodes } from './dynamic'
import { RESERVED_DIGITS_PROP } from '../text/fragments'
import { paginationStuck, type Relayout } from './index'
import { BOX_TYPES, breakKindOf, canWrap, contentAreaOf, hasBreak, isAbsolute, isFixed, isRow, isSizedBox, isText, pagesOf, SAFETY_THRESHOLD, unset, wrapAreaOf, type BreakKind, type PageCondition } from './rules'
import { CONTENT_BOTTOM_PROP, noteAreaOf, type NoteBook, noteBookOf, NOTE_NUMBER_PROP, NOTES_MOVED_PROP, notesNeed, placeNotes, referencesIn, type ChosenSplit } from './notes'
import { countWork } from '../../work'
import { createRunningValues, runningValuesIn } from './running'
import { chainStartOf, KEEP_IGNORED_PROP, keepsWithNext, nextReached, previousReached, reached, spanGroupEnd } from './split-keep'
import { fixedItemOf, fromFlexLines, inFlexLines, wrapsRow } from './flex-lines'
import { elementsOf, EMPTY_ROW_PART_PROP, inFlow, paintsBox, placesFlow, showsContent, SPAN_GROUP_OVERFLOW_PROP } from './split-parts'
import { heightAtLineIndex, lineHeights, startLines } from './text'
import { edgesBottom, edgesTop, gapOf, marginBottom, marginTop, stackHeight, sum, withoutBottom, withoutTop } from './boxes'
import { checkFloatRoom, extentOf, floatOf, floatOrderOf, hoistPageFloats, isColumnContainer, type FloatSide } from './floats'

// Pagination as a page builder over
// measured heights. Stage 1 gave every node its final width and its height at
// that width, so a height measured once stays true on every page. The builder
// walks the flow as a list of pieces (a node placed whole, the open part of a
// container that must split, a text's lines), sums heights from the page top
// and never reads a `top` from a box: no position exists before a break is
// chosen, so none can go stale. The rest of a page is the list after the
// break. Each page is laid out once (the `relayout` seam), and that layout is
// a check: every placed piece must sit where the sum put it.

const EPS = SAFETY_THRESHOLD
/** How far a laid-out top may differ from the builder's sum: yoga computes in 32-bit floats. */
const TOLERANCE = 0.01

/** Whether the top and the bottom margin are `auto`: 0 in the box, they take the free room yoga hands out. */
const autoMarginsOf = (node: MeasuredNode): [boolean, boolean] => [node.style.marginTop === 'auto', node.style.marginBottom === 'auto']

/** A column whose gap is in points (or none). */
const plainColumn = (node: MeasuredNode): boolean => (unset(node.style.flexDirection) || node.style.flexDirection === 'column')
  && (unset(node.style.rowGap) || typeof node.style.rowGap === 'number')

/**
 * The fixed head: fixed children of a page before its first flow child (an
 * absolute child is none), as their count. They and the fixed children after
 * it (its tail) are reserved room, rendered and measured for each page (an
 * absolute one takes none, and repeats wherever it stands).
 */
const fixedHeadOf = (page: MeasuredNode): number => {
  const children = elementsOf(page)
  const flow = children.findIndex(child => !isFixed(child) && !isAbsolute(child))
  return children.slice(0, flow === -1 ? children.length : flow).filter(isFixed).length
}

/**
 * The height of the tallest flow node that cannot split in a column, at any
 * depth inside nodes that can; 0 when there is none. A part that holds such
 * a node is at least this high, so no lower column height can hold it.
 */
const tallestUnsplittable = (nodes: readonly MeasuredNode[]): number => {
  let tallest = 0
  for (const child of nodes) {
    if (!inFlow(child) || (isText(child) && canWrap(child))) continue
    tallest = Math.max(tallest, canWrap(child) && floatOf(child) === undefined ? tallestUnsplittable(elementsOf(child)) : child.box.height)
  }
  return tallest
}

/** A text cut after `index` lines: the lines above stay with its top edges, the rest starts the next part. */
const textParts = (node: MeasuredNode, index: number): [MeasuredNode, MeasuredNode] => {
  const heights = lineHeights(node)
  const kept = withoutBottom(node)
  const rest = withoutTop(node)
  return [
    { ...node, ...kept, box: { ...kept.box, height: edgesTop(node) + sum(heights.slice(0, index)) }, lines: node.lines!.slice(0, index), hiddenLines: undefined },
    { ...node, ...rest, box: { ...rest.box, height: sum(heights.slice(index)) + edgesBottom(node) }, lines: node.lines!.slice(index) },
  ]
}

/** Marks a `column-reverse` container while the builder fills it as a column. */
const REVERSED_PROP = '__nuxtPdfReversed'

/** `justifyContent` seen from the other end of the main axis (unset is `flex-start`). */
const mirrored = (justify: ResolvedStyle['justifyContent']): ResolvedStyle['justifyContent'] =>
  justify === 'flex-end' ? 'flex-start' : justify === undefined || justify === 'flex-start' ? 'flex-end' : justify

/**
 * A `column-reverse` container draws its last child at the top, so it breaks in that order: the builder fills
 * it as a column of its children in drawing order, with `justifyContent` mirrored (yoga lays both out the
 * same), and `restored` gives every part its own order and style back (for the structure, the outline and the
 * paint order of overlapping children).
 */
const inDrawingOrder = (node: MeasuredNode): MeasuredNode => {
  if (isText(node)) return node
  let changed = false
  const children = node.children.map((child) => {
    if (child.type === PDF_PRIMITIVES.TextInstance) return child
    const ordered = inDrawingOrder(child)
    changed ||= ordered !== child
    return ordered
  })
  if (wrapsRow(node)) return inFlexLines({ ...node, children })
  if (node.style.flexDirection !== 'column-reverse') return changed ? { ...node, children } : node
  return { ...node, props: { ...node.props, [REVERSED_PROP]: true }, style: { ...node.style, flexDirection: 'column', justifyContent: mirrored(node.style.justifyContent) }, children: children.reverse() }
}

/**
 * Percentage insets in points against the whole parent, before it splits (yoga's bases: the padding box for an
 * absolute node, the content box for a relative offset), so every part of the parent keeps them. A page's own
 * absolute children stay: each page is laid out at its own height.
 */
const insetsInPoints = (node: MeasuredNode, page = false): MeasuredNode => {
  if (isText(node)) return node
  const paddingBox = (page ? Number(node.style.height) : node.box.height) - (node.box.borderTopWidth ?? 0) - (node.box.borderBottomWidth ?? 0)
  const contentBox = paddingBox - (node.box.paddingTop ?? 0) - (node.box.paddingBottom ?? 0)
  let changed = false
  const children = node.children.map((child) => {
    if (child.type === PDF_PRIMITIVES.TextInstance) return child
    let resolved = insetsInPoints(child)
    const absolute = isAbsolute(child)
    if (!(page && absolute) && (percentOf(child.style.top) !== undefined || percentOf(child.style.bottom) !== undefined)) {
      const base = absolute ? paddingBox : contentBox
      resolved = { ...resolved, style: { ...resolved.style, top: resolvePercent(child.style.top, base), bottom: resolvePercent(child.style.bottom, base) } }
    }
    changed ||= resolved !== child
    return resolved
  })
  return changed ? { ...node, children } : node
}

const restored = (node: MeasuredNode): MeasuredNode => {
  if (isText(node)) return node
  const children = node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : restored(child))
  if (!(REVERSED_PROP in node.props)) return fromFlexLines({ ...node, children })
  const { [REVERSED_PROP]: _reversed, ...props } = node.props
  return { ...node, props, style: { ...node.style, flexDirection: 'column-reverse', justifyContent: mirrored(node.style.justifyContent) }, children: children.reverse() }
}

/**
 * A text with a `minHeight` cut `room` below its top, as a view: this part fills the room (up to the
 * `minHeight`), the next keeps what is left of it. Only the next part's box counts for the sums: this one ends
 * the page.
 */
const minHeightParts = ([kept, rest]: [MeasuredNode, MeasuredNode], minHeight: number, room: number): [MeasuredNode, MeasuredNode] => {
  const left = Math.max(0, minHeight - room)
  return [
    { ...kept, style: { ...kept.style, minHeight: Math.min(minHeight, room) } },
    { ...rest, style: { ...rest.style, minHeight: left }, box: { ...rest.box, height: Math.max(rest.box.height, left) } },
  ]
}

/**
 * A container cut `room` below its top: the part on this page fills the room,
 * the next part has no top edges, keeps what is left
 * of a `minHeight` and its bookmark moves only when this part shows nothing.
 */
const viewParts = (node: MeasuredNode, room: number, current: MeasuredNode[], next: MeasuredNode[]): [MeasuredNode, MeasuredNode | null] => {
  const minHeight = node.style.minHeight as number | undefined
  // A view with a height higher than a page keeps it in total: this part never grows past it, the next gets what is left.
  const fixed = isSizedBox(node)
  const height = fixed ? Math.min(node.box.height, room) : room
  const kept = withoutBottom(node)
  // Its children keep the heights yoga gave them in its whole height: a part must not shrink them again.
  const frozen = (nodes: MeasuredNode[]) => fixed ? nodes.map(child => isFixed(child) || isAbsolute(child) || isColumnSegment(child) ? child : { ...child, style: { ...child.style, height: child.box.height, flexShrink: 0 } }) : nodes
  const part: MeasuredNode = {
    ...node,
    style: { ...kept.style, height, ...(minHeight === undefined ? {} : { minHeight: Math.min(minHeight, room) }) },
    box: { ...kept.box, height },
    children: frozen(current),
  }
  const flows = (nodes: MeasuredNode[]) => nodes.some(child => !isFixed(child))
  // A box higher than the room goes on with the rest of its height, also when its content ends here.
  if (flows(elementsOf(node)) && flows(current) && !flows(next) && minHeight === undefined && !fixed) return [part, null]
  const rest = withoutTop(node)
  const restMin = minHeight === undefined ? undefined : Math.max(0, minHeight - room)
  const restHeight = fixed ? Math.max(0, node.box.height - room) : 0
  const nextPart: MeasuredNode = {
    ...node,
    style: { ...rest.style, height: restHeight || undefined, ...(restMin === undefined ? {} : { minHeight: restMin }) },
    box: { ...rest.box, height: Math.max(restMin ?? 0, restHeight || stackHeight(next, gapOf(node)) + edgesBottom(node)) },
    props: { ...node.props, bookmark: null },
    children: frozen(next),
  }
  if (node.props.bookmark && !showsContent(part) && showsContent(nextPart)) {
    return [{ ...part, props: { ...part.props, bookmark: null } }, { ...nextPart, props: { ...nextPart.props, bookmark: node.props.bookmark } }]
  }
  return [part, nextPart]
}

// ---------------------------------------------------------------------------
// Lookahead for the keep rules: tops of later siblings, as sums.

/** Border-box tops of `nodes` from `from` on, `top` being the top of `nodes[from]`, stacked. */
const topsFrom = (nodes: readonly MeasuredNode[], from: number, top: number, gap: number) => {
  const tops = [top]
  return (index: number): number => {
    for (let at = from + tops.length; at <= index; at += 1) {
      const before = nodes[at - 1]!
      tops.push(tops.at(-1)! + before.box.height + marginBottom(before) + gap + marginTop(nodes[at]!))
    }
    return tops[index - from]!
  }
}

const childTops = (node: MeasuredNode, top: number) => {
  const children = elementsOf(node)
  return { children, topOf: topsFrom(children, 0, top + edgesTop(node) + (children[0] ? marginTop(children[0]) : 0), gapOf(node)) }
}

/** The page state of one page's fill: what the rules found, and the nodes a keep breaks before. */
interface Found {
  forced: boolean
  warnings: string[]
  keepBreaks: Set<MeasuredNode>
  /** The first nodes of the keep chains this fill dropped (`PDF_KEEP_IGNORED`). */
  keepIgnored: Set<MeasuredNode>
  /** The first node of each keep chain, for the whole render (`chainStartOf`). */
  chains: WeakMap<MeasuredNode, MeasuredNode>
  area: number
  /** A piece stays cut at the page end: yoga squeezes the page, so the check does not apply. */
  overflows?: boolean
  /** The kind of the forced break that ended the fill: a column break goes on in the next column. */
  kind?: BreakKind
  /** The lowest end above this fill's end at which it would place more (a balance steps there). */
  nextEnd?: number
  /** Where the content it placed ends: the last line or box, without the bottom margins after it at any depth. */
  bottom?: number
  /** Where the bottom margin after that content ends: empty room the note area may cover. */
  reach?: number
}

const need = (found: Found, end: number) => {
  found.nextEnd = Math.min(found.nextEnd ?? Number.POSITIVE_INFINITY, end)
}

/** The bottom margins inside a node's box below its last line or box: a plain column with no bottom edges holds its last child's. */
const trailingMargin = (node: MeasuredNode): number => {
  if (isText(node) || edgesBottom(node) > 0 || !unset(node.style.height) || !unset(node.style.minHeight) || !plainColumn(node)) return 0
  const last = elementsOf(node).filter(child => !isFixed(child) && !isAbsolute(child)).at(-1)
  return last === undefined ? 0 : marginBottom(last) + trailingMargin(last)
}

/** Records a piece placed whole (or a text part) at `top`: where its content and its bottom margin end. */
const recordReach = (found: Found, node: MeasuredNode, top: number) => {
  const bottom = top + node.box.height - trailingMargin(node)
  found.bottom = Math.max(found.bottom ?? Number.NEGATIVE_INFINITY, bottom)
  found.reach = Math.max(found.reach ?? Number.NEGATIVE_INFINITY, top + node.box.height + marginBottom(node))
}

const breaksBefore = (node: MeasuredNode, found: Found) => hasBreak(node) || found.keepBreaks.has(node)

/**
 * A node that may split in a content area of `area`: not `wrap={false}`, not
 * an image, SVG or note, and not a box with a height (`isSizedBox`) that fits
 * the area. A box higher than the area splits at page ends, and its
 * parts share its height.
 */
const splittable = (node: MeasuredNode, area: number): boolean => Boolean(canWrap(node)) && !(isSizedBox(node) && node.box.height <= area + EPS)

const containsBreak = (node: MeasuredNode, found: Found): boolean => !isText(node) && splittable(node, found.area) && node.props[COLUMN_ROW_PROP] !== true
  && elementsOf(node).some(child => breaksBefore(child, found) || containsBreak(child, found))

/** Whether a node is or holds a column container that `withSpanningFloats` could not arrange whole (`Context.held`). */
const holdsHeld = (node: MeasuredNode, context: Context): boolean => context.held !== undefined
  && (context.held.has(node) || (!isText(node) && elementsOf(node).some(child => holdsHeld(child, context))))

/** Where the start of a node ends, which a keep before it needs on the same page. */
const endOfStart = (node: MeasuredNode, top: number, area: number): number => {
  const bottom = top + node.box.height
  if (!splittable(node, area)) return bottom
  if (isText(node)) return Math.min(bottom, top + edgesTop(node) + heightAtLineIndex(node, startLines(node)))
  if (isRow(node)) {
    // Side by side: the row starts when each child with content has started.
    const shown = elementsOf(node).filter(child => inFlowNode(child) && showsContent(child))
    if (shown.length === 0) return bottom
    return Math.min(bottom, Math.max(...shown.map(child => endOfStart(child, top + edgesTop(node) + marginTop(child), area))))
  }
  const { children, topOf } = childTops(node, top)
  const at = children.findIndex(child => inFlowNode(child) && showsContent(child))
  if (at === -1) return bottom
  return Math.min(bottom, Math.max(endOfStart(children[at]!, topOf(at), area), endOfKeep(children, at, area, topOf) ?? 0, endOfGroup(children, at, topOf)))
}

/** Where the keep of `nodes[index]` ends, Infinity past one content area. */
const endOfKeep = (nodes: readonly MeasuredNode[], index: number, area: number, topOf: (index: number) => number, from = topOf(index)): number | undefined => {
  if (!keepsWithNext(nodes[index]!)) return undefined
  let end: number | undefined
  for (let at = index; ;) {
    const next = nextReached(nodes, at)
    if (next === -1 || hasBreak(nodes[next]!)) return end
    countWork('keepSteps')
    const reach = endOfStart(nodes[next]!, topOf(next), area)
    end = Math.max(end ?? reach, reach, endOfGroup(nodes, next, topOf))
    if (end > from + area) return Number.POSITIVE_INFINITY
    if (!keepsWithNext(nodes[next]!)) return end
    at = next
  }
}

/** Where the rows that cells over several rows hold together with `nodes[index]` end: they start as one. */
const endOfGroup = (nodes: readonly MeasuredNode[], index: number, topOf: (index: number) => number): number => {
  const end = spanGroupEnd(nodes, index)
  return end > index ? topOf(end) + nodes[end]!.box.height : 0
}

/** The row where a cell over several rows starts that covers `nodes[index]` from a row above it, within one content area, or -1. */
const spanStartCovering = (nodes: readonly MeasuredNode[], index: number, area: number, topOf: (index: number) => number): number => {
  for (let row = index - 1; row >= 0 && topOf(index) - topOf(row) <= area; row -= 1) {
    if (elementsOf(nodes[row]!).some(cell => typeof cell.props[PDF_ROW_SPAN_PROP] === 'number' && row + (cell.props[PDF_ROW_SPAN_PROP] as number) - 1 >= index)) return row
  }
  return -1
}

/** The tail of a container whose keep comes from its last child: its top and first node. */
const keepTail = (node: MeasuredNode, top: number, area: number): { top: number, start: MeasuredNode } | undefined => {
  if (node.props.keepWithNext === true || isText(node) || isRow(node) || !splittable(node, area)) return undefined
  const { children, topOf } = childTops(node, top)
  let last = children.length - 1
  while (last >= 0 && !reached(children[last]!)) last -= 1
  if (last < 0 || !keepsWithNext(children[last]!)) return undefined
  const inner = keepTail(children[last]!, topOf(last), area)
  if (inner !== undefined) return inner
  const bottom = topOf(last) + children[last]!.box.height
  let start = last
  while (bottom - topOf(start) <= area) {
    countWork('keepSteps')
    const covering = spanStartCovering(children, start, area, topOf)
    if (covering !== -1) {
      start = covering
      continue
    }
    const before = previousReached(children, start)
    if (before === -1 || hasBreak(children[start]!) || !keepsWithNext(children[before]!)) break
    start = before
  }
  return previousReached(children, start) === -1 ? undefined : { top: topOf(start), start: children[start]! }
}

// ---------------------------------------------------------------------------
// The fill: the pieces of one container on this page, and its rest.

/** Expected border-box tops of the pieces placed on a page, for the check. */
type Expected = Map<MeasuredNode, number>
type Parts = [MeasuredNode[], MeasuredNode[]]

interface Context {
  end: number
  /** How far below `end` fixed nodes may reach: the room a split left for its trailing fixed rows. */
  below?: number
  found: Found
  expected: Expected
  /** After an automatic break: no node starts above the content top (a negative margin is cut there). */
  liftTo: number
  /** The node that moved whole to this page because it could not split there: on a fresh page it may. */
  movedWhole: MeasuredNode | undefined
  /**
   * On a page with notes the fill ends above the page end, which a fresh page never does: there the
   * moved node is unsplittable again wherever it fits the content area.
   */
  restore?: boolean
  /** Set when this fill moves a node whole for the next page. */
  moving?: MeasuredNode
  /** Segments of this fill that neither balance nor end in order at their place: they split. */
  goOn?: Set<MeasuredNode>
  /** Column containers with spanning floats that `withSpanningFloats` could not arrange whole here: they split, even when they fit. */
  held?: Set<MeasuredNode>
  /** Set by the note fit: the order numbers of the floats this page may place; every other float waits (`fitNotes`). */
  only?: ReadonlySet<number>
  /** Whether the page's flow holds a not-last node, which every last part empties. */
  notLast?: boolean
  /**
   * Set by a column container's fill when it holds spanning floats: per side, the float order above
   * which its columns place no float on this page (`fillArea`, the shared queue).
   */
  gate?: FloatGate
}

/**
 * After an automatic break nothing starts above the content top: `node`, whose margin box starts at `y`, with every negative top
 * margin at any depth that reaches above `liftTo` cut there, and the heights
 * around it summed again. The node itself when nothing reaches.
 */
const liftedAt = (node: MeasuredNode, y: number, liftTo: number): MeasuredNode => {
  const reach = marginTop(node) < 0 && y + marginTop(node) < liftTo - EPS
  const lifted = reach ? Math.min(0, liftTo - y) : marginTop(node)
  const original = elementsOf(node)
  let children = original
  if (!isText(node) && !isRow(node) && children.length > 0 && y + lifted < liftTo + EPS) {
    let at = y + lifted + edgesTop(node)
    children = children.map((child, index) => {
      at += index > 0 ? gapOf(node) : 0
      const moved = liftedAt(child, at, liftTo)
      at += marginTop(moved) + moved.box.height + marginBottom(moved)
      return moved
    })
  }
  const changed = children.some((child, index) => child !== original[index])
  if (!reach && !changed) return node
  const height = changed ? Math.max(Number(node.style.minHeight ?? 0), edgesTop(node) + stackHeight(children, gapOf(node)) + edgesBottom(node)) : node.box.height
  return { ...node, style: { ...node.style, marginTop: lifted }, box: { ...node.box, marginTop: lifted, height }, ...(changed ? { children } : {}) }
}

/** How many lines of a text stay when its lines start at `linesTop` (orphans and widows). */
const lineBreak = (node: MeasuredNode, linesTop: number, end: number, area: number, contentBefore: boolean): number => {
  const heights = lineHeights(node)
  let fitting = 0
  for (let y = linesTop; fitting < heights.length && y + heights[fitting]! <= end + EPS; fitting += 1) y += heights[fitting]!
  if (heightAtLineIndex(node, startLines(node)) > area && !contentBefore) return Math.max(1, fitting)
  const orphans = Number(node.props.orphans) || 2
  const widows = Number(node.props.widows) || 2
  const lines = heights.length
  if (fitting === 0) return 0
  if (fitting >= lines) return lines
  if (fitting < orphans || lines < orphans + widows) return 0
  if (lines === orphans + widows) return orphans
  return lines - fitting < widows ? lines - widows : fitting
}

const split = (node: MeasuredNode, top: number, context: Context, contentBefore: boolean, room = context.found.area): [MeasuredNode, MeasuredNode | null] => {
  const parts = splitOnce(node, top, context, contentBefore, room)
  const fixedItem = parts[1] !== null && showsContent(parts[0]) ? fixedItemOf(node) : undefined
  if (fixedItem) throw fixedItemError(node, fixedItem)
  return parts
}

const splitOnce = (node: MeasuredNode, top: number, context: Context, contentBefore: boolean, room: number): [MeasuredNode, MeasuredNode | null] => {
  if (isText(node)) {
    const index = lineBreak(node, top + edgesTop(node), context.end, context.found.area, contentBefore)
    const neverFits = heightAtLineIndex(node, startLines(node)) > context.found.area && !contentBefore
    if (neverFits && index >= node.lines!.length) return [node, null]
    const linesTop = top + edgesTop(node)
    let lineEnd = linesTop
    for (const lineHeight of lineHeights(node)) {
      lineEnd += lineHeight
      if (lineEnd > context.end + EPS && lineBreak(node, linesTop, lineEnd, context.found.area, contentBefore) > index) {
        need(context.found, lineEnd)
        break
      }
    }
    const lineParts = textParts(node, index)
    const parts = typeof node.style.minHeight === 'number' ? minHeightParts(lineParts, node.style.minHeight, context.end - top) : lineParts
    // A text with page values: each part shows its own range of the text, with the values of its page.
    const cut = 'render' in node.props && index > 0 && index < node.lines!.length ? dynamicTextCut(node, node.lines!, index) : undefined
    return cut ? [{ ...parts[0], props: cut[0] }, { ...parts[1], props: cut[1] }] : parts
  }
  if (isColumnSegment(node)) return columnParts(node, top, context, contentBefore)
  if (isSizedBox(node) && !isRow(node) && (node.style.flexWrap === 'wrap' || node.style.flexWrap === 'wrap-reverse')) throw wrappingBoxError(node, context.found.area)
  if (isRow(node)) return rowParts(node, top, context, contentBefore, room)
  const { children } = childTops(node, top)
  // The children split where the whole layout puts them, justified in the container's whole height;
  // each part is then justified in its own height (`spread`). A box's parts share its height instead.
  const whole = isSizedBox(node) ? { lead: 0, gap: 0 } : justifiedSpacing(node.style.justifyContent, node.box.height - edgesTop(node) - edgesBottom(node) - stackHeight(elementsOf(node), gapOf(node)), elementsOf(node).filter(child => !isAbsolute(child)).length)
  const inner = top + edgesTop(node) + whole.lead
  // The parent's padding box on this page, from its top border to the page end.
  const paddingRoom = context.end - top - (node.box.borderTopWidth ?? 0)
  // A column container's list holds its spanning floats (`fillArea`).
  const container: ContainerFill | undefined = isColumnContainer(node) ? { bottomsAtEnd: hasHeight(node) } : undefined
  const fillChildren = (nodes: MeasuredNode[], into: Context): Parts => {
    // Fixed nodes after the flow end each part (a trailing fixed row): the flow ends that much higher, when
    // that still places flow here or other content is above; else at the end.
    const trailing = trailingFixedHeight(nodes)
    if (trailing > 0) {
      const found: Found = { forced: false, warnings: [], keepBreaks: into.found.keepBreaks, keepIgnored: into.found.keepIgnored, chains: into.found.chains, area: into.found.area }
      const sub: Context = { ...into, end: into.end - trailing, below: (into.below ?? 0) + trailing, found, moving: undefined }
      const parts = fillArea(nodes, inner, sub, contentBefore, gapOf(node) + whole.gap, true, node.style.justifyContent, paddingRoom, container)
      // With nothing above, a part that stays cut at the page end above that room is not one: the fill at
      // the end decides.
      if (contentBefore || (!found.overflows && parts[0].some(child => inFlowNode(child) && placesFlow(child)) && !parts[0].some(child => child.props[SPAN_GROUP_OVERFLOW_PROP] !== undefined))) {
        adopt(into, sub, trailing)
        return parts
      }
    }
    return fillArea(nodes, inner, into, contentBefore, gapOf(node) + whole.gap, true, node.style.justifyContent, paddingRoom, container)
  }
  // Every part keeps the room of its not-last nodes: whether it continues is known only after its fill.
  // The last part leaves that room empty (CONFORMANCE "Fixed content").
  const [current, next] = fillChildren(children, context)
  const shown = context.notLast && !next.some(inFlowNode) ? unpainted(current, context.expected) : current
  return viewParts(node, context.end - top, shown, continued(next, carriedOf(node)))
}

// ---------------------------------------------------------------------------
// Page-conditional nodes (`pages`) and per-page values. The builder knows on
// each part whether it is a container's first part and whether it continues,
// so it shows a carrier's node itself and never calls the carrier's `render`,
// which needs the facts of an earlier pass (plain-tree.ts). A per-page value
// (a page number, a running value) is laid out once at the widest value it can
// print and keeps that room on every page (`frozen`), so a value known only
// after the fill (`at="end"`, the total) moves nothing.

/** On a container: its continuation nodes, which its first part does not show (`heldCarried`). */
const CARRIED_PROP = '__nuxtPdfCarried'
/** A continuation node and whether it stands after flow content (a carry row at a table's end) or before it. */
type Carried = { readonly node: MeasuredNode, readonly atEnd: boolean }
const carriedOf = (node: MeasuredNode): readonly Carried[] => (node.props[CARRIED_PROP] as Carried[] | undefined) ?? []

const withoutHeight = ({ height: _height, ...box }: MeasuredNode['box']) => box

/** Every carrier as its node's fixed wrapper, `render` dropped: shown until the parts are known. */
const shownCarriers = (node: MeasuredNode): MeasuredNode => {
  const children = node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : shownCarriers(child))
  if (pagesOf(node) === undefined) return { ...node, children }
  const { render: _render, ...props } = node.props
  return { ...node, props, children }
}

/**
 * The running values of a document while a page's `at="end"` values are unknown (plain-tree.ts prints the longest
 * value of each name in characters then): every value each name is set to, and those longest values.
 */
type EndValues = { values: Map<string, string[]>, longest: Record<string, string> }

const endValuesOf = (root: MeasuredDocument): EndValues => {
  const values = runningValuesIn(root.children)
  return { values, longest: Object.fromEntries([...values].map(([name, list]) => [name, list.reduce((longest, value) => value.length > longest.length ? value : longest)])) }
}

/** `info` with these `at="end"` values; the values at the top and before the page stay as known, else the longest. */
const withEnd = (info: PageInfo, { longest }: EndValues, end: Record<string, string>): PageInfo =>
  ({ ...info, running: { top: longest, before: longest, ...info.running, end } })

/**
 * Whether a dynamic text in `node` prints an `at="end"` value: its text differs between no values and the longest
 * at the page end, with no values before the page (a value unset at the end prints the one before).
 */
const printsEnd = (node: MeasuredNode, info: PageInfo, end: EndValues): boolean => {
  const at = (values: Record<string, string>): PageInfo => ({ ...info, running: { top: {}, before: {}, end: values } })
  if (isText(node) && 'render' in node.props) return JSON.stringify(node.props.render?.(at({}))) !== JSON.stringify(node.props.render?.(at(end.longest)))
  return !isText(node) && elementsOf(node).some(child => printsEnd(child, info, end))
}

/** A fixed node that prints an `at="end"` value, the content width of its parent, and its place in the tree. */
type EndSlot = { node: MeasuredNode, width: number, place: string }

const contentWidthOf = (node: MeasuredNode): number =>
  node.box.width - (node.box.paddingLeft ?? 0) - (node.box.paddingRight ?? 0) - (node.box.borderLeftWidth ?? 0) - (node.box.borderRightWidth ?? 0)

/** The highest box each dynamic text below `node` takes, by its place in the tree. */
const textHeights = (node: MeasuredNode, place: string, heights: Map<string, number>): void => {
  if (isText(node)) {
    if ('render' in node.props) heights.set(place, Math.max(heights.get(place) ?? 0, node.box.height))
    return
  }
  elementsOf(node).forEach((child, index) => textHeights(child, `${place}/${index}`, heights))
}

/** `node` with each dynamic text below it at least as high as `heights` holds for its place. */
const raisedTo = (node: MeasuredNode, place: string, heights: Map<string, number>): MeasuredNode => {
  const height = heights.get(place)
  if (isText(node)) return height === undefined ? node : { ...node, style: { ...node.style, minHeight: Math.max(Number(node.style.minHeight ?? 0), height) } }
  let index = 0
  return { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : raisedTo(child, `${place}/${index++}`, heights)) }
}

/**
 * The room of the `at="end"` values in `slots`: the highest box each of their dynamic texts takes for any value its
 * name can print, so the value painted once the page is filled fits the room the fill gave it. One layout holds a
 * copy of every slot per value, each copy as wide as the slot's parent.
 */
const endRoom = (slots: readonly EndSlot[], info: PageInfo, end: EndValues, page: MeasuredNode, relayout: Relayout): Map<string, number> => {
  const infos = [...end.values].flatMap(([name, list]) => list.map(value => withEnd(info, end, { ...end.longest, [name]: value })))
  const copies = infos.flatMap(each => slots.map(slot => ({ type: PDF_PRIMITIVES.View, box: {}, props: {}, style: { width: slot.width, flexShrink: 0 }, children: [resolveDynamicNodes(each, slot.node)] })))
  const laidOut = elementsOf(relayout({ ...page, box: withoutHeight(page.box), children: copies }))
  const heights = new Map<string, number>()
  laidOut.forEach((copy, index) => textHeights(elementsOf(copy)[0]!, slots[index % slots.length]!.place, heights))
  return heights
}

/** A dynamic text keeps the height it was laid out with: the room of the widest value it can print. */
const frozen = (node: MeasuredNode): MeasuredNode => {
  if (isText(node)) return 'render' in node.props && node.box.height > 0 ? { ...node, style: { ...node.style, minHeight: node.box.height } } : node
  return { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : frozen(child)) }
}

/** Each container without its continuation nodes, which it holds in `CARRIED_PROP`; the page keeps its own. */
const heldCarried = (node: MeasuredNode, held: { count: number }, page = false): MeasuredNode => {
  if (isText(node)) return node
  const carried: Carried[] = []
  const children: MeasuredNode[] = []
  let flowBefore = false
  for (const child of elementsOf(node)) {
    const pages = pagesOf(child)
    if (!page && pages === 'continuation') carried.push({ node: child, atEnd: flowBefore })
    else children.push(heldCarried(child, held))
    if (inFlowNode(child)) flowBefore = true
  }
  held.count += carried.length
  return { ...node, props: carried.length > 0 ? { ...node.props, [CARRIED_PROP]: carried } : node.props, children }
}

/** `nodes` with the carry nodes in their places: before the first flow node, or at the end. */
const withCarried = (nodes: MeasuredNode[], carried: readonly Carried[]): MeasuredNode[] => {
  const lead = nodes.findIndex(inFlowNode)
  const at = lead === -1 ? nodes.length : lead
  return [...nodes.slice(0, at), ...carried.filter(({ atEnd }) => !atEnd).map(({ node }) => node), ...nodes.slice(at), ...carried.filter(({ atEnd }) => atEnd).map(({ node }) => node)]
}

/** A not-last node on a last part: its room stays, nothing is painted there. */
const emptied = (node: MeasuredNode): MeasuredNode => ({ ...node, style: { ...node.style, height: node.box.height }, children: [] })

/** The parts of a last part (or page) with their not-last nodes emptied. */
const unpainted = (nodes: MeasuredNode[], expected: Expected): MeasuredNode[] => nodes.map((child) => {
  if (pagesOf(child) !== 'not-last') return child
  const empty = emptied(child)
  const top = expected.get(child)
  if (top !== undefined) expected.set(empty, top)
  return empty
})

const holdsNotLast = (node: MeasuredNode): boolean => pagesOf(node) === 'not-last' || (!isText(node) && elementsOf(node).some(holdsNotLast))

/** A node placed whole is the last part of itself and of everything in it: each not-last node in it is emptied. */
const lastPart = (node: MeasuredNode): MeasuredNode => {
  if (isText(node) || !holdsNotLast(node)) return node
  return { ...node, children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : pagesOf(child) === 'not-last' ? emptied(child) : lastPart(child)) }
}

/** The children of a container's next part: without its first-part nodes, with its continuation ones. */
const continued = (next: MeasuredNode[], carried: readonly Carried[]): MeasuredNode[] => {
  if (!next.some(child => pagesOf(child) === 'first') && carried.length === 0) return next
  return withCarried(next.filter(child => pagesOf(child) !== 'first' && pagesOf(child) !== 'continuation'), carried)
}

/**
 * A page part with its per-page values sized: every carrier as its node, each value as the widest it can
 * print (a running value prints its longest value, a page number the part's first number), laid out whole,
 * then once more without the carry nodes its containers hold back.
 */
const sized = (page: MeasuredNode, pageNumber: number, reserve: number, relayout: Relayout, end: EndValues): MeasuredNode => {
  let shown = shownCarriers(page)
  const info = { pageNumber, reserve }
  const layOut = (node: MeasuredNode) => relayout(resolveDynamicNodes(info, { ...node, box: withoutHeight(node.box) }))
  let measured = layOut(shown)
  // A fixed node in a container (a carry row) that prints an `at="end"` value keeps the room of its highest value.
  const slots: EndSlot[] = []
  const collect = (node: MeasuredNode, place: string) => elementsOf(node).forEach((child, index) => {
    if (isFixed(child) && !isAbsolute(child) && printsEnd(child, info, end)) slots.push({ node: child, width: contentWidthOf(node), place: `${place}/${index}` })
    else if (!isText(child)) collect(child, `${place}/${index}`)
  })
  if (end.values.size > 0) elementsOf(measured).forEach((child, index) => !isText(child) && !isFixed(child) && collect(child, `/${index}`))
  if (slots.length > 0) {
    const heights = endRoom(slots, info, end, shown, relayout)
    const tall = new Map<string, number>()
    for (const slot of slots) textHeights(slot.node, slot.place, tall)
    if ([...heights].some(([place, height]) => height > (tall.get(place) ?? 0) + EPS)) {
      shown = raisedTo(shown, '', heights)
      measured = layOut(shown)
    }
  }
  measured = frozen(measured)
  const held = { count: 0 }
  const kept = heldCarried(measured, held, true)
  return held.count === 0 ? measured : relayout({ ...kept, box: withoutHeight(kept.box) })
}

/** Whether a page's fixed node takes room on a page: known on the first page and after it; a not-last one on every page. */
const holdsCarrier = (node: MeasuredNode): boolean => pagesOf(node) !== undefined || (!isText(node) && elementsOf(node).some(holdsCarrier))

const showsOn = (pages: PageCondition | undefined, first: boolean): boolean =>
  pages === undefined || pages === 'not-last' || (pages === 'first') === first

/** The fixed nodes after the last flow child: the room they take at the end of each part. */
const trailingFixedHeight = (nodes: readonly MeasuredNode[]): number => {
  let height = 0
  for (let at = nodes.length - 1; at >= 0 && !inFlowNode(nodes[at]!); at -= 1) {
    if (!isAbsolute(nodes[at]!)) height += marginTop(nodes[at]!) + nodes[at]!.box.height + marginBottom(nodes[at]!)
  }
  return height
}

/** What a fill `shift` higher than `context` found, taken as this fill's. */
const adopt = (context: Context, sub: Context, shift: number) => {
  const { found } = context
  found.forced ||= sub.found.forced
  found.kind ??= sub.found.kind
  found.overflows ||= sub.found.overflows
  found.warnings.push(...sub.found.warnings)
  if (sub.found.nextEnd !== undefined) need(found, sub.found.nextEnd + shift)
  if (sub.found.bottom !== undefined) found.bottom = Math.max(found.bottom ?? Number.NEGATIVE_INFINITY, sub.found.bottom)
  if (sub.found.reach !== undefined) found.reach = Math.max(found.reach ?? Number.NEGATIVE_INFINITY, sub.found.reach)
  context.moving = sub.moving ?? context.moving
}

// ---------------------------------------------------------------------------
// Rows (table rows). A row's children stand side by side from its top; a row
// that splits splits each child to the same end, so every child keeps its
// column on both pages.

/** A node's height from its content: a row child is stretched to its row, which a part of the row no longer is. */
/** How a row places a cell across: its own `alignSelf`, or the row's `alignItems` (stretch by default). */
const alignOf = (cell: MeasuredNode, row: MeasuredNode): unknown => {
  // Auto margins across a row place the cell before alignSelf does: a top one takes the room above it.
  const [top, bottom] = autoMarginsOf(cell)
  if (top || bottom) return top && bottom ? 'center' : top ? 'flex-end' : 'flex-start'
  const own = cell.style.alignSelf
  const align = unset(own) || own === 'auto' ? row.style.alignItems : own
  return unset(align) ? 'stretch' : align
}

/**
 * Where a cell stands below its row's content top, in a row (part) whose content is `content` high: as yoga
 * aligns it. A baseline cell keeps the offset of the whole layout (its first line's baseline to the row's).
 */
const alignedOffset = (cell: MeasuredNode, row: MeasuredNode, content: number, height = cell.box.height): number => {
  const align = alignOf(cell, row)
  if (align === 'baseline') return Math.max(0, (cell.box.top ?? 0) - edgesTop(row) - marginTop(cell))
  const free = Math.max(0, content - marginTop(cell) - height - marginBottom(cell))
  return align === 'center' ? free / 2 : align === 'flex-end' ? free : 0
}

const naturalHeight = (node: MeasuredNode): number => {
  if (isText(node)) return edgesTop(node) + sum(lineHeights(node)) + edgesBottom(node)
  if (typeof node.style.height === 'number' || BOX_TYPES.has(node.type) || elementsOf(node).length === 0) return node.box.height
  // A fixed child repeats in every part, so it takes room in this one too.
  const children = elementsOf(node).filter(child => !isAbsolute(child))
  const content = isRow(node)
    ? Math.max(0, ...children.map(child => marginTop(child) + naturalHeight(child) + marginBottom(child)))
    : sum(children.map(child => marginTop(child) + naturalHeight(child) + marginBottom(child))) + gapOf(node) * Math.max(0, children.length - 1)
  return Math.max(Number(node.style.minHeight ?? 0), edgesTop(node) + content + edgesBottom(node))
}

/** The part of a row child on a page where it shows nothing: its box keeps its width, so later children keep their columns. */
const emptyRowPart = (node: MeasuredNode): MeasuredNode => {
  const { height: _height, minHeight: _minHeight, ...style } = { ...node.style, marginTop: 0, paddingTop: 0, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }
  const { render: _render, ...props } = node.props
  const box = { ...node.box, top: 0, height: 0, marginTop: 0, paddingTop: 0, borderTopWidth: 0 }
  if (BOX_TYPES.has(node.type)) return { ...node, type: PDF_PRIMITIVES.View, box, style: { ...style, width: node.box.width }, props: { [EMPTY_ROW_PART_PROP]: true }, children: [] }
  return { ...node, box, style, props: { ...props, [EMPTY_ROW_PART_PROP]: true }, ...(isText(node) ? { lines: [] } : { children: [] }) }
}

/** The height of a view's bottom edges with those of the views that end it (their bottom margins too): no content is in it. */
const trailingEdges = (node: MeasuredNode): number => {
  const last = elementsOf(node).findLast(inFlowNode)
  const inner = last !== undefined && last.type === PDF_PRIMITIVES.View && !isRow(last) ? marginBottom(last) + trailingEdges(last) : 0
  return edgesBottom(node) + inner
}

/** A part known to paint nothing, which the next part may drop. */
const isBlank = (node: MeasuredNode): boolean => {
  if (node.props[EMPTY_ROW_PART_PROP] === true) return true
  if (isText(node)) return !paintsBox(node) && (node.lines?.length ?? 0) === 0
  if (node.type !== PDF_PRIMITIVES.View || paintsBox(node)) return false
  return elementsOf(node).every(child => isFixed(child) || isBlank(child))
}

const rowParts = (node: MeasuredNode, top: number, context: Context, contentBefore: boolean, room: number): [MeasuredNode, MeasuredNode | null] => {
  const { end, found, expected } = context
  const inner = top + edgesTop(node)
  const current: MeasuredNode[] = []
  const next: MeasuredNode[] = []
  // The whole row (or the rest, laid out again as a whole) decides where an aligned cell's lines fall.
  const content = node.box.height - edgesTop(node) - edgesBottom(node)
  // Absolute children that `top` places below this part, and where they stand among the rest's children.
  const later: { node: MeasuredNode, at: number, nextAt: number }[] = []
  // A cell whose first content fits here by its place in the row, but whose own rules (orphans, widows,
  // a node that does not split) move it after the break: the row would leave its other cells alone here.
  // A cell the row's layout places below the break (an alignment, a margin) starts there by right.
  let startsLater = false
  const firstFits = (cell: MeasuredNode, at: number): boolean => {
    if (isText(cell)) return (cell.lines?.length ?? 0) > 0 && at + edgesTop(cell) + heightAtLineIndex(cell, 1) <= end + EPS
    if (!splittable(cell, found.area)) return at < end - EPS
    // Its children where its whole layout puts them, justified in its whole height (as `split` does).
    const children = elementsOf(cell)
    const whole = isSizedBox(cell) ? { lead: 0, gap: 0 } : justifiedSpacing(cell.style.justifyContent, cell.box.height - edgesTop(cell) - edgesBottom(cell) - stackHeight(children, gapOf(cell)), children.filter(each => !isAbsolute(each)).length)
    const topOf = topsFrom(children, 0, at + edgesTop(cell) + whole.lead + (children[0] ? marginTop(children[0]) : 0), gapOf(cell) + whole.gap)
    const first = children.findIndex(each => inFlowNode(each) && showsContent(each))
    return first !== -1 && firstFits(children[first]!, topOf(first))
  }
  // The places the cells record here, undone when the row moves whole.
  const marked = expected.size
  for (const child of elementsOf(node)) {
    if (isFixed(child)) {
      current.push(child)
      next.push(child)
      continue
    }
    // An absolute child takes no room: with the first part, or the rest when only `bottom` or (without an
    // inset) the row's end places it, as in a column.
    if (isAbsolute(child)) {
      const atEnd = endAnchored(child) || (alignOf(child, node) === 'flex-end' && unset(child.style.top) && unset(child.style.bottom))
      const moved = landsLater(child, end - top - (node.box.borderTopWidth ?? 0))
      if (moved) later.push({ node: moved, at: current.length, nextAt: next.length });
      (atEnd ? next : current).push(child)
      continue
    }
    // A relative offset moves the cell's box in every part, as in a column.
    const childTop = inner + marginTop(child) + alignedOffset(child, node, content) + shiftOf(child)
    const height = child.box.height
    const place = (piece: MeasuredNode, whole: boolean) => {
      expected.set(piece, childTop)
      current.push(piece)
      if (whole || isText(piece)) recordReach(found, piece, childTop)
    }
    if (end <= childTop) {
      need(found, endOfStart(child, childTop, found.area))
      current.push(emptyRowPart(child))
      next.push(child)
      continue
    }
    const contentEnd = isText(child) ? childTop + edgesTop(child) + heightAtLineIndex(child, child.lines!.length) : childTop + height
    if (!splittable(child, found.area) && end + EPS < childTop + height) {
      // It cannot split: it moves whole as in a column; higher than the room below the repeated rows it stays, cut.
      need(found, childTop + height)
      if (height > room) {
        const higher = height > found.area + EPS
        place(higher ? child : { ...child, props: { ...child.props, [SPAN_GROUP_OVERFLOW_PROP]: { nodeHeight: height, availableHeight: room } } }, true)
        next.push(emptyRowPart(child))
        found.overflows = true
        if (!higher) found.warnings.push(`Node of type ${child.type} can't wrap between pages and it's bigger than available page height`)
      }
      else {
        current.push(emptyRowPart(child))
        next.push(child)
        startsLater ||= showsContent(child)
      }
      continue
    }
    if (end + EPS < contentEnd) {
      const [split0, nextPart] = split(child, childTop, context, contentBefore)
      // A cell that does not stretch is as high as what it holds here; the row part aligns it (`spread`).
      const currentPart = alignOf(child, node) === 'stretch' || isText(split0) ? split0 : { ...split0, style: { ...split0.style, height: undefined }, box: { ...split0.box, height: edgesTop(split0) + stackHeight(elementsOf(split0), gapOf(split0)) + edgesBottom(split0) } }
      place(currentPart, false)
      next.push(nextPart ?? emptyRowPart(child))
      startsLater ||= !showsContent(currentPart) && nextPart !== null && showsContent(nextPart) && firstFits(child, childTop)
      continue
    }
    place(child, true)
    next.push(emptyRowPart(child))
  }
  // A row whose first child with content shows nothing here moves whole below other content (the caller
  // sees no flow), and so does a row that breaks where a cell whose content fits here by its place shows
  // none of it here.
  const first = elementsOf(node).findIndex(child => !isFixed(child) && showsContent(child))
  if (contentBefore && (first === -1 || !showsContent(current[first]!) || startsLater)) {
    for (const piece of [...expected.keys()].slice(marked)) expected.delete(piece)
    return [{ ...node, children: current.filter(isFixed) }, node]
  }
  const kept = withoutBottom(node)
  const height = end - top
  const part: MeasuredNode = { ...node, style: { ...kept.style, height }, box: { ...kept.box, height }, children: current }
  if (next.every(child => isFixed(child) || isBlank(child))) return [part, null]
  // The row continues: an absolute child placed below this part goes on the rest (from the last, so each index holds).
  for (const { node: moved, at, nextAt } of later.reverse()) {
    current.splice(at, 1)
    next.splice(nextAt, 0, moved)
  }
  const rest = withoutTop(node)
  // A baseline cell keeps its offset below the row's top (`alignedOffset`): the rest is that much higher.
  const below = (child: MeasuredNode) => alignOf(child, node) === 'baseline' ? alignedOffset(child, node, 0) : 0
  const restHeight = Math.max(0, ...next.filter(inFlowNode).map(child => below(child) + marginTop(child) + naturalHeight(child) + marginBottom(child))) + edgesBottom(node)
  // The rest is laid out again as a whole on the next page: a justified cell stretches to its height and
  // splits where that layout puts its children (as its first part did in the whole row).
  const justifies = (child: MeasuredNode) => inFlowNode(child) && !isText(child) && !(unset(child.style.justifyContent) || child.style.justifyContent === 'flex-start')
  const stretch = (child: MeasuredNode): MeasuredNode => ({ ...child, box: { ...child.box, height: Math.max(child.box.height, restHeight - edgesBottom(node) - marginTop(child) - marginBottom(child)) } })
  const stretched = next.map(child => justifies(child) && alignOf(child, node) === 'stretch' ? stretch(child) : child)
  const nextPart: MeasuredNode = { ...node, style: { ...rest.style, height: undefined }, box: { ...rest.box, height: restHeight }, props: { ...node.props, bookmark: null }, children: stretched }
  if (node.props.bookmark && !showsContent(part) && showsContent(nextPart)) {
    return [{ ...part, props: { ...part.props, bookmark: null } }, { ...nextPart, props: { ...nextPart.props, bookmark: node.props.bookmark } }]
  }
  return [part, nextPart]
}

// ---------------------------------------------------------------------------
// Columns. A segment's galley holds its content at the column width (stage 1),
// so a column is filled like a page: the same fill over the same pieces, to
// the column's end. The next column continues from the rest; no column is
// laid out again. A balance is a search over heights, each try a fill.

interface ColumnFill {
  columns: MeasuredNode[][]
  rest: MeasuredNode[]
  kind?: BreakKind
  warnings: string[]
  overflows: boolean
  nextEnd: number
  moving?: MeasuredNode
  bottom?: number
}

/** The columns of `segment` (top at `top`) filled in order to `height` below its galley's top. */
const columnFill = (segment: MeasuredNode, top: number, context: Context, height: number, firstHasContent: boolean, laterHaveContent: boolean, expected: Expected, keepBreaks = context.found.keepBreaks): ColumnFill => {
  const galley = elementsOf(segment)[0]!
  const galleyTop = top + edgesTop(segment)
  const result: ColumnFill = { columns: [], rest: elementsOf(galley), warnings: [], overflows: false, nextEnd: Number.POSITIVE_INFINITY }
  for (let column = 0; column < columnCountOf(segment); column += 1) {
    const found: Found = { forced: false, warnings: [], keepBreaks, keepIgnored: context.found.keepIgnored, chains: context.found.chains, area: context.found.area }
    // A column top is no page top: a negative margin is not cut there, and a moved wrap={false} node is unsplittable again.
    const sub: Context = { end: galleyTop + height, found, expected, liftTo: column === 0 ? context.liftTo : Number.NEGATIVE_INFINITY, movedWhole: column === 0 ? context.movedWhole : undefined, restore: context.restore, gate: context.gate, only: context.only }
    countWork('columnFills')
    // A fixed child of the galley repeats at the top of each column that has content.
    const [current, filledNext] = fillArea(result.rest, galleyTop + edgesTop(galley), sub, column === 0 ? firstHasContent : laterHaveContent, gapOf(galley), true)
    // Only fixed children left start no column of their own.
    const next = filledNext.every(isFixed) ? [] : filledNext
    result.warnings.push(...found.warnings)
    result.overflows ||= Boolean(found.overflows)
    result.nextEnd = Math.min(result.nextEnd, found.nextEnd ?? Number.POSITIVE_INFINITY)
    if (found.bottom !== undefined) result.bottom = Math.max(result.bottom ?? Number.NEGATIVE_INFINITY, found.bottom + edgesBottom(galley))
    result.columns.push(current)
    result.rest = next
    result.moving = sub.moving
    if (next.length === 0) break
    if (found.kind === 'page' || column === columnCountOf(segment) - 1) {
      if (found.forced) result.kind = found.kind ?? 'page'
      break
    }
  }
  return result
}

/** The row of filled columns a segment becomes: each column as high as what it holds. */
const rowOf = (segment: MeasuredNode, columns: MeasuredNode[][], height: number | undefined): MeasuredNode => {
  const galley = elementsOf(segment)[0]!
  const heights = columns.map(children => edgesTop(galley) + stackHeight(children, gapOf(galley)) + edgesBottom(galley))
  const { [COLUMN_SEGMENT_PROP]: _count, [COLUMN_AUTO_FILL_PROP]: _auto, ...props } = segment.props
  const kept = withoutBottom(segment)
  return {
    ...segment,
    style: { ...kept.style, height },
    box: { ...kept.box, height: height ?? edgesTop(segment) + Math.max(...heights) },
    props: { ...props, [COLUMN_ROW_PROP]: true },
    children: columns.map((children, at) => ({ ...galley, box: { ...galley.box, height: heights[at]! }, children })),
  }
}

/** A segment that crosses the page end (or holds a forced break), filled in order: the row on this page and the segment with the galley's rest. */
const columnParts = (segment: MeasuredNode, top: number, context: Context, contentBefore: boolean): [MeasuredNode, MeasuredNode | null] => {
  const room = context.end - top
  const filled = columnFill(segment, top, context, room - edgesTop(segment), contentBefore, false, context.expected)
  const { found } = context
  found.warnings.push(...filled.warnings)
  if (filled.overflows) found.overflows = true
  if (filled.nextEnd < Number.POSITIVE_INFINITY) need(found, filled.nextEnd)
  if (filled.kind !== undefined) {
    found.forced = true
    found.kind = found.kind === 'page' ? 'page' : filled.kind
  }
  if (filled.moving) context.moving = filled.moving
  if (filled.bottom !== undefined) {
    found.bottom = Math.max(found.bottom ?? Number.NEGATIVE_INFINITY, filled.bottom)
    found.reach = Math.max(found.reach ?? Number.NEGATIVE_INFINITY, filled.bottom)
  }
  if (!filled.columns.some(column => column.length > 0)) return [{ ...segment, children: [] }, segment]
  if (filled.rest.length === 0) return [rowOf(segment, filled.columns, segment.style.height as number | undefined), null]
  const galley = elementsOf(segment)[0]!
  const galleyRest = { ...galley, box: { ...galley.box, height: Math.min(galley.box.height, edgesTop(galley) + stackHeight(filled.rest, gapOf(galley)) + edgesBottom(galley)) }, children: filled.rest }
  const rest = withoutTop(segment)
  return [
    rowOf(segment, filled.columns, room),
    { ...segment, ...rest, box: { ...rest.box, height: galleyRest.box.height + edgesBottom(segment) }, props: { ...segment.props, bookmark: null }, children: [galleyRest] },
  ]
}

/**
 * A segment that can end on this page, balanced: its columns at the lowest
 * height up to the room that holds all of it with no warning and content in
 * the first column. A try is a fill (arithmetic over the pieces);
 * after a try that fails, the next is at the lowest height at which any
 * column would take more (`nextEnd`), so the steps find the lowest height
 * that works, also where the keep rules make the fill not monotone.
 */
const balanced = (segment: MeasuredNode, top: number, context: Context, end = context.end): MeasuredNode | undefined => {
  const galley = elementsOf(segment)[0]!
  const count = columnCountOf(segment)
  if (segment.props[COLUMN_AUTO_FILL_PROP] === true || count === 1 || !elementsOf(galley).some(placesFlow)) return undefined
  const limit = end - top - edgesTop(segment)
  let height = Math.max(galley.box.height / count, tallestUnsplittable(elementsOf(galley)))
  while (height <= limit + EPS) {
    countWork('columnBalanceTries')
    const expected: Expected = new Map()
    // A try leaves nothing behind: its own expected tops and keep breaks.
    const filled = columnFill(segment, top, context, height, true, true, expected, new Set(context.found.keepBreaks))
    if (filled.rest.length === 0 && filled.warnings.length === 0 && (filled.columns[0]?.length ?? 0) > 0) {
      for (const [node, at] of expected) context.expected.set(node, at)
      return rowOf(segment, filled.columns, segment.style.height as number | undefined)
    }
    const step = filled.nextEnd - top - edgesTop(segment)
    if (!(step > height + EPS)) return undefined
    height = step
  }
  return undefined
}

/** A piece whose forced break was taken. */
const spent = (node: MeasuredNode): MeasuredNode => ({ ...node, props: { ...node.props, break: false } })

/** Whether a node holds a column segment at any depth. */
const holdsSegments = (node: MeasuredNode): boolean => !isText(node) && elementsOf(node).some(child => isColumnSegment(child) || holdsSegments(child))

/**
 * A segment whose columns, filled in order to the room, hold all of it: the row they make, as high as its highest
 * column. Undefined when content goes on, after the room or a page break.
 */
const filledInOrder = (segment: MeasuredNode, top: number, context: Context, contentBefore: boolean, end = context.end): MeasuredNode | undefined => {
  const expected: Expected = new Map()
  const keepBreaks = new Set(context.found.keepBreaks)
  const filled = columnFill(segment, top, context, end - top - edgesTop(segment), contentBefore, false, expected, keepBreaks)
  if (filled.rest.length > 0 || filled.kind === 'page' || filled.overflows || !filled.columns.some(column => column.length > 0)) return undefined
  for (const [node, at] of expected) context.expected.set(node, at)
  for (const node of keepBreaks) context.found.keepBreaks.add(node)
  context.found.warnings.push(...filled.warnings)
  if (filled.nextEnd < Number.POSITIVE_INFINITY) need(context.found, filled.nextEnd)
  if (filled.bottom !== undefined) {
    context.found.bottom = Math.max(context.found.bottom ?? Number.NEGATIVE_INFINITY, filled.bottom)
  }
  return rowOf(segment, filled.columns, segment.style.height as number | undefined)
}

/**
 * `node` (its border box at `top`) with every segment in it that can end on
 * this page made a row where it is: balanced, or
 * else filled in order; its height summed again. The node itself when
 * nothing changes; a segment that goes on stays one, for the split.
 */
const withBalanced = (node: MeasuredNode, top: number, context: Context, contentBefore: boolean, end = Number.POSITIVE_INFINITY): MeasuredNode => {
  if (isColumnSegment(node)) {
    if (context.goOn?.has(node)) return node
    // `end` is the bottom of the box around it with a height. A box that goes on below this page is not
    // balanced here: only its last part is (as in CSS); its columns fill in order to the page end.
    const room = Math.min(end, context.end)
    const row = (end > context.end + EPS && end < Number.POSITIVE_INFINITY ? undefined : balanced(node, top, context, room)) ?? filledInOrder(node, top, context, contentBefore, room)
    if (row !== undefined) return row
    // Its box's height ends its columns above the page end: content that needs more columns fails.
    const galley = elementsOf(node)[0]!
    if (end < context.end - EPS) throw columnHeightError(galley.box.height, end - top - edgesTop(node) - edgesTop(galley), columnCountOf(node))
    ;(context.goOn ??= new Set()).add(node)
    return node
  }
  // Also the rest of a container that holds only the spanning floats that wait: they go to its edges.
  if (isColumnContainer(node) && elementsOf(node).some(child => floatOf(child) !== undefined)) return withSpanningFloats(node, top, context, contentBefore, end)
  if (!holdsSegments(node)) return node
  const original = elementsOf(node)
  let at = top + edgesTop(node)
  // A box fills its columns to its own height (a part to its share of it).
  const inner = isSizedBox(node) ? Math.min(end, top + node.box.height - edgesBottom(node)) : end
  let before = false
  const children = original.map((child, index) => {
    // An absolute child takes no room: the content after it starts where it would without it.
    if (isAbsolute(child)) return child
    at += (before ? gapOf(node) : 0) + marginTop(child)
    before = true
    const placed = withBalanced(child, at, context, contentBefore || original.slice(0, index).some(placesFlow), inner)
    at += placed.box.height + marginBottom(placed)
    return placed
  })
  if (children.every((child, index) => child === original[index])) return node
  const summed = Math.max(Number(node.style.minHeight ?? 0), edgesTop(node) + stackHeight(children, gapOf(node)) + edgesBottom(node))
  const height = typeof node.style.height === 'number' ? node.box.height : typeof node.style.maxHeight === 'number' ? Math.min(node.style.maxHeight, summed) : summed
  return { ...node, box: { ...node.box, height }, children }
}

/**
 * A column container with spanning floats that ends on this page, its list
 * filled with them (`fillArea`): the spanning top floats at its top, the
 * bottom ones right below its last row (at its bottom, with a height). The
 * container itself when its list goes on: the split fills it.
 */
const withSpanningFloats = (node: MeasuredNode, top: number, context: Context, contentBefore: boolean, end: number): MeasuredNode => {
  const sized = isSizedBox(node)
  const limit = Math.min(end, context.end, sized ? top + node.box.height - edgesBottom(node) : Number.POSITIVE_INFINITY)
  const found: Found = { forced: false, warnings: [], keepBreaks: new Set(context.found.keepBreaks), keepIgnored: new Set(context.found.keepIgnored), chains: context.found.chains, area: context.found.area }
  const sub: Context = { ...context, end: limit, found, expected: new Map(), moving: undefined, ...(context.goOn ? { goOn: new Set(context.goOn) } : {}) }
  const [current, next] = fillArea(elementsOf(node), top + edgesTop(node), sub, contentBefore, gapOf(node), true, node.style.justifyContent, undefined, { bottomsAtEnd: hasHeight(node) })
  if (next.some(inFlowNode) || found.forced || found.overflows) {
    // A box with a height that fits here ends its columns at its height: content that needs more fails, as without floats.
    if (sized && !found.forced && top + node.box.height <= Math.min(end, context.end) + EPS) throw spanningHeightError(node, limit - top - edgesTop(node))
    // A float held back for the next page splits the container where it would fit whole.
    ;(context.held ??= new Set()).add(node)
    return node
  }
  for (const [placed, at] of sub.expected) context.expected.set(placed, at)
  for (const kept of found.keepBreaks) context.found.keepBreaks.add(kept)
  for (const start of found.keepIgnored) context.found.keepIgnored.add(start)
  context.found.warnings.push(...found.warnings)
  if (found.nextEnd !== undefined) need(context.found, found.nextEnd)
  if (found.bottom !== undefined) context.found.bottom = Math.max(context.found.bottom ?? Number.NEGATIVE_INFINITY, found.bottom)
  const summed = Math.max(Number(node.style.minHeight ?? 0), edgesTop(node) + stackHeight(current, gapOf(node)) + edgesBottom(node))
  const height = typeof node.style.height === 'number' ? node.box.height : typeof node.style.maxHeight === 'number' ? Math.min(node.style.maxHeight, summed) : summed
  return { ...node, box: { ...node.box, height }, children: current }
}

/** `columnHeightError` for a box whose spanning floats take `room` from its columns' height, less their room. */
const spanningHeightError = (node: MeasuredNode, room: number) => {
  const children = elementsOf(node)
  const floats = children.filter(child => floatOf(child) !== undefined)
  const galleys = children.filter(isColumnSegment).map(segment => elementsOf(segment)[0]!)
  const segment = children.find(isColumnSegment)
  return columnHeightError(sum(galleys.map(galley => galley.box.height)), room - sum(floats.map(float => extentOf(float) + gapOf(node))), segment === undefined ? 1 : columnCountOf(segment))
}

/**
 * The fixed nodes a page holds after its flow (a footer written last), placed
 * as yoga places them: below the last node placed on the page. The fill left
 * them their room (`tailRoom`); an absolute one takes none.
 */
const tailed = (tail: MeasuredNode[], placed: MeasuredNode[], context: Context, contentTop: number, gap: number, pageEnd: number): MeasuredNode[] => {
  const last = placed.findLast(node => !isAbsolute(node))
  let before = last !== undefined
  let at = last === undefined ? contentTop : (context.expected.get(last) ?? contentTop) + last.box.height + marginBottom(last)
  for (const node of tail) {
    if (isAbsolute(node)) continue
    at += (before ? gap : 0) + marginTop(node)
    before = true
    context.expected.set(node, at + shiftOf(node))
    recordReach(context.found, node, at)
    // Below a line that fits no page (a text keeps one line on an empty page), it crosses the page end: yoga squeezes the page.
    if (at + node.box.height > pageEnd + EPS) context.found.overflows = true
    at += node.box.height + marginBottom(node)
  }
  return tail
}

/** A node in the flow of its parent: not fixed, not absolute. */
const inFlowNode = (node: MeasuredNode): boolean => !isFixed(node) && !isAbsolute(node)

/** How far a relative `top` or `bottom` moves a node's box from its place; its siblings stay where they are. */
const shiftOf = (node: MeasuredNode): number => {
  // A static node ignores its offsets; an absolute one is placed by them.
  if (isAbsolute(node) || node.style.position === 'static') return 0
  if (typeof node.style.top === 'number') return node.style.top
  return typeof node.style.bottom === 'number' ? -node.style.bottom : 0
}

/**
 * An absolute node that `top` places below the part of its parent on this page, whose padding box is `room`
 * high here: it goes on the next part, `room` higher (the parts stack as one tall parent, as CSS fragments
 * do). Undefined when it stays.
 */
const landsLater = (node: MeasuredNode, room: number): MeasuredNode | undefined =>
  typeof node.style.top === 'number' && node.style.top >= room ? { ...node, style: { ...node.style, top: node.style.top - room } } : undefined

/** An absolute node that only `bottom` places goes with the last part of its parent; any other with the first. */
const endAnchored = (node: MeasuredNode): boolean => unset(node.style.top) && !unset(node.style.bottom)

/**
 * The pieces of `nodes` on this page and their rest. With `repeat` (the
 * children of a container, not of a page) a fixed node repeats in both parts,
 * as a table header does; one after the flow that moved (a trailing fixed
 * row) follows the last piece placed here.
 */
const fill = (nodes: MeasuredNode[], start: number, context: Context, pageHasContent: boolean, gap: number, repeat = false, justify?: unknown, room?: number): Parts => {
  const { end, found, expected } = context
  const current: MeasuredNode[] = []
  const next: MeasuredNode[] = []
  let moved = false
  let y = start
  // Where the last flow piece placed here ends, for the fixed nodes that follow it.
  let lastEnd: number | undefined
  const deferred: MeasuredNode[] = []
  let furthest: number | undefined
  let flowBefore = false
  let inFlowBefore = false
  // Room the fixed nodes take on each page: a block that cannot split and is higher than what is left never fits.
  const repeated = sum(nodes.filter(node => isFixed(node) && !isAbsolute(node)).map(node => marginTop(node) + node.box.height + marginBottom(node)))
  // The fixed nodes placed here. A repeated one is placed as a copy: in columns, two parts of one container
  // share a page, and the check finds each placement by its node.
  const placedFixed = new Set<MeasuredNode>()
  // The absolute nodes, which take no room, and where they stand among the pieces: placed after the fill.
  const absolutes: { node: MeasuredNode, at: number, nextAt: number }[] = []
  for (const [index, original] of nodes.entries()) {
    if (isAbsolute(original) && !isFixed(original)) {
      absolutes.push({ node: original, at: current.length, nextAt: next.length })
      continue
    }
    if (floatOf(original) !== undefined) {
      // A top float its area placed (`fillArea`): whole, below the fixed nodes at the top.
      y += (inFlowBefore ? gap : 0) + marginTop(original)
      expected.set(original, y + shiftOf(original))
      current.push(original)
      recordReach(found, original, y)
      y += original.box.height + marginBottom(original)
      inFlowBefore = true
      continue
    }
    if (isFixed(original)) {
      if (repeat && moved) {
        deferred.push(original)
        next.push(original)
        continue
      }
      placedFixed.add(original)
      const shown = repeat ? { ...original } : original
      if (repeat) next.push(original)
      if (isAbsolute(shown)) current.push(shown)
      else {
        y += (inFlowBefore ? gap : 0) + marginTop(shown)
        expected.set(shown, y + shiftOf(shown))
        current.push(shown)
        recordReach(found, shown, y)
        // Fixed content that crosses the page end does not fit: yoga squeezes the page.
        if (y + shown.box.height > end + (context.below ?? 0) + EPS) found.overflows = true
        y += shown.box.height + marginBottom(shown)
        inFlowBefore = true
      }
      continue
    }
    if (moved) {
      next.push(original)
      continue
    }
    if (inFlowBefore) y += gap
    inFlowBefore = true
    const lifted = liftedAt(original, y, context.liftTo)
    // A relative offset moves its box: the page end applies to the moved box, the next node starts below its place.
    const shift = shiftOf(lifted)
    const top = y + marginTop(lifted) + shift
    if (end <= top) {
      // At any higher end it is reached: its forced break is taken just below its top, else its start must fit.
      if (breaksBefore(lifted, found) && (pageHasContent || flowBefore)) need(found, top + 2 * EPS)
      else if (!isText(lifted) || lifted.lines!.length > 0) need(found, Math.max(endOfStart(lifted, top, found.area), endOfGroup(nodes, index, topsFrom(nodes, index, top, gap))))
      next.push(lifted)
      moved = true
      continue
    }
    // A segment that can end here is balanced first, at any depth; the row it
    // becomes does not split. What moves on is the piece as it was: the next page balances it again.
    const child = withBalanced(lifted, top, context, pageHasContent || flowBefore)
    const height = child.box.height
    const after = nodes.slice(index + 1)
    // A part a split made (whole = false) records where its content ends while it is filled.
    const place = (placed: MeasuredNode, whole = true) => {
      const node = whole && context.notLast ? lastPart(placed) : placed
      expected.set(node, top)
      current.push(node)
      flowBefore = true
      lastEnd = top + node.box.height
      if (whole || isText(node)) recordReach(found, node, top)
    }
    // A break inside the child (a keep's tail, a forced break), taken when the
    // rest keeps flow content; with none above the break, the child moves whole.
    const breakInside = (): boolean => {
      const [currentPart, nextPart] = split(child, top, context, contentBefore)
      if (nextPart === null || !elementsOf(nextPart).some(inFlowNode)) return false
      const keeps = elementsOf(currentPart).some(inFlowNode)
      if (keeps) place(currentPart, false)
      next.push(keeps ? nextPart : lifted, ...after)
      return true
    }
    const splits = (splittable(child, found.area) && child.props[COLUMN_ROW_PROP] !== true)
      || (child === context.movedWhole && !(context.restore && height <= found.area + EPS))
    const contentBefore = pageHasContent || flowBefore
    const crosses = end + EPS < top + height
    const tail = keepTail(child, top, found.area)
    const improves = contentBefore || tail !== undefined
    const topOf = topsFrom(nodes, index, top - shift, gap)
    const presence = (): number => {
      const ahead = Number(child.props.minPresenceAhead ?? 0)
      const own = top + height + (ahead > 0 ? marginBottom(child) + ahead : 0)
      furthest ??= after.length === 0 ? Number.NEGATIVE_INFINITY : topOf(nodes.length - 1) + nodes.at(-1)!.box.height
      // Content after a forced break never shares the page, as for a keep: the reach ends before it.
      const broken = ahead > 0 ? after.findIndex(hasBreak) : -1
      const last = broken === -1 ? furthest : broken === 0 ? top + height : topOf(index + broken) + nodes[index + broken]!.box.height
      const reach = last === Number.NEGATIVE_INFINITY ? own : Math.min(own, last)
      const from = tail?.top ?? top
      const kept = endOfKeep(nodes, index, found.area, topOf, from)
      // A chain higher than the content area cannot stay on one page: the keep is dropped.
      if (kept !== undefined && kept - from > found.area) found.keepIgnored.add(chainStartOf(nodes, index, found.chains))
      return kept === undefined || kept - from > found.area ? reach : Math.max(reach, kept)
    }
    const forcedHere = breaksBefore(child, found) && improves
    const breaks = forcedHere
      || (crosses && !splits)
      || (!crosses && improves && presence() > end + EPS)
    // At the top of a page a move gains nothing: a keep or minPresenceAhead that asks for more stays dropped.
    if (!crosses && !improves && !hasBreak(child) && (keepsWithNext(child) || Number(child.props.minPresenceAhead ?? 0) > 0) && presence() > end + EPS) {
      found.keepIgnored.add(chainStartOf(nodes, index, found.chains))
    }
    // A break the room decides: a higher end keeps the child here.
    if (breaks && !forcedHere) need(found, crosses ? top + height : presence())

    const groupEnd = spanGroupEnd(nodes, index)
    if (groupEnd > index) {
      // The rows a cell spans stay on one page (a span group): crossing the end they move whole below
      // other content when they fit below the repeated rows; else they stay, cut at the page end.
      const bottom = topOf(groupEnd) + nodes[groupEnd]!.box.height
      if (end + EPS < bottom) {
        need(found, bottom)
        if (contentBefore && bottom - top <= found.area - repeated) {
          next.push(lifted, ...after)
          break
        }
        const overflow = { nodeHeight: bottom - top, availableHeight: found.area - repeated }
        nodes.slice(index, groupEnd + 1).forEach((row, at) => {
          const placed = { ...row, props: { ...row.props, [SPAN_GROUP_OVERFLOW_PROP]: at === 0 ? overflow : true } }
          expected.set(placed, topOf(index + at))
          current.push(placed)
          flowBefore = true
          lastEnd = topOf(index + at) + row.box.height
        })
        next.push(...nodes.slice(groupEnd + 1))
        found.overflows = true
        found.warnings.push(`Rows a table cell spans can't split between pages and they're bigger than available page height`)
        break
      }
    }
    if (height > found.area + EPS && !splits) {
      // It can never fit and cannot split: it stays, cut at the page end.
      place(child)
      next.push(...after)
      found.overflows = true
      found.warnings.push(`Node of type ${child.type} can't wrap between pages and it's bigger than available page height`)
      break
    }
    if (!splits && crosses && height > found.area - repeated + EPS) {
      // It fits a page, but not below the fixed nodes: moved, it would cross the page end again.
      place({ ...child, props: { ...child.props, [SPAN_GROUP_OVERFLOW_PROP]: { nodeHeight: height, availableHeight: found.area - repeated } } })
      next.push(...after)
      found.overflows = true
      found.warnings.push(`Node of type ${child.type} can't wrap between pages and it's bigger than available page height`)
      break
    }
    if (breaks && tail !== undefined && !hasBreak(child)) {
      // Its keep comes from its last child: it splits before the tail.
      found.keepBreaks.add(tail.start)
      if (breakInside()) break
    }
    if (breaks) {
      const kind = breakKindOf(child)
      if (kind !== undefined) {
        found.forced = true
        found.kind = found.kind === 'page' ? 'page' : kind
      }
      // A moved wrap={false} node may split on the next page, a fresh one: a value of the rest, not a prop it gets.
      // A forced break is taken once: the piece it moved starts the next column or page, and keeps no break.
      const moving = kind === undefined ? lifted : spent(lifted)
      if (moving.props.wrap === false && !BOX_TYPES.has(moving.type) && splittable({ ...moving, props: { ...moving.props, wrap: true } }, found.area)) context.moving = moving
      next.push(moving, ...after)
      break
    }
    if (crosses) {
      // At its own end it fits whole: the lowest change can be there, when all its children fit and only its edges move on.
      need(found, top + height)
      // Only its bottom edges cross the end: the content after it starts on the next page, so a keep
      // with that content holds as in a child that fits. It splits before its tail, or moves whole.
      if (!hasBreak(child) && !isText(child) && !isRow(child) && top + height - trailingEdges(child) <= end + EPS && (tail !== undefined || (improves && keepsWithNext(child)))) {
        const from = tail?.top ?? top
        const kept = endOfKeep(nodes, index, found.area, topOf, from)
        if (kept !== undefined && kept - from > found.area) found.keepIgnored.add(chainStartOf(nodes, index, found.chains))
        else if (kept !== undefined) {
          need(found, kept)
          if (tail !== undefined) {
            found.keepBreaks.add(tail.start)
            if (breakInside()) break
          }
          else {
            next.push(lifted, ...after)
            break
          }
        }
      }
      const [currentPart, nextPart] = split(child, top, context, contentBefore, found.area - repeated)
      if (isText(child) && currentPart.lines!.length === 0 && contentBefore) {
        next.push(child)
        moved = true
        continue
      }
      // A view with no flow inside whose top edges do not fit the room: a part of it would be lower than its edges.
      const edgesOnly = !isText(child) && !elementsOf(child).some(inFlowNode) && end - top < edgesTop(child) - EPS
      if (edgesOnly || (elementsOf(child).some(inFlowNode) && !elementsOf(currentPart).some(inFlowNode))) {
        // Every child of it moved: it moves whole, so no empty box of it stays at
        // the page end, unless nothing is above it.
        if (contentBefore) next.push(lifted, ...after)
        else {
          place(child)
          next.push(...after)
          found.overflows = true
        }
        break
      }
      place(currentPart, false)
      // A view with no flow inside shows its top edges here: the note fit counts them as this page's content.
      if (!isText(child) && !elementsOf(child).some(inFlowNode)) found.bottom = Math.max(found.bottom ?? Number.NEGATIVE_INFINITY, top + edgesTop(child))
      // A line higher than the room stays at a page top, cut at the page end, like a block that cannot split.
      if (top + currentPart.box.height > end + (context.below ?? 0) + EPS) found.overflows = true
      if (nextPart !== null) {
        next.push(nextPart)
        moved = true
      }
      // A segment whose columns end on the page is as high as its highest column: the flow goes on below it.
      y = top - shift + (isColumnSegment(child) && nextPart === null ? currentPart.box.height : height) + marginBottom(child)
      continue
    }
    // A forced break inside a container that fits (H5-A). A segment that is still one goes on after a
    // page break in it: its columns fill in order.
    if (isColumnSegment(child)) {
      const [row, rest] = split(child, top, context, contentBefore)
      if (rest !== null && elementsOf(row).length === 0 && contentBefore) {
        next.push(child, ...after)
        break
      }
      place(row, false)
      if (rest !== null) {
        next.push(rest, ...after)
        break
      }
      y = top - shift + row.box.height + marginBottom(child)
      continue
    }
    if ((containsBreak(child, found) || holdsHeld(child, context)) && breakInside()) break
    if (marginBottom(child) > 0 && top + height + marginBottom(child) > end + EPS) {
      // Its box fits, its bottom margin does not: the margin is lost at the break.
      place({ ...child, style: { ...child.style, marginBottom: 0 }, box: { ...child.box, marginBottom: 0 } })
    }
    else place(child)
    y = top - shift + height + marginBottom(child)
  }
  if (repeat) {
    // The fixed nodes after the flow that moved: below the last piece placed here.
    let at = (lastEnd ?? y) + (current.some(inFlowNode) ? gap : 0)
    for (const original of [...deferred, ...nodes.filter(node => isFixed(node) && !placedFixed.has(node) && !deferred.includes(node) && next.includes(node))]) {
      const node = { ...original }
      if (isAbsolute(node)) {
        current.push(node)
        continue
      }
      at += marginTop(node)
      expected.set(node, at)
      current.push(node)
      recordReach(found, node, at)
      // Past the page end it does not fit: yoga squeezes the page, so the check does not apply.
      if (at + node.box.height > end + (context.below ?? 0) + EPS) found.overflows = true
      at += node.box.height + marginBottom(node) + gap
    }
  }
  if (absolutes.length > 0) {
    const last = !next.some(inFlowNode)
    const here = last || current.some(inFlowNode)
    // From the last back, so each keeps its place among the pieces (the paint order).
    for (const { node, at, nextAt } of absolutes.reverse()) {
      // Without a vertical inset it stands where justify puts it in the whole column: at its end for flex-end.
      const atEnd = endAnchored(node) || (justify === 'flex-end' && unset(node.style.top) && unset(node.style.bottom))
      const later = room === undefined || last || !here ? undefined : landsLater(node, room)
      if (later) next.splice(nextAt, 0, later)
      else if (atEnd ? last : here) current.splice(at, 0, node)
      else next.splice(nextAt, 0, node)
    }
  }
  return [current, next]
}

// ---------------------------------------------------------------------------
// Floats (D49). A float is a piece of its reference list (paginate/floats.ts)
// that the flow does not see: each area (the page flow, one column, a column
// container's part on a page) takes the floats queued from the areas before
// it, then fills its flow, then tries the floats whose anchor (their place in
// the flow) it reached, each with one fill more. A top float is placed by
// `fill` below the fixed nodes at the top; a bottom float follows the flow,
// the free room of the area as its top margin.
//
// The floats of a column container's list span its columns. Their anchor is a
// place in a galley: a segment counts the flow pieces of its galley, and the
// segments a spanning float stands between are one segment for the fill, so
// the float does not end the columns. The column floats and the spanning
// floats of a container share one queue per side. On a page the spanning top
// floats print above the column top floats and the spanning bottom floats
// below the column bottom floats, so the container's fill keeps each spanning
// float off a page where that would put it before an earlier column float,
// and gives its columns a `gate`: the order above which they place no float
// of a side on this page.

type FloatGate = Readonly<Record<FloatSide, number>>

interface AreaFill {
  current: MeasuredNode[]
  next: MeasuredNode[]
  sub: Context
  /** How many anchor units the fill placed whole: a float whose anchor is at most this is reached. */
  cut: number
}

/** A flow piece of a reference list: what a float's anchor counts. */
const flowPiece = (node: MeasuredNode): boolean => inFlowNode(node) && floatOf(node) === undefined

/** The anchor units of a flow piece: a segment one per flow piece of its galley, any other piece one. */
const unitsOf = (node: MeasuredNode): number => isColumnSegment(node) ? elementsOf(elementsOf(node)[0]!).filter(flowPiece).length : 1

const unitsIn = (nodes: readonly MeasuredNode[]): number => sum(nodes.filter(flowPiece).map(unitsOf))

/** `segment` with `children` in its galley, as high as they stack. */
const segmentWith = (segment: MeasuredNode, children: MeasuredNode[]): MeasuredNode => {
  const galley = elementsOf(segment)[0]!
  const height = edgesTop(galley) + stackHeight(children, gapOf(galley)) + edgesBottom(galley)
  return { ...segment, box: { ...segment.box, height: edgesTop(segment) + height + edgesBottom(segment) }, children: [{ ...galley, box: { ...galley.box, height }, children }] }
}

/**
 * A container's flow with the segments that spanning floats stood between
 * joined: one galley, so the columns go on through the floats. An absolute
 * child between them follows the joined segment.
 */
const joinedSegments = (flow: readonly MeasuredNode[]): MeasuredNode[] => {
  const joined: MeasuredNode[] = []
  let last = -1
  for (const node of flow) {
    if (isColumnSegment(node) && last !== -1 && joined.slice(last + 1).every(isAbsolute)) {
      joined[last] = segmentWith(joined[last]!, [...elementsOf(elementsOf(joined[last]!)[0]!), ...elementsOf(elementsOf(node)[0]!)])
      continue
    }
    if (isColumnSegment(node)) last = joined.length
    else if (!isAbsolute(node)) last = -1
    joined.push(node)
  }
  return joined
}

/** A segment cut after `units` flow pieces of its galley: the part before and the part after. */
const segmentAt = (segment: MeasuredNode, units: number): [MeasuredNode, MeasuredNode] => {
  const children = elementsOf(elementsOf(segment)[0]!)
  let at = 0
  for (let left = units; left > 0; at += 1) {
    if (flowPiece(children[at]!)) left -= 1
  }
  return [segmentWith(segment, children.slice(0, at)), segmentWith(segment, children.slice(at))]
}

/** The column floats in a container's list: in the galleys of its segments and the columns of its rows. */
const columnFloatsIn = (nodes: readonly MeasuredNode[]): MeasuredNode[] => nodes.flatMap((node) => {
  if (isColumnSegment(node)) return elementsOf(elementsOf(node)[0]!).filter(child => floatOf(child) !== undefined)
  if (node.props[COLUMN_ROW_PROP] === true) return elementsOf(node).flatMap(column => elementsOf(column).filter(child => floatOf(child) !== undefined))
  return []
})

/** `node` placed after `placed`, with its top in the stack (`start` on an empty area). */
const stackedAfter = (placed: readonly MeasuredNode[], expected: Expected, start: number): { at: number, before: boolean } => {
  const last = placed.findLast(node => !isAbsolute(node))
  return last === undefined
    ? { at: start, before: false }
    : { at: (expected.get(last) ?? start) - shiftOf(last) + last.box.height + marginBottom(last), before: true }
}

/** How a column container's list is filled: its bottom floats go to the area end only when it has a height, or goes on. */
interface ContainerFill { bottomsAtEnd: boolean }

/** A box with a `height`: its bottom floats go to its bottom. With `maxHeight` alone it is as high as its content, and they go right below it. */
const hasHeight = (node: MeasuredNode): boolean => node.style.height !== undefined && node.style.height !== null

/**
 * `fill` over a reference list with floats. The list itself goes to `fill`
 * when it holds none, so a document without floats lays out as before.
 * `container` is set for the children of a column container.
 */
const fillArea = (nodes: MeasuredNode[], start: number, context: Context, pageHasContent: boolean, gap: number, repeat = false, justify?: unknown, room?: number, container?: ContainerFill): Parts => {
  if (!nodes.some(node => floatOf(node) !== undefined)) return fill(nodes, start, context, pageHasContent, gap, repeat, justify, room)
  const lead = nodes.findIndex(inFlowNode)
  // The fixed and absolute nodes before the first piece: a top float goes below them.
  const prefix = nodes.slice(0, lead === -1 ? nodes.length : lead)
  const flow: MeasuredNode[] = []
  // Each float, its side, the anchor units before it (its anchor), and whether it is queued: before every flow piece of this area.
  // A container tries each of its floats with a fill, since its columns decide whether an earlier column float is placed.
  const floats: { node: MeasuredNode, side: FloatSide, anchor: number, queued: boolean }[] = []
  let pieces = 0
  for (const node of nodes.slice(prefix.length)) {
    const side = floatOf(node)
    if (side === undefined) {
      flow.push(node)
      if (flowPiece(node)) pieces += unitsOf(node)
    }
    else floats.push({ node, side, anchor: pieces, queued: container === undefined && pieces === 0 })
  }
  const filledFlow = container === undefined ? flow : joinedSegments(flow)
  const tops: MeasuredNode[] = []
  const bottoms: MeasuredNode[] = []
  const below = (list: readonly MeasuredNode[]) => sum(list.map(node => gap + extentOf(node)))
  const topEnd = (list: readonly MeasuredNode[]) => {
    let y = start
    let before = false
    for (const node of [...prefix, ...list]) {
      if (isAbsolute(node)) continue
      y += (before ? gap : 0) + extentOf(node)
      before = true
    }
    return y
  }
  /** How far the area falls short of holding the floats, 0 when they fit. */
  const shortBy = (topList: readonly MeasuredNode[], bottomList: readonly MeasuredNode[]) => Math.max(0, topEnd(topList) - (context.end - below(bottomList)))
  // A container's gate for its columns (the shared queue), per side.
  const gate: Record<FloatSide, number> = { top: Number.POSITIVE_INFINITY, bottom: Number.POSITIVE_INFINITY }
  const attempt = (): AreaFill => {
    const lower = below(bottoms)
    const found: Found = { ...context.found, warnings: [], keepBreaks: new Set(context.found.keepBreaks), keepIgnored: new Set(context.found.keepIgnored) }
    const sub: Context = { ...context, end: context.end - lower, found, expected: new Map(), moving: undefined, ...(context.goOn ? { goOn: new Set(context.goOn) } : {}), ...(container ? { gate: { ...gate } } : {}) }
    const holdsFloats = tops.length + bottoms.length > 0
    const [current, next] = fill([...prefix, ...tops, ...filledFlow], start, sub, pageHasContent || holdsFloats, gap, repeat, justify, room)
    // The fill ran to the end above the bottom floats: an end it names is that much lower than the area's.
    if (found.nextEnd !== undefined) found.nextEnd += lower
    return { current, next, sub, cut: pieces - unitsIn(next) }
  }
  // The ends at which this area would place a float it could not: a balance or a note fit steps there.
  const needs: number[] = []
  // A float that cannot go here queues, and every later float of its side queues behind it.
  const blocked = new Set<FloatSide>()
  const queued: MeasuredNode[] = []
  const queue = (node: MeasuredNode, side: FloatSide, needed?: number) => {
    blocked.add(side)
    queued.push(node)
    if (needed !== undefined) needs.push(needed)
  }
  // In a column of a container with spanning floats: a float its container's gate holds back waits for the next page.
  const gated = (node: MeasuredNode, side: FloatSide) => context.gate !== undefined && floatOrderOf(node) > context.gate[side]
  // A float the note fit keeps off this page waits, as one that does not fit.
  const kept = (node: MeasuredNode) => context.only !== undefined && !context.only.has(floatOrderOf(node))
  for (const { node, side } of floats.filter(entry => entry.queued)) {
    const short = shortBy(side === 'top' ? [...tops, node] : tops, side === 'bottom' ? [...bottoms, node] : bottoms)
    if (gated(node, side) || kept(node)) queue(node, side)
    else if (blocked.has(side) || short > EPS) queue(node, side, context.end + Math.max(short, EPS))
    else (side === 'top' ? tops : bottoms).push(node)
  }
  let filled = attempt()
  /** A spanning float that cannot go on this page: it queues, and its columns place no later float of its side here. */
  const holdBack = (node: MeasuredNode, side: FloatSide, needed?: number) => {
    queue(node, side, needed)
    gate[side] = Math.min(gate[side], floatOrderOf(node))
    countWork('floatFills')
    filled = attempt()
  }
  // The floats whose anchor this area does not reach stay at their places in the flow.
  const unreached: { node: MeasuredNode, anchor: number }[] = []
  for (const { node, side, anchor, queued: atStart } of floats) {
    if (atStart) continue
    if (anchor > filled.cut) {
      unreached.push({ node, anchor })
      continue
    }
    if (blocked.has(side) || gated(node, side)) {
      queue(node, side)
      continue
    }
    if (kept(node)) {
      if (container) holdBack(node, side)
      else queue(node, side)
      continue
    }
    const order = container ? floatOrderOf(node) : 0
    // A spanning top float prints above the column top floats of its page: an earlier one not placed before this page holds it back.
    if (container && side === 'top' && columnFloatsIn(nodes).some(other => floatOf(other) === 'top' && floatOrderOf(other) < order)) {
      holdBack(node, side)
      continue
    }
    const short = shortBy(side === 'top' ? [...tops, node] : tops, side === 'bottom' ? [...bottoms, node] : bottoms)
    if (short > EPS) {
      if (container) holdBack(node, side, context.end + short)
      else queue(node, side, context.end + short)
      continue
    }
    countWork('floatFills')
    const list = side === 'top' ? tops : bottoms
    list.push(node)
    // A spanning bottom float prints below the column bottom floats of its page: no later one goes on this page.
    if (container && side === 'bottom') gate.bottom = Math.min(gate.bottom, order)
    const tried = attempt()
    // It stays when the area still reaches its anchor and nothing new is cut at the area end, and when no
    // column bottom float earlier than a spanning bottom float placed here now waits for a later page
    // (a spanning float it pushes out of its column would print after a later spanning bottom float).
    const waits = container !== undefined && columnFloatsIn(tried.next).some(other => floatOf(other) === 'bottom' && bottoms.some(placed => floatOrderOf(other) < floatOrderOf(placed)))
    if (anchor <= tried.cut && !waits && !(tried.sub.found.overflows && !filled.sub.found.overflows)) {
      filled = tried
      continue
    }
    list.pop()
    const needed = waits ? undefined : tried.sub.found.nextEnd ?? context.end + extentOf(node)
    if (container) holdBack(node, side, needed)
    else queue(node, side, needed)
  }
  // The fill that stands, as if it were this fill.
  const { found } = context
  const { sub } = filled
  found.warnings.push(...sub.found.warnings)
  for (const node of sub.found.keepBreaks) found.keepBreaks.add(node)
  for (const node of sub.found.keepIgnored) found.keepIgnored.add(node)
  Object.assign(found, { forced: sub.found.forced, kind: sub.found.kind, overflows: sub.found.overflows, nextEnd: sub.found.nextEnd, bottom: sub.found.bottom, reach: sub.found.reach })
  for (const end of needs) need(found, end)
  for (const [node, at] of sub.expected) context.expected.set(node, at)
  context.moving = sub.moving
  if (sub.goOn) context.goOn = sub.goOn
  // The bottom floats after the flow: the first takes the room left as its top margin, so the last ends at
  // the area end. A container's part that ends here ends with them, right below its flow; a part that goes
  // on, with flow or with a float that waits, ends at the area end.
  const current = [...filled.current]
  if (bottoms.length > 0) {
    const atEnd = container === undefined || container.bottomsAtEnd || queued.length > 0 || filled.next.some(flowPiece)
    const { at, before } = stackedAfter(current, context.expected, start)
    let y = at + (before ? gap : 0)
    const free = atEnd ? Math.max(0, context.end - y - sum(bottoms.map(extentOf)) - gap * (bottoms.length - 1)) : 0
    bottoms.forEach((original, index) => {
      const node = index === 0 && free > EPS ? { ...original, style: { ...original.style, marginTop: marginTop(original) + free }, box: { ...original.box, marginTop: marginTop(original) + free } } : original
      y += (index > 0 ? gap : 0) + marginTop(node)
      context.expected.set(node, y + shiftOf(node))
      recordReach(found, node, y)
      current.push(node)
      y += node.box.height + marginBottom(node)
    })
  }
  // The next area: the queued floats first (after its fixed nodes at the top), then the flow with the unreached floats at their places.
  const next = [...filled.next]
  // From the last back, each right after the anchor unit before it, which may cut a segment in two:
  // floats with one anchor keep their order.
  for (const { node, anchor } of unreached.reverse()) {
    let ahead = anchor - filled.cut
    let at = next.length
    for (const [index, piece] of next.entries()) {
      if (!flowPiece(piece)) continue
      const units = unitsOf(piece)
      if (ahead > units) {
        ahead -= units
        continue
      }
      if (ahead < units) next.splice(index, 1, ...segmentAt(piece, ahead))
      at = index + 1
      break
    }
    next.splice(at, 0, node)
  }
  const head = next.findIndex(inFlowNode)
  next.splice(head === -1 ? next.length : head, 0, ...queued)
  return [current, next]
}

// ---------------------------------------------------------------------------
// Footnotes. A note is an attachment of the line that holds its mark: a page
// holds the flow and the notes of its marks, so the flow ends where the notes
// leave room. Each try is a fill to a height; its end is the fill's sum. Phase
// 1 goes down to the page end minus the notes of what stays; phase 2 goes up
// to the next height at which the fill takes more (`nextEnd`), while the notes
// fit. The area, carried and moved notes and rule 11 are in notes.ts.

interface Filled {
  height: number
  current: MeasuredNode[]
  next: MeasuredNode[]
  found: Found
  context: Context
}

interface NoteTry extends Filled, ChosenSplit {}
type Placed = ReturnType<typeof placeNotes>

const fitNotes = (book: NoteBook, fillTo: (height: number, only?: ReadonlySet<number>) => Filled, end: number, contentTop: number, flow: MeasuredNode[]): NoteTry & { fit: Placed } => {
  let tries = 0
  const attempt = (height: number, only?: ReadonlySet<number>): NoteTry => {
    // A page without footnotes is one fill too: each try after the first is the fit's own work.
    if (tries++ > 0) countWork('noteFits')
    const filled = fillTo(height, only)
    const bottom = filled.found.bottom ?? contentTop
    const references = referencesIn(filled.current, book)
    return {
      ...filled,
      end: bottom,
      margin: Math.max(0, (filled.found.reach ?? bottom) - bottom),
      references,
      fits: bottom + notesNeed(book, references) <= end + EPS,
      takesFlow: filled.current.some(placesFlow),
    }
  }
  // Up from a try that fits while the next height that takes more still fits; below `above`, which failed.
  const up = (fitting: NoteTry, above: number): NoteTry => {
    let best = fitting
    for (;;) {
      const height = best.found.nextEnd
      if (height === undefined || height <= best.height + EPS || height >= above - EPS) return best
      const tried = attempt(height)
      if (!tried.fits) return best
      best = tried
    }
  }
  let chosen = attempt(end - notesNeed(book, []))
  const highest = chosen
  let failed: NoteTry | undefined
  while (!chosen.fits) {
    const lower = end - notesNeed(book, chosen.references)
    if (lower >= chosen.height - EPS) break
    failed = chosen
    chosen = attempt(lower)
  }
  if (chosen.fits && failed !== undefined) chosen = up(chosen, failed.height)
  // Rule 11: from the content top, the first height that takes flow and fits; else the one that takes flow and ends highest.
  const placesNothing = !chosen.takesFlow && book.carried.length === 0 && flow.length > 0
  if (!chosen.fits || placesNothing) {
    let least = placesNothing ? undefined : chosen
    for (let height: number | undefined = contentTop; height !== undefined;) {
      const tried = attempt(height)
      const after = tried.found.nextEnd ?? end
      height = tried.height >= end - EPS || after <= tried.height + EPS ? undefined : Math.min(end, after)
      if (!tried.takesFlow) continue
      if (tried.fits) {
        least = up(tried, highest.height)
        break
      }
      if (least === undefined || tried.end < least.end) least = tried
      if (tried.end <= tried.height + EPS) break
    }
    if (least !== undefined) chosen = least
  }
  // A float that came with a note that did not fit made the fit end the flow above the room the notes leave.
  // Filled to that room with only the floats that fit with their notes, the page holds more flow, and its
  // bottom floats reach its end. Without floats nothing is dropped, and nothing changes.
  const room = end - notesNeed(book, chosen.references)
  let only: ReadonlySet<number> | undefined
  if (chosen.fits && failed !== undefined && chosen.height < room - EPS) {
    const placed = floatOrdersIn(chosen.current)
    if ([...floatOrdersIn(failed.current)].some(order => !placed.has(order))) {
      const again = attempt(room, placed)
      if (again.fits) {
        chosen = again
        only = placed
      }
    }
  }
  // Places the notes and carries the rest in the book: once, for the fill that stands.
  const fit = placeNotes(book, chosen, end, contentTop)
  // The flow's room ends at the area top, which can be above the height the fill went to. Filled to
  // that end, a part split there keeps the rest of its height for the next page. Used when it places
  // the same content; the keep rules can make a lower end place less, and then the parts are clamped.
  if (chosen.height > fit.flowEnd + EPS) {
    const again = fillTo(fit.flowEnd, only)
    if (again.next.length === chosen.next.length && Math.abs((again.found.bottom ?? contentTop) - chosen.end) <= EPS && piecesIn(again.current) === piecesIn(chosen.current)) {
      return { ...chosen, ...again, fit }
    }
  }
  return { ...chosen, fit }
}

/** The order numbers of the floats a fill placed (`FLOAT_ORDER_PROP`). */
const floatOrdersIn = (nodes: readonly MeasuredNode[]): Set<number> => {
  const orders = new Set<number>()
  const walk = (node: MeasuredNode) => {
    if (floatOf(node) !== undefined) orders.add(floatOrderOf(node))
    else if (!isText(node)) elementsOf(node).forEach(walk)
  }
  nodes.forEach(walk)
  return orders
}

/** The lines and boxes a part holds, to compare two fills of one page. */
const piecesIn = (nodes: MeasuredNode[]): number => nodes.reduce((total, node) => total + (isText(node) ? node.lines!.length : elementsOf(node).length === 0 ? 1 : piecesIn(elementsOf(node))), 0)

/**
 * The pieces of a page whose flow room ends at `limit` (above the fill's end,
 * where the note area starts): a part that a split made fills the room down to
 * the fill's end, so it reaches below `limit`, and now fills the room to it.
 * Nothing else reaches below it: the fit counted every line and box.
 */
const clampedTo = (nodes: MeasuredNode[], expected: Expected, limit: number): MeasuredNode[] => nodes.map((node) => {
  const top = expected.get(node)
  if (top === undefined || isText(node) || top + node.box.height <= limit + EPS) return node
  const height = Math.max(0, limit - top)
  const minHeight = node.style.minHeight as number | undefined
  const clamped: MeasuredNode = {
    ...node,
    style: { ...node.style, height, ...(minHeight === undefined ? {} : { minHeight: Math.min(minHeight, height) }) },
    box: { ...node.box, height },
    children: node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : clampedTo([child], expected, limit)[0]!),
  }
  expected.set(clamped, top)
  return clamped
})

/** Moves a placed node and every placed node inside it by `by`. */
const moveTops = (node: MeasuredNode, by: number, expected: Expected) => {
  const top = expected.get(node)
  if (top !== undefined) expected.set(node, top + by)
  if (!isText(node)) for (const child of elementsOf(node)) moveTops(child, by, expected)
}

/**
 * A column with a height that wraps lays its children out in lines of that height. Higher than a page, it
 * would split, and each part would wrap its own share into other lines: no part shows the box's layout.
 */
const wrappingBoxError = (node: MeasuredNode, area: number): NuxtPdfError => {
  const source = parsePdfSourcePosition(node.source)
  const where = source ? ` at ${source.file}:${source.line}:${source.column}` : ''
  const points = (value: number) => Math.round(value * 100) / 100
  return new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `A <${PDF_PRIMITIVE_NAMES[node.type] ?? node.type}>${where} with flexWrap "${String(node.style.flexWrap)}" is ${points(node.box.height)} pt high, more than the ${points(area)} pt a page holds, so it would break across pages and wrap its children into other lines on each. `
    + 'Give it a height that fits on a page, or remove its height and maxHeight so it breaks as a column, or put the children in a <PdfView> with flexDirection "row" and flexWrap.',
  )
}

/**
 * A `fixed` node repeats on every page of its parent, but an item of a wrapping row has no place of its own
 * on the next page: repeated there, it would wrap the row's other items into other lines.
 */
const fixedItemError = (row: MeasuredNode, item: MeasuredNode): NuxtPdfError => {
  const source = parsePdfSourcePosition(item.source)
  const where = source ? ` at ${source.file}:${source.line}:${source.column}` : ''
  return new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `A fixed <${PDF_PRIMITIVE_NAMES[item.type] ?? item.type}>${where} is an item of a <${PDF_PRIMITIVE_NAMES[row.type] ?? row.type}> with flexWrap "${String(fromFlexLines(row).style.flexWrap)}" that breaks across pages. `
    + 'Repeated on the next page, it would wrap the other items into other lines. Put the fixed node before the row, in a <PdfView> that holds both, or remove its fixed prop.',
  )
}

/** The room `justifyContent` puts before the first of `count` children and between two, with `free` room left. */
const justifiedSpacing = (justify: unknown, free: number, count: number): { lead: number, gap: number } => {
  if (free <= EPS || count === 0) return { lead: 0, gap: 0 }
  if (justify === 'flex-end') return { lead: free, gap: 0 }
  if (justify === 'center') return { lead: free / 2, gap: 0 }
  if (justify === 'space-between') return { lead: 0, gap: count > 1 ? free / (count - 1) : 0 }
  if (justify === 'space-around') return { lead: free / count / 2, gap: free / count }
  if (justify === 'space-evenly') return { lead: free / (count + 1), gap: free / (count + 1) }
  return { lead: 0, gap: 0 }
}

/**
 * The shares of `free` room the grown children take, by their `flexGrow`
 * factors, as yoga resolves them: a child that its `maxHeight` stops keeps
 * that height, and the others share the rest.
 */
const grownShares = (flow: MeasuredNode[], free: number): number[] => {
  const grows = flow.map(child => Math.max(0, Number(child.style.flexGrow ?? 0)))
  const caps = flow.map(child => typeof child.style.maxHeight === 'number' ? Math.max(0, child.style.maxHeight - child.box.height) : Number.POSITIVE_INFINITY)
  const shares = flow.map(() => 0)
  let open = grows.flatMap((grow, index) => grow > 0 ? [index] : [])
  let left = free
  while (open.length > 0 && left > EPS) {
    const total = sum(open.map(index => grows[index]!))
    const stopped = open.filter(index => shares[index]! + left * grows[index]! / total > caps[index]!)
    if (stopped.length === 0) {
      for (const index of open) shares[index]! += left * grows[index]! / total
      break
    }
    for (const index of stopped) {
      left -= caps[index]! - shares[index]!
      shares[index] = caps[index]!
    }
    open = open.filter(index => !stopped.includes(index))
  }
  return shares
}

/**
 * The free room of a column part, as yoga hands it out once the fill has
 * chosen what the part holds: the room between its last child and its content
 * bottom goes to the children with `flexGrow`, by their factors, and what is
 * left to the spacing `justifyContent` asks for. The fill does not change:
 * both only use room that is left. Then the same inside each child: a part a
 * split made reaches the page end, a grown child gets its share, and a cell
 * is as high as its row. A child the fill did not place one by one (inside a
 * container placed whole) stands where the stack of its siblings puts it.
 */
const spread = (children: MeasuredNode[], style: MeasuredNode['style'], contentTop: number, contentBottom: number, expected: Expected) => {
  const flow = children.filter(child => !isAbsolute(child))
  if (flow.length === 0) return
  const gap = Number(style.rowGap ?? 0)
  const tops: number[] = []
  let at = contentTop
  flow.forEach((child, index) => {
    const top = at + (index > 0 ? gap : 0) + marginTop(child)
    tops.push(top)
    at = top + child.box.height + marginBottom(child)
  })
  const free = contentBottom - at
  const shares = free > EPS ? grownShares(flow, free) : flow.map(() => 0)
  // What the grown children leave goes to the auto margins, in equal parts; with any, justifyContent has none.
  const autos = flow.map(autoMarginsOf)
  const autoCount = sum(autos.map(([top, bottom]) => Number(top) + Number(bottom)))
  const autoShare = autoCount > 0 && free - sum(shares) > EPS ? (free - sum(shares)) / autoCount : 0
  const spacing = autoCount > 0 ? { lead: 0, gap: 0 } : justifiedSpacing(style.justifyContent, free - sum(shares), flow.length)
  if (shares.some(share => share > 0) || autoShare > 0 || !(unset(style.justifyContent) || style.justifyContent === 'flex-start')) {
    let grown = 0
    flow.forEach((child, index) => {
      // The fill placed it by the whole layout, or stacked it without the spacing; one placed inside a
      // container placed whole stands at its stacked top. It moves to its place in this part.
      const placed = expected.get(child)
      const from = placed === undefined ? tops[index]! : placed - shiftOf(child)
      const [autoTop, autoBottom] = autos[index]!
      if (autoTop) grown += autoShare
      tops[index]! += grown + spacing.lead + index * spacing.gap
      grown += shares[index]! + (autoBottom ? autoShare : 0)
      if (tops[index] !== from) moveTops(child, tops[index]! - from, expected)
    })
  }
  else {
    // Nothing moves here: the fill's tops stand (a child it lifted or that lost its margin at the page end included).
    flow.forEach((child, index) => {
      const placed = expected.get(child)
      if (placed !== undefined) tops[index] = placed - shiftOf(child)
    })
  }
  flow.forEach((child, index) => {
    if (isText(child) || BOX_TYPES.has(child.type)) return
    const top = tops[index]!
    const bottom = top + child.box.height + shares[index]! - edgesBottom(child)
    if (isRow(child)) {
      // A cell stretches to its row part's height, or the part aligns it there (as high as what it holds).
      const content = bottom - top - edgesTop(child)
      for (const cell of elementsOf(child)) {
        if (isAbsolute(cell) || isFixed(cell)) continue
        const cellTop = top + edgesTop(child) + marginTop(cell) + alignedOffset(cell, child, content)
        const placed = expected.get(cell)
        if (placed !== undefined && placed - shiftOf(cell) !== cellTop) moveTops(cell, cellTop - (placed - shiftOf(cell)), expected)
        if (isText(cell) || BOX_TYPES.has(cell.type)) continue
        const cellBottom = alignOf(cell, child) === 'stretch' ? bottom - marginBottom(cell) : cellTop + cell.box.height
        spread(elementsOf(cell), cell.style, cellTop + edgesTop(cell), cellBottom - edgesBottom(cell), expected)
      }
      return
    }
    // The columns of a segment stand side by side: yoga fills them, the fill placed them.
    if (child.style.flexDirection === 'row') return
    spread(elementsOf(child), child.style, top + edgesTop(child), bottom, expected)
  })
}

/** A page with its note area: the flow's content area ends where the area starts. */
const withNotes = (page: MeasuredNode, props: MeasuredNode['props'], pageHeight: number, fit: Placed, current: MeasuredNode[], notesArea: ReturnType<typeof noteAreaOf>[]) => {
  const innerBottom = pageHeight - (page.box.borderBottomWidth ?? 0)
  const contentProps = fit.shrinks ? props : { ...props, [CONTENT_BOTTOM_PROP]: innerBottom - getPadding(page).paddingBottom }
  const moved = fit.moved.flatMap(note => typeof note.props[NOTE_NUMBER_PROP] === 'number' ? [{ number: note.props[NOTE_NUMBER_PROP], source: note.source }] : [])
  return {
    ...page,
    style: { ...page.style, paddingBottom: innerBottom - fit.flowEnd },
    props: moved.length > 0 ? { ...contentProps, [NOTES_MOVED_PROP]: moved } : contentProps,
    box: { ...page.box, height: pageHeight },
    children: [...current, ...notesArea],
  }
}

// ---------------------------------------------------------------------------
// Pages, and the check.

/** Compares every placed piece's top in the laid-out page with the sum; the largest difference. */
const differenceOf = (built: MeasuredNode[], laidOut: MeasuredNode['children'], parentTop: number, expected: Expected, inRow = false): number => {
  let largest = 0
  built.forEach((node, index) => {
    const twin = laidOut[index]
    if (twin === undefined || twin.type === PDF_PRIMITIVES.TextInstance) return
    const top = parentTop + (twin.box?.top ?? 0)
    const want = expected.get(node)
    if (want !== undefined) {
      largest = Math.max(largest, Math.abs(top - want))
      // A piece placed whole keeps its measured height; a row's child takes the row's height.
      if (!inRow && node.box.height !== undefined && !isText(node) && elementsOf(node).length === 0 && !(Number(node.style.flexGrow ?? 0) > 0)) largest = Math.max(largest, Math.abs((twin.box?.height ?? 0) - node.box.height))
    }
    if (!isText(node)) largest = Math.max(largest, differenceOf(elementsOf(node), elementsOf(twin as MeasuredNode), top, expected, isRow(node)))
  })
  return largest
}

/**
 * How far the summed boxes of a page's nodes reach below `limit`, the end of its content area (an absolute node
 * takes no room). Yoga squeezes a page whose content is higher than the page, and the layout can agree with the
 * sums then (a node placed whole keeps no sums for its children), so the tops alone do not show it.
 */
const belowOf = (nodes: MeasuredNode[], expected: Expected, limit: number): number =>
  nodes.reduce((lowest, node) => {
    const top = expected.get(node)
    return top === undefined || isAbsolute(node) ? lowest : Math.max(lowest, top + (node.box.height ?? 0) - limit)
  }, 0)

/** The largest difference between the tops of two layouts of one page, its flow children only. */
const sameTops = (before: MeasuredNode, after: MeasuredNode): number => {
  const flow = (node: MeasuredNode) => elementsOf(node).filter(child => !isFixed(child))
  const walk = (a: MeasuredNode[], b: MeasuredNode[]): number => a.reduce((largest, node, index) => {
    const twin = b[index]
    if (twin === undefined) return Number.POSITIVE_INFINITY
    return Math.max(largest, Math.abs(node.box.top - twin.box.top), isText(node) ? 0 : walk(elementsOf(node), elementsOf(twin)))
  }, 0)
  return walk(flow(before), flow(after))
}

/**
 * A page whose layout differs from the builder's sums, whose flow ends below its content area, or a page
 * number wider than its reserved room: a bug in the builder. Every render fails with it, in production too: no other pagination exists.
 */
const builderBug = (page: number, difference: number | string): NuxtPdfError => new NuxtPdfError(
  PDF_ERROR_CODES.RenderError,
  `${typeof difference === 'number' ? `Page builder: the layout of page ${page} differs from the builder's sums by ${difference} pt.` : `Page builder: page ${page} cannot be painted: ${difference}.`} `
  + 'This is a bug in Nuxt PDF; please report it with the template: https://github.com/lupinum-dev/nuxt-pdf/issues',
)

/** Whether a page holds a page number or count laid out in reserved digits. */
const holdsReserve = (node: MeasuredNode): boolean => RESERVED_DIGITS_PROP in node.props || (!isText(node) && elementsOf(node).some(holdsReserve))

/**
 * A page with `wrap={false}`: one page that grows to hold its content (the
 * natural-height layouts of layout-diagnostics.ts and plain-tree.ts are made
 * of such pages). Its column containers are balanced over all their content,
 * and its per-page values are known once its flow is read: it is laid out
 * with them, page numbers in their reserved digits, and grows to hold them.
 */
const wholePage = (page: MeasuredNode, notes: boolean, running: ReturnType<typeof createRunningValues>, { pageNumber, reserve }: { pageNumber: number, reserve: number }, relayout: Relayout): MeasuredNode => {
  if (notes) throw new NuxtPdfError(PDF_ERROR_CODES.LayoutError, 'A page with wrap={false} or an automatic height cannot hold footnotes yet. Give the page a fixed size and let it wrap, or move the footnotes to a page that does.')
  const decided = wholeCarriers(page)
  running.enter(pageNumber, decided.children)
  running.leave(decided.children)
  const found: Found = { forced: false, warnings: [], keepBreaks: new Set(), keepIgnored: new Set(), chains: new WeakMap(), area: Number.POSITIVE_INFINITY }
  const context: Context = { end: Number.POSITIVE_INFINITY, found, expected: new Map(), liftTo: Number.NEGATIVE_INFINITY, movedWhole: undefined }
  const balanced = withBalanced(decided, 0, context, false)
  if (hasDynamicNodes(balanced)) return relayout(resolveDynamicNodes({ ...running.of(pageNumber), reserve }, { ...balanced, box: withoutHeight(balanced.box) }))
  return balanced === page ? page : relayout({ ...balanced, box: withoutHeight(balanced.box) })
}

/**
 * The carriers of a page that is the first and the last part of its PdfPage,
 * and of everything in it, decided before its layout: a `pages="first"` node
 * shows, a `"continuation"` node is left out (it takes room only where it
 * shows, decision 1), a `"not-last"` node keeps its room and paints nothing.
 * Their `render` goes, so the paint with the total cannot decide again.
 */
const wholeCarriers = (node: MeasuredNode): MeasuredNode => {
  if (isText(node) || !elementsOf(node).some(child => holdsCarrier(child))) return node
  return {
    ...node,
    children: node.children.flatMap((child): MeasuredNode['children'] => {
      if (child.type === PDF_PRIMITIVES.TextInstance) return [child]
      const pages = pagesOf(child)
      if (pages === 'continuation') return []
      if (pages === undefined) return [wholeCarriers(child)]
      const { render: _render, ...props } = child.props
      const shown = { ...child, props }
      return [pages === 'not-last' ? emptied(shown) : wholeCarriers(shown)]
    }),
  }
}

/**
 * The digits of the page count a document is likely to reach: the flow of each
 * of its pages over the room its fixed nodes leave. An estimate too low costs a
 * second pagination (`build`).
 */
const estimatedDigits = (root: MeasuredDocument): number => String(root.children.reduce((total, page) => {
  if (page.props.wrap === false) return total + 1
  const children = elementsOf(page)
  const extent = (node: MeasuredNode) => marginTop(node) + node.box.height + marginBottom(node)
  const room = contentAreaOf(page) - sum(children.filter(isFixed).map(extent))
  return total + Math.max(1, Math.ceil(sum(children.filter(node => !isFixed(node)).map(extent)) / Math.max(room, 1)))
}, 0)).length

/** The pages of a measured document, built over measured heights. */
export const buildPagination = (measured: MeasuredDocument, relayout: Relayout): MeasuredDocument => {
  const root: MeasuredDocument = { ...measured, children: measured.children.map(page => ({ ...page, ...inDrawingOrder(insetsInPoints(page, true)) })) }
  const endValues = endValuesOf(root)
  /** The pages with `reserve` digits for page tokens, painted on demand, and the digits their total needs. */
  const paginate = (reserve: number): Paged<() => MeasuredNode[]> => {
    const pages: MeasuredNode[] = []
    const subPages: { subPageNumber: number, subPageTotalPages: number }[] = []
    const running = createRunningValues()
    const chains = new WeakMap<MeasuredNode, MeasuredNode>()
    const warnedChains = new Set<MeasuredNode>()
    for (const { notes, noteArea, ...source } of root.children) {
      const firstPage = pages.length
      if (source.props.wrap === false) {
        pages.push(wholePage(source, noteBookOf(notes, noteArea) !== undefined, running, { pageNumber: pages.length + 1, reserve }, relayout))
        subPages.push({ subPageNumber: 1, subPageTotalPages: 1 })
        continue
      }
      // Sized when its flow holds a per-page value or a carrier, whose container holds it back (`heldCarried`).
      const page = elementsOf(source).some(node => !isFixed(node) && (hasDynamicNodes(node) || holdsCarrier(node))) ? sized(source, firstPage + 1, reserve, relayout, endValues) : source
      const end = wrapAreaOf(page)
      const area = contentAreaOf(page)
      const contentTop = (page.box.paddingTop ?? 0) + (page.box.borderTopWidth ?? 0)
      const pageHeight = page.style.height as number
      // The fixed nodes of the page: its head, before the flow, and its tail, after it (a footer written last).
      const fixed = elementsOf(page).filter(isFixed).map(shownCarriers)
      const head = new Set(fixed.slice(0, fixedHeadOf(page)))
      const gap = gapOf(page)
      // Each float a piece of its reference list (D49), and every float lower than the most room its area gets.
      let rest: MeasuredNode[] = hoistPageFloats(elementsOf(page).filter(node => !isFixed(node)), gap)
      checkFloatRoom([...fixed, ...rest], area, gap)
      const notLast = rest.some(holdsNotLast)
      const book = noteBookOf(notes, noteArea)
      // The fixed nodes of a page with its values: measured again only when a dynamic node can change the room
      // they take (an absolute one takes none), and kept at that height when the page shows a value known only after the fill.
      // While a page is filled its `at="end"` values are unknown: a fixed node that prints one keeps the room of
      // its highest value (`endRoom`), measured once for the head of the first page and once for the others.
      const endRooms = new Map<boolean, Map<string, number> | undefined>()
      const endRoomOf = (info: PageInfo, shown: MeasuredNode[], first: boolean): Map<string, number> | undefined => {
        if (!endRooms.has(first)) {
          const slots = shown.flatMap((node, index) => !isAbsolute(node) && printsEnd(node, info, endValues) ? [{ node, width: contentWidthOf(page), place: `/${index}` }] : [])
          endRooms.set(first, slots.length > 0 ? endRoom(slots, info, endValues, page, relayout) : undefined)
        }
        return endRooms.get(first)
      }
      const fixedOn = (info: PageInfo, first: boolean): { head: MeasuredNode[], tail: MeasuredNode[] } => {
        const shown = fixed.filter(node => showsOn(pagesOf(node), first))
        const dynamic = shown.some(node => !isAbsolute(node) && hasDynamicNodes(node))
        const heights = dynamic && info.running?.end === undefined && endValues.values.size > 0 ? endRoomOf(info, shown, first) : undefined
        const sizedShown = heights ? shown.map((node, index) => raisedTo(node, `/${index}`, heights)) : shown
        const measured = dynamic
          ? elementsOf(relayout({ ...page, box: { ...page.box, height: pageHeight }, children: sizedShown.map(node => resolveDynamicNodes(info, node)) })).map(frozen)
          : shown
        const heads = shown.filter(node => head.has(node)).length
        return { head: measured.slice(0, heads), tail: measured.slice(heads) }
      }
      let first = true
      let forced = true
      let movedWhole: MeasuredNode | undefined
      let idle = 0
      do {
        root.onPage?.()
        const info = { ...running.enter(pages.length + 1, rest), reserve }
        // A not-last fixed node reserves its room on every page of its PdfPage; the last one leaves it empty.
        const attempt = () => {
          const shown = fixedOn(info, first)
          // Absolute nodes before the page's first flow node keep their paint order: before its head.
          const lead = rest.findIndex(inFlowNode)
          const leading = rest.slice(0, lead === -1 ? rest.length : lead)
          const nodes = [...leading, ...shown.head, ...rest.slice(leading.length)]
          // The tail takes its room on every page, below the flow, when that still places flow on the
          // page (as a container's trailing fixed rows, `fillChildren`); else the flow ends at the page end.
          const tailRoom = sum(shown.tail.filter(node => !isAbsolute(node)).map(node => gap + marginTop(node) + node.box.height + marginBottom(node)))
          const fillWith = (height: number, room: number, only?: ReadonlySet<number>): Filled => {
            const found: Found = { forced: false, warnings: [], keepBreaks: new Set(), keepIgnored: new Set(), chains, area: area - room }
            const context: Context = { end: height - room, found, expected: new Map(), liftTo: forced ? Number.NEGATIVE_INFINITY : contentTop, movedWhole, restore: book !== undefined, notLast, ...(only ? { only } : {}) }
            const [placed, next] = fillArea(nodes, contentTop, context, false, gap, false, page.style.justifyContent)
            const current = [...placed, ...tailed(shown.tail, placed, context, contentTop, gap, height)]
            return { height, current, next, found, context }
          }
          const fillTo = (height: number, only?: ReadonlySet<number>): Filled => {
            const filled = fillWith(height, tailRoom, only)
            const placesHere = !filled.found.overflows && filled.current.some(child => inFlowNode(child) && placesFlow(child)) && !filled.current.some(child => child.props[SPAN_GROUP_OVERFLOW_PROP] !== undefined)
            return tailRoom > 0 && rest.length > 0 && !placesHere ? fillWith(height, 0, only) : filled
          }
          return book ? fitNotes(book, fillTo, end, contentTop, rest) : { ...fillTo(end), fit: undefined }
        }
        const filled = attempt()
        const { next, found, context, fit } = filled
        const clamped = fit && !fit.shrinks ? clampedTo(filled.current, context.expected, fit.flowEnd) : filled.current
        const current = next.length === 0 && !book?.carried.length ? unpainted(clamped, context.expected) : clamped
        running.leave(current)
        for (const warning of found.warnings) console.warn(warning)
        // Each dropped keep chain once, on the first page that drops it.
        const ignored = [...found.keepIgnored].filter(start => !warnedChains.has(start))
        for (const start of ignored) warnedChains.add(start)
        const pageProps = first ? page.props : (({ bookmark: _bookmark, ...others }) => others)(page.props)
        const props = ignored.length > 0 ? { ...pageProps, [KEEP_IGNORED_PROP]: ignored.map(start => ({ type: start.type, source: start.source })) } : pageProps
        const notesArea = book && fit?.parts.length ? [noteAreaOf(book, fit)] : []
        if (!found.overflows) spread(current, page.style, contentTop, (notesArea.length > 0 && fit ? fit.flowEnd : end) - (page.box.borderBottomWidth ?? 0), context.expected)
        // The content area from the page's box, not from the room the fill used: the flow must end inside it.
        const contentEnd = pageHeight - (page.box.paddingBottom ?? 0) - (page.box.borderBottomWidth ?? 0)
        const below = found.overflows ? 0 : belowOf(current, context.expected, Math.min(contentEnd, notesArea.length > 0 && fit ? fit.flowEnd - (page.box.borderBottomWidth ?? 0) : contentEnd))
        if (below > TOLERANCE) throw builderBug(pages.length + 1, `its flow ends ${below} pt below its content area`)
        const built = notesArea.length > 0 && fit ? withNotes(page, props, pageHeight, fit, current, notesArea) : { ...page, props, box: { ...page.box, height: pageHeight }, children: current }
        // The values of this page, the end ones included now that its flow is known; the total comes last.
        const laidOut = relayout(hasDynamicNodes(built) ? resolveDynamicNodes({ ...running.of(pages.length + 1), reserve }, built) : built)
        const difference = found.overflows ? 0 : differenceOf(current, laidOut.children, 0, context.expected)
        if (difference > TOLERANCE) throw builderBug(pages.length + 1, difference)
        pages.push(laidOut)
        idle = found.forced || next.length === 0 || current.some(placesFlow) || notesArea.length > 0 ? 0 : idle + 1
        if (next.length > 0 && idle === 2) throw paginationStuck(pages.length)
        rest = next
        first = false
        forced = found.forced
        movedWhole = context.moving
      } while (rest.length > 0 || (book?.carried.length ?? 0) > 0)
      for (let at = firstPage; at < pages.length; at += 1) subPages.push({ subPageNumber: at - firstPage + 1, subPageTotalPages: pages.length - firstPage })
    }
    // The digits the total needs, which `pagedWithReserve` compares with the reserve.
    const digits = pages.some(holdsReserve) ? String(pages.length).length : reserve
    return { digits, pages: () => painted(pages, subPages, running, reserve) }
  }
  // Every page with a dynamic node once more, now that the total is known. Its
  // flow must not move: a value known only after paging must not change a size.
  // Page numbers and counts keep their reserved digits for that layout and are
  // painted into them after it.
  const painted = (pages: MeasuredNode[], subPages: { subPageNumber: number, subPageTotalPages: number }[], running: ReturnType<typeof createRunningValues>, reserve: number): MeasuredNode[] => {
    for (const [index, page] of pages.entries()) {
      if (!hasDynamicNodes(page)) continue
      const values = running.of(index + 1, { totalPages: pages.length, ...subPages[index] })
      const laidOut = relayout(resolveDynamicNodes({ ...values, reserve }, page))
      const difference = sameTops(page, laidOut)
      if (difference > TOLERANCE) throw builderBug(index + 1, difference)
      const relabelled = relabelPageTokens(values, laidOut)
      // Bidi keeps a number's digits one range, forward or (overridden) reversed: anything else is a bug.
      if (relabelled === 'reordered') throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, `Page builder: the digits of a page number on page ${index + 1} are not one range of one line, so the number cannot be painted. This is a bug in Nuxt PDF; please report it with the template.`)
      if (relabelled === 'wider') throw builderBug(index + 1, 'its page number is wider than the room it kept')
      pages[index] = relabelled
    }
    return pages
  }
  const pages = pagedWithReserve(estimatedDigits(root), paginate)()
  return { ...measured, children: pages.map(restored) }
}

/**
 * Paginations of one document at most: the estimate, its correction, one
 * more digit from the wider numbers, and one try with fewer digits. A guard
 * against a bug: `pagedWithReserve` settles every real document before it.
 */
export const MAX_PAGINATIONS = 4

/** A pagination with page numbers and counts in `reserve` digits: its pages, and the digits its total needs (the reserve when no page shows one). */
export interface Paged<Pages> { readonly pages: Pages, readonly digits: number }

/**
 * The pages of a pagination whose total fits its reserve. A reserve
 * that is too narrow gives wrong pages: page again with the total's digits.
 * One that is too wide gives valid pages (each number is painted inside it):
 * try once with the total's digits, unless that reserve was already too
 * narrow, and keep the wider pages when the narrower ones outgrow it. So the
 * pages follow from the document alone, and the estimate costs a pagination
 * or two, never an error. Past `max` paginations, a bug fails.
 */
export const pagedWithReserve = <Pages>(estimate: number, paginate: (reserve: number) => Paged<Pages>, max = MAX_PAGINATIONS): Pages => {
  const narrow = new Set<number>()
  let wider: Pages | undefined
  let reserve = estimate
  for (let run = 1; ; run += 1) {
    const paged = paginate(reserve)
    if (paged.digits === reserve) return paged.pages
    if (paged.digits > reserve) {
      if (wider !== undefined) return wider
      narrow.add(reserve)
    }
    else {
      if (wider !== undefined || narrow.has(paged.digits)) return paged.pages
      wider = paged.pages
    }
    if (run >= max) {
      throw new NuxtPdfError(PDF_ERROR_CODES.LimitExceeded, `Page numbers did not settle after ${max} paginations: the page count had ${reserve} digits while the pages were made, and ${paged.digits} after.`)
    }
    reserve = paged.digits
  }
}
