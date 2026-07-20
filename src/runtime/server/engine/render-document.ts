import { Buffer } from 'node:buffer'
import FontStore from '@react-pdf/font'
import layoutDocument, {
  type DocumentNode,
  type SafeDocumentNode,
} from '@react-pdf/layout'
import PDFDocument from '@react-pdf/pdfkit'
import renderPDF from '@react-pdf/render'

export interface PdfEngineOptions {
  compress?: boolean
  fontStore?: FontStore
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
    throw new TypeError(`Expected a DOCUMENT root, received ${document.type}`)
  }

  const fontStore = options.fontStore ?? new FontStore()
  const layout = await runLayout(document, fontStore)
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

export { FontStore }
