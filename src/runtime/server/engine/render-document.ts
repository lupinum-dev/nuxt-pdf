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
} from '../fonts'
import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../../shared/errors'
import {
  PDF_PRIMITIVES,
  type PdfElementNode,
  type PdfNode,
} from '../../renderer/types'

export interface PdfEngineOptions {
  compress?: boolean
  fontStore?: PdfFontStore
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
    node.style = Array.isArray(node.style)
      ? [...node.style, { lineHeight: DYNAMIC_LINE_HEIGHT_SENTINEL }]
      : { ...(node.style ?? {}), lineHeight: DYNAMIC_LINE_HEIGHT_SENTINEL }
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

const collectStream = (stream: NodeJS.ReadableStream) => new Promise<Uint8Array>((resolve, reject) => {
  const chunks: Uint8Array[] = []

  stream.on('data', (chunk: Uint8Array | Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  })
  stream.on('end', () => resolve(Buffer.concat(chunks)))
  stream.on('error', reject)
})

const createContext = (props: DocumentMetadata, compress: boolean) => new PDFDocument({
  compress,
  pdfVersion: props.pdfVersion,
  lang: props.language,
  displayTitle: true,
  autoFirstPage: false,
  ownerPassword: props.ownerPassword,
  userPassword: props.userPassword,
  permissions: props.permissions,
  pageLayout: props.pageLayout,
  info: compact({
    Title: props.title,
    Author: props.author,
    Subject: props.subject,
    Keywords: props.keywords,
    Creator: props.creator ?? 'nuxt-pdf',
    Producer: props.producer ?? 'nuxt-pdf',
    CreationDate: props.creationDate ?? new Date(),
    ModificationDate: props.modificationDate,
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
): Promise<SafeDocumentNode> => {
  if (document.type !== 'DOCUMENT') {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `Expected a DOCUMENT root, received ${document.type}.`,
    )
  }

  normalizeDynamicTextLineHeight(document as unknown as PdfElementNode)

  try {
    return await runLayout(
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
  const pages: DestinationPageMap = {}

  documentPages(layout).forEach((page, index) => {
    const pageNumber = index + 1
    visitPageNodes(page, (node) => {
      const id = nodeId(node)
      if (id !== undefined && !(id in pages)) pages[id] = pageNumber
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

// Serialization seam. Paints one already-laid-out document to PDF bytes.
export const serializePdfLayout = async (
  props: DocumentMetadata,
  layout: SafeDocumentNode,
  compress: boolean,
): Promise<Uint8Array> => {
  try {
    anchorDestinationsAtFirstPage(layout)
    const context = createContext(props, compress)
    const stream = renderPDF(
      context as unknown as Parameters<typeof renderPDF>[0],
      layout,
    ) as unknown as NodeJS.ReadableStream

    return await collectStream(stream)
  }
  catch (error) {
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
  const layout = await layoutPdfTree(document, fontStore)
  const bytes = await serializePdfLayout(
    document.props,
    layout,
    options.compress ?? true,
  )

  return { bytes, layout }
}
