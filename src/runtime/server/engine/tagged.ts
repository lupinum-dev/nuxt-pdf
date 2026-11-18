// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./react-pdf-pdfkit.d.ts" />

// Tagged PDF for PDF/UA-1 and PDF/A-3a: the structure tree, the marked
// content and the tagged annotations of a document that claims one of them
// (see "Tagged PDF" in CONTRACTS.md). A document without the claim never
// reaches this file, so its bytes do not change.
//
// How it works, in short. The engine adapter asks `createStructurePlanner`
// for the structure of every node in tree order and stores the answer on the
// node (`STRUCTURE_PROP`); pagination copies it to every fragment. A node is
// either a leaf (it paints its own marked content: a text, a figure, a
// text-only cell or link) or a container (table, row, list, section, link
// around blocks), which has no content of its own. Right before the paint,
// each leaf fragment's `id` becomes a `StructureMarker`. The painter paints
// each node between one `save` and one `restore` and calls
// `addNamedDestination(id)` after the node's content, before that `restore`.
// So when a marker arrives, the innermost open `save` is the start of the
// leaf's content, and its `restore` is the end. The page's operators are kept
// in a list and written when the page ends, with `BDC … EMC` around each leaf
// (split around inline links and images) and everything else marked as an
// artifact. Link annotations are predicted from the laid-out pages, so each
// one gets its structure parent before the engine writes it.

import type { SafeDocumentNode } from './layout/index'
import type PDFDocument from '@react-pdf/pdfkit'
import type { PDFContentChunk, PDFReference } from '@react-pdf/pdfkit'
import { PDF_HEADER_CELL_PROP, PDF_PRIMITIVES } from '../../primitives'
import type { PdfElementNode, PdfNode } from '../../renderer'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'

/**
 * Engine-tree prop with the structure of a node (`StructureNodeInfo`),
 * written by `toEngineDocument` in a tagged document. Authors cannot set it:
 * the renderer accepts only the props of the primitive table.
 */
export const STRUCTURE_PROP = '__nuxtPdfStruct'

/** PDF standard structure types this module writes. */
type StructureRole
  = | 'P' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
    | 'Figure' | 'Link'
    | 'Sect' | 'L' | 'LI' | 'LBody' | 'BlockQuote' | 'Caption'
    | 'Table' | 'TR' | 'TH' | 'TD'

const TEXT_ROLES: Readonly<Record<string, StructureRole>> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
  h5: 'H5',
  h6: 'H6',
  p: 'P',
}

const VIEW_ROLES: Readonly<Record<string, StructureRole>> = {
  'section': 'Sect',
  'list': 'L',
  'list-item': 'LI',
  'quote': 'BlockQuote',
  'caption': 'Caption',
  'figure': 'Figure',
}

/** One structure element, planned in tree order (its `index`). */
export interface StructureSpec {
  readonly index: number
  readonly role: StructureRole
  /** The parent element; none for a child of `Document`. */
  readonly parent: StructureSpec | undefined
  readonly alt?: string
  /** Inside a repeated table header: tagged on its first page only. */
  readonly repeats: boolean
  /**
   * A link or figure inside a text: it takes its place among the text's own
   * marked-content parts when it is painted.
   */
  readonly inline: boolean
  /** A link's target and the description its annotation carries. */
  readonly link?: { readonly href: string, readonly contents: string }
  readonly scope?: 'Column' | 'Row'
  /** A text element's inline links and images, in text order. */
  readonly inlines: InlineEntry[]
}

type InlineEntry
  = | { readonly kind: 'link', readonly spec: StructureSpec }
  /** `spec` is undefined for a decorative image: an artifact inside the text. */
    | { readonly kind: 'image', readonly spec: StructureSpec | undefined }

/** The value of `STRUCTURE_PROP`. */
export interface StructureNodeInfo {
  readonly spec: StructureSpec
  /** Paints marked content of `spec`; a container paints none. */
  readonly leaf: boolean
  /** Position in tree order, to place the node's content among child elements. */
  readonly order: number
}

const isStructureInfo = (value: unknown): value is StructureNodeInfo =>
  typeof value === 'object' && value !== null && 'spec' in value && 'leaf' in value

// ---------------------------------------------------------------------------
// Planning (engine adapter, once per layout pass)
// ---------------------------------------------------------------------------

/** What the planner knows about the ancestors of a node. */
export interface StructureScope {
  /** Inside a `fixed` (not a table header) or `decorative` node. */
  readonly artifact: boolean
  readonly insideSvg: boolean
  /** Inside a text: nested nodes are part of its lines. */
  readonly insideText: boolean
  /** The element the enclosing text belongs to; undefined for an artifact text. */
  readonly text: StructureSpec | undefined
  /** The parent of an inline link or figure: the text's element or an inline link. */
  readonly inlineParent: StructureSpec | undefined
  /** The nearest element: the parent of a new one. */
  readonly parent: StructureSpec | undefined
  /** Inside a link around blocks: an untagged text is the link's own content. */
  readonly link: StructureSpec | undefined
  /**
   * The cell of a view cell, for its direct children only: the visible part
   * of a cell wrapper (also a `PdfTableCell` node) belongs to that cell.
   */
  readonly cellWrapper: StructureSpec | undefined
  /** Inside a `PdfTableHeader` (and not inside a table nested in it). */
  readonly header: boolean
  readonly repeats: boolean
  /**
   * Inside the content of a `PdfView tag="figure"` (not inside its caption):
   * every text, image and SVG paints marked content of the figure.
   */
  readonly figure: StructureSpec | undefined
}

export const ROOT_STRUCTURE_SCOPE: StructureScope = {
  artifact: false,
  insideSvg: false,
  insideText: false,
  text: undefined,
  inlineParent: undefined,
  parent: undefined,
  link: undefined,
  cellWrapper: undefined,
  header: false,
  repeats: false,
  figure: undefined,
}

/** The scope inside a page-conditional carrier: running content is an artifact. */
export const artifactScope = (scope: StructureScope): StructureScope => ({ ...scope, artifact: true })

/**
 * An inline link's target as layout sees it in a tagged document: the href,
 * then a NUL and the link element's index. Layout copies it to every run of
 * the link (`attributes.link`), so each run names its own link even when two
 * adjacent links share an href. The annotation wrappers strip the suffix
 * before pdfkit writes the target.
 */
const LINK_MARK = '\u0000'
const markedHref = (href: string, spec: StructureSpec): string => `${href}${LINK_MARK}${spec.index}`
const splitMarkedLink = (value: string): { target: string, index: number | undefined } => {
  const at = value.indexOf(LINK_MARK)
  return at === -1 ? { target: value, index: undefined } : { target: value.slice(0, at), index: Number(value.slice(at + 1)) }
}

/** The text a link carries as its description: its text runs and alt texts. */
const linkText = (node: PdfElementNode): string => {
  const parts: string[] = []
  const visit = (child: PdfNode): void => {
    if (child.type === PDF_PRIMITIVES.TextInstance) {
      parts.push(child.value)
      return
    }
    if (!('props' in child)) return
    const element = child as PdfElementNode
    if (typeof element.props.alt === 'string') parts.push(` ${element.props.alt} `)
    element.children.forEach(visit)
  }
  node.children.forEach(visit)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * The layout engine wraps the children of a link in a text when they are all
 * text runs, or text runs mixed with texts (`transformLink`); such a link
 * paints its text inside its own `save`, so it is a leaf.
 */
const isTextLink = (node: PdfElementNode): boolean => {
  const isText = (child: PdfNode) => child.type === PDF_PRIMITIVES.Text
  const isRun = (child: PdfNode) => child.type === PDF_PRIMITIVES.TextInstance
  if (node.children.every(isRun)) return true
  if (node.children.every(isText)) return false
  return node.children.every(child => isRun(child) || isText(child))
}

/**
 * The structure planner of one engine tree. `enter` returns the structure of
 * a node (`info`, stored as `STRUCTURE_PROP`) and the scope of its children.
 * Indices come from a counter in tree order, so reading order is tree order.
 */
export const createStructurePlanner = () => {
  let next = 0

  const create = (
    role: StructureRole,
    parent: StructureSpec | undefined,
    scope: StructureScope,
    extra: Partial<Pick<StructureSpec, 'alt' | 'link' | 'scope' | 'inline'>> = {},
  ): StructureSpec => ({ index: next++, role, parent, repeats: scope.repeats, inline: false, inlines: [], ...extra })

  const leaf = (spec: StructureSpec, order = spec.index): StructureNodeInfo => ({ spec, leaf: true, order })
  const container = (spec: StructureSpec): StructureNodeInfo => ({ spec, leaf: false, order: spec.index })

  /** `href` replaces an inline link's target in the engine tree (see `markedHref`). */
  const enter = (node: PdfElementNode, scope: StructureScope): { info?: StructureNodeInfo, href?: string, children: StructureScope } => {
    const artifact = scope.artifact
      || node.props.decorative === true
      || (node.props.fixed === true && node.component !== 'PdfTableHeader')
    const base: StructureScope = {
      ...scope,
      artifact,
      insideSvg: scope.insideSvg || node.type === PDF_PRIMITIVES.Svg,
      cellWrapper: undefined,
    }
    if (scope.insideSvg) return { children: base }

    if (scope.insideText) {
      const text = scope.text
      if (text === undefined) return { children: base }
      if (node.type === PDF_PRIMITIVES.Image) {
        const alt = node.props.alt
        const spec = artifact
          ? undefined
          : create('Figure', scope.inlineParent, scope, { inline: true, ...(typeof alt === 'string' ? { alt } : {}) })
        text.inlines.push({ kind: 'image', spec })
        return { children: base }
      }
      if (node.type === PDF_PRIMITIVES.Link && !artifact) {
        const href = String(node.props.href)
        const spec = create('Link', scope.inlineParent, scope, { inline: true, link: { href, contents: linkText(node) || href } })
        text.inlines.push({ kind: 'link', spec })
        return { href: markedHref(href, spec), children: { ...base, inlineParent: spec } }
      }
      return { children: base }
    }

    if (artifact) return { children: base }
    const inText = (spec: StructureSpec): StructureScope => ({ ...base, insideText: true, text: spec, inlineParent: spec })
    const cell = () => {
      if (scope.header) return create('TH', scope.parent, scope, { scope: 'Column' })
      return node.props[PDF_HEADER_CELL_PROP] === true
        ? create('TH', scope.parent, scope, { scope: 'Row' })
        : create('TD', scope.parent, scope)
    }

    // A figure's content is the figure's own marked content, in tree order
    // among its caption. Links, tables and tags inside it fail validation.
    const figure = scope.figure
    if (figure !== undefined) {
      if (node.type === PDF_PRIMITIVES.Text) {
        // Its inline images are part of its lines, not figures of their own.
        return { info: leaf(figure, next++), children: { ...base, insideText: true, text: undefined, inlineParent: undefined } }
      }
      if (node.type === PDF_PRIMITIVES.Image || node.type === PDF_PRIMITIVES.Svg) {
        return { info: leaf(figure, next++), children: base }
      }
      if (node.type === PDF_PRIMITIVES.View && node.props.tag === 'caption') {
        const spec = create('Caption', figure, scope)
        return { info: container(spec), children: { ...base, parent: spec, figure: undefined } }
      }
      return { children: base }
    }

    switch (node.type) {
      case PDF_PRIMITIVES.Text: {
        if (scope.cellWrapper !== undefined && node.component === 'PdfTableCell') {
          return { info: leaf(scope.cellWrapper, next++), children: inText(scope.cellWrapper) }
        }
        if (node.component === 'PdfTableCell') {
          const spec = cell()
          return { info: leaf(spec), children: inText(spec) }
        }
        if (scope.link !== undefined && node.props.tag === undefined) {
          return { info: leaf(scope.link, next++), children: inText(scope.link) }
        }
        const spec = create(TEXT_ROLES[String(node.props.tag ?? 'p')] ?? 'P', scope.parent, scope)
        return { info: leaf(spec), children: inText(spec) }
      }
      case PDF_PRIMITIVES.Image:
      case PDF_PRIMITIVES.Svg: {
        const alt = node.props.alt
        return { info: leaf(create('Figure', scope.parent, scope, typeof alt === 'string' ? { alt } : {})), children: base }
      }
      case PDF_PRIMITIVES.Link: {
        const href = String(node.props.href)
        const spec = create('Link', scope.parent, scope, { link: { href, contents: linkText(node) || href } })
        return isTextLink(node)
          ? { info: leaf(spec), children: inText(spec) }
          : { info: container(spec), children: { ...base, parent: spec, link: spec } }
      }
      case PDF_PRIMITIVES.View:
        break
      default:
        return { children: base }
    }

    switch (node.component) {
      case 'PdfTable': {
        const spec = create('Table', scope.parent, scope)
        return { info: container(spec), children: { ...base, parent: spec, link: undefined, header: false } }
      }
      case 'PdfTableHeader': {
        const spec = create('TR', scope.parent, { ...scope, repeats: true })
        return { info: container(spec), children: { ...base, parent: spec, header: true, repeats: true } }
      }
      case 'PdfTableRow': {
        const spec = create('TR', scope.parent, scope)
        return { info: container(spec), children: { ...base, parent: spec, header: false } }
      }
      case 'PdfTableCell': {
        // The visible part of a cell wrapper belongs to the wrapper's cell.
        if (scope.cellWrapper !== undefined) return { children: base }
        const spec = cell()
        return { info: container(spec), children: { ...base, parent: spec, cellWrapper: spec } }
      }
      default:
        break
    }

    const role = VIEW_ROLES[String(node.props.tag)]
    if (role === undefined) return { children: base }
    if (role === 'Figure') {
      const alt = node.props.alt
      const spec = create('Figure', scope.parent, scope, typeof alt === 'string' ? { alt } : {})
      return { info: container(spec), children: { ...base, parent: spec, figure: spec } }
    }
    const spec = create(role, scope.parent, scope)
    // A list item's content is its body: the author writes no label/body split.
    const parent = role === 'LI' ? create('LBody', spec, scope) : spec
    return { info: container(spec), children: { ...base, parent } }
  }

  return { enter }
}

// ---------------------------------------------------------------------------
// Before the paint: markers, column spans, the annotation plan
// ---------------------------------------------------------------------------

/**
 * The `id` of a painted fragment of a leaf. An object, so no author id can
 * collide with it; the painter passes it to `addNamedDestination` unchanged
 * and reads it nowhere else.
 */
class StructureMarker {
  readonly info: StructureNodeInfo
  /** The author's `id`, on the fragment that keeps it (the first). */
  readonly authorId: string | undefined
  /** The source text of this fragment, for `/ActualText` (see `sourceTexts`). */
  actualText: string | undefined

  // Plain fields: the worker loads this file with type stripping only, which
  // rejects parameter properties.
  constructor(info: StructureNodeInfo, authorId: string | undefined) {
    this.info = info
    this.authorId = authorId
    this.actualText = undefined
  }
}

interface LaidOutRun {
  glyphs?: unknown[]
  positions?: unknown[]
  attributes: { font?: unknown[], link?: string | null, characterSpacing?: number }
}

/** A laid-out engine node, with the fields this file reads. */
interface LaidOutNode {
  type: string
  props?: Record<string, unknown>
  box?: { left: number, marginLeft?: number }
  /** A text instance's string, before `textTransform`. */
  value?: string
  /** The resolved (inherited) style; layout reads `textTransform` from each text instance. */
  style?: { textTransform?: string }
  image?: { format?: string }
  /** A text's lines: the laid-out string of each and its runs. */
  lines?: { string: string, runs: LaidOutRun[] }[]
  children?: LaidOutNode[]
}

const infoOf = (node: LaidOutNode): StructureNodeInfo | undefined => {
  const value = node.props?.[STRUCTURE_PROP]
  return isStructureInfo(value) ? value : undefined
}

const pagesOf = (layout: SafeDocumentNode): LaidOutNode[] =>
  (layout as unknown as LaidOutNode).children ?? []

// ---------------------------------------------------------------------------
// Source text for `/ActualText`
// ---------------------------------------------------------------------------

/** The layout engine's `transformText` (`@react-pdf/layout`, see CONTRACTS.md). */
const transformText = (text: string, transform: string | undefined): string => {
  if (text === '') return text
  switch (transform) {
    case 'uppercase': return text.toUpperCase()
    case 'lowercase': return text.toLowerCase()
    case 'capitalize': return text.replace(/(^|\s)\S/g, letter => letter.toUpperCase())
    case 'upperfirst': return text.charAt(0).toUpperCase() + text.slice(1)
    default: return text
  }
}

/**
 * Whether every character of `text` keeps its length under `transform`, so
 * character `i` of the laid-out string is character `i` of the source. Not
 * so for `ß` → `SS` in upper case, or `İ` in lower case.
 */
const keepsLength = (text: string, transform: string | undefined): boolean => {
  if (transform === 'lowercase') return [...text].every(char => char.toLowerCase().length === char.length)
  if (transform === 'uppercase' || transform === 'capitalize' || transform === 'upperfirst') {
    return [...text].every(char => char.toUpperCase().length === char.length)
  }
  return true
}

/** One text instance: its range in the laid-out string and in the source. */
interface SourceSegment {
  readonly from: number
  readonly to: number
  readonly sourceFrom: number
  readonly sourceTo: number
  /** Character `i` of the range is character `i` of the source range. */
  readonly exact: boolean
}

/**
 * The source and the laid-out string of a text, built like the layout
 * engine's `getFragments`: each text instance transformed by its own
 * resolved `textTransform`, a raster image as U+FFFC, nested texts in order.
 */
const textSource = (text: LaidOutNode) => {
  let source = ''
  let laidOut = ''
  let transformed = false
  const segments: SourceSegment[] = []
  const add = (sourcePart: string, laidOutPart: string, exact: boolean) => {
    segments.push({ from: laidOut.length, to: laidOut.length + laidOutPart.length, sourceFrom: source.length, sourceTo: source.length + sourcePart.length, exact })
    source += sourcePart
    laidOut += laidOutPart
  }
  const visit = (node: LaidOutNode): void => {
    for (const child of node.children ?? []) {
      if (child.type === PDF_PRIMITIVES.TextInstance) {
        const value = child.value ?? ''
        const transform = child.style?.textTransform
        if (transform !== undefined && transform !== 'none') transformed = true
        const part = transformText(value, transform)
        add(value, part, part.length === value.length && keepsLength(value, transform))
      }
      else if (child.type === PDF_PRIMITIVES.Image) {
        if (child.image !== undefined && child.image.format !== 'svg') add('\uFFFC', '\uFFFC', true)
      }
      else {
        visit(child)
      }
    }
  }
  visit(text)
  return { source, laidOut, transformed, segments }
}

/** Laid-out characters that are not in any line: line breaks and soft hyphens. */
const NOT_IN_LINES = new Set(['\n', '\r', '\u00AD'])

/**
 * The source text of each fragment of one text, in page order, or undefined
 * where it cannot be derived exactly. The fragments' lines are walked against
 * the laid-out string: layout drops line breaks and soft hyphens from the
 * lines and adds a hyphen where it splits a word. A fragment maps back to
 * the source when its two ends map: inside a length-keeping instance, or on
 * the boundary of one that changes length (`ß` → `SS`). After a line that
 * does not match (an ellipsis, an emoji image) no later fragment gets one.
 */
const fragmentSources = (fragments: readonly LaidOutNode[]): (string | undefined)[] => {
  const { source, laidOut, segments } = textSource(fragments[0]!)
  const sourceAt = (position: number, end: boolean): number | undefined => {
    const segment = segments.find(item => item.from < item.to && (end
      ? position > item.from && position <= item.to
      : position >= item.from && position < item.to))
    if (segment === undefined) return undefined
    if (segment.exact) return segment.sourceFrom + position - segment.from
    if (!end && position === segment.from) return segment.sourceFrom
    if (end && position === segment.to) return segment.sourceTo
    return undefined
  }
  let cursor = 0
  let aligned = true
  return fragments.map((fragment) => {
    if (!aligned) return undefined
    while (NOT_IN_LINES.has(laidOut[cursor] ?? '')) cursor += 1
    const start = cursor
    for (const line of fragment.lines ?? []) {
      for (let index = 0; index < line.string.length && aligned; index += 1) {
        const char = line.string[index]
        while (laidOut[cursor] !== char && NOT_IN_LINES.has(laidOut[cursor] ?? '')) cursor += 1
        if (laidOut[cursor] === char) cursor += 1
        else if (!(char === '-' && index === line.string.length - 1)) aligned = false
      }
    }
    if (!aligned || cursor === start) return undefined
    const from = sourceAt(start, false)
    const to = sourceAt(cursor, true)
    return from === undefined || to === undefined ? undefined : source.slice(from, to)
  })
}

/**
 * Whether a text needs `/ActualText`: a `textTransform` changes its glyphs,
 * or letter spacing makes text extraction read single letters.
 */
const needsActualText = (fragments: readonly LaidOutNode[]): boolean =>
  textSource(fragments[0]!).transformed
  || fragments.some(fragment => (fragment.lines ?? []).some(line =>
    line.runs.some(run => (run.attributes.characterSpacing ?? 0) !== 0)))

/**
 * Set `actualText` on the markers of the texts that need it. A text with
 * inline links or images is left out: its marked content is split into
 * parts, and each part would need the source of its own runs.
 */
const sourceTexts = (texts: ReadonlyMap<unknown, readonly { node: LaidOutNode, marker: StructureMarker }[]>): void => {
  for (const fragments of texts.values()) {
    const nodes = fragments.map(fragment => fragment.node)
    if (!needsActualText(nodes)) continue
    fragmentSources(nodes).forEach((text, index) => {
      fragments[index]!.marker.actualText = text
    })
  }
}

/** A PDF text string in hex: UTF-16BE with its byte order mark. */
const pdfTextHex = (text: string): string => {
  let hex = 'FEFF'
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')
  return `<${hex}>`
}

/**
 * Collect every element, replace the `id` of every leaf fragment with its
 * marker, and read the column span of each cell from the laid-out rows. Runs
 * on the converged layout after `anchorDestinationsAtFirstPage`, so only the
 * first fragment still carries an author id. Each fragment has its own props
 * (pagination copies them); a repeated header is one node on every page and
 * gets the same marker each time.
 */
const prepareLayout = (layout: SafeDocumentNode) => {
  const specs = new Map<number, StructureSpec>()
  const register = (spec: StructureSpec | undefined): void => {
    if (spec === undefined || specs.has(spec.index)) return
    specs.set(spec.index, spec)
    register(spec.parent)
    for (const entry of spec.inlines) register(entry.spec)
  }
  // Table index → row index → the start of each cell, in row order.
  const rows = new Map<number, Map<number, { cell: number, start: number }[]>>()
  // The fragments of each text leaf in page order, keyed by its node's info
  // (shared by its fragments); a repeated header's text is whole on each page.
  const texts = new Map<unknown, { node: LaidOutNode, marker: StructureMarker }[]>()

  const visit = (node: LaidOutNode): void => {
    const info = infoOf(node)
    if (info !== undefined && node.props !== undefined) {
      register(info.spec)
      if (info.leaf) {
        const id = node.props.id
        const marker = new StructureMarker(info, typeof id === 'string' ? id : undefined)
        node.props = { ...node.props, id: marker }
        if (node.type === PDF_PRIMITIVES.Text && info.spec.role !== 'Figure' && info.spec.inlines.length === 0) {
          const key = info.spec.repeats ? marker : info
          texts.set(key, [...(texts.get(key) ?? []), { node, marker }])
        }
      }
      const table = info.spec.parent
      if (info.spec.role === 'TR' && table !== undefined) {
        const tableRows = rows.get(table.index) ?? new Map<number, { cell: number, start: number }[]>()
        rows.set(table.index, tableRows)
        if (!tableRows.has(info.spec.index)) {
          tableRows.set(info.spec.index, (node.children ?? []).flatMap((child) => {
            const cell = infoOf(child)?.spec
            const box = child.box
            return cell !== undefined && box !== undefined && (cell.role === 'TH' || cell.role === 'TD')
              ? [{ cell: cell.index, start: box.left - (box.marginLeft ?? 0) }]
              : []
          }))
        }
      }
    }
    node.children?.forEach(visit)
  }
  pagesOf(layout).forEach(visit)
  sourceTexts(texts)

  return { specs, colSpans: columnSpans(rows) }
}

/**
 * The column span of each cell, from geometry: the columns of a table start
 * where any of its cells starts, and a cell covers the column starts up to
 * the next cell of its row. The table components keep `colspan` to
 * themselves, and the cells of one row sit side by side, so this is exact for
 * every column that some row starts a cell in.
 */
const columnSpans = (rows: ReadonlyMap<number, ReadonlyMap<number, readonly { cell: number, start: number }[]>>): Map<number, number> => {
  const spans = new Map<number, number>()
  const round = (value: number) => Math.round(value * 100) / 100
  for (const tableRows of rows.values()) {
    const starts = [...new Set([...tableRows.values()].flatMap(cells => cells.map(cell => round(cell.start))))]
    for (const cells of tableRows.values()) {
      cells.forEach((cell, position) => {
        const from = round(cell.start)
        const to = position + 1 < cells.length ? round(cells[position + 1]!.start) : Number.POSITIVE_INFINITY
        const span = starts.filter(start => start >= from && start < to).length
        if (span > 1) spans.set(cell.cell, span)
      })
    }
  }
  return spans
}

interface PlannedAnnotation {
  /** The link element; undefined when the walk found a link outside the structure. */
  readonly link: StructureSpec | undefined
  readonly target: string
  /** In a text: its marked content is the run, inside the text's span. */
  readonly inline: boolean
}

/**
 * The link annotations of each page, in the order the painter writes them:
 * `renderNode` calls `setLink` for a link node before its children, does not
 * recurse into texts and SVGs, and `renderText` calls `link`/`goTo` for every
 * run with glyphs, positions, a font and a `link`. A run of an inline link
 * names its link element (`markedHref`), so each `PdfLink` is its own element,
 * also next to another link with the same href.
 */
const planAnnotations = (layout: SafeDocumentNode): PlannedAnnotation[][] =>
  pagesOf(layout).map((page) => {
    const planned: PlannedAnnotation[] = []
    const visit = (node: LaidOutNode): void => {
      const info = infoOf(node)
      const props = node.props ?? {}
      if (node.type === PDF_PRIMITIVES.Link && node.box !== undefined) {
        const target = typeof props.src === 'string' ? props.src : props.href
        if (typeof target === 'string') planned.push({ link: info?.spec, target, inline: false })
      }
      if (node.type === PDF_PRIMITIVES.Text && node.box !== undefined && node.lines !== undefined) {
        const inlines = info?.spec.inlines ?? []
        for (const line of node.lines) {
          for (const run of line.runs) {
            const value = run.attributes.link
            // Layout writes `null` or `undefined` for a run outside a link.
            if (typeof value !== 'string') continue
            if (run.glyphs === undefined || run.positions === undefined || run.attributes.font?.[0] === undefined) continue
            const { target, index } = splitMarkedLink(value)
            const link = inlines.find(entry => entry.kind === 'link' && entry.spec.index === index)?.spec
            planned.push({ link, target, inline: true })
          }
        }
      }
      if (node.type !== PDF_PRIMITIVES.Text && node.type !== PDF_PRIMITIVES.Svg) node.children?.forEach(visit)
    }
    visit(page)
    return planned
  })

// ---------------------------------------------------------------------------
// The paint
// ---------------------------------------------------------------------------

type Kid
  = | { readonly order: number, readonly kind: 'mcr', readonly page: PDFReference, readonly mcid: number }
    | { readonly order: number, readonly kind: 'objr', readonly page: PDFReference, readonly annotation: PDFReference }
    | { readonly order: number, readonly kind: 'element', readonly index: number }

interface ElementState {
  /** Content and inline elements in paint order. */
  kids: Kid[]
  /** An inline element: already placed among its parent's kids. */
  placed: boolean
  /** The page of its first marked content (a repeated element is tagged there only). */
  firstPage: number | undefined
  /** Next inline image entry of a text element. */
  imageCursor: number
}

interface OpenSave {
  /** Index of the `q` in the page's operator list. */
  start: number
  /** Set when the marker of the leaf that opened this `save` arrives. */
  leaf?: StructureMarker
  /** Index of the first operator after the marker: only `renderDebug` paints there. */
  afterMarker?: number
}

interface LeafSpan {
  start: number
  /** Index after the `Q`. */
  end: number
  info: StructureNodeInfo
  actualText: string | undefined
  /** The debug overlay (with the leaf's closing `Q`): an artifact. */
  overlay: { start: number, end: number } | undefined
}

type InlineEvent
  = | { kind: 'link', start: number, end: number, spec: StructureSpec }
    | { kind: 'image', start: number, end: number }

const unexpectedAnnotation = (): never => {
  throw new NuxtPdfError(
    PDF_ERROR_CODES.RenderError,
    'Tagged PDF: the engine painted an annotation the structure plan did not expect; check CONTRACTS.md "Tagged PDF" after an engine update.',
  )
}

/**
 * Tag an open document: call it after `createContext` and before `renderPDF`.
 * Wraps nine methods of this one instance (`addContent`, `save`, `restore`,
 * `addNamedDestination`, `addPage`, `end`, `link`, `goTo`, `image`); the
 * engine internals relied on are listed in CONTRACTS.md, "Tagged PDF".
 */
export const applyTagging = (context: PDFDocument, layout: SafeDocumentNode): void => {
  const { specs, colSpans } = prepareLayout(layout)
  const annotationPlan = planAnnotations(layout)
  const original = {
    save: context.save.bind(context),
    restore: context.restore.bind(context),
    addNamedDestination: context.addNamedDestination.bind(context),
    addPage: context.addPage.bind(context),
    end: context.end.bind(context),
    link: context.link.bind(context),
    goTo: context.goTo.bind(context),
    image: context.image.bind(context),
  }

  const states = new Map<number, ElementState>()
  const stateOf = (spec: StructureSpec): ElementState => {
    let state = states.get(spec.index)
    if (state === undefined) {
      state = { kids: [], placed: false, firstPage: undefined, imageCursor: 0 }
      states.set(spec.index, state)
    }
    return state
  }

  let operators: PDFContentChunk[] = []
  let openSaves: OpenSave[] = []
  let spans: LeafSpan[] = []
  let events: InlineEvent[] = []
  // The annotation of an inline link whose run has not ended yet.
  let pendingRun: { start: number, depth: number, spec: StructureSpec } | undefined
  let pageIndex = -1
  let annotationIndex = 0
  // Parent tree key → the element of each MCID of a page, or the element of an annotation.
  const parentTree = new Map<number, number[] | number>()
  let nextParentKey = 0

  context.addContent = (data) => {
    operators.push(data)
    return context
  }
  context.save = () => {
    const start = operators.length
    original.save()
    openSaves.push({ start })
    return context
  }
  context.restore = () => {
    original.restore()
    const open = openSaves.pop()
    if (open === undefined) return context
    if (open.leaf !== undefined) {
      const end = operators.length
      // Without `debug` only the leaf's own `Q` follows the marker.
      const overlay = open.afterMarker !== undefined && open.afterMarker < end - 1 ? { start: open.afterMarker, end } : undefined
      spans.push({ start: open.start, end, info: open.leaf.info, actualText: open.leaf.actualText, overlay })
    }
    // A run's glyphs are the first group at the next depth that holds `BT`.
    if (pendingRun !== undefined && openSaves.length === pendingRun.depth && operators.slice(open.start).includes('BT')) {
      events.push({ kind: 'link', start: pendingRun.start, end: operators.length, spec: pendingRun.spec })
      pendingRun = undefined
    }
    return context
  }
  context.addNamedDestination = (name, ...args) => {
    if (!(name instanceof StructureMarker)) {
      original.addNamedDestination(name, ...args)
      return
    }
    const open = openSaves.at(-1)
    if (open !== undefined) {
      open.leaf = name
      open.afterMarker = operators.length
    }
    if (name.authorId !== undefined) original.addNamedDestination(name.authorId, ...args)
  }

  // Gives the next planned annotation its parent tree key and description,
  // and records it as an object reference of its link element.
  const annotate = (target: string, paint: (options: Record<string, unknown>) => void) => {
    const planned = annotationPlan[pageIndex]?.[annotationIndex]
    annotationIndex += 1
    const link = planned?.link
    if (planned === undefined || planned.target !== target || link === undefined) return unexpectedAnnotation()
    const key = nextParentKey++
    parentTree.set(key, link.index)
    const start = operators.length
    paint({ StructParent: key, Contents: new String(link.link?.contents ?? target) })
    const page = context.page!
    stateOf(link).kids.push({ order: link.index, kind: 'objr', page: page.dictionary, annotation: page.annotations.at(-1)! })
    if (planned.inline) pendingRun = { start, depth: openSaves.length, spec: link }
  }
  context.link = (x, y, w, h, url, options = {}) => {
    const { target } = splitMarkedLink(String(url))
    annotate(target, structure => original.link(x, y, w, h, target, { ...options, ...structure }))
    return context
  }
  context.goTo = (x, y, w, h, name, options = {}) => {
    const { target } = splitMarkedLink(name)
    annotate(`#${target}`, structure => original.goTo(x, y, w, h, target, { ...options, ...structure }))
    return context
  }
  context.image = (...args) => {
    const start = operators.length
    original.image(...args)
    events.push({ kind: 'image', start, end: operators.length })
    return context
  }

  const write = (page: NonNullable<PDFDocument['page']>, from: number, to: number) => {
    for (let index = from; index < to; index += 1) page.write(operators[index]!)
  }
  const writeArtifact = (page: NonNullable<PDFDocument['page']>, from: number, to: number, open = '/Artifact BMC') => {
    if (from >= to) return
    page.write(open)
    write(page, from, to)
    page.write('EMC')
  }

  // An inline element takes its place among its parent's kids where its first
  // content is painted.
  const place = (spec: StructureSpec, order: number): void => {
    const state = stateOf(spec)
    const parent = spec.parent
    if (!spec.inline || state.placed || parent === undefined) return
    place(parent, order)
    stateOf(parent).kids.push({ order, kind: 'element', index: spec.index })
    state.placed = true
  }

  /**
   * The parts of a leaf's span: the leaf's own content, inline links (their
   * runs) and inline images (their `q … Do … Q`), innermost first. `null` is
   * an artifact (a decorative inline image, the debug overlay).
   */
  const partition = (span: LeafSpan): { start: number, end: number, owner: StructureSpec | null }[] => {
    const { spec } = span.info
    const inside = spec.role === 'Figure'
      ? []
      : events.filter(event => event.start >= span.start && event.end <= span.end)
    const state = stateOf(spec)
    const images = spec.inlines.filter(entry => entry.kind === 'image')
    const owned: { start: number, end: number, kind: InlineEvent['kind'] | 'overlay', owner: StructureSpec | null }[] = inside.map(event => ({
      ...event,
      owner: event.kind === 'link' ? event.spec : images[state.imageCursor++]?.spec ?? null,
    }))
    if (span.overlay !== undefined) owned.push({ ...span.overlay, kind: 'overlay', owner: null })
    const bounds = [...new Set([span.start, span.end, ...owned.flatMap(event => [event.start, event.end])])].sort((a, b) => a - b)
    const parts: { start: number, end: number, owner: StructureSpec | null }[] = []
    for (let index = 0; index + 1 < bounds.length; index += 1) {
      const start = bounds[index]!
      const end = bounds[index + 1]!
      const covering = owned.filter(event => event.start <= start && event.end >= end)
      const owner = (covering.find(event => event.kind === 'overlay') ?? covering.find(event => event.kind === 'image') ?? covering.find(event => event.kind === 'link'))?.owner
      const resolved = owner === undefined ? spec : owner
      const last = parts.at(-1)
      if (last !== undefined && last.owner === resolved) last.end = end
      else parts.push({ start, end, owner: resolved })
    }
    return parts
  }

  // Writes the current page's operators with the marked content around them.
  // The spans of one page never overlap: leaves do not nest (a text paints its
  // nested texts as part of its lines, an SVG its children).
  const flushPage = () => {
    const page = context.page
    if (page === null || page === undefined) return
    const mcids: number[] = []
    let position = 0
    for (const span of [...spans].sort((a, b) => a.start - b.start)) {
      const { spec, order } = span.info
      const state = stateOf(spec)
      writeArtifact(page, position, span.start)
      position = span.end
      if (spec.repeats && state.firstPage !== undefined && state.firstPage !== pageIndex) {
        writeArtifact(page, span.start, span.end, '/Artifact <</Type /Pagination>> BDC')
        continue
      }
      state.firstPage ??= pageIndex
      const parts = partition(span)
      for (const part of parts) {
        if (part.owner === null) {
          writeArtifact(page, part.start, part.end)
          continue
        }
        const mcid = mcids.length
        const actualText = parts.filter(item => item.owner !== null).length === 1 && span.actualText !== undefined ? ` /ActualText ${pdfTextHex(span.actualText)}` : ''
        page.write(`/${part.owner.role} <</MCID ${mcid}${actualText}>> BDC`)
        write(page, part.start, part.end)
        page.write('EMC')
        mcids.push(part.owner.index)
        place(part.owner, order)
        stateOf(part.owner).kids.push({ order, kind: 'mcr', page: page.dictionary, mcid })
      }
    }
    writeArtifact(page, position, operators.length)
    page.dictionary.data.Tabs = 'S'
    if (mcids.length > 0) {
      const key = nextParentKey++
      page.dictionary.data.StructParents = key
      parentTree.set(key, mcids)
    }
    operators = []
    openSaves = []
    spans = []
    events = []
    pendingRun = undefined
  }

  context.addPage = (options) => {
    flushPage()
    pageIndex += 1
    annotationIndex = 0
    original.addPage(options)
    return context
  }

  context.end = () => {
    flushPage()
    writeStructureTree(context, specs, states, colSpans, parentTree)
    original.end()
  }
}

/** Table cells keep their place even when empty, so every row has its columns. */
const KEPT_EMPTY: ReadonlySet<StructureRole> = new Set(['TH', 'TD'])

/**
 * Write the structure tree as plain dictionaries: `Document` holds the
 * top-level elements in tree order (reading order). An element's kids are its
 * marked content, annotations and inline elements in paint order, merged with
 * its child elements by tree order. Elements with nothing painted in them are
 * left out. `StructTreeRoot` and `MarkInfo` are ended by the engine's `end()`
 * (it ends both when present); every other object here is ended by us.
 */
const writeStructureTree = (
  context: PDFDocument,
  specs: ReadonlyMap<number, StructureSpec>,
  states: ReadonlyMap<number, ElementState>,
  colSpans: ReadonlyMap<number, number>,
  parentTree: ReadonlyMap<number, number[] | number>,
): void => {
  const ordered = [...specs.values()].sort((a, b) => a.index - b.index)
  const kept = new Set<number>()
  const children = new Map<number, StructureSpec[]>()
  for (const spec of [...ordered].reverse()) {
    const painted = (states.get(spec.index)?.kids.length ?? 0) > 0
    if (painted || KEPT_EMPTY.has(spec.role) || (children.get(spec.index)?.length ?? 0) > 0) {
      kept.add(spec.index)
      const parent = spec.parent?.index ?? -1
      children.set(parent, [spec, ...(children.get(parent) ?? [])])
    }
  }

  const root = context.ref({ Type: 'StructTreeRoot' })
  const document = context.ref({ Type: 'StructElem', S: 'Document', P: root })
  const refs = new Map<number, PDFReference>()
  for (const spec of ordered) {
    if (!kept.has(spec.index)) continue
    const colSpan = colSpans.get(spec.index)
    const attributes = {
      ...(spec.scope === undefined ? {} : { Scope: spec.scope }),
      ...(colSpan === undefined ? {} : { ColSpan: colSpan }),
    }
    refs.set(spec.index, context.ref({
      Type: 'StructElem',
      S: spec.role,
      P: spec.parent === undefined ? document : refs.get(spec.parent.index)!,
      // The engine writes a String object as a PDF text string.
      ...(spec.alt === undefined ? {} : { Alt: new String(spec.alt) }),
      ...(Object.keys(attributes).length === 0 ? {} : { A: { O: 'Table', ...attributes } }),
    }))
  }

  const kidsOf = (index: number): unknown[] => {
    const state = states.get(index)
    const painted = state?.kids ?? []
    const placed = new Set(painted.flatMap(kid => kid.kind === 'element' ? [kid.index] : []))
    const structural: Kid[] = (children.get(index) ?? [])
      .filter(child => !placed.has(child.index))
      .map(child => ({ order: child.index, kind: 'element', index: child.index }))
    // Stable: paint order holds within one order key.
    return [...painted, ...structural]
      .sort((a, b) => a.order - b.order)
      .map((kid) => {
        if (kid.kind === 'mcr') return { Type: 'MCR', Pg: kid.page, MCID: kid.mcid }
        if (kid.kind === 'objr') return { Type: 'OBJR', Pg: kid.page, Obj: kid.annotation }
        return refs.get(kid.index)!
      })
  }

  for (const [index, ref] of refs) ref.data.K = kidsOf(index)
  document.data.K = kidsOf(-1)
  root.data.K = document
  root.data.ParentTree = {
    Nums: [...parentTree.entries()]
      .sort(([a], [b]) => a - b)
      .flatMap(([key, value]) => [key, Array.isArray(value) ? value.map(index => refs.get(index)!) : refs.get(value)!]),
  }
  root.data.ParentTreeNextKey = parentTree.size
  for (const ref of refs.values()) ref.end()
  document.end()
  context._root.data.StructTreeRoot = root
  context._root.data.MarkInfo = context.ref({ Marked: true })
}
