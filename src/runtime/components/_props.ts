import type {
  PdfDynamicTextRender,
  PdfStyleValue,
} from '../authoring'

export type PdfBookmark = string | {
  title: string
  expanded?: boolean
}

export type PdfBaseProps = {
  id?: string
  fixed?: boolean
  break?: boolean
  debug?: boolean
  minPresenceAhead?: number
  style?: PdfStyleValue
}

// Outline entries are typed only where they are claimed and tested
// (Page/View/Text/Image); see CONFORMANCE.md.
type PdfBookmarkProp = {
  bookmark?: PdfBookmark
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
  pdfVersion?: '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '1.7ext3'
  pageLayout?:
    | 'singlePage'
    | 'oneColumn'
    | 'twoColumnLeft'
    | 'twoColumnRight'
    | 'twoPageLeft'
    | 'twoPageRight'
}

export const PDF_PAGE_SIZE_NAMES = [
  '4A0',
  '2A0',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
  'B0',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'C0',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'RA0',
  'RA1',
  'RA2',
  'RA3',
  'RA4',
  'SRA0',
  'SRA1',
  'SRA2',
  'SRA3',
  'SRA4',
  'EXECUTIVE',
  'FOLIO',
  'LEGAL',
  'LETTER',
  'TABLOID',
  'ID1',
] as const

export type PdfPageSizeName = (typeof PDF_PAGE_SIZE_NAMES)[number]

export type PdfPageUnit = 'pt' | 'in' | 'mm' | 'cm' | 'px'
export type PdfPageDimension = number | `${number}${PdfPageUnit}`
export type PdfPageSize
  = | PdfPageSizeName
    | readonly [PdfPageDimension, PdfPageDimension]
    | { width: PdfPageDimension, height: PdfPageDimension }

export type PdfPageProps = PdfBaseProps & PdfBookmarkProp & {
  wrap?: boolean
  size?: PdfPageSize
  orientation?: 'portrait' | 'landscape'
  dpi?: number
}

/** Numeric SVG values accepted by the pinned layout parser. */
export type PdfSvgNumber = number | `${number}`
export type PdfSvgLength = PdfSvgNumber | `${number}%`
export type PdfSvgTransformOperation
  = | `translate(${number})`
    | `translate(${number},${number})`
    | `translate(${number}, ${number})`
    | `translate(${number} ${number})`
    | `rotate(${number})`
export type PdfSvgTransform
  = | PdfSvgTransformOperation
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`

export type PdfViewProps = PdfBaseProps & PdfBookmarkProp & {
  wrap?: boolean
}

type PdfFlowTextProps = PdfBaseProps & PdfBookmarkProp & {
  wrap?: boolean
  widows?: number
  orphans?: number
  render?: PdfDynamicTextRender
  hyphenationCallback?: (word: string) => string[]
}

type PdfSvgTextProps = {
  /** SVG text positioning is explicit and required inside a `PdfSvg`. */
  x: PdfSvgLength
  y: PdfSvgLength
  fill?: string
  style?: PdfStyleValue
  hyphenationCallback?: (word: string) => string[]
}

export type PdfTextProps = PdfFlowTextProps | PdfSvgTextProps

export type PdfImageSource
  = | string
    | Uint8Array
    | ArrayBuffer
    | { data: Uint8Array, format: 'png' | 'jpg' }
    | { uri: string, format?: 'png' | 'jpg' }

type PdfImageSourceProp
  = | { src: PdfImageSource, source?: never }
    | { src?: never, source: PdfImageSource }

export type PdfImageProps = PdfBaseProps & PdfBookmarkProp & PdfImageSourceProp

type PdfLinkTarget
  = | { href: string, src?: never }
    | { href?: never, src: string }

export type PdfLinkProps = PdfBaseProps & PdfLinkTarget & {
  wrap?: boolean
  hitSlop?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
}

export type PdfNoteProps = PdfBaseProps

const KEBAB_SEGMENT = /-([a-z])/g

// data-*/aria-* stay kebab so patchPdfProp keeps rejecting them as DOM-only.
const normalizePropName = (key: string): string =>
  key.startsWith('data-') || key.startsWith('aria-')
    ? key
    : key.replace(KEBAB_SEGMENT, (_, letter: string) => letter.toUpperCase())

/**
 * Fixture-proven subset of the engine's SVG presentation attributes. On SVG
 * nodes these are camelCase props. `transform` is a prop here (unlike
 * `PdfView`, where it is a style key).
 */
export type PdfSvgPresentationProps = {
  fill?: string
  stroke?: string
  transform?: PdfSvgTransform
  strokeWidth?: PdfSvgNumber
  fillOpacity?: PdfSvgLength
  strokeOpacity?: PdfSvgLength
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  clipPath?: string
}

export type PdfSvgProps = {
  width?: PdfSvgLength
  height?: PdfSvgLength
  viewBox?: string
  /** Page-flow sizing and positioning for the SVG root. */
  style?: PdfStyleValue
}

export type PdfGProps = PdfSvgPresentationProps

export type PdfPathProps = PdfSvgPresentationProps & {
  d: string
}

export type PdfRectProps = PdfSvgPresentationProps & {
  x?: PdfSvgLength
  y?: PdfSvgLength
  width: PdfSvgLength
  height: PdfSvgLength
  rx?: PdfSvgLength
  ry?: PdfSvgLength
}

export type PdfCircleProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r: PdfSvgLength
}

export type PdfEllipseProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  rx: PdfSvgLength
  ry: PdfSvgLength
}

export type PdfLineProps = PdfSvgPresentationProps & {
  x1: PdfSvgLength
  y1: PdfSvgLength
  x2: PdfSvgLength
  y2: PdfSvgLength
}

export type PdfPolylineProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfPolygonProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfDefsProps = Record<never, never>

export type PdfClipPathProps = {
  id: string
}

type PdfGradientProps = {
  id: string
}

export type PdfLinearGradientProps = PdfGradientProps & {
  x1?: PdfSvgLength
  y1?: PdfSvgLength
  x2?: PdfSvgLength
  y2?: PdfSvgLength
}

export type PdfRadialGradientProps = PdfGradientProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r?: PdfSvgLength
  fx?: PdfSvgLength
  fy?: PdfSvgLength
}

export type PdfStopProps = {
  offset: PdfSvgLength
  stopColor: string
  stopOpacity?: PdfSvgLength
}

export type PdfTspanProps = {
  x?: PdfSvgLength
  y?: PdfSvgLength
  fill?: string
}

/**
 * Compact props for PDF and SVG primitives, coercing kebab-case attribute
 * names (`stroke-width`, `stop-color`, `min-presence-ahead`) to the exact
 * camelCase keys the engine reads. Without this, static kebab attributes from
 * Vue templates would silently no-op. Pure input coercion, not a second
 * source of truth. `data-`/`aria-` names stay kebab so `patchPdfProp` keeps
 * rejecting them as DOM-only.
 */
export const compactProps = (props: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue

    result[normalizePropName(key)] = value
  }

  return result
}
