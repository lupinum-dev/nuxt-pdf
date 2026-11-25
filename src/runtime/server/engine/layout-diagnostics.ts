// What a converged layout tells the author: unbreakable blocks higher than
// their page (`findShrinkCandidates`, `measureNaturalHeights`,
// `collectLayoutWarnings`) and in-flow `fixed` nodes that leave no room for
// the content after them (`inspectFixedFlow`).

import type { DocumentNode, SafeDocumentNode } from './layout/index'
import type { LaidOutNode } from './layout/types'
import type { PdfFontStore } from './fonts'
import { parsePdfSourcePosition, type PdfSourcePosition } from '../../shared/errors'
import {
  PDF_ELEMENTS,
  PDF_FIELD_TYPES,
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  type PdfPageFlowName,
} from '../../primitives'
import type { PdfLayoutWarning } from '../../shared/template'
import { documentPages, elementChildren, finiteNumber, layoutKey, visitPageNodes } from './laid-out'
import { TABLE_COLUMNS_NEED_PROP } from './layout/dimensions/table-columns'
import { NATURAL_PAGE_HEIGHT_PROP } from './layout/styles/page-percent'
import { CONTENT_BOTTOM_PROP, NOTES_MOVED_PROP } from './layout/paginate/notes'
import { KEEP_IGNORED_PROP } from './layout/paginate/split-keep'
import { SPAN_GROUP_OVERFLOW_PROP } from './layout/paginate/split-parts'
import { layoutPdfTree } from './layout-pass'
import { missingCodePoints } from './text/itemize'
import { lacksPatterns } from './text/hyphenation'
import type { RenderLimits } from '../render-limits'

const NON_WRAPPING_NODE_TYPES = new Set<string>([
  PDF_PRIMITIVES.Image,
  PDF_PRIMITIVES.Note,
  PDF_PRIMITIVES.Svg,
])

// Page-flow elements: the ones a page holds directly.
const WARNING_NODE_TYPES: ReadonlySet<string> = PDF_ELEMENTS[PDF_PRIMITIVES.Page].children

const roundedPoints = (value: number): number => Math.round(value * 100) / 100

const pageContentHeight = (page: LaidOutNode): number | undefined => {
  const style = page.style
  const pageHeight = finiteNumber(style?.height) ?? finiteNumber(page.box.height)
  if (pageHeight === undefined) return undefined

  const paddingTop = finiteNumber(page.box.paddingTop)
    ?? finiteNumber(style?.paddingTop)
    ?? 0
  const paddingBottom = finiteNumber(page.box.paddingBottom)
    ?? finiteNumber(style?.paddingBottom)
    ?? 0

  return pageHeight - paddingTop - paddingBottom
}

// Read on the plain tree (`toEngineDocument`) and on the laid-out tree.
type FlowNode = { type: string, props: { wrap?: unknown } }

const cannotWrap = (node: FlowNode): boolean =>
  NON_WRAPPING_NODE_TYPES.has(node.type) || node.props.wrap === false

/** A page-flow node that pagination may not split (`PdfImage`, `wrap: false`). */
export const isUnbreakableFlowNode = (node: FlowNode): boolean =>
  WARNING_NODE_TYPES.has(node.type) && cannotWrap(node)

const sourceField = (value: string | undefined): { source?: PdfSourcePosition } => {
  const source = parsePdfSourcePosition(value)
  return source ? { source } : {}
}

/** What the oversized-block check needs from a converged layout. */
interface ShrinkCandidates {
  /** Layout keys of unbreakable blocks that fill their page to the bottom. */
  keys: ReadonlySet<string>
  /** `PdfPage` layout key → laid-out page width and height. */
  pageSizes: ReadonlyMap<string, { width: number, height: number }>
}

// A block is never higher than the page in the final layout: the page builder
// only logs it, and the layout of the page at the page height lets yoga
// shrink its children to fit. A shrunk block fills the page to
// its content bottom, so only such blocks need the natural-height layout.
const BOTTOM_TOLERANCE = 0.5

/**
 * Unbreakable flow blocks whose bottom edge (with margin) reaches the content
 * bottom of their page, and the page widths for the natural-height layout.
 * The keys come from `toEngineDocument`.
 */
export const findShrinkCandidates = (layout: SafeDocumentNode): ShrinkCandidates => {
  const keys = new Set<string>()
  const pageSizes = new Map<string, { width: number, height: number }>()

  for (const page of documentPages(layout)) {
    const pageKey = layoutKey(page)
    const width = finiteNumber(page.box.width)
    const height = finiteNumber(page.box.height)
    if (pageKey !== undefined && width !== undefined && height !== undefined && !pageSizes.has(pageKey)) {
      pageSizes.set(pageKey, { width, height })
    }
    const availableHeight = pageContentHeight(page)
    const paddingTop = finiteNumber(page.box.paddingTop) ?? 0
    if (availableHeight === undefined || availableHeight <= 0) continue
    // A page with notes: its own content bottom, not the top of its notes. A
    // block that ends at the notes, or whose bottom margin reaches into them,
    // fits; a shrunk block fills the page to its own bottom (the fit gives
    // the flow all of it when a block is higher than the room).
    const contentBottom = (finiteNumber(page.props[CONTENT_BOTTOM_PROP]) ?? paddingTop + availableHeight) - BOTTOM_TOLERANCE

    // Yoga places a box relative to its parent's box. An absolute node is not
    // in the flow: pagination never shrinks it, its page clips it.
    const visit = (node: LaidOutNode, parentTop: number): void => {
      if (node.props.fixed === true || isAbsoluteNode(node)) return
      const top = parentTop + (finiteNumber(node.box.top) ?? 0)
      const height = finiteNumber(node.box.height) ?? 0
      const key = layoutKey(node)
      if (isUnbreakableFlowNode(node) && key !== undefined) {
        const bottom = top + height + (finiteNumber(node.box.marginBottom) ?? 0)
        if (bottom >= contentBottom) keys.add(key)
        return
      }
      for (const child of elementChildren(node)) visit(child, top)
    }
    for (const child of elementChildren(page)) visit(child, 0)
  }

  return { keys, pageSizes }
}

/**
 * Lay the document out once more with every `PdfPage` as one page of its laid
 * out width and automatic height, so nothing is shrunk to a page, and read the
 * height of each candidate. Used for diagnostics only; the PDF comes from the
 * converged layout. The pages leave their footnotes out: a page of automatic
 * height has no bottom to hold them (pagination rejects that), and a block's
 * natural height does not depend on them.
 */
export const measureNaturalHeights = async (
  document: DocumentNode,
  candidates: ShrinkCandidates,
  fontStore: PdfFontStore,
  limits?: RenderLimits,
): Promise<Map<string, number>> => {
  const tall: DocumentNode = {
    ...document,
    children: document.children.map((child) => {
      const pageKey = layoutKey(child)
      const size = pageKey === undefined ? undefined : candidates.pageSizes.get(pageKey)
      if (size === undefined) return child
      // A size without a height leaves the page height automatic; the width
      // is already the oriented one. Percentages keep the page's height.
      const { notes: _notes, noteArea: _noteArea, ...page } = child
      const { orientation: _orientation, ...props } = page.props
      return { ...page, props: { ...props, size: { width: size.width }, wrap: false, [NATURAL_PAGE_HEIGHT_PROP]: size.height } }
    }),
  }

  const layout = await layoutPdfTree(tall, fontStore, limits)
  const heights = new Map<string, number>()
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      const key = layoutKey(node)
      const height = finiteNumber(node.box?.height)
      if (key !== undefined && height !== undefined && candidates.keys.has(key) && !heights.has(key)) {
        heights.set(key, height)
      }
    })
  }
  return heights
}

/** The width a laid-out view gives its children: its box less its horizontal paddings and borders. */
const contentWidth = (node: LaidOutNode): number => (finiteNumber(node.box.width) ?? 0)
  - (finiteNumber(node.box.paddingLeft) ?? 0) - (finiteNumber(node.box.paddingRight) ?? 0)
  - (finiteNumber(node.box.borderLeftWidth) ?? 0) - (finiteNumber(node.box.borderRightWidth) ?? 0)

/**
 * What pagination set on rows that cells over several rows hold together and
 * that stay cut (`SPAN_GROUP_OVERFLOW_PROP`): the heights on the first row,
 * `true` on the others; the heights on a block that cannot split and stays
 * cut below the fixed nodes that repeat in its container; undefined on any
 * other node.
 */
const spanGroupOverflow = (node: LaidOutNode): { nodeHeight: number, availableHeight: number } | true | undefined => {
  const value: unknown = node.props[SPAN_GROUP_OVERFLOW_PROP]
  if (value === true) return true
  if (typeof value !== 'object' || value === null || !('nodeHeight' in value) || !('availableHeight' in value)) return undefined
  const { nodeHeight, availableHeight } = value
  return typeof nodeHeight === 'number' && typeof availableHeight === 'number' ? { nodeHeight, availableHeight } : undefined
}

/** The keep chains the page builder dropped on a page (`KEEP_IGNORED_PROP`): the type and source of each first node. */
const keepsIgnoredOf = (page: LaidOutNode): { nodeType: PdfPageFlowName, source?: string }[] => {
  const ignored: unknown = page.props[KEEP_IGNORED_PROP]
  if (!Array.isArray(ignored)) return []
  return ignored.flatMap((kept: unknown) => typeof kept === 'object' && kept !== null && 'type' in kept && typeof kept.type === 'string' && kept.type in PDF_PRIMITIVE_NAMES
    ? [{ nodeType: PDF_PRIMITIVE_NAMES[kept.type as keyof typeof PDF_PRIMITIVE_NAMES] as PdfPageFlowName, source: 'source' in kept && typeof kept.source === 'string' ? kept.source : undefined }]
    : [])
}

/** The notes a page part moved to the next page (`NOTES_MOVED_PROP`, paginate/index.ts). */
const movedNotesOf = (page: LaidOutNode): { number: number, source?: string }[] => {
  const moved: unknown = page.props[NOTES_MOVED_PROP]
  if (!Array.isArray(moved)) return []
  return moved.flatMap((note: unknown) => typeof note === 'object' && note !== null && 'number' in note && typeof note.number === 'number'
    ? [{ number: note.number, source: 'source' in note && typeof note.source === 'string' ? note.source : undefined }]
    : [])
}

/** The font family a laid-out text asks for: its own or an inherited one, else the default Helvetica. */
const fontFamilyOf = (node: LaidOutNode): string => {
  const family: unknown = node.style?.fontFamily
  return typeof family === 'string' ? family : 'Helvetica'
}

// Boxes that show content without lines or children of their own.
const CONTENT_BOXES: ReadonlySet<string> = new Set([PDF_PRIMITIVES.Image, PDF_PRIMITIVES.Svg, ...PDF_FIELD_TYPES])

const isAbsoluteNode = (node: LaidOutNode): boolean => node.style?.position === 'absolute'

/**
 * The text lines and content boxes of `node` that start at or below `bottom`,
 * the page end, `top` being its parent's top: they are not drawn. An absolute
 * node inside it counts its own.
 */
const belowPage = (node: LaidOutNode, top: number, bottom: number): { lines: number, nodes: number } => {
  const nodeTop = top + (finiteNumber(node.box.top) ?? 0)
  if (node.lines) {
    // The painter puts the first line at the top of the content box (paint/text.ts).
    const contentTop = nodeTop + (finiteNumber(node.box.borderTopWidth) ?? 0) + (finiteNumber(node.box.paddingTop) ?? 0)
    const first = node.lines[0]?.box.y ?? 0
    return { lines: node.lines.filter(line => contentTop + line.box.y - first >= bottom).length, nodes: 0 }
  }
  if (CONTENT_BOXES.has(node.type)) return { lines: 0, nodes: nodeTop >= bottom ? 1 : 0 }
  return elementChildren(node).filter(child => !isAbsoluteNode(child)).reduce((total, child) => {
    const below = belowPage(child, nodeTop, bottom)
    return { lines: total.lines + below.lines, nodes: total.nodes + below.nodes }
  }, { lines: 0, nodes: 0 })
}

/** Whether a text of the document asks for the patterns (`hyphens: 'auto'`). */
const hyphenatesAutomatically = (layout: SafeDocumentNode): boolean => {
  let found = false
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      if (node.type === PDF_PRIMITIVES.Text && node.style?.hyphens === 'auto') found = true
      return !found
    })
    if (found) return true
  }
  return false
}

/**
 * Find blocks that cannot fit on any ordinary page because pagination is not
 * allowed to split them: higher than the page in the layout, or, for a block
 * the engine shrank to the page, in `naturalHeights` (`measureNaturalHeights`),
 * and the rows that cells over several rows hold together, which pagination
 * marks when it leaves them cut (reported once, on their first row).
 * Also tables with 'auto' columns narrower than the longest words of their
 * columns (`TABLE_COLUMNS_NEED_PROP`), once per table, on its first page, and
 * pages whose footnotes did not all start on them (`NOTES_MOVED_PROP`), and
 * characters that no font of their text has, once per character (D40), and
 * a document language without hyphenation patterns when a text has
 * `hyphens: 'auto'`, once (D41), and the
 * content that is cut off and not drawn (`PDF_CONTENT_HIDDEN`): the lines a
 * box's height cut off (`hiddenLines` of a text), and the lines and content
 * boxes of an absolute node that start below the page end, except inside a
 * block reported with `PDF_UNBREAKABLE_NODE_OVERFLOW`: one code per cause.
 * No text, ids, or other authored content enters the public diagnostics
 * object, apart from the code point of such a character and that language.
 */
export const collectLayoutWarnings = (
  layout: SafeDocumentNode,
  naturalHeights: ReadonlyMap<string, number> = new Map(),
): PdfLayoutWarning[] => {
  const warnings: PdfLayoutWarning[] = []
  const { language } = layout.props
  if (lacksPatterns(language) && hyphenatesAutomatically(layout)) warnings.push({ code: 'PDF_HYPHENATION_UNAVAILABLE', language })
  // The need object of each table seen: its page parts share it.
  const tables = new WeakSet<object>()
  // The missing characters warned about: one warning each per render.
  const missing = new Set<number>()

  documentPages(layout).forEach((page, pageIndex) => {
    const moved = movedNotesOf(page)
    if (moved.length > 0) {
      warnings.push({ code: 'PDF_FOOTNOTES_MOVED', pageNumber: pageIndex + 1, footnotes: moved.map(note => note.number), ...sourceField(moved[0]!.source) })
    }
    for (const kept of keepsIgnoredOf(page)) {
      warnings.push({ code: 'PDF_KEEP_IGNORED', pageNumber: pageIndex + 1, nodeType: kept.nodeType, ...sourceField(kept.source) })
    }

    visitPageNodes(page, (node) => {
      const need: unknown = node.props[TABLE_COLUMNS_NEED_PROP]
      if (typeof need !== 'object' || need === null || !('neededWidth' in need) || typeof need.neededWidth !== 'number' || tables.has(need)) return
      tables.add(need)
      const tableWidth = contentWidth(node)
      // Rounding noise of yoga's float32 boxes is no shortfall.
      if (tableWidth + 0.01 >= need.neededWidth) return
      warnings.push({
        code: 'PDF_TABLE_COLUMNS_TOO_NARROW',
        pageNumber: pageIndex + 1,
        tableWidth: roundedPoints(tableWidth),
        neededWidth: roundedPoints(need.neededWidth),
        ...sourceField(node.source),
      })
    })

    visitPageNodes(page, (node) => {
      for (const line of node.lines ?? []) {
        for (const codePoint of missingCodePoints(line)) {
          if (missing.has(codePoint)) continue
          missing.add(codePoint)
          warnings.push({ code: 'PDF_GLYPH_MISSING', pageNumber: pageIndex + 1, codePoint, fontFamily: fontFamilyOf(node), ...sourceField(node.source) })
        }
      }
    })

    // Blocks that cannot split and are higher than the room: the engine cuts them, and that warning alone
    // reports what they lose (one code per cause), not PDF_CONTENT_HIDDEN for the lines inside them.
    const overflows: PdfLayoutWarning[] = []
    const cut = new Set<LaidOutNode>()
    const availableHeight = pageContentHeight(page)
    if (availableHeight !== undefined && availableHeight > 0) visitPageNodes(page, (node) => {
      const group = spanGroupOverflow(node)
      if (group === true) {
        cut.add(node)
        return false
      }
      if (group !== undefined) {
        cut.add(node)
        overflows.push({
          code: 'PDF_UNBREAKABLE_NODE_OVERFLOW',
          pageNumber: pageIndex + 1,
          // A table row, or one block that cannot split (an SVG, an image).
          nodeType: PDF_PRIMITIVE_NAMES[node.type] as PdfPageFlowName,
          nodeHeight: roundedPoints(group.nodeHeight),
          availableHeight: roundedPoints(group.availableHeight),
          ...sourceField(node.source),
        })
        // A row or cell of them may be higher than the page too: one warning.
        return false
      }
      if (
        node === page
        || node.props.fixed === true
        || isAbsoluteNode(node)
        || !isUnbreakableFlowNode(node)
      ) return

      const key = layoutKey(node)
      const natural = key === undefined ? undefined : naturalHeights.get(key)
      const laidOut = finiteNumber(node.box.height)
      const nodeHeight = laidOut === undefined ? natural : Math.max(laidOut, natural ?? 0)
      if (nodeHeight === undefined || nodeHeight <= availableHeight + 0.001) return

      cut.add(node)
      overflows.push({
        code: 'PDF_UNBREAKABLE_NODE_OVERFLOW',
        pageNumber: pageIndex + 1,
        nodeType: PDF_PRIMITIVE_NAMES[node.type] as PdfPageFlowName,
        nodeHeight: roundedPoints(nodeHeight),
        availableHeight: roundedPoints(availableHeight),
        ...sourceField(node.source),
      })
    })

    // Lines that a box's height cut off, and what of an absolute node starts below the page end.
    const pageBottom = finiteNumber(page.style?.height) ?? finiteNumber(page.box.height)
    const visitHidden = (node: LaidOutNode, parentTop: number): void => {
      if (cut.has(node)) return
      const below = pageBottom !== undefined && isAbsoluteNode(node) ? belowPage(node, parentTop, pageBottom) : { lines: 0, nodes: 0 }
      const hiddenLines = (node.hiddenLines ?? 0) + below.lines
      if (hiddenLines + below.nodes > 0) {
        warnings.push({
          code: 'PDF_CONTENT_HIDDEN',
          pageNumber: pageIndex + 1,
          nodeType: PDF_PRIMITIVE_NAMES[node.type] as PdfPageFlowName,
          hiddenLines,
          hiddenNodes: below.nodes,
          ...sourceField(node.source),
        })
      }
      if (node.lines) return
      const top = parentTop + (finiteNumber(node.box.top) ?? 0)
      for (const child of elementChildren(node)) visitHidden(child, top)
    }
    for (const child of elementChildren(page)) visitHidden(child, 0)
    warnings.push(...overflows)
  })

  return warnings
}

/** One `fixed` node in flow that takes height on every page it repeats on. */
export interface FixedFlowNode {
  nodeType: string
  height: number
  /** `pages` of a page-conditional node. */
  pages?: 'first' | 'continuation'
  source?: PdfSourcePosition
}

/** What the fixed nodes in flow leave for the content after them. */
export interface FixedFlowReport {
  /**
   * In-flow `fixed` nodes that together fill the content area above some
   * content, on the first page where that happens.
   */
  blocked?: {
    /** The `PdfPage` element, counted from 1, and how many the document has. */
    pageNumber: number
    pageCount: number
    /**
     * Which pages of it are full: every page (no page-conditional node), every
     * page after the first (`all` and `continuation` nodes), or the first page
     * (`all` and `first` nodes).
     */
    pageKind: 'every' | 'later' | 'first'
    availableHeight: number
    nodes: [FixedFlowNode, ...FixedFlowNode[]]
    totalHeight: number
  }
}

const isRowStyle = (node: LaidOutNode): boolean => {
  const direction = node.style?.flexDirection
  return direction === 'row' || direction === 'row-reverse'
}

/**
 * Read a layout whose pages were not split (`wrap: false`). Pagination
 * repeats a `fixed` node on every page its parent reaches, before the
 * content that follows it in the same column. So when the in-flow fixed
 * nodes above some content (in that content's ancestors, before it) fill the
 * content area, the content never fits, every page would be the same, and
 * pagination could not end. Absolute nodes take no flow height. Fixed nodes in
 * a finished sibling container no longer repeat and do not count. Paddings,
 * borders and margins are not added, so the check only finds certain cases.
 */
export const inspectFixedFlow = (layout: SafeDocumentNode): FixedFlowReport => {
  const report: FixedFlowReport = {}
  const pages = documentPages(layout)
  for (const [index, page] of pages.entries()) {
    const availableHeight = pageContentHeight(page)
    if (availableHeight === undefined || availableHeight <= 0) continue

    const fills = (nodes: readonly FixedFlowNode[]) => {
      const totalHeight = roundedPoints(nodes.reduce((sum, node) => sum + node.height, 0))
      return { totalHeight, full: totalHeight >= availableHeight - 0.001 }
    }
    const reachContent = (above: readonly FixedFlowNode[]): void => {
      if (report.blocked !== undefined) return
      const firstNodes = above.filter(node => node.pages !== 'continuation')
      const first = fills(firstNodes)
      const laterNodes = above.filter(node => node.pages !== 'first')
      const later = fills(laterNodes)
      const conditional = above.some(node => node.pages !== undefined)
      const [nodes, pageKind, totalHeight] = later.full
        ? [laterNodes, conditional ? 'later' as const : 'every' as const, later.totalHeight]
        : first.full ? [firstNodes, 'first' as const, first.totalHeight] : [[], 'every' as const, 0]
      const [head, ...rest] = nodes
      if (head) {
        report.blocked = { pageNumber: index + 1, pageCount: pages.length, pageKind, availableHeight: roundedPoints(availableHeight), nodes: [head, ...rest], totalHeight }
      }
    }
    const visit = (container: LaidOutNode, inherited: readonly FixedFlowNode[]): void => {
      const above = [...inherited]
      for (const child of elementChildren(container)) {
        if (isAbsoluteNode(child)) continue
        if (child.props.fixed === true) {
          const height = finiteNumber(child.box?.height)
          if (height !== undefined) {
            const condition: unknown = child.props.pages
            const pages: Pick<FixedFlowNode, 'pages'> = condition === 'first' || condition === 'continuation' ? { pages: condition } : {}
            above.push({ nodeType: PDF_PRIMITIVE_NAMES[child.type] ?? child.type, height: roundedPoints(height), ...pages, ...sourceField(child.source) })
          }
          continue
        }
        if (isRowStyle(child)) {
          reachContent(above)
          continue
        }
        if (child.type === PDF_PRIMITIVES.View && elementChildren(child).length > 0) visit(child, above)
        else reachContent(above)
      }
    }
    visit(page, [])
  }
  return report
}
