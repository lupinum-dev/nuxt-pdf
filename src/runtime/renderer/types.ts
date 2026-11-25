import type { PdfStyleValue } from '../authoring'
import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES, type PdfElementType } from '../primitives'
import type { PdfLibraryComponentName, PdfRichImageMark } from '../component-names'
import type { RichTextWarningEntry } from '../rich-text/warnings'
import { describePdfValue } from '../shared/describe-value'

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
  /**
   * `"<file>:<line>:<column>"` of the template element, in development
   * builds. Host data only: it never becomes an engine prop or style.
   */
  source?: string
  /**
   * The library component that rendered this element, such as `'PdfTableCell'`.
   * Host data only, like `source`.
   */
  component?: PdfLibraryComponentName
  /** An image block of `PdfRichText` or its placeholder. Host data only, like `source`. */
  richImage?: PdfRichImageMark
  /** The input warnings of a `PdfRichText`, on its view. Host data only, like `source`. */
  richTextWarnings?: readonly RichTextWarningEntry[]
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

/** The component name an error about this element shows to the author. */
export const pdfElementName = (node: PdfElementNode): string =>
  node.component ?? PDF_PRIMITIVE_NAMES[node.type]

/**
 * The element in an error message, written by the caller inside `<…>`: its
 * name, and its id when it has one, such as `PdfText id="intro"`.
 */
export const pdfElementLabel = (node: PdfElementNode): string => {
  const name = pdfElementName(node)
  const { id } = node.props
  return typeof id === 'string' && id.trim() !== '' ? `${name} id=${describePdfValue(id)}` : name
}
