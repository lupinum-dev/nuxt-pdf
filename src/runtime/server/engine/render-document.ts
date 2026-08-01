// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./react-pdf-pdfkit.d.ts" />

import { Buffer } from 'node:buffer'
import type FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from '@react-pdf/layout'
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
import {
  PDF_PRIMITIVES,
  type PdfStyleValue,
} from '../../authoring'
import type {
  PdfElementNode,
  PdfNode,
} from '../../renderer'
import {
  enforceMaxPages,
  type RenderLimits,
} from '../render-limits'

export interface PdfEngineOptions {
  compress?: boolean
  fontStore?: PdfFontStore
  limits?: RenderLimits
}

/** id (named destination) → 1-based page number the destination resolves to. */
export type DestinationPageMap = Record<string, number>

export interface PdfEngineResult {
  bytes: Uint8Array
  layout: SafeDocumentNode
}

type DocumentMetadata = DocumentNode['props']
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
      if (limits && total > limits.maxOutputBytes) {
        const error = new NuxtPdfError(
          PDF_ERROR_CODES.LimitExceeded,
          `PDF output exceeded pdf.limits.maxOutputBytes (${limits.maxOutputBytes}).`,
        )
        limits.abortController.abort(error)
        stream.destroy(error)
        return
      }
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

const createContext = (props: DocumentMetadata, compress: boolean) => new PDFDocument({
  compress,
  pdfVersion: props.pdfVersion,
  lang: props.language,
  displayTitle: true,
  autoFirstPage: false,
  pageLayout: props.pageLayout,
  info: compact({
    Title: props.title,
    Author: props.author,
    Subject: props.subject,
    Keywords: props.keywords,
    Creator: props.creator ?? 'nuxt-pdf',
    Producer: props.producer ?? 'nuxt-pdf',
    CreationDate: props.creationDate ?? new Date(),
  }),
})

// Single-pass layout seam. Validates the root, applies the dynamic lineHeight
// shield, and runs the upstream layout pipeline once. The multi-pass loop
// (layout-passes.ts) calls this once per pass — re-normalizing each time because
// re-patching the mounted tree resets dynamic-text styles to their literals — and
// serializes only the converged result via `serializePdfLayout`. `renderDocument`
// composes both for the ordinary one-shot path; both share this one source of
// truth for layout error mapping and the lineHeight shield.
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

const nodeId = (node: PdfElementNode): string | undefined => {
  const id = node.props?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * Map every `id` (named destination) to the **first** 1-based page it appears
 * on. `id` is the key `render/src/operations/setDestination.ts` emits and that a
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

  documentPages(layout).forEach((page, index) => {
    const pageNumber = index + 1
    visitPageNodes(page, (node) => {
      const id = nodeId(node)
      if (id !== undefined && !Object.hasOwn(pages, id)) pages[id] = pageNumber
    })
  })

  return pages
}

/**
 * Before serialization, drop `props.id` from every appearance of an id after its
 * first page. pdfkit's NameTree (and upstream `setDestination`, called per node)
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

  const strip = (node: PdfNode): PdfNode => {
    if (!('props' in node)) return node
    const element = node as PdfElementNode
    let next = element

    const id = nodeId(element)
    if (id !== undefined) {
      if (!seen.has(id)) {
        seen.add(id)
      }
      else {
        const { id: _dropped, ...rest } = element.props
        next = { ...element, props: rest }
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

// Serialization seam. Paints one already-laid-out document to PDF bytes.
export const serializePdfLayout = async (
  props: DocumentMetadata,
  layout: SafeDocumentNode,
  compress: boolean,
  limits?: RenderLimits,
): Promise<Uint8Array> => {
  // Checked before the paint (outside the try below) so an expired budget stays
  // PDF_LIMIT_EXCEEDED instead of being re-wrapped as a serialization failure.
  limits?.deadline.check()
  try {
    anchorDestinationsAtFirstPage(layout)
    normalizeResolvedSvgZeros(layout)
    const context = createContext(props, compress)
    // Listen before the synchronous painter starts so early PDFKit chunks and
    // errors cannot race the collector.
    const collected = collectStream(context, limits)
    try {
      renderPDF(
        context as unknown as Parameters<typeof renderPDF>[0],
        layout,
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
