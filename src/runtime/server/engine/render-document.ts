// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./react-pdf-pdfkit.d.ts" />

import { Buffer } from 'node:buffer'
import type FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from './layout/index'
import PDFDocument from '@react-pdf/pdfkit'
import renderPDF from '@react-pdf/render'
import {
  createPdfFontStore,
  type PdfFontStore,
} from './fonts'
import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../../shared/errors'
// Not from the renderer facade: it loads Vue, and the engine also runs in the
// render worker.
import type { PdfStyleValue } from '../../authoring'
import {
  PDF_ELEMENTS,
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  pdfConformanceLevels,
  type PdfAttachmentRelationship,
  claimsPdfA,
  claimsTaggedPdf,
  type PdfConformance,
  type PdfDocumentProps,
  type PdfFacturXProfile,
  type PdfPageFlowName,
} from '../../primitives'
import type {
  PdfElementNode,
  PdfNode,
} from '../../renderer'
import type { PdfLayoutWarning } from '../../shared/template'
import { parsePdfSourcePosition, type PdfSourcePosition } from '../../shared/errors'
import {
  addSrgbOutputIntent,
  assertEmbeddedFonts,
  buildConformanceXmp,
  CONFORMANCE_PDF_VERSION,
  replaceXmp,
  type PdfDocumentInfo,
  type PdfFacturXMetadata,
} from './pdfa'
import { prepareForm } from './forms'
import { protectDocument } from './protection'
import { makeOutputReproducible } from './reproducible'
import { applyTagging } from './tagged'
import {
  enforceMaxPages,
  type RenderLimits,
} from '../render-limits'

export interface PdfEngineOptions {
  compress?: boolean
  fontStore?: PdfFontStore
  limits?: RenderLimits
}

/** A file to embed when the PDF is written; plain data from a `PdfAttachment`. */
export interface PdfEngineAttachment {
  name: string
  data: Uint8Array
  type?: string
  description?: string
  relationship: PdfAttachmentRelationship
  /** Set for the invoice XML of a `PdfFacturX`; it makes the document PDF/A-3b. */
  facturXProfile?: PdfFacturXProfile
}

/** id (named destination) → 1-based page number the destination resolves to. */
export type DestinationPageMap = Record<string, number>

export interface PdfEngineResult {
  bytes: Uint8Array
  layout: SafeDocumentNode
}

// The engine's document props, plus the Nuxt PDF props it does not know.
// Tree validation checked their shape (renderer/validate-tree.ts).
type DocumentMetadata = DocumentNode['props'] & Pick<PdfDocumentProps, 'protection'>
type LayoutDocument = (
  document: DocumentNode,
  fontStore: FontStore,
) => Promise<SafeDocumentNode>

const runLayout = layoutDocument as unknown as LayoutDocument

// `''` is the unique fixed point of upstream's transformLineHeight
// (@react-pdf/stylesheet resolve/text.ts:53 short-circuits `if (value === '')`).
// Every other lineHeight value is an absolute number after the first resolution,
// and pagination re-resolves dynamic-node styles multiple times
// (@react-pdf/layout resolvePagination.ts / resolveStyles.ts), re-multiplying it
// by fontSize on each pass until the dynamic line box explodes off-page.
const DYNAMIC_LINE_HEIGHT_SENTINEL = ''

// Shield dynamic text from any inherited lineHeight by giving each dynamic Text
// node its OWN `''` lineHeight, which survives re-resolution and (via
// resolveInheritance's own-over-inherited merge) overrides the compounding
// ancestor value. Replaces the node.style reference on the disposable mounted
// tree, mirroring how registry.ts mutates styles before layout; the shared
// style object is never mutated.
const normalizeDynamicTextLineHeight = (node: PdfElementNode): void => {
  if (
    node.type === PDF_PRIMITIVES.Text
    && typeof node.props.render === 'function'
  ) {
    // The empty-string sentinel is an engine-only workaround, never valid
    // author input, so keep it outside the public PdfStyle contract.
    node.style = (Array.isArray(node.style)
      ? [...node.style, { lineHeight: DYNAMIC_LINE_HEIGHT_SENTINEL }]
      : { ...(node.style ?? {}), lineHeight: DYNAMIC_LINE_HEIGHT_SENTINEL }) as PdfStyleValue
  }

  for (const child of node.children) {
    if ('children' in child) {
      normalizeDynamicTextLineHeight(child)
    }
  }
}

const compact = (values: Record<string, unknown>) => Object.fromEntries(
  Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
)

const collectStream = (
  stream: PDFDocument,
  limits?: RenderLimits,
) => new Promise<Uint8Array>((resolve, reject) => {
  const chunks: Uint8Array[] = []
  let total = 0

  stream.on('data', (chunk: Uint8Array | Buffer | string) => {
    try {
      limits?.deadline.check()
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk)
      total += bytes.byteLength
      chunks.push(bytes)
    }
    catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      limits?.abortController.abort(cause)
      stream.destroy(cause)
    }
  })
  stream.on('end', () => {
    try {
      limits?.deadline.check()
      resolve(Buffer.concat(chunks, total))
    }
    catch (error) {
      reject(error)
    }
  })
  stream.on('error', reject)
})

const documentInfo = (props: DocumentMetadata, creationDate: Date): PdfDocumentInfo => ({
  ...compact({
    Title: props.title,
    Author: props.author,
    Subject: props.subject,
    Keywords: props.keywords,
  }),
  Creator: props.creator ?? 'nuxt-pdf',
  Producer: props.producer ?? 'nuxt-pdf',
  CreationDate: creationDate,
})

const createContext = (
  props: DocumentMetadata,
  compress: boolean,
  info: PdfDocumentInfo,
  levels: readonly PdfConformance[],
) => new PDFDocument({
  compress,
  // A protected PDF is PDF 1.7 with Adobe extension level 8 (protection.ts).
  pdfVersion: levels.length > 0 ? CONFORMANCE_PDF_VERSION : props.protection === undefined ? props.pdfVersion : '1.7',
  lang: props.language,
  displayTitle: true,
  autoFirstPage: false,
  pageLayout: props.pageLayout,
  info,
})

/**
 * The standards a document claims: its `conformance` prop, and PDF/A-3b when
 * it holds a `PdfFacturX`, because a hybrid invoice is a PDF/A-3 file.
 */
const resolveConformance = (
  props: DocumentMetadata,
  attachments: readonly PdfEngineAttachment[],
): PdfConformance[] => {
  const levels = pdfConformanceLevels((props as Record<string, unknown>).conformance)
  if (!claimsPdfA(levels) && attachments.some(item => item.facturXProfile !== undefined)) {
    levels.unshift('PDF/A-3b')
  }
  return levels
}

const facturXMetadata = (attachments: readonly PdfEngineAttachment[]): PdfFacturXMetadata | undefined => {
  const invoice = attachments.find(item => item.facturXProfile !== undefined)
  return invoice?.facturXProfile === undefined
    ? undefined
    : { profile: invoice.facturXProfile, fileName: invoice.name }
}

// renderPDF ends the document, so files are embedded before it paints. The
// engine treats a string as a server file path and a plain Uint8Array the same
// way; only a Buffer is read as content (see CONTRACTS.md, "Attachments").
// PDF/A-3 requires a MIME type on every embedded file (veraPDF rule 6.8-1).
const PDF_A_DEFAULT_ATTACHMENT_TYPE = 'application/octet-stream'

const embedAttachments = (
  context: PDFDocument,
  attachments: readonly PdfEngineAttachment[],
  creationDate: Date,
  pdfA: boolean,
): void => {
  for (const attachment of attachments) {
    const { data } = attachment
    context.file(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      name: attachment.name,
      type: attachment.type ?? (pdfA ? PDF_A_DEFAULT_ATTACHMENT_TYPE : undefined),
      description: attachment.description,
      relationship: attachment.relationship,
      creationDate,
      modifiedDate: creationDate,
    })
  }
}

// One layout pass. Validates the root, applies the dynamic lineHeight shield,
// and runs the upstream layout pipeline once. The pass loop (layout-passes.ts)
// calls this once per pass on a fresh engine tree and serializes only the
// converged result via `serializePdfLayout`. `renderDocument` composes one pass
// and serialization for engine tests; both share this one source of truth for
// layout error mapping and the lineHeight shield.
export const layoutPdfTree = async (
  document: DocumentNode,
  fontStore: PdfFontStore,
  limits?: RenderLimits,
): Promise<SafeDocumentNode> => {
  limits?.deadline.check()

  if (document.type !== 'DOCUMENT') {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `Expected a DOCUMENT root, received ${document.type}.`,
    )
  }

  normalizeDynamicTextLineHeight(document as unknown as PdfElementNode)

  let layout: SafeDocumentNode
  try {
    layout = await runLayout(
      document,
      fontStore as unknown as FontStore,
    )
  }
  catch (error) {
    // A typed error from an adapter callback inside pagination (the page
    // guard in plain-tree.ts: the deadline) keeps its code.
    if (error instanceof NuxtPdfError) throw error
    // Font resolution is a layout sub-stage (resolveAssets → fontStore.load), so
    // font failures surface here as LAYOUT_ERROR carrying React PDF's own message
    // (e.g. "Font family not registered: Roboto"). Nuxt PDF does not re-classify
    // by message text or duplicate the layout traversal to sub-type the failure.
    throw new NuxtPdfError(
      PDF_ERROR_CODES.LayoutError,
      `PDF layout failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  // The single page-count enforcement point. Both the single-pass path and every
  // multi-pass iteration reach layout through here, right after the page list is
  // produced and before serialization — so the cap is checked once, not copied.
  // Kept outside the layout try/catch so a limit breach stays PDF_LIMIT_EXCEEDED
  // rather than being re-wrapped as a layout error.
  limits?.deadline.check()
  if (limits) enforceMaxPages(countPages(layout), limits.maxPages)

  return layout
}

// Depth-first walk over the element nodes of one final page tree. The laid-out
// SafeDocumentNode replaces some nodes' `children` with other shapes (e.g. a
// laid-out TEXT carries `lines`, an SVG leaf measures itself), so recurse only
// into an actual array of children.
const visitPageNodes = (
  page: PdfNode,
  visit: (node: PdfElementNode) => void,
): void => {
  if (!('props' in page)) return
  visit(page as PdfElementNode)
  const children = (page as PdfElementNode).children
  if (Array.isArray(children)) {
    for (const child of children) visitPageNodes(child, visit)
  }
}

const documentPages = (layout: SafeDocumentNode): PdfNode[] =>
  ((layout as unknown as PdfElementNode).children ?? []) as PdfNode[]

/** The number of laid-out pages in a serialized document. */
export const countPages = (layout: SafeDocumentNode): number =>
  documentPages(layout).length

/**
 * The engine-tree prop that names a node in a laid-out tree: views the
 * multi-pass loop may move to a new page, unbreakable blocks and pages for the
 * oversized-block check. Only the adapter writes it (`toEngineDocument`);
 * authors cannot, because the renderer accepts only the props of the primitive
 * table. Every split fragment and every page a `PdfPage` breaks into keeps its
 * node's props, so the key is found on every page the node reaches.
 */
export const LAYOUT_KEY_PROP = '__nuxtPdfKey'

const NON_WRAPPING_NODE_TYPES = new Set<string>([
  PDF_PRIMITIVES.Image,
  PDF_PRIMITIVES.Note,
  PDF_PRIMITIVES.Svg,
])

// Page-flow elements: the ones a page holds directly.
const WARNING_NODE_TYPES: ReadonlySet<string> = PDF_ELEMENTS[PDF_PRIMITIVES.Page].children

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const roundedPoints = (value: number): number => Math.round(value * 100) / 100

const pageContentHeight = (page: PdfElementNode): number | undefined => {
  const style = page.style as Record<string, unknown> | undefined
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

const cannotWrap = (node: PdfElementNode): boolean =>
  NON_WRAPPING_NODE_TYPES.has(node.type) || node.props.wrap === false

/** A page-flow node that pagination may not split (`PdfImage`, `wrap: false`). */
export const isUnbreakableFlowNode = (node: PdfElementNode): boolean =>
  WARNING_NODE_TYPES.has(node.type) && cannotWrap(node)

const layoutKey = (node: PdfElementNode): string | undefined => {
  const key = node.props[LAYOUT_KEY_PROP]
  return typeof key === 'string' ? key : undefined
}

const sourceField = (value: string | undefined): { source?: PdfSourcePosition } => {
  const source = parsePdfSourcePosition(value)
  return source ? { source } : {}
}

/** What the oversized-block check needs from a converged layout. */
export interface ShrinkCandidates {
  /** Layout keys of unbreakable blocks that fill their page to the bottom. */
  keys: ReadonlySet<string>
  /** `PdfPage` layout key → laid-out page width. */
  pageWidths: ReadonlyMap<string, number>
}

// A block is never higher than the page in the final layout: after the split,
// upstream lays the page out at the page height and yoga shrinks its children
// to fit (`warnUnavailableSpace` only logs). A shrunk block fills the page to
// its content bottom, so only such blocks need the natural-height layout.
const BOTTOM_TOLERANCE = 0.5

/**
 * Unbreakable flow blocks whose bottom edge (with margin) reaches the content
 * bottom of their page, and the page widths for the natural-height layout.
 * The keys come from `toEngineDocument`.
 */
export const findShrinkCandidates = (layout: SafeDocumentNode): ShrinkCandidates => {
  const keys = new Set<string>()
  const pageWidths = new Map<string, number>()

  for (const pageNode of documentPages(layout)) {
    if (!('props' in pageNode)) continue
    const page = pageNode as PdfElementNode
    const pageKey = layoutKey(page)
    const width = finiteNumber(page.box.width)
    if (pageKey !== undefined && width !== undefined && !pageWidths.has(pageKey)) {
      pageWidths.set(pageKey, width)
    }
    const availableHeight = pageContentHeight(page)
    const paddingTop = finiteNumber(page.box.paddingTop) ?? 0
    if (availableHeight === undefined || availableHeight <= 0) continue
    const contentBottom = paddingTop + availableHeight - BOTTOM_TOLERANCE

    // Yoga places a box relative to its parent's box.
    const visit = (node: PdfElementNode, parentTop: number): void => {
      if (node.props.fixed === true) return
      const top = parentTop + (finiteNumber(node.box.top) ?? 0)
      const height = finiteNumber(node.box.height) ?? 0
      const key = layoutKey(node)
      if (isUnbreakableFlowNode(node) && key !== undefined) {
        const bottom = top + height + (finiteNumber(node.box.marginBottom) ?? 0)
        if (bottom >= contentBottom) keys.add(key)
        return
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if ('props' in child) visit(child, top)
        }
      }
    }
    for (const child of page.children) {
      if ('props' in child) visit(child, 0)
    }
  }

  return { keys, pageWidths }
}

/**
 * Lay the document out once more with every `PdfPage` as one page of its laid
 * out width and automatic height, so nothing is shrunk to a page, and read the
 * height of each candidate. Used for diagnostics only; the PDF comes from the
 * converged layout.
 */
export const measureNaturalHeights = async (
  document: DocumentNode,
  candidates: ShrinkCandidates,
  fontStore: PdfFontStore,
  limits?: RenderLimits,
): Promise<Map<string, number>> => {
  const root = document as unknown as PdfElementNode
  const tall: PdfElementNode = {
    ...root,
    children: root.children.map((child) => {
      if (!('props' in child)) return child
      const pageKey = layoutKey(child)
      const width = pageKey === undefined ? undefined : candidates.pageWidths.get(pageKey)
      if (width === undefined) return child
      // A size without a height leaves the page height automatic; the width
      // is already the oriented one.
      const { orientation: _orientation, ...props } = child.props
      return { ...child, props: { ...props, size: { width }, wrap: false } }
    }),
  }

  const layout = await layoutPdfTree(tall as unknown as DocumentNode, fontStore, limits)
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

/**
 * Find blocks that cannot fit on any ordinary page because pagination is not
 * allowed to split them: higher than the page in the layout, or, for a block
 * the engine shrank to the page, in `naturalHeights` (`measureNaturalHeights`).
 * No text, ids, or other authored content enters the public diagnostics object.
 */
export const collectLayoutWarnings = (
  layout: SafeDocumentNode,
  naturalHeights: ReadonlyMap<string, number> = new Map(),
): PdfLayoutWarning[] => {
  const warnings: PdfLayoutWarning[] = []

  documentPages(layout).forEach((pageNode, pageIndex) => {
    if (!('props' in pageNode)) return
    const page = pageNode as PdfElementNode
    const availableHeight = pageContentHeight(page)
    if (availableHeight === undefined || availableHeight <= 0) return

    visitPageNodes(page, (node) => {
      if (
        node === page
        || node.props.fixed === true
        || !isUnbreakableFlowNode(node)
      ) return

      const key = layoutKey(node)
      const natural = key === undefined ? undefined : naturalHeights.get(key)
      const laidOut = finiteNumber(node.box.height)
      const nodeHeight = laidOut === undefined ? natural : Math.max(laidOut, natural ?? 0)
      if (nodeHeight === undefined || nodeHeight <= availableHeight + 0.001) return

      warnings.push({
        code: 'PDF_UNBREAKABLE_NODE_OVERFLOW',
        pageNumber: pageIndex + 1,
        nodeType: PDF_PRIMITIVE_NAMES[node.type] as PdfPageFlowName,
        nodeHeight: roundedPoints(nodeHeight),
        availableHeight: roundedPoints(availableHeight),
        ...sourceField(node.source),
      })
    })
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
     * (`all`, `first` and `continuation` nodes: the engine keeps the room of a
     * `continuation` node on the first page too).
     */
    pageKind: 'every' | 'later' | 'first'
    availableHeight: number
    nodes: [FixedFlowNode, ...FixedFlowNode[]]
    totalHeight: number
  }
  /**
   * The fixed nodes that take the largest share of a content area above
   * content: their height together and that content area.
   */
  largest?: { height: number, availableHeight: number }
  /** A `fixed` node inside a row: its height is not stacked above the content. */
  inRow: boolean
}

const isRowStyle = (node: PdfElementNode): boolean => {
  const direction = (node.style as Record<string, unknown> | undefined)?.flexDirection
  return direction === 'row' || direction === 'row-reverse'
}

const isAbsoluteStyle = (node: PdfElementNode): boolean =>
  (node.style as Record<string, unknown> | undefined)?.position === 'absolute'

const elementChildren = (node: PdfElementNode): PdfElementNode[] =>
  (Array.isArray(node.children) ? node.children : []).filter((child): child is PdfElementNode => 'props' in child)

const holdsFixed = (node: PdfElementNode): boolean =>
  elementChildren(node).some(child => child.props.fixed === true || holdsFixed(child))

/**
 * Read a layout whose pages were not split (`wrap: false`). Pagination
 * repeats a `fixed` node on every page its parent reaches, before the
 * content that follows it in the same column. So when the in-flow fixed
 * nodes above some content (in that content's ancestors, before it) fill the
 * content area, the content never fits, every page is the same, and
 * pagination never ends. Absolute nodes take no flow height. Fixed nodes in
 * a finished sibling container no longer repeat and do not count. Paddings,
 * borders and margins are not added, so the check only finds certain cases.
 */
export const inspectFixedFlow = (layout: SafeDocumentNode): FixedFlowReport => {
  const report: FixedFlowReport = { inRow: false }
  const pages = documentPages(layout)
  for (const [index, pageNode] of pages.entries()) {
    if (!('props' in pageNode)) continue
    const page = pageNode as PdfElementNode
    const availableHeight = pageContentHeight(page)
    if (availableHeight === undefined || availableHeight <= 0) continue

    const fills = (nodes: readonly FixedFlowNode[]) => {
      const totalHeight = roundedPoints(nodes.reduce((sum, node) => sum + node.height, 0))
      return { totalHeight, full: totalHeight >= availableHeight - 0.001 }
    }
    const reachContent = (above: readonly FixedFlowNode[]): void => {
      const first = fills(above)
      const { largest } = report
      if (!largest || first.totalHeight / availableHeight > largest.height / largest.availableHeight) {
        report.largest = { height: first.totalHeight, availableHeight: roundedPoints(availableHeight) }
      }
      if (report.blocked !== undefined) return
      const laterNodes = above.filter(node => node.pages !== 'first')
      const later = fills(laterNodes)
      const conditional = above.some(node => node.pages !== undefined)
      const [nodes, pageKind, totalHeight] = later.full
        ? [laterNodes, conditional ? 'later' as const : 'every' as const, later.totalHeight]
        : first.full ? [above, 'first' as const, first.totalHeight] : [[], 'every' as const, 0]
      const [head, ...rest] = nodes
      if (head) {
        report.blocked = { pageNumber: index + 1, pageCount: pages.length, pageKind, availableHeight: roundedPoints(availableHeight), nodes: [head, ...rest], totalHeight }
      }
    }
    const visit = (container: PdfElementNode, inherited: readonly FixedFlowNode[]): void => {
      const above = [...inherited]
      for (const child of elementChildren(container)) {
        if (isAbsoluteStyle(child)) continue
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
          if (holdsFixed(child)) report.inRow = true
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

const nodeId = (node: PdfElementNode): string | undefined => {
  const id = node.props?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * A fragment that pagination left on a page with nothing in it: the part of a
 * text above the page end that got no line, or a view part with no child and
 * no height. It still carries `props.id`, but the content starts on a later page.
 */
const isEmptyFragment = (node: PdfElementNode): boolean => {
  if (node.type === PDF_PRIMITIVES.Text) {
    // Laid-out text nodes carry `lines`; the shared node type does not declare it.
    const { lines } = node as { lines?: unknown }
    return Array.isArray(lines) && lines.length === 0
  }
  return node.type === PDF_PRIMITIVES.View
    && node.children.length === 0
    && finiteNumber(node.box.height) === 0
}

/**
 * Whether an appearance of a node (named by `keyOf`: its id, or its bookmark)
 * can name where its content starts. An empty fragment cannot, unless the node
 * has no other appearance: an empty `<PdfView id>` placed as an anchor stays a
 * destination.
 */
const contentAnchor = <K>(
  layout: SafeDocumentNode,
  keyOf: (node: PdfElementNode) => K | undefined,
): (node: PdfElementNode, key: K) => boolean => {
  const withContent = new Set<K>()
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      const key = keyOf(node)
      if (key !== undefined && !isEmptyFragment(node)) withContent.add(key)
    })
  }
  return (node, key) => !withContent.has(key) || !isEmptyFragment(node)
}

const destinationAnchor = (layout: SafeDocumentNode) => contentAnchor(layout, nodeId)

/**
 * The bookmark of a node, by the `ref` layout gives each bookmarked source
 * node. Every page part of a split node keeps the same bookmark object.
 */
const bookmarkRef = (node: PdfElementNode): unknown => {
  const bookmark: unknown = node.props?.bookmark
  return typeof bookmark === 'object' && bookmark !== null && 'ref' in bookmark ? bookmark.ref : undefined
}

/**
 * Map every `id` (named destination) to the **first** 1-based page it appears
 * on, not counting empty fragments (`isEmptyFragment`). `id` is the key `render/src/operations/setDestination.ts` emits and that a
 * Link `src="#id"` jumps to (`setLink.ts`), so this map is the table-of-contents'
 * source of truth. Pagination splits a node that spans a page boundary into a
 * fragment on every page it touches, each keeping `props.id`; a destination names
 * where a section STARTS, so the first page wins (`first-writer-wins`).
 * `layout.children` is the final ordered page list produced by `resolvePagination`.
 */
export const extractDestinationPages = (
  layout: SafeDocumentNode,
): DestinationPageMap => {
  const pages = Object.create(null) as DestinationPageMap
  const anchors = destinationAnchor(layout)

  documentPages(layout).forEach((page, index) => {
    const pageNumber = index + 1
    visitPageNodes(page, (node) => {
      const id = nodeId(node)
      if (id !== undefined && !Object.hasOwn(pages, id) && anchors(node, id)) pages[id] = pageNumber
    })
  })

  return pages
}

/**
 * Find views that ended a page with only their repeated header. `orphanWatch`
 * names views that hold both `fixed` and flow children in the source: if such
 * a view's first fragment holds only its `fixed` children (a header with no
 * row under it), its key is reported, so the next pass can start it on a new
 * page.
 */
export const findOrphanedViews = (
  layout: SafeDocumentNode,
  orphanWatch: ReadonlySet<string>,
): string[] => {
  const seen = new Set<string>()
  const orphans: string[] = []

  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      const key = node.props[LAYOUT_KEY_PROP]
      if (typeof key !== 'string' || seen.has(key)) return
      seen.add(key)
      const children = node.children
      if (
        orphanWatch.has(key)
        && Array.isArray(children)
        && children.length > 0
        && children.every(child => 'props' in child && (child as PdfElementNode).props.fixed === true)
      ) {
        orphans.push(key)
      }
    })
  }

  return orphans
}

/**
 * Before serialization, drop `props.id` from every appearance of an id except
 * the first one that `extractDestinationPages` counts (empty fragments do not
 * count). pdfkit's NameTree (and upstream `setDestination`, called per node)
 * is last-writer-wins, so without this a page-spanning section's destination
 * would point at its LAST page. After the drop, the single surviving
 * `setDestination` call anchors the destination at the section's first page —
 * matching `extractDestinationPages` and the printed TOC number.
 *
 * The drop is copy-on-write, never an in-place delete: pagination REUSES node
 * objects across pages — a `fixed` node is the SAME object (and props object) on
 * every page it repeats on, and only split fragments get fresh props — so an
 * in-place delete on a later page would erase the first page's destination too.
 * Later appearances are replaced with shallow copies (props without `id`), and
 * the copy propagates up through the ancestor path so shared subtrees on earlier
 * pages stay untouched. The layout is derived and disposable (see CONTRACTS.md),
 * so replacing nodes inside it is legitimate.
 */
const anchorDestinationsAtFirstPage = (layout: SafeDocumentNode): void => {
  const seen = new Set<string>()
  const anchors = destinationAnchor(layout)
  // The same holds for bookmarks: upstream adds an outline entry for every
  // node with `props.bookmark`, so a node split over three pages had three.
  const seenBookmarks = new Set<unknown>()
  const bookmarkAnchors = contentAnchor(layout, bookmarkRef)

  const strip = (node: PdfNode): PdfNode => {
    if (!('props' in node)) return node
    const element = node as PdfElementNode
    let next = element

    const id = nodeId(element)
    if (id !== undefined) {
      if (!seen.has(id) && anchors(element, id)) {
        seen.add(id)
      }
      else {
        const { id: _dropped, ...rest } = element.props
        next = { ...element, props: rest }
      }
    }

    const ref = bookmarkRef(element)
    if (ref !== undefined) {
      if (!seenBookmarks.has(ref) && bookmarkAnchors(element, ref)) {
        seenBookmarks.add(ref)
      }
      else {
        const { bookmark: _dropped, ...rest } = next.props
        next = { ...next, props: rest }
      }
    }

    const children = next.children
    if (Array.isArray(children)) {
      let changed = false
      const stripped = children.map((child) => {
        const result = strip(child)
        if (result !== child) changed = true
        return result
      })
      if (changed) next = { ...next, children: stripped }
    }

    return next
  }

  const root = layout as unknown as PdfElementNode
  root.children = documentPages(layout).map(strip) as PdfElementNode['children']
}

const SVG_SHAPE_TYPES = new Set<string>([
  PDF_PRIMITIVES.Circle,
  PDF_PRIMITIVES.Ellipse,
  PDF_PRIMITIVES.G,
  PDF_PRIMITIVES.Line,
  PDF_PRIMITIVES.Path,
  PDF_PRIMITIVES.Polygon,
  PDF_PRIMITIVES.Polyline,
  PDF_PRIMITIVES.Rect,
  PDF_PRIMITIVES.Text,
])

const GRADIENT_ZERO_KEYS = {
  [PDF_PRIMITIVES.LinearGradient]: ['x2'],
  [PDF_PRIMITIVES.RadialGradient]: ['cx', 'cy', 'fx', 'fy', 'r'],
} as const

const normalizeGradientZeros = (value: unknown): void => {
  if (
    typeof value !== 'object'
    || value === null
    || !('type' in value)
    || !('props' in value)
    || (
      value.type !== PDF_PRIMITIVES.LinearGradient
      && value.type !== PDF_PRIMITIVES.RadialGradient
    )
    || typeof value.props !== 'object'
    || value.props === null
  ) return

  const props = value.props as Record<string, unknown>
  const keys = GRADIENT_ZERO_KEYS[value.type]
  for (const key of keys) {
    if (props[key] === 0) props[key] = '0'
  }
}

/**
 * Repair explicit SVG zeroes on the disposable, fully-resolved tree.
 *
 * The pinned `@react-pdf/render` release uses truthiness fallbacks for these
 * values. Layout has already parsed author strings to numbers, so normalizing
 * before layout cannot survive. Under the closed objectBoundingBox gradient
 * contract, render multiplies/coerces a truthy string zero before PDFKit sees
 * it. A zero-width stroke is removed because SVG defines it as not painted
 * (PDF's native width zero would be a hairline).
 */
const normalizeResolvedSvgZeros = (layout: SafeDocumentNode): void => {
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      normalizeGradientZeros(node.props.fill)

      if (!SVG_SHAPE_TYPES.has(node.type)) return

      if (node.props.fillOpacity === 0) node.props.fillOpacity = '0'
      if (node.props.strokeWidth === 0) node.props.stroke = null
    })
  }
}

/**
 * Give every laid-out image a key named after its bytes, so the painter embeds
 * each distinct image once per document. The engine reuses an embedded image
 * only by `image.key`, and it sets no key for Buffer sources: a `fixed` image
 * on 50 pages would be embedded 50 times. Two nodes with the same admitted
 * source share one buffer (the worker rewraps the same memory per node), so
 * the key is the memory range. Keys are numbered per call and the painter's
 * key map lives for one paint, so nothing is carried to another render.
 */
const keyImagesByBytes = (layout: SafeDocumentNode): void => {
  const memoryIds = new Map<unknown, number>()
  const keyOf = (data: unknown): string => {
    const memory = data instanceof Uint8Array ? data.buffer : data
    let id = memoryIds.get(memory)
    if (id === undefined) {
      id = memoryIds.size
      memoryIds.set(memory, id)
    }
    return data instanceof Uint8Array
      ? `nuxt-pdf-image:${id}:${data.byteOffset}:${data.byteLength}`
      : `nuxt-pdf-image:${id}`
  }
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      // Layout stores the decoded image on the node as `image`.
      if (!('image' in node)) return
      const image = node.image
      if (typeof image === 'object' && image !== null && 'data' in image && image.data != null) {
        Object.assign(image, { key: keyOf(image.data) })
      }
    })
  }
}

// Serialization seam. Paints one already-laid-out document to PDF bytes.
export const serializePdfLayout = async (
  props: DocumentMetadata,
  layout: SafeDocumentNode,
  compress: boolean,
  limits?: RenderLimits,
  attachments: readonly PdfEngineAttachment[] = [],
): Promise<Uint8Array> => {
  // Checked before the paint (outside the try below) so an expired budget stays
  // PDF_LIMIT_EXCEEDED instead of being re-wrapped as a serialization failure.
  limits?.deadline.check()
  try {
    anchorDestinationsAtFirstPage(layout)
    normalizeResolvedSvgZeros(layout)
    keyImagesByBytes(layout)
    const creationDate = props.creationDate ?? new Date()
    const levels = resolveConformance(props, attachments)
    const pdfA = claimsPdfA(levels)
    if (levels.length > 0) assertEmbeddedFonts(layout, levels)
    const info = documentInfo(props, creationDate)
    const context = createContext(props, compress, info, levels)
    if (props.protection !== undefined) protectDocument(context, props.protection)
    makeOutputReproducible(context)
    // Listen before the synchronous painter starts so early PDFKit chunks and
    // errors cannot race the collector.
    const collected = collectStream(context, limits)
    try {
      if (levels.length > 0) {
        replaceXmp(context, buildConformanceXmp(info, props.language, levels, facturXMetadata(attachments)))
      }
      if (pdfA) addSrgbOutputIntent(context)
      if (claimsTaggedPdf(levels)) applyTagging(context, layout)
      const painted = prepareForm(context, layout)
      embedAttachments(context, attachments, creationDate, pdfA)
      renderPDF(
        context as unknown as Parameters<typeof renderPDF>[0],
        painted,
      )
    }
    catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      context.destroy(cause)
      await collected.catch(() => undefined)
      throw cause
    }

    return await collected
  }
  catch (error) {
    if (error instanceof NuxtPdfError) throw error
    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      `PDF serialization failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export const renderDocument = async (
  document: DocumentNode,
  options: PdfEngineOptions = {},
): Promise<PdfEngineResult> => {
  const fontStore = options.fontStore ?? createPdfFontStore()
  const layout = await layoutPdfTree(document, fontStore, options.limits)
  const bytes = await serializePdfLayout(
    document.props,
    layout,
    options.compress ?? true,
    options.limits,
  )

  return { bytes, layout }
}
