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
} from '../../renderer/types'

export interface PdfEngineOptions {
  compress?: boolean
  fontStore?: PdfFontStore
}

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

export const renderDocument = async (
  document: DocumentNode,
  options: PdfEngineOptions = {},
): Promise<PdfEngineResult> => {
  if (document.type !== 'DOCUMENT') {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `Expected a DOCUMENT root, received ${document.type}.`,
    )
  }

  normalizeDynamicTextLineHeight(document as unknown as PdfElementNode)

  const fontStore = options.fontStore ?? createPdfFontStore()
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

  try {
    const context = createContext(document.props, options.compress ?? true)
    const stream = renderPDF(
      context as unknown as Parameters<typeof renderPDF>[0],
      layout,
    ) as unknown as NodeJS.ReadableStream

    return {
      bytes: await collectStream(stream),
      layout,
    }
  }
  catch (error) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      `PDF serialization failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
