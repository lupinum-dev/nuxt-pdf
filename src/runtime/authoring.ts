import type { PdfFontStyle, PdfFontWeight, PdfFontWeightName } from './fonts'

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

/**
 * How a `PdfStyle` value is written. The `<style>` block compiler reads these
 * rules at build time; the runtime only reads the key set.
 */
export type PdfStyleValueKind
  = | 'color'
    | 'fontFamily'
    | 'fontWeight'
    | 'length'
    | 'lengthOrPercentage'
    | 'lengthOrPercentageOrAuto'
    | 'lineHeight'
    | 'number'
    | 'transform'

export type PdfStyleValueRule = PdfStyleValueKind | { readonly keywords: readonly string[] }

/** A keyword list that must name every member of `Union` and nothing else. */
const keywords = <Union extends string>() =>
  <const Words extends readonly Union[]>(
    words: Words & (
      Exclude<Union, Words[number]> extends never
        ? unknown
        : { readonly __missingKeywords: Exclude<Union, Words[number]> }
    ),
  ) => ({ keywords: words })

const borderStyle = keywords<PdfBorderStyle>()(['solid', 'dashed', 'dotted'])

/** One rule per `PdfStyle` key; a missing or extra key fails to compile. */
export const PDF_STYLE_VALUES = {
  width: 'lengthOrPercentage',
  height: 'lengthOrPercentage',
  minWidth: 'lengthOrPercentage',
  minHeight: 'lengthOrPercentage',
  maxWidth: 'lengthOrPercentage',
  maxHeight: 'lengthOrPercentage',

  flex: 'number',
  flexBasis: 'lengthOrPercentageOrAuto',
  flexDirection: keywords<PdfFlexDirection>()(['row', 'row-reverse', 'column', 'column-reverse']),
  flexGrow: 'number',
  flexShrink: 'number',
  flexWrap: keywords<PdfFlexWrap>()(['nowrap', 'wrap', 'wrap-reverse']),
  alignItems: keywords<PdfAlignItems>()(['flex-start', 'flex-end', 'center', 'stretch', 'baseline']),
  justifyContent: keywords<PdfJustifyContent>()([
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
  ]),
  gap: 'length',

  margin: 'lengthOrPercentageOrAuto',
  marginHorizontal: 'lengthOrPercentageOrAuto',
  marginVertical: 'lengthOrPercentageOrAuto',
  marginTop: 'lengthOrPercentageOrAuto',
  marginRight: 'lengthOrPercentageOrAuto',
  marginBottom: 'lengthOrPercentageOrAuto',
  marginLeft: 'lengthOrPercentageOrAuto',
  padding: 'lengthOrPercentage',
  paddingHorizontal: 'lengthOrPercentage',
  paddingVertical: 'lengthOrPercentage',
  paddingTop: 'lengthOrPercentage',
  paddingRight: 'lengthOrPercentage',
  paddingBottom: 'lengthOrPercentage',
  paddingLeft: 'lengthOrPercentage',

  position: keywords<NonNullable<PdfStyle['position']>>()(['absolute', 'relative']),
  top: 'lengthOrPercentage',
  right: 'lengthOrPercentage',
  bottom: 'lengthOrPercentage',
  left: 'lengthOrPercentage',

  backgroundColor: 'color',
  color: 'color',
  opacity: 'number',
  borderWidth: 'length',
  borderColor: 'color',
  borderStyle,
  borderRadius: 'length',
  borderTopWidth: 'length',
  borderTopColor: 'color',
  borderTopStyle: borderStyle,
  borderRightWidth: 'length',
  borderRightColor: 'color',
  borderRightStyle: borderStyle,
  borderBottomWidth: 'length',
  borderBottomColor: 'color',
  borderBottomStyle: borderStyle,
  borderLeftWidth: 'length',
  borderLeftColor: 'color',
  borderLeftStyle: borderStyle,
  borderTopLeftRadius: 'lengthOrPercentage',
  borderTopRightRadius: 'lengthOrPercentage',
  borderBottomRightRadius: 'lengthOrPercentage',
  borderBottomLeftRadius: 'lengthOrPercentage',

  fontFamily: 'fontFamily',
  fontSize: 'length',
  fontStyle: keywords<PdfFontStyle>()(['normal', 'italic', 'oblique']),
  fontWeight: 'fontWeight',
  letterSpacing: 'length',
  lineHeight: 'lineHeight',
  maxLines: 'number',
  textAlign: keywords<PdfTextAlign>()(['left', 'right', 'center', 'justify']),
  textDecoration: keywords<PdfTextDecoration>()([
    'none',
    'underline',
    'line-through',
    'underline line-through',
    'line-through underline',
  ]),
  textDecorationColor: 'color',
  textDecorationStyle: borderStyle,
  textOverflow: keywords<NonNullable<PdfStyle['textOverflow']>>()(['ellipsis']),
  textTransform: keywords<PdfTextTransform>()(['none', 'capitalize', 'lowercase', 'uppercase']),

  objectFit: keywords<PdfObjectFit>()(['contain', 'cover']),
  transform: 'transform',
} as const satisfies { readonly [Key in keyof Required<PdfStyle>]: PdfStyleValueRule }

/**
 * The sign rule of a style key, one per key of `PDF_STYLE_VALUES`:
 * - `nonNegative`: a size, a padding, a border width or radius, a gap, a
 *   flex factor; a negative value is an error.
 * - `unitInterval`: a number from 0 to 1 (`opacity`).
 * - `signed`: may be negative (margins, insets, letter spacing, transforms).
 * - `none`: not a length (keywords, colors, the font family); `fontWeight`
 *   has its own range, 1 to 1000.
 * - `open`: no rule decided yet, so no check: `flex` (grow, shrink and basis
 *   in one value) and `maxLines`.
 * A new style key without an entry fails to compile.
 */
export type PdfStyleSign = 'nonNegative' | 'unitInterval' | 'signed' | 'none' | 'open'

export const PDF_STYLE_SIGNS = {
  width: 'nonNegative',
  height: 'nonNegative',
  minWidth: 'nonNegative',
  minHeight: 'nonNegative',
  maxWidth: 'nonNegative',
  maxHeight: 'nonNegative',

  flex: 'open',
  flexBasis: 'nonNegative',
  flexDirection: 'none',
  flexGrow: 'nonNegative',
  flexShrink: 'nonNegative',
  flexWrap: 'none',
  alignItems: 'none',
  justifyContent: 'none',
  gap: 'nonNegative',

  margin: 'signed',
  marginHorizontal: 'signed',
  marginVertical: 'signed',
  marginTop: 'signed',
  marginRight: 'signed',
  marginBottom: 'signed',
  marginLeft: 'signed',
  padding: 'nonNegative',
  paddingHorizontal: 'nonNegative',
  paddingVertical: 'nonNegative',
  paddingTop: 'nonNegative',
  paddingRight: 'nonNegative',
  paddingBottom: 'nonNegative',
  paddingLeft: 'nonNegative',

  position: 'none',
  top: 'signed',
  right: 'signed',
  bottom: 'signed',
  left: 'signed',

  backgroundColor: 'none',
  color: 'none',
  opacity: 'unitInterval',
  borderWidth: 'nonNegative',
  borderColor: 'none',
  borderStyle: 'none',
  borderRadius: 'nonNegative',
  borderTopWidth: 'nonNegative',
  borderTopColor: 'none',
  borderTopStyle: 'none',
  borderRightWidth: 'nonNegative',
  borderRightColor: 'none',
  borderRightStyle: 'none',
  borderBottomWidth: 'nonNegative',
  borderBottomColor: 'none',
  borderBottomStyle: 'none',
  borderLeftWidth: 'nonNegative',
  borderLeftColor: 'none',
  borderLeftStyle: 'none',
  borderTopLeftRadius: 'nonNegative',
  borderTopRightRadius: 'nonNegative',
  borderBottomRightRadius: 'nonNegative',
  borderBottomLeftRadius: 'nonNegative',

  fontFamily: 'none',
  fontSize: 'nonNegative',
  fontStyle: 'none',
  fontWeight: 'none',
  letterSpacing: 'signed',
  lineHeight: 'nonNegative',
  maxLines: 'open',
  textAlign: 'none',
  textDecoration: 'none',
  textDecorationColor: 'none',
  textDecorationStyle: 'none',
  textOverflow: 'none',
  textTransform: 'none',

  objectFit: 'none',
  transform: 'signed',
} as const satisfies { readonly [Key in keyof typeof PDF_STYLE_VALUES]: PdfStyleSign }

/** Font weight names, bound to `PdfFontWeightName`. */
export const PDF_FONT_WEIGHT_NAMES = keywords<PdfFontWeightName>()([
  'black',
  'bold',
  'demibold',
  'extrabold',
  'extralight',
  'hairline',
  'heavy',
  'light',
  'medium',
  'normal',
  'semibold',
  'thin',
  'ultrabold',
  'ultralight',
]).keywords

/** The value of one style key a style value resolves to: the last entry that sets it wins. */
export const resolvedStyleValue = <Key extends keyof PdfStyle>(style: PdfStyleEntry, key: Key): PdfStyle[Key] | undefined => {
  if (Array.isArray(style)) {
    let resolved: PdfStyle[Key] | undefined
    for (const entry of style as readonly PdfStyleEntry[]) {
      resolved = resolvedStyleValue(entry, key) ?? resolved
    }
    return resolved
  }
  return typeof style === 'object' && style !== null ? (style as PdfStyle)[key] : undefined
}

/** The `position` a style value resolves to: the last entry that sets it wins. */
export const resolvedPosition = (style: PdfStyleEntry): PdfStyle['position'] =>
  resolvedStyleValue(style, 'position')
