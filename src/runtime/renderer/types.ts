export const PDF_PRIMITIVES = {
  Document: 'DOCUMENT',
  Page: 'PAGE',
  View: 'VIEW',
  Text: 'TEXT',
  Image: 'IMAGE',
  Link: 'LINK',
  Note: 'NOTE',
  Tspan: 'TSPAN',
  TextInstance: 'TEXT_INSTANCE',
} as const

export type PdfElementType = Exclude<
  (typeof PDF_PRIMITIVES)[keyof typeof PDF_PRIMITIVES],
  typeof PDF_PRIMITIVES.TextInstance
>

export const PDF_PRIMITIVE_NAMES: Record<PdfElementType, string> = {
  [PDF_PRIMITIVES.Document]: 'PdfDocument',
  [PDF_PRIMITIVES.Page]: 'PdfPage',
  [PDF_PRIMITIVES.View]: 'PdfView',
  [PDF_PRIMITIVES.Text]: 'PdfText',
  [PDF_PRIMITIVES.Image]: 'PdfImage',
  [PDF_PRIMITIVES.Link]: 'PdfLink',
  [PDF_PRIMITIVES.Note]: 'PdfNote',
  [PDF_PRIMITIVES.Tspan]: 'Tspan',
}

export type PdfStyle = Record<string, unknown>
export type PdfStyleValue = PdfStyle | PdfStyle[]

export type PdfDynamicPageProps = {
  pageNumber: number
  totalPages?: number
  subPageNumber?: number
  subPageTotalPages?: number
}

export type PdfDynamicTextRender = (
  props: PdfDynamicPageProps,
) => string | number | null | undefined

export type PdfTextInstance = {
  type: typeof PDF_PRIMITIVES.TextInstance
  value: string
}

export type PdfElementNode = {
  type: PdfElementType
  box: Record<string, unknown>
  style: PdfStyleValue
  props: Record<string, unknown>
  children: PdfNode[]
}

export type PdfDocumentNode = PdfElementNode & {
  type: typeof PDF_PRIMITIVES.Document
}

export type PdfNode = PdfElementNode | PdfTextInstance

export type PdfRoot = {
  type: 'ROOT'
  document: PdfDocumentNode | null
}

export const PDF_COMMENT = Symbol('nuxt-pdf-comment')

export type PdfCommentNode = {
  readonly [PDF_COMMENT]: true
  value: string
}

export type PdfHostNode = PdfNode | PdfCommentNode
export type PdfHostElement = PdfRoot | PdfElementNode

const ELEMENT_TYPES = new Set<string>([
  PDF_PRIMITIVES.Document,
  PDF_PRIMITIVES.Page,
  PDF_PRIMITIVES.View,
  PDF_PRIMITIVES.Text,
  PDF_PRIMITIVES.Image,
  PDF_PRIMITIVES.Link,
  PDF_PRIMITIVES.Note,
  PDF_PRIMITIVES.Tspan,
])

export const isPdfElementType = (value: string): value is PdfElementType =>
  ELEMENT_TYPES.has(value)

export const isPdfElementNode = (
  node: PdfHostNode,
): node is PdfElementNode =>
  'type' in node && node.type !== PDF_PRIMITIVES.TextInstance

export const isPdfTextInstance = (
  node: PdfHostNode,
): node is PdfTextInstance =>
  'type' in node && node.type === PDF_PRIMITIVES.TextInstance

export const isPdfCommentNode = (
  node: PdfHostNode,
): node is PdfCommentNode => PDF_COMMENT in node
