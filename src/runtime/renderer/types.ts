import type { PdfFontStyle, PdfFontWeight } from '../fonts'

export const PDF_PRIMITIVES = {
  Document: 'DOCUMENT',
  Page: 'PAGE',
  View: 'VIEW',
  Text: 'TEXT',
  Image: 'IMAGE',
  Link: 'LINK',
  Note: 'NOTE',
  Tspan: 'TSPAN',
  Svg: 'SVG',
  G: 'G',
  Path: 'PATH',
  Rect: 'RECT',
  Circle: 'CIRCLE',
  Ellipse: 'ELLIPSE',
  Line: 'LINE',
  Polyline: 'POLYLINE',
  Polygon: 'POLYGON',
  Defs: 'DEFS',
  ClipPath: 'CLIP_PATH',
  LinearGradient: 'LINEAR_GRADIENT',
  RadialGradient: 'RADIAL_GRADIENT',
  Stop: 'STOP',
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
  [PDF_PRIMITIVES.Tspan]: 'PdfTspan',
  [PDF_PRIMITIVES.Svg]: 'PdfSvg',
  [PDF_PRIMITIVES.G]: 'PdfG',
  [PDF_PRIMITIVES.Path]: 'PdfPath',
  [PDF_PRIMITIVES.Rect]: 'PdfRect',
  [PDF_PRIMITIVES.Circle]: 'PdfCircle',
  [PDF_PRIMITIVES.Ellipse]: 'PdfEllipse',
  [PDF_PRIMITIVES.Line]: 'PdfLine',
  [PDF_PRIMITIVES.Polyline]: 'PdfPolyline',
  [PDF_PRIMITIVES.Polygon]: 'PdfPolygon',
  [PDF_PRIMITIVES.Defs]: 'PdfDefs',
  [PDF_PRIMITIVES.ClipPath]: 'PdfClipPath',
  [PDF_PRIMITIVES.LinearGradient]: 'PdfLinearGradient',
  [PDF_PRIMITIVES.RadialGradient]: 'PdfRadialGradient',
  [PDF_PRIMITIVES.Stop]: 'PdfStop',
}

/** Units resolved by the PDF stylesheet engine. Unitless numbers are points. */
export type PdfLengthUnit = 'pt' | 'px' | 'in' | 'mm' | 'cm' | 'rem' | 'vh' | 'vw'
export type PdfUnitLength = `${number}${PdfLengthUnit}`
export type PdfPercentage = `${number}%`
export type PdfLength = number | PdfUnitLength
export type PdfLengthOrPercentage = PdfLength | PdfPercentage

export type PdfBorderStyle = 'solid' | 'dashed' | 'dotted'
export type PdfFlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse'
export type PdfFlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse'
export type PdfAlignItems = 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'
export type PdfJustifyContent
  = | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
export type PdfTextAlign = 'left' | 'right' | 'center' | 'justify'
export type PdfTextDecoration
  = | 'none'
    | 'underline'
    | 'line-through'
    | 'underline line-through'
    | 'line-through underline'
export type PdfTextTransform = 'none' | 'capitalize' | 'lowercase' | 'uppercase'
export type PdfObjectFit = 'contain' | 'cover'

/**
 * Transform operations covered by the conformance corpus. Translation values
 * are unitless points because the pinned transform parser does not resolve CSS
 * length units inside `translate()`.
 */
export type PdfTransformOperation
  = | `rotate(${number}deg)`
    | `rotate(${number}rad)`
    | `scale(${number})`
    | `scale(${number},${number})`
    | `scale(${number}, ${number})`
    | `scale(${number} ${number})`
    | `translate(${number},${number})`
    | `translate(${number}, ${number})`
    | `translate(${number} ${number})`

/** One to three left-to-right transform operations. */
export type PdfTransform
  = | PdfTransformOperation
    | `${PdfTransformOperation} ${PdfTransformOperation}`
    | `${PdfTransformOperation} ${PdfTransformOperation} ${PdfTransformOperation}`

/**
 * Framework-owned style surface for PDF primitives.
 *
 * This deliberately describes the tested Nuxt PDF contract instead of
 * re-exporting the wider, version-dependent upstream stylesheet types.
 */
export interface PdfStyle {
  // Dimensions
  width?: PdfLengthOrPercentage
  height?: PdfLengthOrPercentage
  minWidth?: PdfLengthOrPercentage
  minHeight?: PdfLengthOrPercentage
  maxWidth?: PdfLengthOrPercentage
  maxHeight?: PdfLengthOrPercentage

  // Flex layout
  flex?: number
  flexBasis?: PdfLengthOrPercentage | 'auto'
  flexDirection?: PdfFlexDirection
  flexGrow?: number
  flexShrink?: number
  flexWrap?: PdfFlexWrap
  alignItems?: PdfAlignItems
  justifyContent?: PdfJustifyContent
  gap?: PdfLength

  // Box model
  margin?: PdfLengthOrPercentage | 'auto'
  marginHorizontal?: PdfLengthOrPercentage | 'auto'
  marginVertical?: PdfLengthOrPercentage | 'auto'
  marginTop?: PdfLengthOrPercentage | 'auto'
  marginRight?: PdfLengthOrPercentage | 'auto'
  marginBottom?: PdfLengthOrPercentage | 'auto'
  marginLeft?: PdfLengthOrPercentage | 'auto'
  padding?: PdfLengthOrPercentage
  paddingHorizontal?: PdfLengthOrPercentage
  paddingVertical?: PdfLengthOrPercentage
  paddingTop?: PdfLengthOrPercentage
  paddingRight?: PdfLengthOrPercentage
  paddingBottom?: PdfLengthOrPercentage
  paddingLeft?: PdfLengthOrPercentage

  // Positioning
  position?: 'absolute' | 'relative'
  top?: PdfLengthOrPercentage
  right?: PdfLengthOrPercentage
  bottom?: PdfLengthOrPercentage
  left?: PdfLengthOrPercentage

  // Borders and paint
  backgroundColor?: string
  color?: string
  opacity?: number
  borderWidth?: PdfLength
  borderColor?: string
  borderStyle?: PdfBorderStyle
  borderRadius?: PdfLength
  borderTopWidth?: PdfLength
  borderTopColor?: string
  borderTopStyle?: PdfBorderStyle
  borderRightWidth?: PdfLength
  borderRightColor?: string
  borderRightStyle?: PdfBorderStyle
  borderBottomWidth?: PdfLength
  borderBottomColor?: string
  borderBottomStyle?: PdfBorderStyle
  borderLeftWidth?: PdfLength
  borderLeftColor?: string
  borderLeftStyle?: PdfBorderStyle
  borderTopLeftRadius?: PdfLengthOrPercentage
  borderTopRightRadius?: PdfLengthOrPercentage
  borderBottomRightRadius?: PdfLengthOrPercentage
  borderBottomLeftRadius?: PdfLengthOrPercentage

  // Text
  fontFamily?: string
  fontSize?: PdfLength
  fontStyle?: PdfFontStyle
  fontWeight?: PdfFontWeight
  letterSpacing?: PdfLength
  lineHeight?: number | PdfUnitLength | PdfPercentage
  maxLines?: number
  textAlign?: PdfTextAlign
  textDecoration?: PdfTextDecoration
  textDecorationColor?: string
  textDecorationStyle?: PdfBorderStyle
  textOverflow?: 'ellipsis'
  textTransform?: PdfTextTransform

  // Images and transforms
  objectFit?: PdfObjectFit
  transform?: PdfTransform
}

/** One recursively nestable entry inside a style array. */
export type PdfStyleEntry
  = | PdfStyle
    | readonly PdfStyleEntry[]
    | false
    | null
    | undefined

/** A style object or a recursively nested, left-to-right style array. */
export type PdfStyleValue = PdfStyle | readonly PdfStyleEntry[]

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
  PDF_PRIMITIVES.Svg,
  PDF_PRIMITIVES.G,
  PDF_PRIMITIVES.Path,
  PDF_PRIMITIVES.Rect,
  PDF_PRIMITIVES.Circle,
  PDF_PRIMITIVES.Ellipse,
  PDF_PRIMITIVES.Line,
  PDF_PRIMITIVES.Polyline,
  PDF_PRIMITIVES.Polygon,
  PDF_PRIMITIVES.Defs,
  PDF_PRIMITIVES.ClipPath,
  PDF_PRIMITIVES.LinearGradient,
  PDF_PRIMITIVES.RadialGradient,
  PDF_PRIMITIVES.Stop,
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
