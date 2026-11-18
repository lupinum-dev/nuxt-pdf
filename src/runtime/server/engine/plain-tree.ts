import { workerData } from 'node:worker_threads'
import type { DocumentNode, SafeDocumentNode } from './layout/index'
import { resolvedPosition, type PdfStyleValue } from '../../authoring'
import {
  PDF_ATTACHMENT_RELATIONSHIPS,
  PDF_FACTUR_X_PROFILES,
  PDF_HEADER_CELL_PROP,
  PDF_PRIMITIVES,
  claimsTaggedPdf,
  pdfConformanceLevels,
  pdfFacturXFileName,
  type PdfAttachmentRelationship,
  type PdfFacturXProfile,
} from '../../primitives'
import type { PdfElementNode, PdfNode } from '../../renderer'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import type { RenderLimits } from '../render-limits'
import { createPdfFontStore, type PdfFontStore } from './fonts'
import {
  describeMap,
  extractDestinationPages,
  renderDocumentMultiPass,
  samePages,
} from './layout-passes'
import {
  collectLayoutWarnings,
  findOrphanedViews,
  inspectFixedFlow,
  type FixedFlowNode,
  type FixedFlowReport,
  findShrinkCandidates,
  isUnbreakableFlowNode,
  LAYOUT_KEY_PROP,
  layoutPdfTree,
  measureNaturalHeights,
  type DestinationPageMap,
  type PdfEngineAttachment,
} from './render-document'
import type { PdfLayoutWarning } from '../../shared/template'
import { artifactScope, createStructurePlanner, ROOT_STRUCTURE_SCOPE, STRUCTURE_PROP, type StructureScope } from './tagged'

// The adapter between the plain-data document tree and the layout engine.
//
// The mounted tree is plain data, so it can cross a thread boundary. Where the
// engine expects a function, the tree holds data instead: page tokens
// (`PAGE_NUMBER`, `PAGE_COUNT`, `PAGE_REF`) stand for the engine's per-page
// `render` callback, and `hyphenate: false` for its `hyphenationCallback`.
// A `fixed` node with `pages="first"` or `"continuation"` becomes a carrier
// view whose per-page `render` returns the node on the pages where it appears
// (see "Repeated and page-conditional content" in CONTRACTS.md).
// A `PdfAttachment` or `PdfFacturX` is not laid out: `toEngineDocument` leaves
// it out of the engine tree, and `takeAttachments` hands it to serialization
// as plain data.
// `toEngineDocument` builds the engine tree from the plain tree, as a pure
// function. It never changes its input and has no Vue import, so it runs in
// the worker and in-process alike.

/**
 * The argument of the engine's per-page `render` callback. The paint call adds
 * the totals and the page's place inside its `PdfPage`.
 */
type EnginePageProps = {
  pageNumber: number
  totalPages?: number
  subPageNumber?: number
  subPageTotalPages?: number
}

/** The engine splits words with this callback; one part keeps the word whole. */
const keepWordsWhole = (word: string): string[] => [word]

const FIELD_TYPES: ReadonlySet<string> = new Set([PDF_PRIMITIVES.TextField, PDF_PRIMITIVES.Checkbox, PDF_PRIMITIVES.Select])

/**
 * Engine props of an element: `hyphenate: false` on a text becomes the
 * engine's callback. A form field is a leaf with a fixed box, so it never
 * splits (`wrap: false`); server/engine/forms.ts reads its other props.
 */
const engineProps = (node: PdfElementNode): Record<string, unknown> => {
  if (FIELD_TYPES.has(node.type)) return { ...node.props, wrap: false }
  if (node.type !== PDF_PRIMITIVES.Text || !Object.hasOwn(node.props, 'hyphenate')) {
    return { ...node.props }
  }
  const { hyphenate, ...props } = node.props
  return hyphenate === false
    ? { ...props, hyphenationCallback: keepWordsWhole }
    : props
}

const treeInvalid = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message)
}

type TextPart
  = | string
    | typeof PDF_PRIMITIVES.PageNumber
    | typeof PDF_PRIMITIVES.PageCount

const isAttachment = (node: PdfNode): node is PdfElementNode =>
  node.type === PDF_PRIMITIVES.Attachment || node.type === PDF_PRIMITIVES.FacturX

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const RELATIONSHIPS: ReadonlySet<unknown> = new Set(PDF_ATTACHMENT_RELATIONSHIPS)
const isRelationship = (value: unknown): value is PdfAttachmentRelationship =>
  RELATIONSHIPS.has(value)

const FACTUR_X_PROFILES: ReadonlySet<unknown> = new Set(PDF_FACTUR_X_PROFILES)
const isFacturXProfile = (value: unknown): value is PdfFacturXProfile =>
  FACTUR_X_PROFILES.has(value)

const toEngineAttachment = ({ type, props }: PdfElementNode): PdfEngineAttachment => {
  if (type === PDF_PRIMITIVES.FacturX) {
    const { xml, profile, relationship } = props
    if (!(xml instanceof Uint8Array) || !isFacturXProfile(profile)) {
      return treeInvalid('<PdfFacturX> reached the engine without a profile or byte content.')
    }
    // Factur-X 1.0: the XML is `Data` for the profiles that are not a full
    // invoice, and an `Alternative` to the visible invoice for the others.
    const fallback = profile === 'MINIMUM' || profile === 'BASIC WL' ? 'Data' : 'Alternative'
    return {
      name: pdfFacturXFileName(profile),
      data: xml,
      type: 'text/xml',
      description: profile === 'XRECHNUNG' ? 'XRechnung invoice' : 'Factur-X invoice',
      relationship: isRelationship(relationship) ? relationship : fallback,
      facturXProfile: profile,
    }
  }
  const { name, data, relationship } = props
  if (typeof name !== 'string' || !(data instanceof Uint8Array)) {
    return treeInvalid('<PdfAttachment> reached the engine without a name or byte content.')
  }
  return {
    name,
    data,
    type: optionalString(props.type),
    description: optionalString(props.description),
    relationship: isRelationship(relationship) ? relationship : 'Unspecified',
  }
}

/**
 * The files of a document's `PdfAttachment` and `PdfFacturX` children, in
 * tree order. The tree was validated and admitted on the main thread, so the
 * content is bytes.
 */
export const takeAttachments = (document: PdfElementNode): PdfEngineAttachment[] =>
  document.children.filter(isAttachment).map(toEngineAttachment)

/**
 * The engine opens a string `src` (or `source`) itself, as a file path or URL.
 * Only bytes that image resolution admitted on the main thread may reach it,
 * so anything else fails here, even if a tree changed after admission.
 */
const requireAdmittedImage = (node: PdfElementNode): void => {
  if (
    !(node.props.src instanceof Uint8Array)
    || Object.hasOwn(node.props, 'source')
    || Object.hasOwn(node.props, 'srcSet')
  ) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.AssetInvalid,
      '<PdfImage> reached the PDF engine without admitted image bytes. Image sources must be resolved by renderPdf before layout; do not change a PdfImage after the template has rendered.',
    )
  }
}

const isPageToken = (node: PdfNode): boolean =>
  node.type === PDF_PRIMITIVES.PageNumber
  || node.type === PDF_PRIMITIVES.PageCount
  || node.type === PDF_PRIMITIVES.PageRef

const isPerPageToken = (node: PdfNode): boolean =>
  node.type === PDF_PRIMITIVES.PageNumber
  || node.type === PDF_PRIMITIVES.PageCount

/**
 * What one layout pass tells the next. Each part is empty when the document
 * does not use it, so an ordinary document is a fixed point after one pass.
 */
export interface PlainLayoutFacts {
  /** id → first page, read only when the tree prints a `PdfPageRef`. */
  destinations: DestinationPageMap
  /**
   * Layout keys of views that start on a new page, because their repeated
   * `fixed` children would otherwise end a page alone. Only grows within one
   * render, so the loop cannot oscillate on it.
   */
  breaks: readonly string[]
  /**
   * Carrier key → first page of its parent, for the carriers of in-flow
   * `pages="first"` nodes that change a page break. The sizing call reads it
   * (see `carrier`). Once reported, a key stays reported in the render.
   */
  firstPages: Readonly<Record<string, number>>
  /**
   * Set when a pass painted a node on a page it had sized without it (a first
   * page that moved later). From then on carriers ignore `firstPages` and
   * size the node on every page, as in pass 1. Never unset within a render.
   */
  sizeEveryPage: boolean
}

const EMPTY_LAYOUT_FACTS: PlainLayoutFacts = {
  destinations: {},
  breaks: [],
  firstPages: {},
  sizeEveryPage: false,
}

/** What a carrier saw in one layout pass. */
interface CarrierReport {
  key: string
  /** The parent's first page: the carrier's first paint call. */
  firstPage: number | undefined
  /** A page sized with the node but painted without it can break differently. */
  changesBreaks: boolean
  /** A page painted with the node but sized without it. */
  squeezed: boolean
}

export interface EngineDocument {
  document: DocumentNode
  /** True when the tree holds a `PAGE_REF` token. */
  usesPageRefs: boolean
  /** Keys of views with repeated `fixed` children and flow children. */
  orphanWatch: ReadonlySet<string>
  /** Read after layout: what each page-conditional carrier saw. */
  carrierReports: () => CarrierReport[]
}

/** An element in the shape the engine's `render` result takes (React element). */
type EngineElement = string | {
  type: string
  props: Record<string, unknown>
}

const toEngineElement = (node: PdfNode): EngineElement =>
  node.type === PDF_PRIMITIVES.TextInstance
    ? node.value
    : {
        type: node.type,
        props: { ...node.props, style: node.style, children: node.children.map(toEngineElement) },
      }

const isAbsolute = (style: PdfStyleValue | undefined): boolean =>
  resolvedPosition(style) === 'absolute'

// An absolute node keeps its offsets: the carrier covers the parent's box, so
// `top: 22` inside it is 22 from the parent's top edge, as before.
const ABSOLUTE_CARRIER: PdfStyleValue = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

const isFixed = (node: PdfNode): boolean =>
  node.type !== PDF_PRIMITIVES.TextInstance && node.props.fixed === true

/** The engine-tree prop of the page guard; never in the input tree. */
const PAGE_GUARD_PROP = '__nuxtPdfPageGuard'

/**
 * Upstream pagination repeats every `fixed` node on each new page. When those
 * in flow leave no room for the next block that cannot break, every page is
 * the same as the one before, and pagination never ends; in-process, the
 * deadline is only checked after layout returns. The guard is the one way
 * into that loop: an absolute, empty view whose `fixed` prop is a getter.
 * Pagination reads `fixed` of the page's children while it splits each page
 * (CONTRACTS.md, "Page guard"), and every read calls `onPaginate`. A `render`
 * prop would also be called per page, but it makes the engine lay out the
 * rest of the document again on every page. `withoutPageGuards` removes the
 * guard from the layout before anything reads or serializes it, so the PDF
 * bytes do not change.
 */
const pageGuard = (onPaginate: () => void): PdfElementNode => {
  const props: Record<string, unknown> = { [PAGE_GUARD_PROP]: true }
  Object.defineProperty(props, 'fixed', {
    enumerable: true,
    get: () => {
      onPaginate()
      return true
    },
  })
  return {
    type: PDF_PRIMITIVES.View,
    box: {},
    style: { position: 'absolute', top: 0, left: 0, width: 0, height: 0 },
    props,
    children: [],
  }
}

/** The laid-out document without page guards (see `pageGuard`). */
export const withoutPageGuards = (layout: SafeDocumentNode): SafeDocumentNode => {
  const root = layout as unknown as PdfElementNode
  return {
    ...root,
    children: root.children.map(page => page.type === PDF_PRIMITIVES.TextInstance
      ? page
      : { ...page, children: page.children.filter(child => child.type === PDF_PRIMITIVES.TextInstance || child.props[PAGE_GUARD_PROP] !== true) }),
  } as unknown as SafeDocumentNode
}

export interface EngineDocumentOptions {
  /** Called again and again while pagination splits pages; adds the page guard. */
  onPaginate?: () => void
  /**
   * Keep a page-conditional node as a plain `fixed` node, without its
   * carrier: for a layout that measures fixed nodes on unsplit pages.
   */
  conditionalAsFixed?: boolean
}

const pageCondition = (node: PdfNode): 'first' | 'continuation' | undefined => {
  if (node.type === PDF_PRIMITIVES.TextInstance) return undefined
  const pages = node.props.pages
  return pages === 'first' || pages === 'continuation' ? pages : undefined
}

/**
 * Build the tree the layout engine reads from the plain-data tree.
 *
 * - A `PAGE_REF` token becomes the text of the page number in
 *   `facts.destinations`, or empty text while that destination is not located yet.
 * - A `PdfText` that holds `PdfPageNumber` or `PdfPageCount` tokens becomes a
 *   dynamic text: its children are replaced by the `render` callback the engine
 *   calls once per page.
 * - A page-conditional `fixed` node becomes a carrier (see the file comment)
 *   that learns its parent's first page within the same pass.
 * - A view with `fixed` and flow children gets a layout key; when the key is in
 *   `facts.breaks`, the view gets `break: true`. Pages and unbreakable blocks
 *   get one for the oversized-block check.
 * - `hyphenate: false` on a `PdfText` becomes a `hyphenationCallback` that
 *   keeps every word whole.
 * - In a tagged document (PDF/UA-1, PDF/A-3a), every node that belongs to a
 *   structure element gets `STRUCTURE_PROP` from the planner in `tagged.ts`.
 *
 * Every element is copied (node, props, and children array), so layout can
 * write derived state such as resolved bookmarks without touching the input.
 * Keys come from a counter in tree order, so every pass names the same nodes.
 */
export const toEngineDocument = (
  document: PdfElementNode,
  facts: PlainLayoutFacts,
  options: EngineDocumentOptions = {},
): EngineDocument => {
  let usesPageRefs = false
  let nextKey = 0
  const planner = claimsTaggedPdf(pdfConformanceLevels(document.props.conformance))
    ? createStructurePlanner()
    : undefined
  const orphanWatch = new Set<string>()
  const breaks = new Set(facts.breaks)
  const carriers: (() => CarrierReport)[] = []

  const pageRefText = (token: PdfElementNode): string => {
    usesPageRefs = true
    const target = token.props.to
    const pages = facts.destinations
    const page = typeof target === 'string' && Object.hasOwn(pages, target)
      ? pages[target]
      : undefined
    return page === undefined ? '' : String(page)
  }

  const dynamicText = (
    node: PdfElementNode,
    props: Record<string, unknown>,
    insideText: boolean,
  ): PdfElementNode => {
    // The engine lays a nested text out as part of its parent's lines, which
    // are fixed before the per-page callback runs; the number would not print.
    if (insideText) {
      treeInvalid('<PdfPageNumber> and <PdfPageCount> are not supported in a <PdfText> nested inside another <PdfText>.')
    }

    const parts: TextPart[] = []
    for (const child of node.children) {
      if (child.type === PDF_PRIMITIVES.TextInstance) parts.push(child.value)
      else if (child.type === PDF_PRIMITIVES.PageRef) parts.push(pageRefText(child))
      else if (
        child.type === PDF_PRIMITIVES.PageNumber
        || child.type === PDF_PRIMITIVES.PageCount
      ) {
        parts.push(child.type)
      }
      else {
        // A dynamic text returns one string per page, so it cannot keep nested
        // elements.
        treeInvalid('A <PdfText> that contains <PdfPageNumber> or <PdfPageCount> cannot contain other elements.')
      }
    }

    const render = (page: EnginePageProps): string => {
      let text = ''
      for (const part of parts) {
        if (part === PDF_PRIMITIVES.PageNumber) text += String(page.pageNumber)
        // The engine calls once without the total, during pagination, and again
        // with it. The first result only sizes the text.
        else if (part === PDF_PRIMITIVES.PageCount) text += String(page.totalPages ?? '')
        else text += part
      }
      return text
    }

    return {
      type: node.type,
      box: {},
      style: node.style,
      props: { ...props, render },
      children: [],
    }
  }

  /**
   * The carrier of a page-conditional node: `fixed`, without a box of its own,
   * so it repeats with the parent and takes no space where `render` returns
   * nothing. Its static child lets layout load the node's fonts before
   * pagination replaces the children per page.
   *
   * Pagination calls `render` in two rounds (`resolvePagination`):
   * - Sizing (no `totalPages`): once per page while the page is split, on the
   *   whole rest of the document, so also for parents that start on a later
   *   page. The call order therefore does not tell the parent's first page;
   *   for a first-page node the previous pass does (`facts.firstPages`), and
   *   the carrier leaves the node out on every later page. Otherwise it
   *   returns the node. Where the parent has not started yet, the node sits
   *   inside a parent below the page break and changes nothing on the page.
   * - Paint (with `totalPages`): once per final page, in page order, on the
   *   fragments of that page only. The carrier is in every fragment of its
   *   parent, so its first paint call is the parent's first page.
   *
   * So the node shows on the right pages in the first pass. A page where an
   * in-flow node is sized but not painted breaks as if the node were there;
   * the paint relayout moves the content up and leaves the gap at the page
   * bottom. A first-page carrier reports its parent's first page when that
   * happens on a page that is not the last of its `PdfPage`, so the next pass
   * sizes those pages without the node.
   *
   * After a split, upstream lays the next page out with the height it
   * measured in the previous sizing call (`resolveDynamicPage` keeps
   * `page.box.height`) and page children shrink to fit it. So a sizing result
   * may shrink from one page to the next but never grow, and a paint result
   * must never be larger than the sizing result of its page. A continuation
   * node would grow on the page after the parent's first page, so it is always
   * sized: its parent's first page keeps the gap. A first-page node whose
   * parent moved to a later page since the previous pass is painted where it
   * was not sized; the carrier reports it (`squeezed`), the loop does not
   * serialize that pass, and `sizeEveryPage` turns the facts off.
   */
  const carrier = (
    node: PdfElementNode,
    inner: PdfElementNode,
    condition: 'first' | 'continuation',
  ): PdfElementNode => {
    const key = `c${carriers.length}`
    // Only a first-page node uses it: a continuation node left out of the
    // sizing call on the parent's first page would be added on the next page,
    // and upstream lays that page out in the height measured without it.
    const knownFirstPage = condition === 'first'
      && !facts.sizeEveryPage
      && Object.hasOwn(facts.firstPages, key)
      ? facts.firstPages[key]
      : undefined
    const inFlow = !isAbsolute(node.style)
    const sized = new Map<number, boolean>()
    let firstPage: number | undefined
    let changesBreaks = false
    let squeezed = false

    const sizes = (pageNumber: number): boolean =>
      knownFirstPage === undefined || pageNumber <= knownFirstPage

    const render = (page: EnginePageProps): EngineElement | null => {
      if (page.totalPages === undefined) {
        const show = sizes(page.pageNumber)
        sized.set(page.pageNumber, show)
        return show ? toEngineElement(inner) : null
      }
      const isFirstPage = firstPage === undefined
      firstPage ??= page.pageNumber
      const show = isFirstPage === (condition === 'first')
      // On the last page of its PdfPage nothing was pushed to a next page.
      const lastPage = page.subPageNumber === page.subPageTotalPages
      if (condition === 'first' && inFlow && !show && !lastPage) changesBreaks = true
      if (show && sized.get(page.pageNumber) === false) squeezed = true
      return show ? toEngineElement(inner) : null
    }

    carriers.push(() => ({ key, firstPage, changesBreaks, squeezed }))

    return {
      type: PDF_PRIMITIVES.View,
      box: {},
      style: isAbsolute(node.style) ? ABSOLUTE_CARRIER : {},
      props: { fixed: true, render },
      children: [inner],
    }
  }

  /** `structure` is what the structure planner knows about the ancestors. */
  type Scope = { insideText: boolean, structure: StructureScope }

  const convert = (node: PdfNode, scope: Scope): PdfNode => {
    if (node.type === PDF_PRIMITIVES.TextInstance) return node
    const { insideText } = scope

    if (isPageToken(node)) {
      if (node.type !== PDF_PRIMITIVES.PageRef || !insideText) {
        // Unreachable for a mounted tree: the renderer only accepts tokens
        // inside PdfText, and that case is handled by the parent below.
        treeInvalid('A page token is only supported directly inside <PdfText>.')
      }
      return { type: PDF_PRIMITIVES.TextInstance, value: pageRefText(node) }
    }

    const condition = pageCondition(node)
    if (condition !== undefined && !options.conditionalAsFixed) {
      const { fixed: _fixed, pages: _pages, ...rest } = node.props
      // A page-conditional node is `fixed`, so it stays an artifact without the prop.
      const inner = convert({ ...node, props: rest }, { ...scope, structure: artifactScope(scope.structure) })
      return carrier(node, inner as PdfElementNode, condition)
    }

    if (node.type === PDF_PRIMITIVES.Image) requireAdmittedImage(node)

    const props = engineProps(node)
    // The measuring layout (never serialized) reads `pages` to count each page kind.
    if (!options.conditionalAsFixed) delete props.pages
    // Read by the planner below; layout never sees it, so bytes stay the same.
    Reflect.deleteProperty(props, PDF_HEADER_CELL_PROP)
    // The engine copies props to every fragment, so a split text keeps its element.
    const structure = planner?.enter(node, scope.structure)
    if (structure?.info !== undefined) props[STRUCTURE_PROP] = structure.info
    if (structure?.href !== undefined) props.href = structure.href
    const children: Scope = {
      insideText: insideText || node.type === PDF_PRIMITIVES.Text,
      structure: structure?.children ?? scope.structure,
    }

    const isText = node.type === PDF_PRIMITIVES.Text
    if (isText && node.children.some(isPerPageToken)) {
      return dynamicText(node, props, insideText)
    }

    if (
      node.type === PDF_PRIMITIVES.View
      && node.children.some(isFixed)
      && node.children.some(child => !isFixed(child))
    ) {
      const key = String(nextKey++)
      orphanWatch.add(key)
      if (breaks.has(key)) props.break = true
      props[LAYOUT_KEY_PROP] = key
    }
    else if (node.type === PDF_PRIMITIVES.Page || isUnbreakableFlowNode(node)) {
      props[LAYOUT_KEY_PROP] = String(nextKey++)
    }

    return {
      type: node.type,
      box: {},
      style: node.style,
      props,
      // Host data for diagnostics; the engine ignores unknown node fields.
      ...(node.source === undefined ? {} : { source: node.source }),
      children: convertChildren(node.children, children),
    }
  }

  /**
   * A page reference becomes text and joins the text instances next to it.
   * textkit splits words per run, and each text instance is its own run, so
   * `"see p. r2p"` and `"16"` would be two words that the line breaker may
   * split with a hyphen, whatever `hyphenationCallback` says (F6).
   */
  const convertChildren = (nodes: readonly PdfNode[], scope: Scope): PdfNode[] => {
    const converted: PdfNode[] = []
    let previousIsRef = false
    for (const child of nodes) {
      const isRef = child.type === PDF_PRIMITIVES.PageRef
      if (isAttachment(child)) continue
      const next = convert(child, scope)
      const previous = converted.at(-1)
      if (
        (isRef || previousIsRef)
        && next.type === PDF_PRIMITIVES.TextInstance
        && previous?.type === PDF_PRIMITIVES.TextInstance
      ) {
        converted[converted.length - 1] = { type: PDF_PRIMITIVES.TextInstance, value: previous.value + next.value }
      }
      else {
        converted.push(next)
      }
      previousIsRef = isRef
    }
    return converted
  }

  const root = convert(document, { insideText: false, structure: ROOT_STRUCTURE_SCOPE }) as PdfElementNode
  const { onPaginate } = options
  if (onPaginate) {
    root.children = root.children.map(page => page.type === PDF_PRIMITIVES.TextInstance
      ? page
      : { ...page, children: [...page.children, pageGuard(onPaginate)] })
  }

  return {
    document: root as unknown as DocumentNode,
    usesPageRefs,
    orphanWatch,
    carrierReports: () => carriers.map(report => report()),
  }
}

/**
 * The first pages a pass reports: every carrier it was built with (so the set
 * cannot oscillate) and every carrier whose sizing changed a page break.
 */
const reportFirstPages = (
  reports: readonly CarrierReport[],
  fed: PlainLayoutFacts['firstPages'],
): PlainLayoutFacts['firstPages'] => {
  const firstPages: Record<string, number> = {}
  for (const { key, firstPage, changesBreaks } of reports) {
    const known = Object.hasOwn(fed, key) ? fed[key] : undefined
    if (known === undefined && !changesBreaks) continue
    const page = firstPage ?? known
    if (page !== undefined) firstPages[key] = page
  }
  return firstPages
}

/**
 * First pages only refine documents without orphan breaks: in a document with
 * many parents, each pass with them moves where parents end, finds new
 * orphans, and the loop needs a pass per parent (12 sections: 7 passes).
 * So they turn off for good when a pass has an orphan break or squeezed a
 * page. Breaks found in a pass laid out with first pages are dropped then, so
 * the loop continues exactly as without first pages: at most one pass more.
 */
const nextPageFacts = (
  fed: PlainLayoutFacts,
  breaks: readonly string[],
  reports: readonly CarrierReport[],
): Pick<PlainLayoutFacts, 'breaks' | 'firstPages' | 'sizeEveryPage'> => {
  const usedFirstPages = !fed.sizeEveryPage && Object.keys(fed.firstPages).length > 0
  if (fed.sizeEveryPage || breaks.length > 0 || reports.some(report => report.squeezed)) {
    return { breaks: usedFirstPages ? fed.breaks : breaks, firstPages: {}, sizeEveryPage: true }
  }
  return { breaks, firstPages: reportFirstPages(reports, fed.firstPages), sizeEveryPage: false }
}

const sameKeys = (a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key))
}

/**
 * `produced` is a fixed point of `fed`. First pages only need the same keys:
 * a first page that moved earlier leaves at most the gap that pass 1 leaves
 * on those pages, and chasing it would cost a pass per moved parent. A first
 * page that moved later squeezes a page and sets `sizeEveryPage`.
 */
const sameFacts = (produced: PlainLayoutFacts, fed: PlainLayoutFacts): boolean =>
  samePages(produced.destinations, fed.destinations)
  && produced.breaks.length === fed.breaks.length
  && produced.breaks.every((key, index) => key === fed.breaks[index])
  && produced.sizeEveryPage === fed.sizeEveryPage
  && sameKeys(produced.firstPages, fed.firstPages)

const describeFacts = (facts: PlainLayoutFacts): string => {
  const parts = [describeMap(facts.destinations)]
  if (facts.breaks.length > 0) parts.push(`new-page views ${facts.breaks.join(', ')}`)
  const firstPages = Object.entries(facts.firstPages)
  if (firstPages.length > 0) {
    parts.push(`first pages ${firstPages.map(([key, page]) => `${key}→p${page}`).join(', ')}`)
  }
  if (facts.sizeEveryPage) parts.push('first pages off')
  return parts.join('; ')
}

export interface PlainRenderOptions {
  compress?: boolean
  fontStore?: PdfFontStore
  limits?: RenderLimits
  /** Hard cap on layout passes. */
  maxPasses?: number
}

export interface PlainRenderResult {
  bytes: Uint8Array
  layout: SafeDocumentNode
  /** Unbreakable blocks higher than their page, also those the engine shrank. */
  layoutWarnings: PdfLayoutWarning[]
  /**
   * Layout passes run: 1 for an ordinary document; at least 2 for an in-flow
   * `pages="first"` node that changes a break, a `PdfPageRef`, or a header that
   * had to move (3 when a second pass moves a `PdfPageRef` target). The fixed
   * content check before them is not counted.
   */
  passes: number
}

const holdsFlowFixed = (node: PdfElementNode): boolean =>
  node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance
    && !isAbsolute(child.style)
    && (child.props.fixed === true || holdsFlowFixed(child)))

/**
 * The page with only what decides the height of its in-flow `fixed` nodes:
 * the nodes themselves and their ancestors. Each run of other content becomes
 * one empty view, which keeps its place in the flow and takes no height. A
 * row is pruned like any container: `inspectFixedFlow` does not measure
 * inside a row, it only notes that the row holds a `fixed` node. Keeping a
 * row's content would lay the whole row out once more (12 % of a render with
 * a 143-page row).
 */
const keepFixedFlow = (node: PdfElementNode): PdfElementNode => {
  const children: PdfNode[] = []
  let placeholder = false
  for (const child of node.children) {
    if (child.type !== PDF_PRIMITIVES.TextInstance && isAbsolute(child.style)) continue
    const kept = child.type === PDF_PRIMITIVES.TextInstance || child.props.fixed === true
      ? child
      : holdsFlowFixed(child) ? keepFixedFlow(child) : undefined
    if (kept === undefined && placeholder) continue
    placeholder = kept === undefined
    children.push(kept ?? { type: PDF_PRIMITIVES.View, box: {}, style: {}, props: {}, children: [] })
  }
  return { ...node, children }
}

/**
 * Measure the in-flow `fixed` nodes on unsplit pages (`inspectFixedFlow`).
 * Undefined for a document without them, which skips the extra layout.
 */
const measureFixedFlow = async (
  document: PdfElementNode,
  fontStore: PdfFontStore,
  limits: RenderLimits | undefined,
): Promise<FixedFlowReport | undefined> => {
  if (!holdsFlowFixed(document)) return undefined
  const unsplit: PdfElementNode = {
    ...document,
    children: document.children.map(page => page.type === PDF_PRIMITIVES.Page
      ? { ...keepFixedFlow(page), props: { ...page.props, wrap: false } }
      : page),
  }
  const engine = toEngineDocument(unsplit, EMPTY_LAYOUT_FACTS, { conditionalAsFixed: true })
  return inspectFixedFlow(await layoutPdfTree(engine.document, fontStore, limits))
}

const pointText = (value: number): string => `${value} pt`

const PAGE_KIND_TEXT = { every: 'every page', later: 'every page after the first', first: 'the first page' } as const

/** A typed error for fixed content that leaves no room on the page. */
const fixedFlowError = (blocked: NonNullable<FixedFlowReport['blocked']>): NuxtPdfError => {
  const where = (node: FixedFlowNode): string =>
    node.source ? ` at ${node.source.file}:${node.source.line}:${node.source.column}` : ''
  const [first] = blocked.nodes
  const subject = blocked.nodes.length === 1
    ? `A fixed <${first.nodeType}>${where(first)} is ${pointText(first.height)} high`
    : `The fixed nodes ${blocked.nodes.map(node => `<${node.nodeType}>${where(node)} (${pointText(node.height)})`).join(', ')} are ${pointText(blocked.totalHeight)} high together`
  const pages = PAGE_KIND_TEXT[blocked.pageKind] + (blocked.pageCount > 1 ? ` of <PdfPage> ${blocked.pageNumber}` : '')
  const continuation = blocked.pageKind === 'first' && blocked.nodes.some(node => node.pages === 'continuation')
    ? 'A pages="continuation" node keeps its room on the first page too: the first page breaks as if it were there. '
    : ''
  return new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `${subject}, but ${pages} has ${pointText(blocked.availableHeight)} for content. ${continuation}`
    + 'A fixed node repeats above the content that follows it, so that content never fits and pagination cannot end. '
    + 'Make the fixed content lower than the page content area, give it position: absolute, or remove fixed so it can break across pages.',
    first.source ? { source: first.source } : {},
  )
}

/**
 * The `workerData` key that marks the render worker (`PDF_WORKER_MARKER` in
 * worker-entry.ts, which imports this module).
 */
export const RENDER_WORKER_MARKER = 'nuxtPdfRenderWorker'

/**
 * The page guard runs in-process only. The render worker is terminated at the
 * deadline anyway, and there the guard's accessor costs about 20 % of every
 * render with in-flow fixed content: the hot `isFixed` read of the engine
 * then also handles an accessor (measured; in-process it costs nothing
 * measurable). worker-render.ts names the fixed content in its timeout error.
 */
const guardsPagination = (workerData as Record<string, unknown> | null)?.[RENDER_WORKER_MARKER] !== true

/** The page guard callback: at the deadline, a typed error that names the fixed content. */
const paginationDeadline = (limits: RenderLimits, report: FixedFlowReport): (() => void) => () => {
  if (limits.deadline.remainingMs() > 0) return
  const { largest } = report
  const causes = [
    largest && largest.height > 0 ? `Fixed content takes ${pointText(largest.height)} of the ${pointText(largest.availableHeight)} content area on every page it repeats on` : undefined,
    report.inRow ? 'a fixed node in a row repeats next to the content on every page the row reaches' : undefined,
  ].filter(cause => cause !== undefined).join(', and ')
  throw new NuxtPdfError(
    PDF_ERROR_CODES.LimitExceeded,
    `PDF layout did not finish within its ${limits.timeoutMs}ms time budget. `
    + (causes ? `${causes.charAt(0).toUpperCase()}${causes.slice(1)}. ` : '')
    + 'A block that cannot break (an SVG, image or canvas) and is higher than the room left below or beside fixed content never fits, so pagination does not end. '
    + 'Make that block or the fixed content lower, or raise pdf.limits.timeoutMs if the document is legitimately this long.',
  )
}

/**
 * Lay out and serialize a plain-data document tree.
 *
 * Every document runs the fixed-point loop: each pass rebuilds the engine tree
 * from data with the facts of the previous pass, until the facts stop
 * changing. A document that uses none of them stops after one pass.
 */
export const renderPlainDocument = async (
  document: PdfElementNode,
  options: PlainRenderOptions = {},
): Promise<PlainRenderResult> => {
  const { limits } = options
  const fontStore = options.fontStore ?? createPdfFontStore()
  const fixedFlow = await measureFixedFlow(document, fontStore, limits)
  if (fixedFlow?.blocked) throw fixedFlowError(fixedFlow.blocked)
  // In-flow fixed content may leave less room than the next block that
  // cannot break; in-process, the page guard then ends pagination at the
  // deadline (see `pageGuard` and `guardsPagination`).
  const guard: EngineDocumentOptions = guardsPagination && limits && fixedFlow
    ? { onPaginate: paginationDeadline(limits, fixedFlow) }
    : {}
  let current = toEngineDocument(document, EMPTY_LAYOUT_FACTS, guard)
  const attachments = takeAttachments(document)

  const result = await renderDocumentMultiPass<PlainLayoutFacts>(
    {
      get document() {
        return current.document
      },
      initial: EMPTY_LAYOUT_FACTS,
      feed: async (facts) => {
        current = toEngineDocument(document, facts, guard)
      },
      clean: withoutPageGuards,
      extract: (layout, fed) => {
        const orphans = findOrphanedViews(layout, current.orphanWatch)
        return {
          destinations: current.usesPageRefs ? extractDestinationPages(layout) : {},
          ...nextPageFacts(fed, [...new Set([...fed.breaks, ...orphans])].sort(), current.carrierReports()),
        }
      },
      same: sameFacts,
      describe: describeFacts,
    },
    {
      compress: options.compress,
      fontStore,
      limits: options.limits,
      maxPasses: options.maxPasses,
      attachments,
    },
  )

  // Upstream shrinks an unbreakable block that is higher than the page and
  // only logs it. One more layout measures the candidates; the PDF is done.
  const candidates = findShrinkCandidates(result.layout)
  const naturalHeights = candidates.keys.size === 0
    ? undefined
    : await measureNaturalHeights(
        toEngineDocument(document, result.facts).document,
        candidates,
        fontStore,
        options.limits,
      )

  return {
    bytes: result.bytes,
    layout: result.layout,
    layoutWarnings: collectLayoutWarnings(result.layout, naturalHeights),
    passes: result.passes,
  }
}
