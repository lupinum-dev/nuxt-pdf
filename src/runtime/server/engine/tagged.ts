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
// `prepareTagging` gives each leaf fragment a `StructureMarker` (`MARK_PROP`)
// and returns the elements for the writer and `PaintTags` for the painter.
// The painter asks `PaintTags` which node is a leaf and which element owns an
// inline link or image, and calls the writer's marked-content operations;
// the writer numbers the marked content, writes the rest as artifacts and
// builds the structure tree (`pdf/marked-content.ts`).

import type { SafeDocumentNode } from './layout/index'
import { transformText } from './layout/text/transform'
import type { MeasuredNode } from './layout/types'
import { PDF_CONTENTS_PART_PROP, PDF_FIELD_TYPES, PDF_HEADER_CELL_PROP, PDF_PRIMITIVES, PDF_ROW_SPAN_PROP, PDF_TABLE_CAPTION_PROP } from '../../primitives'
import type { PdfContentsPart } from './contents'
import type { PdfElementNode, PdfNode } from '../../renderer'

/**
 * Engine-tree prop with the structure of a node (`StructureNodeInfo`),
 * written by `toEngineDocument` in a tagged document. Authors cannot set it:
 * the renderer accepts only the props of the primitive table.
 */
export const STRUCTURE_PROP = '__nuxtPdfStruct'

/** PDF standard structure types this module writes. */
type StructureRole
  = | 'P' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6'
    | 'Figure' | 'Link' | 'Form'
    | 'Sect' | 'L' | 'LI' | 'LBody' | 'BlockQuote' | 'Caption'
    | 'Note' | 'Reference' | 'Lbl'
    | 'Table' | 'TR' | 'TH' | 'TD'
    | 'TOC' | 'TOCI'

const TEXT_ROLES: Readonly<Record<string, StructureRole>> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
  h5: 'H5',
  h6: 'H6',
  p: 'P',
}

/**
 * The views a `PdfContents` is written as (server/engine/contents.ts): a
 * `TOC` of `TOCI` items, each with the `Reference` that holds the entry's
 * `Link`, and the `TOC` of the next level (ISO 32000-1, 14.8.4.3.3). The
 * leader is a plain view inside the link: it paints outside every marked
 * sequence, so it is an artifact.
 */
const CONTENTS_ROLES: Readonly<Record<PdfContentsPart, StructureRole>> = {
  list: 'TOC',
  item: 'TOCI',
  reference: 'Reference',
}

const contentsPartOf = (value: unknown): PdfContentsPart | undefined =>
  value === 'list' || value === 'item' || value === 'reference' ? value : undefined

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
  /**
   * A link's target and the description its annotation carries; a footnote's
   * links carry the number their run prints, which the page walk may set
   * after layout (footnote-numbers.ts).
   */
  readonly link?: { readonly href: string, readonly contents?: string }
  readonly scope?: 'Column' | 'Row'
  /** The rows a table cell spans, from 2 (`PDF_ROW_SPAN_PROP`). */
  readonly rowSpan?: number
  /** A note's `ID`, unique in the document. */
  readonly id?: string
  /**
   * A note: it sits right after this element, its reference, among their
   * parent's kids, wherever its own content is painted.
   */
  readonly follows?: StructureSpec
  /** A text element's inline links and images, in text order. */
  readonly inlines: InlineEntry[]
}

type InlineEntry
  = | { readonly kind: 'link', readonly spec: StructureSpec }
  /** `spec` is undefined for a decorative image: an artifact inside the text. */
    | { readonly kind: 'image', readonly spec: StructureSpec | undefined }

/** The value of `STRUCTURE_PROP`. */
interface StructureNodeInfo {
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
 * before the writer writes the target.
 */
const LINK_MARK = '\u0000'
const markedHref = (href: string, spec: StructureSpec): string => `${href}${LINK_MARK}${spec.index}`
export const splitMarkedLink = (value: string): { target: string, index: number | undefined } => {
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
  // The Table of a rich-text table caption (`PDF_TABLE_CAPTION_PROP`),
  // created at the caption, for the table that follows it.
  let captioned: StructureSpec | undefined

  const create = (
    role: StructureRole,
    parent: StructureSpec | undefined,
    scope: StructureScope,
    extra: Partial<Pick<StructureSpec, 'alt' | 'link' | 'scope' | 'inline' | 'rowSpan' | 'id' | 'follows'>> = {},
  ): StructureSpec => ({ index: next++, role, parent, repeats: scope.repeats, inline: false, inlines: [], ...extra })

  const leaf = (spec: StructureSpec, order = spec.index): StructureNodeInfo => ({ spec, leaf: true, order })
  const container = (spec: StructureSpec): StructureNodeInfo => ({ spec, leaf: false, order: spec.index })

  /** `href` replaces an inline link's target in the engine tree (see `markedHref`). */
  const enter = (node: PdfElementNode, scope: StructureScope): { info?: StructureNodeInfo, href?: string, figure?: number, children: StructureScope } => {
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
        return { ...(spec === undefined ? {} : { figure: spec.index }), children: base }
      }
      if (node.type === PDF_PRIMITIVES.Link && !artifact) {
        const href = String(node.props.href)
        const spec = create('Link', scope.inlineParent, scope, { inline: true, link: { href, contents: linkText(node) || href } })
        text.inlines.push({ kind: 'link', spec })
        return { href: markedHref(href, spec), children: { ...base, inlineParent: spec } }
      }
      return { children: base }
    }

    // The node after a caption's text is its table: it takes the Table that
    // holds the caption, and no later table can.
    const captionedTable = captioned
    captioned = undefined
    if (artifact) return { children: base }
    const inText = (spec: StructureSpec): StructureScope => ({ ...base, insideText: true, text: spec, inlineParent: spec })
    const cell = () => {
      if (scope.header) return create('TH', scope.parent, scope, { scope: 'Column' })
      // A cell over several rows is the view that takes its columns in its first row.
      const rows = node.props[PDF_ROW_SPAN_PROP]
      const rowSpan = typeof rows === 'number' && rows > 1 ? { rowSpan: rows } : {}
      return node.props[PDF_HEADER_CELL_PROP] === true
        ? create('TH', scope.parent, scope, { scope: 'Row', ...rowSpan })
        : create('TD', scope.parent, scope, rowSpan)
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
        if (node.props[PDF_TABLE_CAPTION_PROP] === true) {
          // The Table starts here, so it keeps the caption's place in the
          // reading order, and the caption is its first kid (as HTML's).
          captioned = create('Table', scope.parent, scope)
          const spec = create('P', create('Caption', captioned, scope), scope)
          return { info: leaf(spec), children: inText(spec) }
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
        // A field paints no marked content: its widget annotation is the
        // element's only kid (an object reference), added when it is written.
        // `Alt` repeats the label (the widget's `TU`): a radio group's field
        // is the parent of its widgets and has no `TU` of its own, and PDF/UA-1
        // then asks for `Alt` on the Form element of each widget (7.18.1).
        // Tree validation requires the label and keeps fields out of
        // artifacts and figures; links and texts cannot hold them.
        // A field is a widget annotation inside a `Form` element.
        if (PDF_FIELD_TYPES.has(node.type)) {
          const label = node.props.label
          return { info: container(create('Form', scope.parent, scope, typeof label === 'string' ? { alt: label } : {})), children: base }
        }
        return { children: base }
    }

    const part = contentsPartOf(node.props[PDF_CONTENTS_PART_PROP])
    if (part !== undefined) {
      const spec = create(CONTENTS_ROLES[part], scope.parent, scope)
      return { info: container(spec), children: { ...base, parent: spec } }
    }

    switch (node.component) {
      case 'PdfTable': {
        const spec = captionedTable ?? create('Table', scope.parent, scope)
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
        // The visible part of a cell wrapper belongs to the wrapper's cell,
        // and so does the text it renders for text-only content.
        if (scope.cellWrapper !== undefined) return { children: { ...base, cellWrapper: scope.cellWrapper } }
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

  /**
   * A footnote mark in the text of `scope`: a `Reference` that holds the
   * mark's `Link` to `href`. Returns the reference and the href for the
   * engine tree (see `markedHref`); undefined outside a tagged text.
   */
  const footnoteMark = (scope: StructureScope, href: string): { reference: StructureSpec, href: string } | undefined => {
    const text = scope.text
    if (scope.artifact || text === undefined) return undefined
    const reference = create('Reference', scope.inlineParent, scope, { inline: true })
    const link = create('Link', reference, scope, { inline: true, link: { href } })
    text.inlines.push({ kind: 'link', spec: link })
    return { reference, href: markedHref(href, link) }
  }

  /**
   * The note of the footnote whose mark is `reference`: a `Note` with `id`
   * as its `ID`, which holds a `Lbl` with the link back to the mark
   * (`backHref`) and a `P` with the note's text. `info` is the structure of
   * the note's text node, `href` replaces the label's link target, and
   * `children` is the scope of the note's content.
   */
  const footnoteNote = (reference: StructureSpec, id: string, backHref: string, scope: StructureScope) => {
    const note = create('Note', reference.parent, scope, { id, follows: reference })
    const label = create('Lbl', note, scope, { inline: true })
    const link = create('Link', label, scope, { inline: true, link: { href: backHref } })
    const paragraph = create('P', note, scope)
    paragraph.inlines.push({ kind: 'link', spec: link })
    // The label's content is painted first in the note's text, so the
    // paragraph's own content takes the label's order and the paragraph
    // stays after the label among the note's kids.
    return {
      info: leaf(paragraph, label.index),
      href: markedHref(backHref, link),
      children: { ...scope, insideText: true, text: paragraph, inlineParent: paragraph },
    }
  }

  return { enter, footnoteMark, footnoteNote }
}

// ---------------------------------------------------------------------------
// Before the paint: markers, column spans, the annotation plan
// ---------------------------------------------------------------------------

/** Engine-tree prop with the `StructureMarker` of a painted leaf fragment (`prepareTagging`). */
const MARK_PROP = '__nuxtPdfMark'

/** A painted fragment of a leaf: its structure and, for a text, its source text. */
class StructureMarker {
  readonly info: StructureNodeInfo
  /** The source text of this fragment, for `/ActualText` (see `sourceTexts`). */
  actualText: string | undefined

  // Plain fields: the worker loads this file with type stripping only, which
  // rejects parameter properties.
  constructor(info: StructureNodeInfo) {
    this.info = info
    this.actualText = undefined
  }
}

const infoOf = (node: TaggedNode): StructureNodeInfo | undefined => {
  const value = node.props?.[STRUCTURE_PROP]
  return isStructureInfo(value) ? value : undefined
}

// ---------------------------------------------------------------------------
// Source text for `/ActualText`
// ---------------------------------------------------------------------------

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
 * resolved `textTransform`, a raster image as U+FFFC, a leader as U+FFFC
 * that reads as a space, nested texts in order.
 */
const textSource = (text: MeasuredNode) => {
  let source = ''
  let laidOut = ''
  let transformed = false
  const segments: SourceSegment[] = []
  const add = (sourcePart: string, laidOutPart: string, exact: boolean) => {
    segments.push({ from: laidOut.length, to: laidOut.length + laidOutPart.length, sourceFrom: source.length, sourceTo: source.length + sourcePart.length, exact })
    source += sourcePart
    laidOut += laidOutPart
  }
  const visit = (node: MeasuredNode): void => {
    for (const child of node.children ?? []) {
      if (child.type === PDF_PRIMITIVES.TextInstance) {
        const value = child.value ?? ''
        const transform = child.style?.textTransform
        if (transform !== undefined && transform !== 'none') transformed = true
        const part = transformText(value, transform)
        add(value, part, part.length === value.length && keepsLength(value, transform))
      }
      else if (child.type === PDF_PRIMITIVES.Image) {
        if (child.image) add('\uFFFC', '\uFFFC', true)
      }
      else if (child.type === PDF_PRIMITIVES.Leader) {
        // The painter draws a leader with a space glyph (paint/text.ts).
        add(' ', '\uFFFC', true)
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
const fragmentSources = (fragments: readonly MeasuredNode[]): (string | undefined)[] => {
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
const needsActualText = (fragments: readonly MeasuredNode[]): boolean =>
  textSource(fragments[0]!).transformed
  || fragments.some(fragment => (fragment.lines ?? []).some(line =>
    line.runs.some(run => (run.attributes.characterSpacing ?? 0) !== 0)))

/**
 * Set `actualText` on the markers of the texts that need it. A text with
 * inline links or images is left out: its marked content is split into
 * parts, and each part would need the source of its own runs.
 */
const sourceTexts = (texts: ReadonlyMap<unknown, readonly { node: MeasuredNode, marker: StructureMarker }[]>): void => {
  for (const fragments of texts.values()) {
    const nodes = fragments.map(fragment => fragment.node)
    if (!needsActualText(nodes)) continue
    fragmentSources(nodes).forEach((text, index) => {
      fragments[index]!.marker.actualText = text
    })
  }
}

/** Where a cell (its element's index) or an empty column (`cell` undefined) of a table row starts. */
type ColumnStart = { cell: number | undefined, start: number }

/**
 * Collect every element, give every leaf fragment its marker, and read the
 * column span of each cell from the laid-out rows. Each fragment has its own props
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
  const rows = new Map<number, Map<number, ColumnStart[]>>()
  // The fragments of each text leaf in page order, keyed by its node's info
  // (shared by its fragments); a repeated header's text is whole on each page.
  const texts = new Map<unknown, { node: MeasuredNode, marker: StructureMarker }[]>()

  const visit = (node: MeasuredNode): void => {
    const info = infoOf(node)
    if (info !== undefined) {
      register(info.spec)
      if (info.leaf) {
        const marker = new StructureMarker(info)
        node.props = { ...node.props, [MARK_PROP]: marker }
        if (node.type === PDF_PRIMITIVES.Text && info.spec.role !== 'Figure' && info.spec.inlines.length === 0) {
          const key = info.spec.repeats ? marker : info
          texts.set(key, [...(texts.get(key) ?? []), { node, marker }])
        }
      }
      const table = info.spec.parent
      if (info.spec.role === 'TR' && table !== undefined) {
        const tableRows = rows.get(table.index) ?? new Map<number, ColumnStart[]>()
        rows.set(table.index, tableRows)
        if (!tableRows.has(info.spec.index)) {
          tableRows.set(info.spec.index, node.children.flatMap((child): ColumnStart[] => {
            if (child.type === PDF_PRIMITIVES.TextInstance) return []
            const cell = infoOf(child)?.spec
            const start = child.box.left - child.box.marginLeft
            if (cell !== undefined && (cell.role === 'TH' || cell.role === 'TD')) return [{ cell: cell.index, start }]
            // An empty column (none of the row's cells takes it, or a cell over
            // several rows from a row above does): a column start, so the
            // cell before it does not span it.
            return [{ cell: undefined, start }]
          }))
        }
      }
    }
    for (const child of node.children) {
      if (child.type !== PDF_PRIMITIVES.TextInstance) visit(child)
    }
  }
  layout.children.forEach(visit)
  sourceTexts(texts)

  return { specs, colSpans: columnSpans(rows) }
}

/**
 * The column span of each cell, from geometry: the columns of a table start
 * where any of its cells or empty columns starts, and a cell covers the
 * column starts up to the next cell or empty column of its row (`cell` is
 * undefined for an empty column). The table components keep `colspan` to
 * themselves, and the cells of one row sit side by side, so this is exact for
 * every column that some row starts a cell or an empty column in.
 */
const columnSpans = (rows: ReadonlyMap<number, ReadonlyMap<number, readonly ColumnStart[]>>): Map<number, number> => {
  const spans = new Map<number, number>()
  const round = (value: number) => Math.round(value * 100) / 100
  for (const tableRows of rows.values()) {
    const starts = [...new Set([...tableRows.values()].flatMap(cells => cells.map(cell => round(cell.start))))]
    for (const cells of tableRows.values()) {
      cells.forEach((cell, position) => {
        const from = round(cell.start)
        const to = position + 1 < cells.length ? round(cells[position + 1]!.start) : Number.POSITIVE_INFINITY
        const span = starts.filter(start => start >= from && start < to).length
        if (span > 1 && cell.cell !== undefined) spans.set(cell.cell, span)
      })
    }
  }
  return spans
}

/** The elements of a tagged document, for the writer's structure tree. */
export interface StructurePlan {
  readonly specs: ReadonlyMap<number, StructureSpec>
  /** The column span of each cell that spans more than one column. */
  readonly colSpans: ReadonlyMap<number, number>
}

/** A leaf fragment as the painter marks it. */
export interface PaintLeaf {
  readonly spec: StructureSpec
  /** Its place among its element's kids (tree order). */
  readonly order: number
  readonly actualText: string | undefined
  /** A repeated table header after its first page: one pagination artifact. */
  readonly pagination: boolean
}

/** The part of a painted node that tagging reads. */
interface TaggedNode {
  props?: Record<string, unknown>
  box?: object
}

/** What the painter asks while it paints a tagged document. */
export interface PaintTags {
  /** The leaf a node paints on page `page` (0-based), or undefined. */
  leaf(node: TaggedNode, page: number): PaintLeaf | undefined
  /** The element of a link or field node. */
  element(node: TaggedNode): StructureSpec | undefined
  /** An inline link's target and its element, from the run's `link` (see `markedHref`). */
  inlineLink(text: TaggedNode, link: string): { target: string, element: StructureSpec | undefined }
  /** The owner of an image painted in `leaf`: the inline figure its attachment names, or null for an artifact. */
  inlineImage(leaf: StructureSpec, figure: number | undefined): StructureSpec | null
}

/**
 * Prepare a laid-out document that claims a tagged conformance level: the
 * elements for the writer, and the answers the painter needs. Runs on the
 * converged layout after `anchorDestinationsAtFirstPage`.
 */
export const prepareTagging = (layout: SafeDocumentNode): { structure: StructurePlan, tags: PaintTags } => {
  const structure = prepareLayout(layout)
  // Per element: the page of its first marked content (a repeated element is
  // tagged there only).
  const firstPages = new Map<number, number>()
  const tags: PaintTags = {
    leaf: (node, page) => {
      const marker = node.props?.[MARK_PROP]
      if (!(marker instanceof StructureMarker) || node.box === undefined) return undefined
      const { spec, order } = marker.info
      const first = firstPages.get(spec.index)
      const pagination = spec.repeats && first !== undefined && first !== page
      if (first === undefined) firstPages.set(spec.index, page)
      return { spec, order, actualText: marker.actualText, pagination }
    },
    element: node => infoOf(node)?.spec,
    inlineLink: (text, link) => {
      const { target, index } = splitMarkedLink(link)
      const element = infoOf(text)?.spec.inlines.find(entry => entry.kind === 'link' && entry.spec.index === index)?.spec
      return { target, element }
    },
    inlineImage: (leaf, figure) =>
      leaf.inlines.find(entry => entry.kind === 'image' && entry.spec !== undefined && entry.spec.index === figure)?.spec ?? null,
  }
  return { structure, tags }
}
