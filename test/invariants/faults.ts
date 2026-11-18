// The `invalid` profile (internals/harness-plan.md, I15): a valid generated
// document with exactly one fault put in.
//
// One fault kind per check of the tree validation: the closed prop surface
// (renderer/patch-prop.ts), the nesting and text rules (renderer/node-ops.ts),
// the table structure (components/table.ts), the prop and document checks
// (renderer/validate-tree.ts), and on `mixed` documents the SVG, tagged-PDF
// and form-field checks. A fault patches one node of the spec, or adds
// one node (a page or view gets an extra child), so the rest of the document
// stays the valid generated one. The checks left out are listed in
// FAULT_EXCLUSIONS with the reason.
import { h, type Component, type VNode } from 'vue'
import fc from 'fast-check'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { PDF_ERROR_CODES, type PdfErrorCode } from '../../src/runtime/shared/errors'
import {
  IMAGES,
  normalizeDocument,
  rawDocument,
  shortDocument,
  type CellSpec,
  type DocumentSpec,
  type FieldSpec,
  type FixedSpec,
  type NodePatch,
  type NodeSpec,
  type PageSpec,
  type Profile,
  type RawDocument,
  type RowSpec,
  type SvgSpec,
  type TableSpec,
  type TextSpec,
  type ViewSpec,
} from './generator'

// The faults pass wrong props on purpose, which the typed component props
// cannot describe, so the components are used as plain Vue components here.
const COMPONENTS: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
const {
  PdfAttachment, PdfCheckbox, PdfDefs, PdfFacturX, PdfImage, PdfLinearGradient, PdfLink, PdfNote, PdfPage, PdfPageNumber,
  PdfPageRef, PdfRect, PdfSelect, PdfStop, PdfSvg, PdfTable, PdfTableCell, PdfTableRow, PdfText, PdfTextField, PdfTspan, PdfView,
} = COMPONENTS

/**
 * What the one fault must give: the error code, the element the message
 * names, the stable part of the message of the check the kind tests (so a
 * fault caught by another check fails I15), and a password it must not show.
 */
export interface ExpectedError {
  code: PdfErrorCode
  element: string
  message: RegExp
  secret?: string
}

interface FaultKind {
  id: string
  /** The check that must catch it. */
  check: string
  /** The profile of the valid document the fault goes into; any when absent. */
  base?: Profile
  /** A `mixed` base that must be tagged (PDF/UA-1) or must not be; as generated when absent. */
  tagged?: boolean
  apply: (spec: DocumentSpec, pick: number) => ExpectedError
}

// Invented passwords. They must never appear in an error message.
const SECRET = 'Vq7-invented-open'
const OTHER_SECRET = 'Lm3-invented-owner'

// The smallest CII file whose profile the tree validation accepts
// (test/renderer.test.ts uses the same).
const FACTUR_X_XML = '<rsm:CrossIndustryInvoice><ram:GuidelineSpecifiedDocumentContextParameter>'
  + '<ram:ID>urn:factur-x.eu:1p0:minimum</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:CrossIndustryInvoice>'

/** Every fault is a tree fault: `PDF_TREE_INVALID`. */
const invalid = (element: string, message: RegExp, secret?: string): ExpectedError =>
  ({ code: PDF_ERROR_CODES.TreeInvalid, element, message, ...(secret === undefined ? {} : { secret }) })

// ---------------------------------------------------------------------------
// The nodes of a spec

const flowNodes = (nodes: readonly NodeSpec[]): NodeSpec[] =>
  nodes.flatMap(node => [node, ...(node.kind === 'view' || node.kind === 'link' ? flowNodes(node.children) : [])])
const allNodes = (spec: DocumentSpec): NodeSpec[] => spec.pages.flatMap(page => flowNodes(page.children))
const texts = (spec: DocumentSpec): TextSpec[] => allNodes(spec).filter((node): node is TextSpec => node.kind === 'text')
const views = (spec: DocumentSpec): ViewSpec[] => allNodes(spec).filter((node): node is ViewSpec => node.kind === 'view')
const tables = (spec: DocumentSpec): TableSpec[] => allNodes(spec).filter((node): node is TableSpec => node.kind === 'table')
const rows = (spec: DocumentSpec): RowSpec[] => tables(spec).flatMap(table => table.rows)
const cells = (spec: DocumentSpec): Array<{ cell: CellSpec, table: TableSpec }> =>
  tables(spec).flatMap(table => table.rows.flatMap(row => row.cells.map(cell => ({ cell, table }))))
const fixedNodes = (spec: DocumentSpec): FixedSpec[] => spec.pages.flatMap(page => page.fixed)
const svgs = (spec: DocumentSpec): SvgSpec[] => allNodes(spec).filter((node): node is SvgSpec => node.kind === 'svg')
const fields = (spec: DocumentSpec): FieldSpec[] => allNodes(spec).filter((node): node is FieldSpec => node.kind === 'field')

const nth = <T>(items: readonly T[], pick: number): T | undefined => items.length === 0 ? undefined : items[pick % items.length]

/** A page or view that gets one extra child. */
const host = (spec: DocumentSpec, pick: number): PageSpec | ViewSpec => nth<PageSpec | ViewSpec>([...spec.pages, ...views(spec)], pick)!
const hostName = (node: PageSpec | ViewSpec): string => 'kind' in node ? 'PdfView' : 'PdfPage'
const append = (node: { patch?: NodePatch }, child: () => VNode | string): void => {
  node.patch = { append: () => [child()] }
}
const setProps = (node: { patch?: NodePatch }, props: Record<string, unknown>): void => {
  node.patch = { props }
}

/**
 * A text or view of the document that gets the fault, and the element the
 * message must name. A short document can have neither (a page with only a
 * table); then the fault goes on a new text added to a page or view.
 */
interface Target {
  name: 'PdfText' | 'PdfView'
  kind: 'text' | 'view'
  patch: (patch: Pick<NodePatch, 'props' | 'style'>) => void
}
const targetOf = (spec: DocumentSpec, pick: number, candidates: ReadonlyArray<TextSpec | ViewSpec>): Target => {
  const node = nth(candidates, pick)
  if (node) {
    return {
      name: node.kind === 'text' ? 'PdfText' : 'PdfView',
      kind: node.kind,
      patch: (patch) => {
        node.patch = patch
      },
    }
  }
  return {
    name: 'PdfText',
    kind: 'text',
    patch: patch => append(host(spec, pick), () => h(PdfText, { ...patch.props, ...(patch.style ? { style: patch.style } : {}) }, () => 'fault')),
  }
}
const textOrView = (spec: DocumentSpec, pick: number): Target => targetOf(spec, pick, [...texts(spec), ...views(spec)])
const textOf = (spec: DocumentSpec, pick: number): Target => targetOf(spec, pick, texts(spec))
/** A text without an id, so an id fault does not meet the generator's own ids. */
const textWithoutId = (spec: DocumentSpec, pick: number): Target => targetOf(spec, pick, texts(spec).filter(text => text.id === undefined))

/** A small valid table with the fault in it, for a document without a table. */
const tableWith = (
  fault: { rowProps?: Record<string, unknown>, cellProps?: Record<string, unknown>, rowChildren?: () => VNode[], columns?: unknown },
): VNode => h(PdfTable, { columns: fault.columns ?? [1, 1] }, () => [
  h(PdfTableRow, fault.rowProps ?? {}, () => [
    h(PdfTableCell, fault.cellProps ?? {}, () => 'cell'),
    ...(fault.rowChildren?.() ?? []),
  ]),
])

const tableFault = (
  spec: DocumentSpec,
  pick: number,
  onTable: (table: TableSpec) => boolean,
  inserted: Parameters<typeof tableWith>[0],
): void => {
  const table = nth(tables(spec), pick)
  if (table && onTable(table)) return
  append(host(spec, pick), () => tableWith(inserted))
}

/** An SVG child with the fault: in a generated SVG, or in a new SVG added to a page or view. */
const inSvg = (spec: DocumentSpec, pick: number, child: () => VNode): void => {
  const svg = nth(svgs(spec), pick)
  if (svg) svg.patch = { append: () => [child()] }
  else append(host(spec, pick), () => h(PdfSvg, { width: 40, height: 20, viewBox: '0 0 40 20' }, () => [child()]))
}

/** A form field has a fixed box (validateField). */
const FIELD_STYLE = { width: 60, height: 14 }

/** A text field of the document, or a new one added to a page or view. */
const textField = (spec: DocumentSpec, pick: number, props: Record<string, unknown>): void => {
  const field = nth(fields(spec).filter(node => node.field === 'text'), pick)
  if (field) field.patch = { props }
  else append(host(spec, pick), () => h(PdfTextField, { name: 'faultfield', style: FIELD_STYLE, ...props }))
}

const protect = (spec: DocumentSpec, protection: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
  setProps(spec, { protection, ...extra })
}

// ---------------------------------------------------------------------------
// The fault kinds

export const FAULTS: readonly FaultKind[] = [
  // Closed prop surface (patch-prop.ts).
  {
    id: 'unknown-prop',
    check: 'patch-prop.ts: unsupported prop',
    apply: (spec, pick) => {
      const targets: Array<{ node: { patch?: NodePatch }, name: string }> = [
        ...texts(spec).map(node => ({ node, name: 'PdfText' })),
        ...views(spec).map(node => ({ node, name: 'PdfView' })),
        ...spec.pages.map(node => ({ node, name: 'PdfPage' })),
        ...tables(spec).map(node => ({ node, name: 'PdfTable' })),
      ]
      const target = nth(targets, pick)!
      setProps(target.node, { colour: 'red' })
      return invalid(target.name, /Unsupported prop "colour" on </)
    },
  },
  { id: 'class-prop', check: 'patch-prop.ts: class outside a PDF component style block', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ props: { class: 'note' } })
    return invalid(target.name, /Unsupported "class" on </)
  } },
  { id: 'event-prop', check: 'patch-prop.ts: Vue event prop', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ props: { onClick: () => undefined } })
    return invalid(target.name, /Vue event prop "onClick" is not supported on </)
  } },
  { id: 'dom-attribute', check: 'patch-prop.ts: DOM-only attribute', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ props: pick % 2 === 0 ? { hidden: true } : { 'aria-label': 'label' } })
    return invalid(target.name, /DOM-only attribute "(?:hidden|aria-label)" is not supported/)
  } },
  { id: 'function-in-prop', check: 'patch-prop.ts: prop that is not plain data', apply: (spec, pick) => {
    const page = nth(spec.pages, pick)!
    setProps(page, { size: { width: 300, height: () => 400 } })
    return invalid('PdfPage', /"size" prop on <PdfPage> must be plain data/)
  } },

  // Prop checks (validate-tree.ts PROP_CHECKS).
  { id: 'boolean-type', check: 'validate-tree.ts: boolean', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ props: { wrap: 'no' } })
    return invalid(target.name, /requires a boolean "wrap" value/)
  } },
  { id: 'fixed-pages-value', check: 'validate-tree.ts: fixedPages', base: 'fixed', apply: (spec, pick) => {
    const fixed = nth(fixedNodes(spec), pick)
    if (fixed) {
      setProps(fixed, { pages: 'odd' })
      return invalid(fixed.container === 'text' ? 'PdfText' : 'PdfView', /requires "pages" to be "all", "first" or "continuation"/)
    }
    append(host(spec, pick), () => h(PdfText, { fixed: true, pages: 'odd' }, () => 'head'))
    return invalid('PdfText', /requires "pages" to be "all", "first" or "continuation"/)
  } },
  { id: 'min-presence-negative', check: 'validate-tree.ts: nonNegativeNumber', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ props: { minPresenceAhead: -10 } })
    return invalid(target.name, /minPresenceAhead must be a non-negative finite number/)
  } },
  { id: 'page-size', check: 'validate-tree.ts: pageSize', apply: (spec, pick) => {
    setProps(nth(spec.pages, pick)!, { size: pick % 2 === 0 ? [-100, 400] : 'A9000' })
    return invalid('PdfPage', /size must be a known page name or positive width and height/)
  } },
  { id: 'page-orientation', check: 'validate-tree.ts: orientation', apply: (spec, pick) => {
    setProps(nth(spec.pages, pick)!, { orientation: 'sideways' })
    return invalid('PdfPage', /requires "orientation" to be "portrait" or "landscape"\. Got "sideways"/)
  } },
  { id: 'page-layout', check: 'validate-tree.ts: pageLayout', apply: (spec) => {
    setProps(spec, { pageLayout: 'twoColumn' })
    return invalid('PdfDocument', /requires "pageLayout" to be "singlePage"/)
  } },
  { id: 'widows-value', check: 'validate-tree.ts: positiveInteger (widows, orphans)', apply: (spec, pick) => {
    textOf(spec, pick).patch({ props: pick % 2 === 0 ? { widows: 0 } : { orphans: 1.5 } })
    return invalid('PdfText', /(?:widows|orphans) must be a positive whole number/)
  } },
  { id: 'text-tag', check: 'validate-tree.ts: textTag', apply: (spec, pick) => {
    textOf(spec, pick).patch({ props: { tag: 'h7' } })
    return invalid('PdfText', /requires "tag" to be "h1"/)
  } },
  { id: 'view-tag', check: 'validate-tree.ts: viewTag', apply: (spec, pick) => {
    const view = nth(views(spec), pick)
    if (view) setProps(view, { tag: 'aside' })
    else append(host(spec, pick), () => h(PdfView, { tag: 'aside' }))
    return invalid('PdfView', /requires "tag" to be "section"/)
  } },
  { id: 'link-empty-href', check: 'validate-tree.ts: linkTarget', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfText, () => [h(PdfLink, { href: ' ' }, () => 'link')]))
    return invalid('PdfLink', /targets must be non-empty strings/)
  } },
  { id: 'image-without-src', check: 'validate-tree.ts: required imageSource', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfImage))
    return invalid('PdfImage', /requires a "src" prop/)
  } },
  { id: 'svg-view-box', check: 'validate-tree.ts: viewBox', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfSvg, { width: 20, height: 20, viewBox: '0 0 0 20' }))
    return invalid('PdfSvg', /viewBox must contain four finite numbers/)
  } },
  { id: 'alt-without-figure', check: 'validate-tree.ts: alt on a view needs tag="figure"', apply: (spec, pick) => {
    const view = nth(views(spec), pick)
    if (view) setProps(view, { alt: 'a chart' })
    else append(host(spec, pick), () => h(PdfView, { alt: 'a chart' }))
    return invalid('PdfView', /"alt" on <PdfView> needs tag="figure"/)
  } },

  // Style values (validate-tree.ts validateStyle).
  { id: 'style-unknown-key', check: 'validate-tree.ts: unsupported style', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: { colour: 'red' } })
    return invalid(target.name, /Unsupported PDF style "colour" on </)
  } },
  { id: 'style-unit', check: 'validate-tree.ts: style value (unit)', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: { marginTop: '3furlong' } })
    return invalid(target.name, /value "3furlong" for "marginTop" is invalid/)
  } },
  { id: 'style-negative', check: 'style-values.ts: sign rule, text and border width (V4)', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: target.kind === 'text' ? { fontSize: -4 } : { borderWidth: -2 } })
    return invalid(target.name, /value -\d+ for "(?:fontSize|borderWidth)" is invalid: expected a value of 0 or more/)
  } },
  // The sign rule (PDF_STYLE_SIGNS), one kind per group of keys.
  ...([
    ['style-negative-size', { width: -10 }, { maxHeight: '-4pt' }],
    ['style-negative-flex', { flexGrow: -1 }, { flexBasis: -20 }],
    ['style-negative-gap', { gap: -3 }, { gap: '-2pt' }],
    ['style-negative-padding', { paddingTop: -5 }, { padding: '4pt -2pt' }],
    ['style-negative-radius', { borderRadius: -2 }, { borderTopLeftRadius: '-3pt' }],
    ['style-negative-line-height', { lineHeight: -1 }, { lineHeight: '-120%' }],
  ] as const).map(([id, first, second]): FaultKind => ({
    id,
    check: 'style-values.ts: sign rule (V4)',
    apply: (spec, pick) => {
      const target = textOrView(spec, pick)
      target.patch({ style: { ...(pick % 2 === 0 ? first : second) } })
      return invalid(target.name, /is invalid: expected a value of 0 or more/)
    },
  })),
  { id: 'style-opacity-range', check: 'style-values.ts: opacity from 0 to 1 (V4)', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: { opacity: [1.5, -0.2, '2'][pick % 3] } })
    return invalid(target.name, /for "opacity" is invalid: expected a number from 0 to 1/)
  } },
  { id: 'style-non-finite', check: 'validate-tree.ts: style value (not finite)', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: { paddingTop: pick % 2 === 0 ? Number.POSITIVE_INFINITY : Number.NaN } })
    return invalid(target.name, /value (?:Infinity|NaN) for "paddingTop" is invalid/)
  } },
  { id: 'style-wrong-type', check: 'validate-tree.ts: style value (type)', apply: (spec, pick) => {
    const target = textOrView(spec, pick)
    target.patch({ style: { color: 42 } })
    return invalid(target.name, /value 42 for "color" is invalid/)
  } },

  // Nesting and text placement (node-ops.ts).
  { id: 'text-in-container', check: 'node-ops.ts: text outside PdfText', apply: (spec, pick) => {
    const node = host(spec, pick)
    append(node, () => 'loose words')
    return invalid(hostName(node), /cannot contain text\. Wrap it in <PdfText>/)
  } },
  { id: 'text-in-leaf', check: 'node-ops.ts: text in a leaf primitive', apply: (spec, pick) => {
    if (pick % 2 === 0) {
      append(host(spec, pick), () => h(PdfText, () => ['page ', h(PdfPageNumber, null, () => 'seven')]))
      return invalid('PdfPageNumber', /<Pdf(?:PageNumber|Rect)> cannot contain text\.(?! Wrap)/)
    }
    append(host(spec, pick), () => h(PdfSvg, { width: 20, height: 20 }, () => [h(PdfRect, { width: 5, height: 5 }, () => 'inside')]))
    return invalid('PdfRect', /<Pdf(?:PageNumber|Rect)> cannot contain text\.(?! Wrap)/)
  } },
  { id: 'nesting', check: 'node-ops.ts: invalid nesting', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfPage))
    return invalid('PdfPage', /Invalid PDF nesting: <Pdf\w+> cannot contain <PdfPage>/)
  } },
  { id: 'page-token-outside-text', check: 'node-ops.ts: page token outside PdfText', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfPageNumber))
    return invalid('PdfPageNumber', /cannot contain <PdfPageNumber>\. Put it inside a <PdfText>/)
  } },
  { id: 'svg-shape-outside-svg', check: 'node-ops.ts: SVG shape in the page flow', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfRect, { width: 5, height: 5 }))
    return invalid('PdfRect', /Invalid PDF nesting: <Pdf\w+> cannot contain <PdfRect>/)
  } },

  // Fixed nodes with `pages` (validate-tree.ts validateFixedPages).
  { id: 'pages-without-fixed', check: 'validate-tree.ts: pages requires fixed', apply: (spec, pick) => {
    textOf(spec, pick).patch({ props: { pages: 'first' } })
    return invalid('PdfText', /"pages" requires "fixed"/)
  } },
  { id: 'pages-nested', check: 'validate-tree.ts: pages inside pages', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { fixed: true, pages: 'first' }, () => [h(PdfText, { fixed: true, pages: 'first' }, () => 'head')]))
    return invalid('PdfText', /with "pages" cannot be nested inside another node with "pages"/)
  } },
  { id: 'pages-content', check: 'validate-tree.ts: content of a page-conditional node', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { fixed: true, pages: 'continuation' }, () => [h(PdfLink, { href: 'https://example.com/head' }, () => [h(PdfText, () => 'head')])]))
    return invalid('PdfLink', /A fixed node with "pages" may contain only .*found <PdfLink>/)
  } },
  { id: 'bookmark-in-pages', check: 'validate-tree.ts: bookmark inside a node with pages', base: 'fixed', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { fixed: true, pages: 'first' }, () => [h(PdfText, { bookmark: 'Head' }, () => 'head')]))
    return invalid('PdfText', /inside a fixed node with "pages" cannot have a bookmark/)
  } },
  { id: 'bookmark-on-link', check: 'patch-prop.ts: bookmark on a node that has none', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfText, () => [h(PdfLink, { href: 'https://example.com/b', bookmark: 'Link' }, () => 'link')]))
    return invalid('PdfLink', /Unsupported prop "bookmark" on <PdfLink>/)
  } },
  { id: 'bookmark-type', check: 'validate-tree.ts: bookmark (V5)', apply: (spec, pick) => {
    textOf(spec, pick).patch({ props: { bookmark: 42 } })
    return invalid('PdfText', /requires "bookmark" to be a title string/)
  } },

  // Destinations (validate-tree.ts validateDestinationId and the target checks).
  { id: 'duplicate-id', check: 'validate-tree.ts: unique destination ids', apply: (spec, pick) => {
    const free = texts(spec).filter(text => text.id === undefined)
    const [first, second] = [nth(free, pick), nth(free, pick + 1)]
    if (first && second && first !== second) {
      setProps(first, { id: 'twice' })
      setProps(second, { id: 'twice' })
    }
    else {
      host(spec, pick).patch = { append: () => [h(PdfText, { id: 'twice' }, () => 'one'), h(PdfText, { id: 'twice' }, () => 'two')] }
    }
    return invalid('PdfText', /and <PdfText[^>]*> have the same id; ids must be unique/)
  } },
  { id: 'empty-id', check: 'validate-tree.ts: non-empty destination id', apply: (spec, pick) => {
    textWithoutId(spec, pick).patch({ props: { id: ' ' } })
    return invalid('PdfText', /"id" must be a non-empty string\. Got " "/)
  } },
  { id: 'reserved-id', check: 'validate-tree.ts: reserved destination id', apply: (spec, pick) => {
    textWithoutId(spec, pick).patch({ props: { id: '__proto__' } })
    return invalid('PdfText', /id="__proto__"> uses a reserved identifier as its id/)
  } },
  { id: 'id-type', check: 'validate-tree.ts: destination id type', apply: (spec, pick) => {
    textWithoutId(spec, pick).patch({ props: { id: 42 } })
    return invalid('PdfText', /"id" must be a non-empty string\. Got 42/)
  } },
  { id: 'link-missing-target', check: 'validate-tree.ts: internal link target', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfText, () => [h(PdfLink, { href: '#no-such-id' }, () => 'link')]))
    return invalid('PdfLink', /<PdfLink> internal destination does not match any id/)
  } },
  { id: 'page-ref-missing-target', check: 'validate-tree.ts: page reference target', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfText, () => ['page ', h(PdfPageRef, { to: 'no-such-id' })]))
    return invalid('PdfPageRef', /<PdfPageRef> destination does not match any id/)
  } },

  // Table structure (components/table.ts).
  { id: 'cells-over-columns', check: 'table.ts: row width counted with colspan (extra cells)', base: 'table', apply: (spec, pick) => {
    tableFault(spec, pick, (table) => {
      const row = nth(table.rows, pick)
      if (!row) return false
      const used = row.cells.reduce((sum, cell) => sum + cell.span, 0)
      row.patch = { append: () => Array.from({ length: table.columns.length - used + 1 }, () => h(PdfTableCell, () => 'extra')) }
      return true
    }, { rowChildren: () => [h(PdfTableCell, () => 'two'), h(PdfTableCell, () => 'three')] })
    return invalid('PdfTableRow', /<PdfTableRow> needs \d+ columns \(counting colspan\), but its <PdfTable> declares \d+/)
  } },
  { id: 'colspan-value', check: 'table.ts: colspan', base: 'table', apply: (spec, pick) => {
    const value = [0, 1.5, -1][pick % 3]
    const target = nth(cells(spec), pick)
    if (target) setProps(target.cell, { colspan: value })
    else append(host(spec, pick), () => tableWith({ cellProps: { colspan: value } }))
    return invalid('PdfTableCell', /requires "colspan" to be a whole number from 1/)
  } },
  { id: 'colspan-text', check: 'table.ts: colspan given as text', base: 'table', apply: (spec, pick) => {
    const target = nth(cells(spec), pick)
    if (target) setProps(target.cell, { colspan: '2' })
    else append(host(spec, pick), () => tableWith({ cellProps: { colspan: '2' } }))
    return invalid('PdfTableCell', /colspan="2" passes the text "2", not a number/)
  } },
  { id: 'colspan-over-columns', check: 'table.ts: row width counted with colspan (a wide span)', base: 'table', apply: (spec, pick) => {
    const target = nth(cells(spec), pick)
    if (target) setProps(target.cell, { colspan: target.table.columns.length + 1 })
    else append(host(spec, pick), () => tableWith({ cellProps: { colspan: 3 } }))
    return invalid('PdfTableRow', /<PdfTableRow> needs \d+ columns \(counting colspan\), but its <PdfTable> declares \d+/)
  } },
  { id: 'cell-header-value', check: 'table.ts: header is true or false', base: 'table', apply: (spec, pick) => {
    const target = nth(cells(spec), pick)
    if (target) setProps(target.cell, { header: 'yes' })
    else append(host(spec, pick), () => tableWith({ cellProps: { header: 'yes' } }))
    return invalid('PdfTableCell', /requires "header" to be true or false/)
  } },
  { id: 'span-mixed-units', check: 'table.ts: a span over columns whose widths cannot be added', apply: (spec, pick) => {
    append(host(spec, pick), () => tableWith({ columns: ['30pt', '3rem'], cellProps: { colspan: 2 } }))
    return invalid('PdfTableCell', /spans columns in "pt" and "rem"/)
  } },
  { id: 'span-right-margin', check: 'table.ts: right margin on a span over percentage and length columns', apply: (spec, pick) => {
    append(host(spec, pick), () => tableWith({ columns: ['20%', '80pt'], cellProps: { colspan: 2, style: { marginRight: 4 } } }))
    return invalid('PdfTableCell', /spans percentage and length columns, so it cannot take a right margin/)
  } },
  { id: 'cell-outside-row', check: 'table.ts: cell outside a row', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfTableCell, () => 'cell'))
    return invalid('PdfTableCell', /<PdfTableCell> must be inside <PdfTableRow>/)
  } },
  { id: 'row-outside-table', check: 'table.ts: row outside a table', apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfTableRow, () => [h(PdfTableCell, () => 'cell')]))
    return invalid('PdfTableRow', /<PdfTableRow> must be inside <PdfTable>/)
  } },
  { id: 'text-in-row', check: 'table.ts: row holds cells only', base: 'table', apply: (spec, pick) => {
    const row = nth(rows(spec), pick)
    if (row) row.patch = { append: () => [h(PdfText, () => 'loose')] }
    else append(host(spec, pick), () => tableWith({ rowChildren: () => [h(PdfText, () => 'loose')] }))
    return invalid('PdfTableRow', /<PdfTableRow> holds <PdfTableCell> elements only/)
  } },
  { id: 'table-columns', check: 'table.ts: columns', base: 'table', apply: (spec, pick) => {
    const columns = [[], [1, 'wide'], [1, -2]][pick % 3]
    const table = nth(tables(spec), pick)
    if (table) setProps(table, { columns })
    else append(host(spec, pick), () => tableWith({ columns }))
    return invalid('PdfTable', /<PdfTable> requires "columns"/)
  } },

  // Document (validate-tree.ts).
  { id: 'document-without-page', check: 'validate-tree.ts: at least one PdfPage', apply: (spec) => {
    spec.patch = { append: () => [], replaceChildren: true }
    return invalid('PdfDocument', /requires at least one <PdfPage>/)
  } },
  { id: 'creation-date', check: 'validate-tree.ts: creationDate', apply: (spec, pick) => {
    setProps(spec, { creationDate: pick % 2 === 0 ? new Date(Number.NaN) : '2026-01-02' })
    return invalid('PdfDocument', /requires "creationDate" to be a valid Date/)
  } },
  { id: 'conformance-value', check: 'validate-tree.ts: conformance', apply: (spec) => {
    setProps(spec, { conformance: 'PDF/A-9z' })
    return invalid('PdfDocument', /requires "conformance" to be/)
  } },
  { id: 'metadata-type', check: 'validate-tree.ts: string metadata (V6)', apply: (spec, pick) => {
    setProps(spec, pick % 2 === 0 ? { title: 42 } : { author: { name: 'A' } })
    return invalid('PdfDocument', /requires a string "(?:title|author)" value/)
  } },
  { id: 'pdf-version-value', check: 'validate-tree.ts: pdfVersion (V7)', apply: (spec) => {
    setProps(spec, { pdfVersion: '9.9' })
    return invalid('PdfDocument', /requires "pdfVersion" to be "1\.3"/)
  } },
  { id: 'attachment-name', check: 'validate-tree.ts: attachmentName', apply: (spec) => {
    spec.patch = { append: () => [h(PdfAttachment, { name: 'notes/a.txt', data: 'x' })] }
    return invalid('PdfAttachment', /<PdfAttachment> requires "name"/)
  } },
  { id: 'attachment-twice', check: 'validate-tree.ts: attachment declared twice', apply: (spec) => {
    spec.patch = { append: () => [h(PdfAttachment, { name: 'a.txt', data: 'x' }), h(PdfAttachment, { name: 'a.txt', data: 'y' })] }
    return invalid('PdfAttachment', /"a\.txt" is declared twice/)
  } },

  // Protection (F4; validate-tree.ts protection and validateProtection).
  { id: 'protection-empty-password', check: 'validate-tree.ts: password must not be empty', apply: (spec) => {
    protect(spec, { openPassword: '' })
    return invalid('PdfDocument', /"protection\.openPassword" must not be empty/)
  } },
  { id: 'protection-same-passwords', check: 'validate-tree.ts: equal open and owner password', apply: (spec) => {
    protect(spec, { openPassword: SECRET, ownerPassword: SECRET })
    return invalid('PdfDocument', /are the same, so whoever opens the PDF gets every permission/, SECRET)
  } },
  { id: 'protection-control-character', check: 'validate-tree.ts: password not SASLprep-stable', apply: (spec) => {
    const secret = `${SECRET}\u0007`
    protect(spec, { openPassword: secret })
    return invalid('PdfDocument', /must not contain control, format or private-use characters/, SECRET)
  } },
  { id: 'protection-unknown-key', check: 'validate-tree.ts: unknown protection key', apply: (spec) => {
    protect(spec, { password: SECRET })
    return invalid('PdfDocument', /"protection" has the unknown key "password"/, SECRET)
  } },
  { id: 'protection-unknown-permission', check: 'validate-tree.ts: unknown permission', apply: (spec) => {
    protect(spec, { ownerPassword: OTHER_SECRET, allow: { copy: true } })
    return invalid('PdfDocument', /has the unknown permission "copy"/, OTHER_SECRET)
  } },
  { id: 'protection-pdf-a', check: 'validate-tree.ts: protection with a PDF/A level', apply: (spec) => {
    protect(spec, { openPassword: SECRET }, { conformance: 'PDF/A-3b' })
    return invalid('PdfDocument', /claims PDF\/A-3b, which must not be encrypted/, SECRET)
  } },
  { id: 'protection-factur-x', check: 'validate-tree.ts: protection with PdfFacturX', apply: (spec) => {
    spec.patch = {
      props: { protection: { ownerPassword: OTHER_SECRET } },
      append: () => [h(PdfFacturX, { profile: 'MINIMUM', xml: FACTUR_X_XML })],
    }
    return invalid('PdfFacturX', /<PdfFacturX> writes a PDF\/A-3 file, which must not be encrypted/, OTHER_SECRET)
  } },
  { id: 'protection-pdf-version', check: 'validate-tree.ts: protection with pdfVersion', apply: (spec) => {
    protect(spec, { openPassword: SECRET }, { pdfVersion: '1.4' })
    return invalid('PdfDocument', /"protection" writes PDF 1\.7 with AES-256/, SECRET)
  } },
  // SVG content (validate-tree.ts: SVG references and presentation values, svg context; mixed, untagged).
  { id: 'svg-fill-reference', check: 'validate-tree.ts: SVG fill url() reference', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfRect, { x: 0, y: 0, width: 4, height: 4, fill: 'url(#missing)' }))
    return invalid('PdfRect', /fill "url\(#missing\)" references a missing or incompatible definition/)
  } },
  { id: 'svg-clip-path-reference', check: 'validate-tree.ts: SVG clipPath reference', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfRect, { x: 0, y: 0, width: 4, height: 4, clipPath: pick % 2 === 0 ? 'url(#nowhere)' : 'nowhere' }))
    return invalid('PdfRect', /clipPath "(?:url\(#nowhere\)|nowhere)" references a missing or incompatible definition/)
  } },
  { id: 'svg-definition-id', check: 'validate-tree.ts: SVG definition id (safe, unique)', base: 'mixed', tagged: false, apply: (spec, pick) => {
    const gradient = (id: string) => h(PdfLinearGradient, { id }, () => [h(PdfStop, { offset: 0, stopColor: '#000000' })])
    inSvg(spec, pick, () => h(PdfDefs, () => pick % 2 === 0 ? [gradient('1g')] : [gradient('g'), gradient('g')]))
    return invalid('PdfLinearGradient', /(?:"id" must be a safe identifier|has the id of another definition)/)
  } },
  { id: 'svg-stroke-width', check: 'validate-tree.ts: svgStrokeWidth', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfRect, { x: 0, y: 0, width: 4, height: 4, stroke: '#000000', strokeWidth: pick % 2 === 0 ? -1 : '10%' }))
    return invalid('PdfRect', /(?:requires a non-negative "strokeWidth" value|does not support a percentage stroke width)/)
  } },
  { id: 'svg-transform', check: 'validate-tree.ts: svgTransform', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfRect, { x: 0, y: 0, width: 4, height: 4, transform: 'scale(2)' }))
    return invalid('PdfRect', /has an unsupported SVG transform\. Got "scale\(2\)"/)
  } },
  { id: 'svg-unit-interval', check: 'validate-tree.ts: svgUnitInterval', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfRect, { x: 0, y: 0, width: 4, height: 4, ...(pick % 2 === 0 ? { fillOpacity: 1.5 } : { strokeOpacity: '150%' }) }))
    return invalid('PdfRect', /requires "(?:fillOpacity|strokeOpacity)" between 0 and 1/)
  } },
  { id: 'svg-text-position', check: 'validate-tree.ts: SVG text needs x and y', base: 'mixed', tagged: false, apply: (spec, pick) => {
    inSvg(spec, pick, () => h(PdfText, pick % 2 === 0 ? { x: 2 } : { y: 12 }, () => 'svg text'))
    return invalid('PdfText', /SVG <PdfText> requires both "x" and "y" props/)
  } },
  { id: 'tspan-outside-svg', check: 'validate-tree.ts: svg-only element in the page flow', base: 'mixed', tagged: false, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfText, () => [h(PdfTspan, () => 'span')]))
    return invalid('PdfTspan', /<PdfTspan> is only supported inside SVG text/)
  } },

  // Tagged PDF (validate-tree.ts validateTaggedDocument; mixed, tagged as PDF/UA-1).
  { id: 'tagged-title', check: 'validate-tree.ts: PDF/UA-1 title', base: 'mixed', tagged: true, apply: (spec, pick) => {
    setProps(spec, { title: pick % 2 === 0 ? '' : '  ' })
    return invalid('PdfDocument', /claims PDF\/UA-1, which requires a "title"/)
  } },
  { id: 'tagged-language', check: 'validate-tree.ts: tagged language', base: 'mixed', tagged: true, apply: (spec, pick) => {
    setProps(spec, { language: pick % 2 === 0 ? '' : 'de_DE' })
    return invalid('PdfDocument', /claims PDF\/UA-1, which requires (?:a "language"|"language" to be a language tag such as "en" or "de-CH"; "de_DE" is not one\. Write "de-DE")/)
  } },
  { id: 'tagged-figure-alt', check: 'validate-tree.ts: figure, image or SVG alt in a tagged document', base: 'mixed', tagged: true, apply: (spec, pick) => {
    const image = pick % 2 === 0
    append(host(spec, pick), () => image
      ? h(PdfImage, { src: IMAGES.png.src, style: { width: 20, height: 12 } })
      : h(PdfView, { tag: 'figure' }, () => [h(PdfText, () => 'figure')]))
    return invalid(image ? 'PdfImage' : 'PdfView', /needs "alt" \(a short text that says what (?:it|the figure) shows\) or "decorative" in a PDF\/UA-1 document/)
  } },
  { id: 'tagged-heading-order', check: 'validate-tree.ts: heading order', base: 'mixed', tagged: true, apply: (spec, pick) => {
    const first = texts(spec).find(text => text.heading !== undefined)
    if (first && pick % 2 === 0) first.patch = { props: { tag: 'h2' } }
    else append(spec.pages[0]!, () => h(PdfText, { tag: 'h4' }, () => 'heading'))
    return invalid('PdfText', /(?:is the first heading of the document; a PDF\/UA-1 document starts with tag="h1"|skips a heading level)/)
  } },
  { id: 'tagged-link-in-fixed', check: 'validate-tree.ts: link in fixed content of a tagged document', base: 'mixed', tagged: true, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { fixed: true }, () => [h(PdfLink, { href: 'https://example.com/fault' }, () => [h(PdfText, () => 'fixed link')])]))
    return invalid('PdfLink', /inside a fixed or decorative node is not supported in a PDF\/UA-1 document/)
  } },
  { id: 'tagged-figure-content', check: 'validate-tree.ts: structure inside a figure', base: 'mixed', tagged: true, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { tag: 'figure', alt: 'figure' }, () => [h(PdfText, { tag: 'p' }, () => 'inside')]))
    return invalid('PdfText', /is not supported inside <PdfView tag="figure">/)
  } },
  { id: 'tagged-list-shape', check: 'validate-tree.ts: list shape', base: 'mixed', tagged: true, apply: (spec, pick) => {
    append(host(spec, pick), () => pick % 2 === 0
      ? h(PdfView, { tag: 'list-item' }, () => [h(PdfText, () => 'item')])
      : h(PdfView, { tag: 'list' }, () => [h(PdfText, () => 'loose')]))
    return invalid(pick % 2 === 0 ? 'PdfView' : 'PdfText', /(?:must be a direct child of <PdfView tag="list">|holds <PdfView tag="list-item"> and <PdfView tag="caption"> elements only)/)
  } },
  { id: 'tagged-note', check: 'validate-tree.ts: PdfNote in a tagged document', base: 'mixed', tagged: true, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfNote, () => 'note'))
    return invalid('PdfNote', /is not supported in a PDF\/UA-1 document: a note is a pop-up/)
  } },

  // Form fields (validate-tree.ts validateField, PROP_CHECKS, validateFieldsConformance; mixed, untagged).
  { id: 'field-duplicate-name', check: 'validate-tree.ts: unique field name', base: 'mixed', tagged: false, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, () => [
      // Both of one kind: the message names one of the two, and the walk order is not part of the contract.
      h(PdfCheckbox, { name: 'samename', style: FIELD_STYLE }),
      h(PdfCheckbox, { name: 'samename', style: FIELD_STYLE }),
    ]))
    return invalid('PdfCheckbox', /"samename" is the name of another form field too/)
  } },
  { id: 'field-value-winansi', check: 'validate-tree.ts: field value in WinAnsi', base: 'mixed', tagged: false, apply: (spec, pick) => {
    textField(spec, pick, { value: 'Ohm \u03A9' })
    return invalid('PdfTextField', /"value" contains .+, which the field font Helvetica cannot draw/)
  } },
  { id: 'field-in-fixed', check: 'validate-tree.ts: field inside fixed content', base: 'mixed', tagged: false, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfView, { fixed: true }, () => [h(PdfCheckbox, { name: 'fixedfield', style: FIELD_STYLE })]))
    return invalid('PdfCheckbox', /"fixedfield" is inside fixed content, which repeats on every page/)
  } },
  { id: 'field-max-length', check: 'validate-tree.ts: value longer than maxLength', base: 'mixed', tagged: false, apply: (spec, pick) => {
    textField(spec, pick, { value: 'abcdef', maxLength: 3 })
    return invalid('PdfTextField', /has a "value" longer than "maxLength" \(3\)/)
  } },
  { id: 'select-value-not-option', check: 'validate-tree.ts: select value among options', base: 'mixed', tagged: false, apply: (spec, pick) => {
    const select = nth(fields(spec).filter(node => node.field === 'select'), pick)
    if (select) select.patch = { props: { value: 'notanoption' } }
    else append(host(spec, pick), () => h(PdfSelect, { name: 'faultselect', options: ['a', 'b'], value: 'c', style: FIELD_STYLE }))
    return invalid('PdfSelect', /has a "value" that is not one of "options"/)
  } },
  { id: 'field-style', check: 'validate-tree.ts: field box style', base: 'mixed', tagged: false, apply: (spec, pick) => {
    const style = [{ width: 60 }, { ...FIELD_STYLE, borderRadius: 4 }, { ...FIELD_STYLE, textAlign: 'justify' }][pick % 3]!
    append(host(spec, pick), () => h(PdfTextField, { name: 'styledfield', style }))
    return invalid('PdfTextField', /(?:needs a "height" in its style|sets "borderRadius", but a field border is square|sets "textAlign: justify")/)
  } },
  { id: 'fields-pdf-a', check: 'validate-tree.ts: form fields with a PDF/A level', base: 'mixed', tagged: false, apply: (spec, pick) => {
    setProps(spec, { conformance: 'PDF/A-3b' })
    append(host(spec, pick), () => h(PdfCheckbox, { name: 'claimfield', style: FIELD_STYLE }))
    return invalid('PdfDocument', /claims PDF\/A-3b, which needs an embedded font in every form field/)
  } },
  { id: 'fields-tagged', check: 'validate-tree.ts: form fields in a tagged document', base: 'mixed', tagged: true, apply: (spec, pick) => {
    append(host(spec, pick), () => h(PdfCheckbox, { name: 'claimfield', style: FIELD_STYLE }))
    return invalid('PdfDocument', /claims PDF\/UA-1, which needs a structure element for every form field/)
  } },
]

/**
 * Checks no fault kind covers, and why.
 */
export const FAULT_EXCLUSIONS = [
  'root: two PdfDocument roots, text outside PdfDocument (the spec template always renders one PdfDocument root)',
  'SVG: a second PdfDefs, svgNonNegative and svgNumber shape values, page-flow props on SVG text, PdfStop values (the same check paths as svg-definition-id, svg-stroke-width and svg-text-position)',
  'tagged PDF: block content inside PdfLink (the same visit as tagged-figure-content), PDF/A-3a (the same checks as PDF/UA-1 under another name), PdfNote in a PDF/A document (tagged-note covers the check)',
  'form fields: multiline line break, checkbox exportValue, field name and options shape (prop checks of the same kind as field-max-length and select-value-not-option)',
  'Factur-X profile, XML well-formedness, relationship and XML/profile match (covered by test/renderer.test.ts and test/einvoice/*; needs invoice fixtures)',
  'attachment data, MIME type, relationship (one attachment fault covers the attachment checks path)',
  'image source policy (PDF_ASSET_BLOCKED, PDF_ASSET_INVALID: asset admission, not tree validation)',
  'repeated or circular element node (render-limits.ts: cannot be built from a Vue template)',
  'creationDate year outside 0 to 9999 (the creation-date fault covers the same check)',
  'async setup, Vue warnings (PDF_TEMPLATE_INVALID: template execution, not a document fault)',
] as const

// ---------------------------------------------------------------------------
// Raw invalid documents

export interface RawInvalidDocument {
  /** The `id` of a FAULTS entry. */
  fault: string
  pick: number
  base: Profile
  raw: RawDocument
}

export const faultKind = (raw: Pick<RawInvalidDocument, 'fault'>): FaultKind => {
  const fault = FAULTS.find(kind => kind.id === raw.fault)
  if (!fault) throw new RangeError(`no fault kind "${raw.fault}"`)
  return fault
}

export const rawInvalidDocument = (kinds: readonly string[]): fc.Arbitrary<RawInvalidDocument> =>
  fc.constantFrom(...kinds).chain((fault) => {
    const { base } = faultKind({ fault })
    return fc.record({
      fault: fc.constant(fault),
      pick: fc.nat({ max: 1000 }),
      base: base === undefined ? fc.constantFrom<Profile>('flow', 'fixed', 'table') : fc.constant(base),
    }).chain(head => rawDocument(head.base).map(raw => ({ ...head, raw: shortDocument(raw) })))
  })

export interface InvalidDocument {
  fault: FaultKind
  /** The valid document. */
  valid: DocumentSpec
  /** The same document with the fault. */
  spec: DocumentSpec
  expected: ExpectedError
}

export const normalizeInvalid = (raw: RawInvalidDocument): InvalidDocument => {
  const fault = faultKind(raw)
  const document = fault.tagged === undefined ? raw.raw : { ...raw.raw, tagged: fault.tagged }
  const spec = normalizeDocument(document, raw.base)
  const expected = fault.apply(spec, raw.pick)
  return { fault, valid: normalizeDocument(document, raw.base), spec, expected }
}
