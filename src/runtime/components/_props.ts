import type {
  PdfDynamicTextRender,
  PdfStyleValue,
} from '../renderer/types'

export type PdfBookmark = string | {
  title: string
  top?: number
  left?: number
  zoom?: number
  fit?: boolean
  expanded?: boolean
}

export type PdfBaseProps = {
  id?: string
  fixed?: boolean
  break?: boolean
  debug?: boolean
  bookmark?: PdfBookmark
  minPresenceAhead?: number
  style?: PdfStyleValue
}

export type PdfDocumentProps = {
  title?: string
  author?: string
  subject?: string
  creator?: string
  keywords?: string
  producer?: string
  language?: string
  creationDate?: Date
  modificationDate?: Date
  pdfVersion?: '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '1.7ext3'
  pageMode?:
    | 'useNone'
    | 'useOutlines'
    | 'useThumbs'
    | 'fullScreen'
    | 'useOC'
    | 'useAttachments'
  pageLayout?:
    | 'singlePage'
    | 'oneColumn'
    | 'twoColumnLeft'
    | 'twoColumnRight'
    | 'twoPageLeft'
    | 'twoPageRight'
  ownerPassword?: string
  userPassword?: string
  permissions?: {
    printing?: 'lowResolution' | 'highResolution'
    modifying?: boolean
    copying?: boolean
    annotating?: boolean
    fillingForms?: boolean
    contentAccessibility?: boolean
    documentAssembly?: boolean
  }
}

export type PdfPageProps = PdfBaseProps & {
  wrap?: boolean
  size?:
    | number
    | string
    | [number | string]
    | [number | string, number | string]
    | { width: number | string, height?: number | string }
  orientation?: 'portrait' | 'landscape'
  dpi?: number
}

export type PdfViewProps = PdfBaseProps & {
  wrap?: boolean
}

export type PdfTextProps = PdfBaseProps & {
  wrap?: boolean
  widows?: number
  orphans?: number
  render?: PdfDynamicTextRender
  hyphenationCallback?: (word: string) => string[]
}

export type PdfImageSource
  = | string
    | Uint8Array
    | ArrayBuffer
    | { data: Uint8Array, format: 'png' | 'jpg' }
    | { uri: string, headers?: Record<string, string> }

export type PdfImageProps = PdfBaseProps & {
  src?: PdfImageSource | (() => PdfImageSource | Promise<PdfImageSource>)
  source?: PdfImageSource | (() => PdfImageSource | Promise<PdfImageSource>)
  cache?: boolean
}

export type PdfLinkProps = PdfBaseProps & {
  wrap?: boolean
  href?: string
  src?: string
  hitSlop?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
}

export type PdfNoteProps = PdfBaseProps

export const compactPdfProps = (props: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) result[key] = value
  }

  return result
}
