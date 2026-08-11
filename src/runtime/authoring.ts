import type { PdfFontStyle, PdfFontWeight } from './fonts'

/** Stable host tags shared by PDF authoring components and the renderer. */
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
