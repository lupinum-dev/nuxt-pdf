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
  type PdfStyleValue,
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

const ownLineHeight = (style: PdfStyleValue): unknown => {
  const styles = Array.isArray(style) ? style : [style]
  let lineHeight: unknown

  for (const entry of styles) {
    if (
      entry
      && Object.prototype.hasOwnProperty.call(entry, 'lineHeight')
    ) {
      lineHeight = entry.lineHeight
    }
  }

  return lineHeight
}

const assertDynamicTextLineHeight = (
  node: PdfElementNode,
  inheritedLineHeight?: unknown,
): void => {
  const localLineHeight = ownLineHeight(node.style)
  const lineHeight = localLineHeight ?? inheritedLineHeight

  if (
    node.type === PDF_PRIMITIVES.Text
    && typeof node.props.render === 'function'
    && lineHeight !== undefined
  ) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.LayoutError,
      'Dynamic PdfText cannot inherit a lineHeight style. Move lineHeight from PdfPage or PdfView to static PdfText styles; the current PDF layout engine otherwise produces invalid page-text geometry.',
    )
  }

  for (const child of node.children) {
    if ('children' in child) {
      assertDynamicTextLineHeight(child, lineHeight)
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

  assertDynamicTextLineHeight(document as unknown as PdfElementNode)

  const fontStore = options.fontStore ?? createPdfFontStore()
  let layout: SafeDocumentNode

  try {
    layout = await runLayout(
      document,
      fontStore as unknown as FontStore,
    )
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = /font|glyph/i.test(message)
      ? PDF_ERROR_CODES.FontError
      : PDF_ERROR_CODES.LayoutError

    throw new NuxtPdfError(
      code,
      code === PDF_ERROR_CODES.FontError
        ? `PDF font resolution failed: ${message}`
        : `PDF layout failed: ${message}`,
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
