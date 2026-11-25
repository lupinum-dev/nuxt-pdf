import type { PdfFontStyle, PdfFontWeight, PdfFontWeightName } from './fonts'
import type { PDF_LENGTH_UNITS } from './shared/style-values'

/** Units resolved by the PDF stylesheet engine. Unitless numbers are points. */
export type PdfLengthUnit = typeof PDF_LENGTH_UNITS[number]
export type PdfUnitLength = `${number}${PdfLengthUnit}`
export type PdfPercentage = `${number}%`
export type PdfLength = number | PdfUnitLength
export type PdfLengthOrPercentage = PdfLength | PdfPercentage
/**
 * A share of the node's own font size, as CSS `em`: `'1.5em'` in a text of
 * 10 pt is 15 pt. Only the keys in `PDF_EM_STYLE_KEYS` take it.
 */
export type PdfEmLength = `${number}em`

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
/** `alignContent`: the justify keywords and `stretch`. `baseline` is left out: the layout places it as `flex-start`. */
export type PdfAlignContent = PdfJustifyContent | 'stretch'
export type PdfTextAlign = 'left' | 'right' | 'center' | 'justify'
export type PdfTextDecoration
  = | 'none'
    | 'underline'
    | 'line-through'
    | 'underline line-through'
    | 'line-through underline'
export type PdfTextTransform = 'none' | 'capitalize' | 'lowercase' | 'uppercase'
export type PdfObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'

type PdfObjectPositionPart = PdfLengthOrPercentage | 'left' | 'center' | 'right' | 'top' | 'bottom'
/**
 * CSS `object-position` in one or two parts: a length or a percentage is the
 * horizontal place, then the vertical one; keywords may come in either order.
 * The mount check rejects what CSS rejects, such as `'top 10pt'`.
 */
export type PdfObjectPosition = PdfObjectPositionPart | `${PdfObjectPositionPart} ${PdfObjectPositionPart}`

type PdfAngle = `${number}deg` | `${number}rad`

/**
 * The transform operations the engine paints. Translation values are
 * unitless points because the pinned transform parser does not resolve CSS
 * length units inside `translate()`.
 */
export type PdfTransformOperation
  = | `rotate(${PdfAngle})`
    | `scale(${number})`
    | `scale(${number},${number})`
    | `scale(${number}, ${number})`
    | `scale(${number} ${number})`
    | `scaleX(${number})`
    | `scaleY(${number})`
    | `translate(${number},${number})`
    | `translate(${number}, ${number})`
    | `translate(${number} ${number})`
    | `translateX(${number})`
    | `translateY(${number})`
    | `skew(${PdfAngle})`
    | `skew(${PdfAngle},${PdfAngle})`
    | `skew(${PdfAngle}, ${PdfAngle})`
    | `skew(${PdfAngle} ${PdfAngle})`
    | `skewX(${PdfAngle})`
    | `skewY(${PdfAngle})`

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
  width?: PdfLengthOrPercentage | PdfEmLength
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
  /** Aligns this node on its parent's cross axis; `'auto'` (the default) takes the parent's `alignItems`. */
  alignSelf?: PdfAlignItems | 'auto'
  justifyContent?: PdfJustifyContent
  /** Places the lines of a wrapping row (or column) in the container's cross axis. */
  alignContent?: PdfAlignContent
  /** One length sets both gaps; two are the row gap, then the column gap. */
  gap?: PdfLength | PdfEmLength | `${PdfLength | PdfEmLength} ${PdfLength | PdfEmLength}`
  /** The space between rows of children: between children of a column, or between the lines of a wrapping row. */
  rowGap?: PdfLength | PdfEmLength

  // Columns
  columnCount?: number
  columnWidth?: PdfLength
  /** `'normal'` is 1em of the container's font size, as in CSS. */
  columnGap?: PdfLength | PdfEmLength | 'normal'
  columnFill?: 'auto' | 'balance'
  columnSpan?: 'none' | 'all'
  /**
   * `'top'` or `'bottom'` takes the node out of the flow and places it at the
   * top or the bottom of its column, or of the page content area without
   * columns (a page float, as in LaTeX). Not inherited.
   */
  float?: 'none' | 'top' | 'bottom'
  /**
   * `columnCount`, `columnWidth` or both, in either order, such as `2`,
   * `'120pt'` or `'2 120pt'`. A number is the count; a width has a unit.
   */
  columns?: number | PdfUnitLength | `${number} ${PdfUnitLength}` | `${PdfUnitLength} ${number}`
  /** The width of the rule in the middle of each gap between two filled columns. Without it there is no rule. */
  columnRuleWidth?: PdfLength
  /** The rule's style, as for borders: `'solid'` (the default), `'dashed'` or `'dotted'`. */
  columnRuleStyle?: PdfBorderStyle
  /** The rule's color; black by default. */
  columnRuleColor?: string

  // Box model
  margin?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginHorizontal?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginVertical?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginTop?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginRight?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginBottom?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  marginLeft?: PdfLengthOrPercentage | PdfEmLength | 'auto'
  padding?: PdfLengthOrPercentage | PdfEmLength
  paddingHorizontal?: PdfLengthOrPercentage | PdfEmLength
  paddingVertical?: PdfLengthOrPercentage | PdfEmLength
  paddingTop?: PdfLengthOrPercentage | PdfEmLength
  paddingRight?: PdfLengthOrPercentage | PdfEmLength
  paddingBottom?: PdfLengthOrPercentage | PdfEmLength
  paddingLeft?: PdfLengthOrPercentage | PdfEmLength

  // Positioning
  /** `'static'` keeps the node in the flow and ignores `top`, `right`, `bottom` and `left`. */
  position?: 'absolute' | 'relative' | 'static'
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
  /** A length, or a percentage of the inherited font size, as in CSS. */
  fontSize?: PdfLengthOrPercentage
  fontStyle?: PdfFontStyle
  fontWeight?: PdfFontWeight
  /**
   * `'tabular-nums'` gives every digit the same advance, so numbers line up in
   * columns (the font's `tnum` feature). A font without it keeps its digits.
   * `'normal'` is the default. Inherited, as in CSS.
   */
  fontVariantNumeric?: 'normal' | 'tabular-nums'
  /**
   * `'auto'` splits a long word at the end of a line by the hyphenation
   * patterns of the document `language`. `'manual'` (the default) splits a
   * word only at its soft hyphens (`&shy;`). Inherited, as in CSS.
   */
  hyphens?: 'auto' | 'manual'
  letterSpacing?: PdfLength
  lineHeight?: number | PdfUnitLength | PdfPercentage
  maxLines?: number
  textAlign?: PdfTextAlign
  textDecoration?: PdfTextDecoration
  textDecorationColor?: string
  textDecorationStyle?: PdfBorderStyle
  textOverflow?: 'ellipsis'
  textTransform?: PdfTextTransform
  /**
   * `'pretty'` breaks a paragraph's lines with more care: it avoids a very
   * short last line, a hyphen on the line before the last, and hyphens on two
   * lines in a row, at the cost of slightly looser lines. `'wrap'` is the
   * default. Inherited, as in CSS.
   */
  textWrap?: 'wrap' | 'pretty'
  /**
   * Raises (`super`) or lowers (`sub`) a `<PdfText>` nested in another
   * `<PdfText>` by a third or a fifth of its parent's font size. It does not
   * change the font size.
   */
  verticalAlign?: 'baseline' | 'super' | 'sub'

  // Images and transforms
  objectFit?: PdfObjectFit
  objectPosition?: PdfObjectPosition
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
    | 'columns'
    | 'fontFamily'
    | 'fontWeight'
    | 'length'
    | 'lengthOrPercentage'
    | 'lengthOrPercentageOrAuto'
    | 'lengthOrNormal'
    | 'lineHeight'
    | 'number'
    | 'objectPosition'
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

/**
 * The keys that take a `PdfEmLength` besides their rule: the spacing in and
 * around a box, and `width`. Not heights (break heights and the column checks
 * read them), insets, border widths (hairlines do not grow with the text), or
 * `fontSize` and `lineHeight` (a percentage and a unitless factor do it). The
 * engine resolves `em` to points with the node's computed font size
 * (layout/styles/inheritance.ts), on these keys as the style expansion
 * writes them, shorthands split into their sides.
 */
export const PDF_EM_LONGHAND_KEYS = [
  'width',
  'rowGap',
  'columnGap',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const satisfies ReadonlyArray<keyof PdfStyle>

/** `PDF_EM_LONGHAND_KEYS` and the shorthands that expand to them. */
export const PDF_EM_STYLE_KEYS: ReadonlySet<keyof PdfStyle> = new Set<keyof PdfStyle>([
  ...PDF_EM_LONGHAND_KEYS,
  'gap',
  'margin',
  'marginHorizontal',
  'marginVertical',
  'padding',
  'paddingHorizontal',
  'paddingVertical',
])

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
  alignSelf: keywords<NonNullable<PdfStyle['alignSelf']>>()(['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline']),
  justifyContent: keywords<PdfJustifyContent>()([
    'flex-start',
    'flex-end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
  ]),
  alignContent: keywords<PdfAlignContent>()([
    'flex-start',
    'flex-end',
    'center',
    'stretch',
    'space-between',
    'space-around',
    'space-evenly',
  ]),
  gap: 'length',
  rowGap: 'length',

  columnCount: 'number',
  columnWidth: 'length',
  columnGap: 'lengthOrNormal',
  columnFill: keywords<NonNullable<PdfStyle['columnFill']>>()(['auto', 'balance']),
  columnSpan: keywords<NonNullable<PdfStyle['columnSpan']>>()(['none', 'all']),
  float: keywords<NonNullable<PdfStyle['float']>>()(['none', 'top', 'bottom']),
  columns: 'columns',
  columnRuleWidth: 'length',
  columnRuleStyle: borderStyle,
  columnRuleColor: 'color',

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

  position: keywords<NonNullable<PdfStyle['position']>>()(['absolute', 'relative', 'static']),
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
  fontSize: 'lengthOrPercentage',
  fontStyle: keywords<PdfFontStyle>()(['normal', 'italic', 'oblique']),
  fontWeight: 'fontWeight',
  fontVariantNumeric: keywords<NonNullable<PdfStyle['fontVariantNumeric']>>()(['normal', 'tabular-nums']),
  hyphens: keywords<NonNullable<PdfStyle['hyphens']>>()(['auto', 'manual']),
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
  textWrap: keywords<NonNullable<PdfStyle['textWrap']>>()(['wrap', 'pretty']),
  verticalAlign: keywords<NonNullable<PdfStyle['verticalAlign']>>()(['baseline', 'super', 'sub']),

  objectFit: keywords<PdfObjectFit>()(['contain', 'cover', 'fill', 'none', 'scale-down']),
  objectPosition: 'objectPosition',
  transform: 'transform',
} as const satisfies { readonly [Key in keyof Required<PdfStyle>]: PdfStyleValueRule }

/**
 * The sign rule of a style key, one per key of `PDF_STYLE_VALUES`:
 * - `nonNegative`: a size, a padding, a border width or radius, a gap, a
 *   flex factor; a negative value is an error.
 * - `positive`: above 0 (`fontSize`, `lineHeight`): the text layout reads
 *   0 as unset, so it would print 12 pt or the normal line height.
 * - `unitInterval`: a number from 0 to 1 (`opacity`).
 * - `signed`: may be negative (margins, insets, letter spacing, transforms).
 * - `positiveWhole`: a whole number of 1 or more (`maxLines`: 0 or less
 *   drops every line).
 * - `none`: not a length (keywords, colors, the font family); `fontWeight`
 *   has its own range, 1 to 1000.
 * `flex` is `nonNegative`: each number of grow, shrink and basis counts, and
 * the engine ignores a negative one (measured); `auto`, `none` and `initial`
 * have no number.
 * A new style key without an entry fails to compile.
 */
export type PdfStyleSign = 'nonNegative' | 'positive' | 'unitInterval' | 'signed' | 'positiveWhole' | 'none'

export const PDF_STYLE_SIGNS = {
  width: 'nonNegative',
  height: 'nonNegative',
  minWidth: 'nonNegative',
  minHeight: 'nonNegative',
  maxWidth: 'nonNegative',
  maxHeight: 'nonNegative',

  flex: 'nonNegative',
  flexBasis: 'nonNegative',
  flexDirection: 'none',
  flexGrow: 'nonNegative',
  flexShrink: 'nonNegative',
  flexWrap: 'none',
  alignItems: 'none',
  alignSelf: 'none',
  justifyContent: 'none',
  alignContent: 'none',
  gap: 'nonNegative',
  rowGap: 'nonNegative',

  columnCount: 'positiveWhole',
  columnWidth: 'nonNegative',
  columnGap: 'nonNegative',
  columnFill: 'none',
  columnSpan: 'none',
  float: 'none',
  columns: 'nonNegative',
  columnRuleWidth: 'nonNegative',
  columnRuleStyle: 'none',
  columnRuleColor: 'none',

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
  fontSize: 'positive',
  fontStyle: 'none',
  fontWeight: 'none',
  fontVariantNumeric: 'none',
  hyphens: 'none',
  letterSpacing: 'signed',
  lineHeight: 'positive',
  maxLines: 'positiveWhole',
  textAlign: 'none',
  textDecoration: 'none',
  textDecorationColor: 'none',
  textDecorationStyle: 'none',
  textOverflow: 'none',
  textTransform: 'none',
  textWrap: 'none',
  verticalAlign: 'none',

  objectFit: 'none',
  objectPosition: 'signed',
  transform: 'signed',
} as const satisfies { readonly [Key in keyof typeof PDF_STYLE_VALUES]: PdfStyleSign }

/**
 * Font weight names and their numbers: the one table for admission, the style
 * step and the font store. `satisfies` binds the names to `PdfFontWeightName`.
 */
export const PDF_FONT_WEIGHTS: ReadonlyMap<string, number> = new Map(Object.entries({
  thin: 100,
  hairline: 100,
  ultralight: 200,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  ultrabold: 800,
  extrabold: 800,
  heavy: 900,
  black: 900,
} satisfies Record<PdfFontWeightName, number>))

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
