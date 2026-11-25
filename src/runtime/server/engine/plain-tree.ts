import type { DocumentNode, SafeDocumentNode } from './layout/index'
import type { ElementNode, ElementType, InputStyle, LayoutNode, RunningValues, WithNotes } from './layout/types'
import { flattenStyle } from './layout/styles/flatten'
import { resolvedPosition, resolvedStyleValue, type PdfStyleValue } from '../../authoring'
import {
  PDF_ATTACHMENT_RELATIONSHIPS,
  PDF_FIELD_TYPES,
  PDF_FOOTNOTE_ID_PREFIX,
  PDF_FOOTNOTE_REPEAT_PROP,
  PDF_CONTENTS_PART_PROP,
  PDF_HEADER_CELL_PROP,
  PDF_PAGE_TOKENS,
  PDF_PER_PAGE_TOKENS,
  PDF_RUNNING_ROW_PROP,
  PDF_TABLE_CAPTION_PROP,
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  claimsTaggedPdf,
  isFacturXProfile,
  pdfClaimedLevels,
  pdfFacturXFileName,
  pdfRunningName,
  type PdfAttachmentRelationship,
  type PdfElementType,
  type PdfRunningAt,
} from '../../primitives'
import type { PdfElementNode, PdfNode } from '../../renderer'
import { PDF_PAGE_COLUMN_KEYS, PDF_PAGE_FLOW_KEYS, setsPdfColumns } from '../../shared/columns'
import { NuxtPdfError, parsePdfSourcePosition, PDF_ERROR_CODES, treeInvalid } from '../../shared/errors'
import { holdsFlowFixed, renderDeadlineError, type RenderLimits } from '../render-limits'
import { expandPdfContents } from './contents'
import { createPdfFontStore, type PdfFontStore } from './fonts'
import {
  collectLayoutWarnings,
  inspectFixedFlow,
  type FixedFlowNode,
  type FixedFlowReport,
  findShrinkCandidates,
  isUnbreakableFlowNode,
  measureNaturalHeights,
} from './layout-diagnostics'
import { extractDestinationPages, findOrphanedViews, type DestinationPageMap } from './destinations'
import type { TextParts } from './layout/paginate/dynamic'
import { FOOTNOTE_MARK_ID_SUFFIX, numberFootnotesByPage } from './footnote-numbers'
import { NOTE_NUMBER_PROP } from './layout/paginate/notes'
import { INLINE_FIGURE_PROP, NUMBER_RESERVE_PROP } from './layout/text/fragments'
import { RUNNING_PROP, type RunningSetter } from './layout/paginate/running'
import { PAGES_PROP } from './layout/paginate/rules'
import { LAYOUT_KEY_PROP } from './laid-out'
import { layoutPdfTree } from './layout-pass'
import { serializePdfLayout, type PdfEngineAttachment } from './render-document'
import type { PdfLayoutWarning } from '../../shared/template'
import { artifactScope, createStructurePlanner, ROOT_STRUCTURE_SCOPE, STRUCTURE_PROP, type StructureScope } from './tagged'

// The adapter between the plain-data document tree and the layout engine.
//
// The mounted tree is plain data, so it can cross a thread boundary. Where the
// engine expects a function, the tree holds data instead: page tokens
// (`PAGE_NUMBER`, `PAGE_COUNT`, `PAGE_REF`) stand for the engine's per-page
// `render` callback.
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
  running?: RunningValues
  totalPages?: number
  subPageNumber?: number
  subPageTotalPages?: number
  reserve?: number
}

/**
 * Engine props of an element. A form field is a leaf with a fixed box, so it
 * never splits (`wrap: false`); server/engine/forms.ts reads its other props.
 */
const engineProps = (node: PdfElementNode): Record<string, unknown> =>
  PDF_FIELD_TYPES.has(node.type) ? { ...node.props, wrap: false } : { ...node.props }

type TextPart
  = | string
    | { token: typeof PDF_PRIMITIVES.PageNumber | typeof PDF_PRIMITIVES.PageCount }
    | { token: typeof PDF_PRIMITIVES.RunningText, name: string, at: PdfRunningAt }

const isAttachment = (node: PdfNode): node is PdfElementNode =>
  node.type === PDF_PRIMITIVES.Attachment || node.type === PDF_PRIMITIVES.FacturX

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const RELATIONSHIPS: ReadonlySet<unknown> = new Set(PDF_ATTACHMENT_RELATIONSHIPS)
const isRelationship = (value: unknown): value is PdfAttachmentRelationship =>
  RELATIONSHIPS.has(value)

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
const takeAttachments = (document: PdfElementNode): PdfEngineAttachment[] =>
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

/** The text of a node as one line: its strings and those of its nested texts, spaces joined. */
const plainTextOf = (node: PdfElementNode): string => {
  const strings = (child: PdfNode): string => child.type === PDF_PRIMITIVES.TextInstance ? child.value : child.children.map(strings).join('')
  return strings(node).replace(/\s+/g, ' ').trim()
}

const isPageToken = (node: PdfNode): boolean =>
  node.type !== PDF_PRIMITIVES.TextInstance && PDF_PAGE_TOKENS.has(node.type)

const isPerPageToken = (node: PdfNode): boolean =>
  node.type !== PDF_PRIMITIVES.TextInstance && PDF_PER_PAGE_TOKENS.has(node.type)

/** The primitives that never reach the layout as an element (`ElementType` leaves them out). */
const NOT_LAID_OUT: ReadonlySet<string> = new Set([
  PDF_PRIMITIVES.Document,
  PDF_PRIMITIVES.Attachment,
  PDF_PRIMITIVES.FacturX,
  ...PDF_PAGE_TOKENS,
  PDF_PRIMITIVES.Footnote,
  // Replaced by its entries before the passes (`expandPdfContents`).
  PDF_PRIMITIVES.Contents,
])

type FootnotePart = 'mark' | 'note' | 'area' | 'rule'

const isStyleObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The footnote styles `PdfDocument` `footnoteStyles` is merged over. The mark
 * style also sets the number at the start of each note.
 */
const DEFAULT_FOOTNOTE_STYLES: Readonly<Record<FootnotePart, PdfStyleValue>> = {
  mark: { verticalAlign: 'super', fontSize: '70%' },
  note: {},
  area: { marginTop: 8, fontSize: '85%' },
  rule: { width: '33%', borderTopWidth: 0.5, marginBottom: 4 },
}

const isLaidOutType = (type: PdfElementType): type is ElementType => !NOT_LAID_OUT.has(type)

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
}

const EMPTY_LAYOUT_FACTS: PlainLayoutFacts = {
  destinations: {},
  breaks: [],
}

interface EngineDocument {
  document: DocumentNode
  /** True when the tree holds a `PAGE_REF` token. */
  usesPageRefs: boolean
  /** True when footnote numbers start again on each page: the page walk sets them after layout. */
  numbersFootnotesByPage: boolean
  /** Keys of views with repeated `fixed` children and flow children. */
  orphanWatch: ReadonlySet<string>
  /** Read after layout: what each page-conditional carrier saw. */
}

const isAbsolute = (style: PdfStyleValue | undefined): boolean =>
  resolvedPosition(style) === 'absolute'

// An absolute node keeps its offsets: the carrier covers the parent's box, so
// `top: 22` inside it is 22 from the parent's top edge, as before.
const ABSOLUTE_CARRIER: PdfStyleValue = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

const isFixed = (node: PdfNode): boolean =>
  node.type !== PDF_PRIMITIVES.TextInstance && node.props.fixed === true

/** A child of a page with columns that goes into its columns: not fixed and not absolute. */
const isPageFlow = (node: PdfNode): boolean =>
  node.type === PDF_PRIMITIVES.TextInstance || (!isFixed(node) && !isAbsolute(node.style))

interface EngineDocumentOptions {
  /** Called once for every page pagination makes (`DocumentNode.onPage`). */
  onPage?: () => void
  /**
   * Keep a page-conditional node as a plain `fixed` node, without its
   * carrier: for a layout that measures fixed nodes on unsplit pages.
   */
  conditionalAsFixed?: boolean
}

type PageCondition = 'first' | 'continuation' | 'not-last'

const pageCondition = (node: PdfNode): PageCondition | undefined => {
  if (node.type === PDF_PRIMITIVES.TextInstance) return undefined
  const pages = node.props.pages
  return pages === 'first' || pages === 'continuation' || pages === 'not-last' ? pages : undefined
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
 *   `facts.breaks` (its header ended a page or a column alone), the view gets
 *   `break: true`, or `break: 'column'` inside a column container. Pages and
 *   unbreakable blocks get one for the oversized-block check.
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
  const planner = claimsTaggedPdf(pdfClaimedLevels(document.props.conformance))
    ? createStructurePlanner()
    : undefined
  const orphanWatch = new Set<string>()
  const breaks = new Set(facts.breaks)
  // The longest value that a setter of each name sets: what a running token
  // prints while its value is not known yet (`tokenValue`).
  const longestRunning = new Map<string, string>()

  const ownFootnoteStyles = document.props.footnoteStyles
  const footnoteStyle = (part: FootnotePart): InputStyle => {
    const own = isStyleObject(ownFootnoteStyles) ? ownFootnoteStyles[part] : undefined
    return isStyleObject(own) ? [DEFAULT_FOOTNOTE_STYLES[part], own] : DEFAULT_FOOTNOTE_STYLES[part]
  }
  /** The one child of a note area: its rule, unless `footnoteStyles.rule` is false. */
  const ruleNodes = (): ElementNode[] =>
    isStyleObject(ownFootnoteStyles) && ownFootnoteStyles.rule === false
      ? []
      : [{ type: PDF_PRIMITIVES.View, box: {}, style: footnoteStyle('rule'), props: {}, children: [] }]
  const pageNumbering = document.props.footnotes === 'page'
  /** The footnotes converted so far, in document order. */
  let footnoteCount = 0
  /** The notes of the page being converted. */
  let pageNotes: ElementNode[] = []

  const pageRefText = (token: PdfElementNode): string => {
    usesPageRefs = true
    const target = token.props.to
    const pages = facts.destinations
    const page = typeof target === 'string' && Object.hasOwn(pages, target)
      ? pages[target]
      : undefined
    return page === undefined ? '' : String(page)
  }

  /**
   * The text of a per-page token on `page`; a running value before its first
   * setter is empty. A running value that is not known yet (`at="end"` while
   * the page is laid out for its split, and the 'auto' column measure, which
   * passes no values) is the longest value of its name, so the room and the
   * column it is measured with hold every value it can print.
   */
  const tokenValue = (part: Exclude<TextPart, string>, page: EnginePageProps): string => {
    if (part.token === PDF_PRIMITIVES.RunningText) {
      const values = page.running?.[part.at]
      return values === undefined ? longestRunning.get(part.name) ?? '' : values[part.name] ?? ''
    }
    if (page.reserve !== undefined) return '0'.repeat(page.reserve)
    return String(part.token === PDF_PRIMITIVES.PageNumber ? page.pageNumber : page.totalPages ?? '')
  }

  const dynamicText = (
    node: PdfElementNode,
    props: Record<string, unknown>,
    insideText: boolean,
  ): ElementNode => {
    // Unreachable for a mounted tree: validate-tree.ts (`validatePerPageText`)
    // rejects both cases with the template position. The engine lays a nested
    // text out as part of its parent's lines, which are fixed before the
    // per-page callback runs; the number would not print.
    const running = node.children.some(child => child.type === PDF_PRIMITIVES.RunningText)
    if (insideText) {
      treeInvalid(running
        ? '<PdfRunningText> is not supported in a <PdfText> nested inside another <PdfText>. Put it in the outer text.'
        : '<PdfPageNumber> and <PdfPageCount> are not supported in a <PdfText> nested inside another <PdfText>.')
    }

    const parts: TextPart[] = []
    for (const child of node.children) {
      if (child.type === PDF_PRIMITIVES.TextInstance) parts.push(child.value)
      else if (child.type === PDF_PRIMITIVES.PageRef) parts.push(pageRefText(child))
      else if (
        child.type === PDF_PRIMITIVES.PageNumber
        || child.type === PDF_PRIMITIVES.PageCount
      ) {
        parts.push({ token: child.type })
      }
      else if (child.type === PDF_PRIMITIVES.RunningText && typeof child.props.name === 'string') {
        parts.push({ token: child.type, name: child.props.name, at: child.props.at === 'before' || child.props.at === 'end' ? child.props.at : 'top' })
      }
      else {
        // A dynamic text returns one string per page, so it cannot keep nested
        // elements.
        treeInvalid(running
          ? 'A <PdfText> that contains <PdfRunningText> cannot contain other elements. Style the whole text, or put the other elements in a text of their own.'
          : 'A <PdfText> that contains <PdfPageNumber> or <PdfPageCount> cannot contain other elements.')
      }
    }

    // Pure: the same page gives the same text, and a call changes nothing. The
    // 'auto' column measure (layout/dimensions/table-columns.ts) calls it ten
    // times with made-up page numbers; a stateful callback would break it. It
    // returns the parts, the token values told apart, so pagination can cut
    // the text between pages in part coordinates (paginate/dynamic.ts).
    const render = (page: EnginePageProps): TextParts => parts.map(part => typeof part === 'string'
      ? { value: part, token: false }
      // The engine calls once without the total, during pagination, and again
      // with it. The first result only sizes the text.
      : { value: tokenValue(part, page), token: true, ...(part.token === PDF_PRIMITIVES.RunningText ? {} : { page: true }) })

    return {
      type: PDF_PRIMITIVES.Text,
      box: {},
      style: node.style,
      props: { ...props, render },
      children: [],
    }
  }

  /**
   * The carrier of a page-conditional node: a `fixed` view without a box of
   * its own (inset 0 and absolute when the node is absolute, so its offsets
   * keep their reference box), marked with its pages (`PAGES_PROP`). The page
   * builder shows the node on the parts of its parent where it appears and
   * leaves it out elsewhere (layout/paginate/builder.ts), so it needs no
   * earlier pass.
   */
  const carrier = (node: PdfElementNode, inner: ElementNode, condition: PageCondition): ElementNode => ({
    type: PDF_PRIMITIVES.View,
    box: {},
    style: isAbsolute(node.style) ? ABSOLUTE_CARRIER : {},
    props: { fixed: true, [PAGES_PROP]: condition },
    children: [inner],
  })

  /**
   * `structure` is what the structure planner knows about the ancestors.
   * `richNotes` holds the id and number of each note of the nearest
   * `PdfRichText`, in order, for the footnotes that mark one of them again.
   * `insideColumns` is true below a column container (a view or a page).
   */
  type Scope = { insideText: boolean, structure: StructureScope, richNotes?: { id: string, number: number }[], insideColumns?: boolean }

  /**
   * A nested text with a footnote's number, in the mark style. Numbered per
   * page, it holds the number through the document, which has as many digits
   * as the page's number can have, laid out in the widest digit
   * (`NUMBER_RESERVE_PROP`); the page walk prints the page's number.
   */
  const numberNode = (number: number, props: Record<string, unknown>): ElementNode => ({
    type: PDF_PRIMITIVES.Text,
    box: {},
    style: footnoteStyle('mark'),
    props: pageNumbering ? { ...props, [NUMBER_RESERVE_PROP]: true } : props,
    children: [{ type: PDF_PRIMITIVES.TextInstance, value: String(number) }],
  })

  /**
   * A footnote becomes its mark, a nested text that links to its note. The
   * first mark of a note has the id the note's number links back to. The
   * note goes to the page's `notes`: a text with the reserved id, the number
   * in the mark style, and the content. With `footnotes: 'page'` the page
   * walk numbers the marks after layout (footnote-numbers.ts): by the mark,
   * not the note, so a note that does not fit on its mark's page moves to the
   * next one (rule 11) and keeps the number its mark shows.
   */
  const footnote = (node: PdfElementNode, scope: Scope): ElementNode => {
    const repeat = node.props[PDF_FOOTNOTE_REPEAT_PROP]
    if (typeof repeat === 'number') {
      const marked = scope.richNotes?.[repeat - 1]
      // Unreachable for a mounted tree: rich text only marks a note it rendered before.
      if (marked === undefined) return treeInvalid('A repeated footnote mark has no note before it in its <PdfRichText>.')
      const href = `#${marked.id}`
      const tagged = planner?.footnoteMark(scope.structure, href)
      return numberNode(marked.number, { href: tagged?.href ?? href })
    }
    const number = footnoteCount += 1
    const id = `${PDF_FOOTNOTE_ID_PREFIX}${number}`
    const markId = `${id}${FOOTNOTE_MARK_ID_SUFFIX}`
    scope.richNotes?.push({ id, number })
    const href = `#${id}`
    const backHref = `#${markId}`
    const tagged = planner?.footnoteMark(scope.structure, href)
    const note = tagged === undefined ? undefined : planner?.footnoteNote(tagged.reference, id, backHref, scope.structure)
    pageNotes.push({
      type: PDF_PRIMITIVES.Text,
      box: {},
      ...(node.source === undefined ? {} : { source: node.source }),
      style: footnoteStyle('note'),
      props: note === undefined ? { id, [NOTE_NUMBER_PROP]: number } : { id, [NOTE_NUMBER_PROP]: number, [STRUCTURE_PROP]: note.info },
      children: [
        numberNode(number, { href: note?.href ?? backHref }),
        { type: PDF_PRIMITIVES.TextInstance, value: ' ' },
        ...convertChildren(node.children, { insideText: true, structure: note?.children ?? scope.structure }),
      ],
    })
    return numberNode(number, { id: markId, href: tagged?.href ?? href })
  }

  /**
   * The engine node of a child: a string stays, a page reference becomes its
   * text, and an element is copied (`convertElement`). `convertChildren`
   * drops attachments before, and per-page tokens only occur inside a dynamic
   * text, so every element here is one the layout lays out.
   */
  const convert = (node: PdfNode, scope: Scope): LayoutNode => {
    if (node.type === PDF_PRIMITIVES.TextInstance) return node

    if (isPageToken(node)) {
      if (node.type !== PDF_PRIMITIVES.PageRef || !scope.insideText) {
        // Unreachable for a mounted tree: the renderer only accepts tokens
        // inside PdfText, and that case is handled by the parent below.
        treeInvalid('A page token is only supported directly inside <PdfText>.')
      }
      return { type: PDF_PRIMITIVES.TextInstance, value: pageRefText(node) }
    }

    if (node.type === PDF_PRIMITIVES.Footnote) return footnote(node, scope)

    return convertElement(node, scope)
  }

  /**
   * The props an element passes to the engine and the scope of its children,
   * for every element and the document.
   */
  const engineNodeProps = (node: PdfElementNode, scope: Scope): { props: Record<string, unknown>, children: Scope } => {
    const props = engineProps(node)
    // The measuring layout (never serialized) reads `pages` to count each page kind.
    if (!options.conditionalAsFixed) delete props.pages
    // Read by the planner below; layout never sees it, so bytes stay the same.
    Reflect.deleteProperty(props, PDF_HEADER_CELL_PROP)
    Reflect.deleteProperty(props, PDF_TABLE_CAPTION_PROP)
    Reflect.deleteProperty(props, PDF_CONTENTS_PART_PROP)
    // `contents: false` is for PdfContents only; the outline takes title and expanded.
    const { bookmark } = props
    if (typeof bookmark === 'object' && bookmark !== null && 'contents' in bookmark) {
      const { contents: _contents, ...outline } = bookmark
      props.bookmark = outline
    }
    // A text or a table row that sets a running value: its name and the
    // value (layout/paginate/running.ts).
    const running = node.type === PDF_PRIMITIVES.Text ? props.running : props[PDF_RUNNING_ROW_PROP]
    if (running !== undefined) {
      delete props.running
      Reflect.deleteProperty(props, PDF_RUNNING_ROW_PROP)
      const name = pdfRunningName(running)
      const text = typeof running === 'object' && running !== null && 'text' in running && typeof running.text === 'string' ? running.text : plainTextOf(node)
      if (name !== undefined) {
        props[RUNNING_PROP] = { name, text } satisfies RunningSetter
        if (text.length > (longestRunning.get(name)?.length ?? -1)) longestRunning.set(name, text)
      }
    }
    // The engine copies props to every fragment, so a split text keeps its element.
    const structure = planner?.enter(node, scope.structure)
    if (structure?.info !== undefined) props[STRUCTURE_PROP] = structure.info
    if (structure?.href !== undefined) props.href = structure.href
    if (structure?.figure !== undefined) props[INLINE_FIGURE_PROP] = structure.figure
    return {
      props,
      children: {
        insideText: scope.insideText || node.type === PDF_PRIMITIVES.Text,
        structure: structure?.children ?? scope.structure,
        richNotes: node.component === 'PdfRichText' ? [] : scope.richNotes,
        insideColumns: scope.insideColumns === true || setsPdfColumns(node.style),
      },
    }
  }

  const convertElement = (node: PdfElementNode, scope: Scope): WithNotes<ElementNode> => {
    const { type } = node
    if (!isLaidOutType(type)) {
      // Unreachable for a mounted tree: admission places these at the top only.
      return treeInvalid(`<${PDF_PRIMITIVE_NAMES[type]}> cannot be laid out inside another element.`)
    }

    const condition = pageCondition(node)
    if (condition !== undefined && !options.conditionalAsFixed) {
      const { fixed: _fixed, pages: _pages, ...rest } = node.props
      // A page-conditional node is `fixed`, so it stays an artifact without the prop.
      const inner = convertElement({ ...node, props: rest }, { ...scope, structure: artifactScope(scope.structure) })
      return carrier(node, inner, condition)
    }

    if (type === PDF_PRIMITIVES.Image) requireAdmittedImage(node)

    const { props, children } = engineNodeProps(node, scope)

    if (type === PDF_PRIMITIVES.Text && node.children.some(isPerPageToken)) {
      return dynamicText(node, props, scope.insideText)
    }

    if (
      type === PDF_PRIMITIVES.View
      && node.children.some(isFixed)
      && node.children.some(child => !isFixed(child))
    ) {
      const key = String(nextKey++)
      orphanWatch.add(key)
      // In a column container a page break here would move the view past
      // every later column: it starts the next column instead, and after
      // the last column the next page.
      if (breaks.has(key)) props.break = scope.insideColumns === true ? 'column' : true
      props[LAYOUT_KEY_PROP] = key
    }
    else if (type === PDF_PRIMITIVES.Page || isUnbreakableFlowNode(node)) {
      props[LAYOUT_KEY_PROP] = String(nextKey++)
    }

    const outerNotes = pageNotes
    if (type === PDF_PRIMITIVES.Page) pageNotes = []
    const content = type === PDF_PRIMITIVES.Page && setsPdfColumns(node.style)
      ? pageColumns(node, children)
      : { style: node.style, children: convertChildren(node.children, children) }
    const notes = type === PDF_PRIMITIVES.Page && pageNotes.length > 0
      ? { notes: pageNotes, noteArea: { type: PDF_PRIMITIVES.View, box: {}, style: footnoteStyle('area'), props: {}, children: ruleNodes() } }
      : {}
    if (type === PDF_PRIMITIVES.Page) pageNotes = outerNotes
    return {
      type,
      box: {},
      props,
      // Host data for diagnostics; the engine ignores unknown node fields.
      ...(node.source === undefined ? {} : { source: node.source }),
      ...content,
      ...notes,
    }
  }

  /**
   * A `PdfPage` with columns: its flow children go into one implicit
   * view, which the column layout makes a column container. Which page keys
   * the view takes, and why: shared/columns.ts. The view is a grouping view
   * without a structure element, so its children keep the page's scope. The
   * page keeps its fixed and absolute children: fixed nodes stay full width,
   * absolute ones keep their offsets against the page box. The view takes
   * the place of the first flow child.
   */
  const pageColumns = (page: PdfElementNode, scope: Scope): { style: InputStyle, children: LayoutNode[] } => {
    const style = flattenStyle(page.style)
    const first = page.children.findIndex(isPageFlow)
    const columnStyle = {
      ...Object.fromEntries(Object.entries(style).filter(([key]) => PDF_PAGE_COLUMN_KEYS.has(key) || PDF_PAGE_FLOW_KEYS.has(key))),
      alignSelf: 'stretch',
    }
    const pageStyle = Object.fromEntries(Object.entries(style).filter(([key]) => !PDF_PAGE_COLUMN_KEYS.has(key)))
    if (first === -1) return { style: pageStyle, children: convertChildren(page.children, scope) }
    // Converted in the order they are placed, so every pass gives the same keys.
    const before = convertChildren(page.children.slice(0, first), scope)
    const view: ElementNode = {
      type: PDF_PRIMITIVES.View,
      box: {},
      style: columnStyle,
      props: {},
      children: convertChildren(page.children.filter(isPageFlow), scope),
    }
    const after = convertChildren(page.children.slice(first).filter(child => !isPageFlow(child)), scope)
    return { style: pageStyle, children: [...before, view, ...after] }
  }

  /**
   * A page reference becomes text and joins the text instances next to it,
   * so `"see p. r2p"` and `"16"` are one string: shaped as one run, with
   * kerning and ligatures across the number, it gives the bytes of the same
   * text written out. Line breaking does not need the join: a word
   * across runs is one word (`wrapWords`).
   */
  const convertChildren = (nodes: readonly PdfNode[], scope: Scope): LayoutNode[] => {
    const converted: LayoutNode[] = []
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

  // A document holds pages and files only (admission), and the files are left out.
  const root = engineNodeProps(document, { insideText: false, structure: ROOT_STRUCTURE_SCOPE })
  const engineDocument: DocumentNode = {
    type: PDF_PRIMITIVES.Document,
    props: root.props,
    style: document.style,
    children: convertChildren(document.children, root.children).map(page =>
      page.type === PDF_PRIMITIVES.TextInstance ? treeInvalid('<PdfDocument> holds pages only.') : page),
  }
  const { onPage } = options
  if (onPage) engineDocument.onPage = onPage

  return {
    document: engineDocument,
    usesPageRefs,
    numbersFootnotesByPage: pageNumbering && footnoteCount > 0,
    orphanWatch,
  }
}

const samePages = (a: DestinationPageMap, b: DestinationPageMap): boolean => {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => a[key] === b[key])
}

/** `produced` is a fixed point of `fed`. */
const sameFacts = (produced: PlainLayoutFacts, fed: PlainLayoutFacts): boolean =>
  samePages(produced.destinations, fed.destinations)
  && produced.breaks.length === fed.breaks.length
  && produced.breaks.every((key, index) => key === fed.breaks[index])

const describeMap = (map: DestinationPageMap): string => {
  const entries = Object.entries(map)
  if (entries.length === 0) return '(empty)'
  return entries.map(([id, page]) => `#${id}→p${page}`).join(', ')
}

const describeFacts = (facts: PlainLayoutFacts): string => {
  const parts = [describeMap(facts.destinations)]
  if (facts.breaks.length > 0) parts.push(`new-page views ${facts.breaks.join(', ')}`)
  return parts.join('; ')
}

// The fixed-point layout loop. It resolves what one layout can only learn from
// a finished layout: page-reference (`PAGE_REF`) numbers, views that must
// start on a new page so a repeated header is not left alone:
//
//   toEngineDocument(facts) → layoutPdfTree → read facts → repeat until stable
//
// Each pass builds a fresh engine tree from the plain document with the
// latest facts, so the one layout step that writes into its input
// (`resolveBookmarks` replaces `props.bookmark`, see CONTRACTS.md "Layout
// purity contract") never reaches the next pass or the mounted tree. Internal
// `#id` links alone do not need the loop: a named destination is resolved by
// name in a single pass.

const DEFAULT_MAX_PASSES = 5

/** The facts a pass reports, given the engine tree and the facts it was built with. */
const readFacts = (layout: SafeDocumentNode, engine: EngineDocument, fed: PlainLayoutFacts): PlainLayoutFacts => {
  const orphans = findOrphanedViews(layout, engine.orphanWatch)
  return {
    destinations: engine.usesPageRefs ? extractDestinationPages(layout) : {},
    breaks: [...new Set([...fed.breaks, ...orphans])].sort(),
  }
}

interface FixedPoint {
  /** The engine tree of the pass that converged; it is serialized. */
  document: DocumentNode
  layout: SafeDocumentNode
  /** Layout passes run (1 when pass 1 already reports its own input). */
  passes: number
  /** The stable facts the converged pass was built with. */
  facts: PlainLayoutFacts
}

/**
 * Lay the document out until the facts a layout PRODUCES equal the facts it
 * was laid out WITH. Throws a `PDF_LIMIT_EXCEEDED` NuxtPdfError after
 * `maxPasses` (a positive integer, checked by definePdf) instead of looping
 * forever or shipping wrong page numbers.
 */
const layoutToFixedPoint = async (
  document: PdfElementNode,
  { guard, fontStore, maxPasses, limits }: {
    guard: EngineDocumentOptions
    fontStore: PdfFontStore
    maxPasses: number
    limits: RenderLimits | undefined
  },
): Promise<FixedPoint> => {
  let fed = EMPTY_LAYOUT_FACTS
  for (let pass = 1; ; pass += 1) {
    const engine = toEngineDocument(document, fed, guard)
    // layoutPdfTree checks the shared deadline before and after each pass and
    // enforces the page cap on every laid-out result, so the whole loop is
    // bounded by the same budget without a second enforcement site here.
    const layout = await layoutPdfTree(engine.document, fontStore, limits)
    const produced = readFacts(layout, engine, fed)
    if (sameFacts(produced, fed)) {
      return { document: engine.document, layout: engine.numbersFootnotesByPage ? numberFootnotesByPage(layout) : layout, passes: pass, facts: produced }
    }
    if (pass >= maxPasses) {
      // The message shows what the last pass was laid out with and what it
      // reported instead.
      throw new NuxtPdfError(
        PDF_ERROR_CODES.LimitExceeded,
        `Page numbers did not stabilize after ${maxPasses} layout passes. `
        + `This means a document's layout depends on the page numbers it prints — usually a `
        + `table-of-contents entry whose height changes with the page number it shows, forming a `
        + `feedback loop. Fix the entry so its size does not depend on the number (e.g. a fixed-width `
        + `number column, or reserve the line height up front), or raise maxPasses if the document is `
        + `legitimately this deep. Last fed: ${describeFacts(fed)}; last produced: ${describeFacts(produced)}.`,
      )
    }
    fed = produced
  }
}

interface PlainRenderOptions {
  compress?: boolean
  fontStore?: PdfFontStore
  limits?: RenderLimits
  /** Hard cap on layout passes. */
  maxPasses?: number
}

interface PlainRenderResult {
  bytes: Uint8Array<ArrayBuffer>
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

/**
 * The page with only what decides the height of its in-flow `fixed` nodes:
 * the nodes themselves and their ancestors. Each run of other content becomes
 * one empty view, which keeps its place in the flow and takes no height. A
 * row is pruned like any container: `inspectFixedFlow` does not measure
 * inside a row. Keeping a row's content would lay the whole row out once more
 * (12 % of a render with a 143-page row).
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
  return new NuxtPdfError(
    PDF_ERROR_CODES.LayoutError,
    `${subject}, but ${pages} has ${pointText(blocked.availableHeight)} for content. `
    + 'A fixed node repeats above the content that follows it, so that content never fits and pagination cannot end. '
    + 'Make the fixed content lower than the page content area, give it position: absolute, or remove fixed so it can break across pages.',
    first.source ? { source: first.source } : {},
  )
}

const elementChildren = (node: PdfElementNode): PdfElementNode[] =>
  node.children.filter((child): child is PdfElementNode => child.type !== PDF_PRIMITIVES.TextInstance)

/** The in-flow `fixed` child of `container` that stands between flow children. */
const fixedChildBetweenFlow = (container: PdfElementNode): PdfElementNode | undefined => {
  const flow = elementChildren(container).filter(child => !isAbsolute(child.style))
  const first = flow.findIndex(child => child.props.fixed !== true)
  const last = flow.findLastIndex(child => child.props.fixed !== true)
  return first === -1 ? undefined : flow.slice(first + 1, last).find(child => child.props.fixed === true)
}

/**
 * The first in-flow `fixed` node between the flow children of a view or link
 * inside `node`, with that container. A row's children sit side by side, so a
 * fixed cell repeats beside the others; a fixed or `wrap={false}` container
 * never breaks, so what it holds never repeats.
 */
const fixedBetweenFlowIn = (node: PdfElementNode): { node: PdfElementNode, parent: PdfElementNode } | undefined => {
  for (const child of elementChildren(node)) {
    if ((child.type !== PDF_PRIMITIVES.View && child.type !== PDF_PRIMITIVES.Link) || child.props.fixed === true || child.props.wrap === false) continue
    const direction = resolvedStyleValue(child.style, 'flexDirection')
    const fixed = direction === 'row' || direction === 'row-reverse' ? undefined : fixedChildBetweenFlow(child)
    const found = fixed ? { node: fixed, parent: child } : fixedBetweenFlowIn(child)
    if (found) return found
  }
  return undefined
}

/**
 * A typed error for an in-flow `fixed` node between flow content, directly on
 * a page or in a view. Pagination repeats it on every page of its parent in
 * its order among the flow, so on a page that ends before it, it sits below
 * that page's flow and the flow is squeezed to make room: lines overlap. An
 * absolute one takes no room.
 */
const fixedBetweenFlowError = (document: PdfElementNode): NuxtPdfError | undefined => {
  const pages = document.children.filter((page): page is PdfElementNode => page.type === PDF_PRIMITIVES.Page)
  const at = (node: PdfElementNode) => {
    const source = parsePdfSourcePosition(node.source)
    return { source, where: source ? ` at ${source.file}:${source.line}:${source.column}` : '' }
  }
  for (const [index, page] of pages.entries()) {
    const onPage = fixedChildBetweenFlow(page)
    const found = onPage ? { node: onPage, parent: undefined } : fixedBetweenFlowIn(page)
    if (found === undefined) continue
    const { node, parent } = found
    const { source, where } = at(node)
    const which = pages.length > 1 ? ` of <PdfPage> ${index + 1}` : ''
    const container = parent ? ` of a <${PDF_PRIMITIVE_NAMES[parent.type] ?? parent.type}>${at(parent).where}` : ''
    return new NuxtPdfError(
      PDF_ERROR_CODES.LayoutError,
      `A fixed <${PDF_PRIMITIVE_NAMES[node.type] ?? node.type}>${where} is between the flow content${container}${which}. `
      + `A fixed node repeats on every page${parent ? ' its parent reaches' : ''}, so on a page that ends before it, the content of that page would be squeezed to make room for it. `
      + 'Put fixed nodes before the flow (a header) or after it (a footer written last), or give the node position: absolute.',
      source ? { source } : {},
    )
  }
  return undefined
}

/**
 * The check pagination runs once per page: at the deadline, a typed error.
 * A pagination whose pages stop taking content fails with "Pagination cannot
 * end" (`paginate/index.ts`), and one that takes content on every page
 * without ending fails at `maxPages` (`layout-pass.ts`), or here first.
 */
const paginationDeadline = (limits: RenderLimits): (() => void) => () => {
  if (limits.deadline.remainingMs() > 0) return
  limits.deadline.check()
  throw renderDeadlineError(limits.timeoutMs, limits.timeoutMs)
}

/**
 * Lay out and serialize a plain-data document tree.
 *
 * Every document runs the fixed-point loop: each pass rebuilds the engine tree
 * from data with the facts of the previous pass, until the facts stop
 * changing. A document that uses none of them stops after one pass.
 */
export const renderPlainDocument = async (
  mounted: PdfElementNode,
  options: PlainRenderOptions = {},
): Promise<PlainRenderResult> => {
  const { limits } = options
  const document = expandPdfContents(mounted)
  const fontStore = options.fontStore ?? createPdfFontStore()
  const between = fixedBetweenFlowError(document)
  if (between) throw between
  const fixedFlow = await measureFixedFlow(document, fontStore, limits)
  if (fixedFlow?.blocked) throw fixedFlowError(fixedFlow.blocked)
  // Pagination checks the deadline once per page, in the worker too.
  const guard: EngineDocumentOptions = limits ? { onPage: paginationDeadline(limits) } : {}
  const attachments = takeAttachments(document)
  const result = await layoutToFixedPoint(document, {
    guard,
    fontStore,
    maxPasses: options.maxPasses ?? DEFAULT_MAX_PASSES,
    limits,
  })
  const bytes = await serializePdfLayout(result.document.props, result.layout, options.compress ?? true, limits, attachments)

  // Upstream shrinks an unbreakable block that is higher than the page and
  // only logs it. One more layout measures the candidates; the PDF is done.
  const candidates = findShrinkCandidates(result.layout)
  const naturalHeights = candidates.keys.size === 0
    ? undefined
    : await measureNaturalHeights(
        toEngineDocument(document, result.facts).document,
        candidates,
        fontStore,
        limits,
      )

  return {
    bytes,
    layout: result.layout,
    layoutWarnings: collectLayoutWarnings(result.layout, naturalHeights),
    passes: result.passes,
  }
}
