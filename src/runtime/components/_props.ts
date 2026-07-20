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
  /** SVG text positioning when nested inside a `PdfSvg`. */
  x?: number
  y?: number
}

export type PdfImageSource
  = | string
    | Uint8Array
    | ArrayBuffer
    | { data: Uint8Array, format: 'png' | 'jpg' }
    | { uri: string, format?: 'png' | 'jpg' }

export type PdfImageProps = PdfBaseProps & {
  src?: PdfImageSource
  source?: PdfImageSource
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

type SvgLength = string | number

/**
 * SVG presentation attributes, mirroring the engine's
 * `SVGPresentationAttributes`. On SVG nodes these are camelCase *props* that
 * override `style`; `transform` is a prop here (unlike `PdfView`, where it is a
 * style key).
 */
export type PdfSvgPresentationProps = {
  fill?: string
  color?: string
  stroke?: string
  transform?: string
  strokeDasharray?: string
  opacity?: SvgLength
  strokeWidth?: SvgLength
  fillOpacity?: SvgLength
  fillRule?: 'nonzero' | 'evenodd'
  strokeOpacity?: SvgLength
  textAnchor?: 'start' | 'middle' | 'end'
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'butt' | 'round' | 'square' | 'miter' | 'bevel'
  visibility?: 'visible' | 'hidden' | 'collapse'
  clipPath?: string
  dominantBaseline?:
    | 'auto'
    | 'middle'
    | 'central'
    | 'hanging'
    | 'mathematical'
    | 'text-after-edge'
    | 'text-before-edge'
  style?: PdfStyleValue
}

export type PdfSvgProps = PdfSvgPresentationProps & {
  width?: SvgLength
  height?: SvgLength
  viewBox?: string
  preserveAspectRatio?: string
}

export type PdfGProps = PdfSvgPresentationProps

export type PdfPathProps = PdfSvgPresentationProps & {
  d: string
}

export type PdfRectProps = PdfSvgPresentationProps & {
  x?: SvgLength
  y?: SvgLength
  width: SvgLength
  height: SvgLength
  rx?: SvgLength
  ry?: SvgLength
}

export type PdfCircleProps = PdfSvgPresentationProps & {
  cx?: SvgLength
  cy?: SvgLength
  r: SvgLength
}

export type PdfEllipseProps = PdfSvgPresentationProps & {
  cx?: SvgLength
  cy?: SvgLength
  rx: SvgLength
  ry: SvgLength
}

export type PdfLineProps = PdfSvgPresentationProps & {
  x1: SvgLength
  y1: SvgLength
  x2: SvgLength
  y2: SvgLength
}

export type PdfPolylineProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfPolygonProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfDefsProps = Record<never, never>

export type PdfClipPathProps = {
  id?: string
}

type PdfGradientProps = {
  id: string
  xlinkHref?: string
  gradientTransform?: string
  gradientUnits?: 'userSpaceOnUse' | 'objectBoundingBox'
}

export type PdfLinearGradientProps = PdfGradientProps & {
  x1?: SvgLength
  y1?: SvgLength
  x2?: SvgLength
  y2?: SvgLength
}

export type PdfRadialGradientProps = PdfGradientProps & {
  cx?: SvgLength
  cy?: SvgLength
  r?: SvgLength
  fx?: SvgLength
  fy?: SvgLength
  fr?: SvgLength
}

export type PdfStopProps = {
  offset: SvgLength
  stopColor: string
  stopOpacity?: SvgLength
}

export type PdfTspanProps = PdfSvgPresentationProps & {
  x?: SvgLength
  y?: SvgLength
}

const KEBAB_SEGMENT = /-([a-z])/g

// data-*/aria-* stay kebab so patchPdfProp keeps rejecting them as DOM-only.
const isDomOnlyAttribute = (key: string): boolean =>
  key.startsWith('data-') || key.startsWith('aria-')

/**
 * Compact SVG props, coercing kebab-case attribute names (`stroke-width`,
 * `stop-color`) to the exact camelCase keys the engine's `resolveSvg` reads.
 * Without this, static kebab attributes from Vue templates would silently
 * no-op. Pure input coercion, not a second source of truth.
 */
export const compactSvgProps = (props: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue

    const name = isDomOnlyAttribute(key)
      ? key
      : key.replace(KEBAB_SEGMENT, (_, letter: string) => letter.toUpperCase())

    result[name] = value
  }

  return result
}
