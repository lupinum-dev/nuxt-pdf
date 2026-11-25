import { PDF_FONT_WEIGHTS } from '../../../../authoring'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../../../shared/errors'
import { pdfColumnsParts, pdfObjectPositionParts } from '../../../../shared/style-values'
import type { Transform } from '../types'
import { percentOf } from './percent'
import { toPoints, type StyleContainer } from './units'

type Style = Readonly<Record<string, unknown>>
type Expand = (value: unknown, key: string, container: StyleContainer, style: Style) => Record<string, unknown>

const numberOf = (value: unknown): unknown => typeof value === 'string' ? Number.parseFloat(value) : value

const asNumber: Expand = (value, key) => ({ [key]: numberOf(value) })
const asPoints: Expand = (value, key, container) => ({ [key]: toPoints(container, value) })

/** The sides a value of 1 to 4 parts gives, as CSS: top, right, bottom, left. */
const sidesOf = (parts: readonly unknown[]): [unknown, unknown, unknown, unknown] =>
  [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]]

/** Parts split at CSS whitespace, each in points. */
const partsOf = (container: StyleContainer, value: unknown): unknown[] =>
  String(value).trim().split(/[ \t\n\r\f]+/).map(part => toPoints(container, part))

/** `margin` and `padding` with 1 to 4 parts (admission: shared/style-values.ts, `boxValue`). */
const boxSides = (prefix: string): Expand => (value, _key, container) => {
  const [top, right, bottom, left] = sidesOf(partsOf(container, value))
  return { [`${prefix}Top`]: top, [`${prefix}Right`]: right, [`${prefix}Bottom`]: bottom, [`${prefix}Left`]: left }
}

/** One side: the value read like a part of the shorthand, so a number becomes the number its text gives. */
const boxSide: Expand = (value, key, container) => ({ [key]: partsOf(container, value)[0] })

/** `…Vertical` and `…Horizontal` with 1 or 2 parts. */
const boxPair = (first: string, second: string): Expand => (value, _key, container) => {
  const parts = partsOf(container, value)
  return { [first]: parts[0], [second]: parts[1] ?? parts[0] }
}

/** `borderWidth`, `borderColor`, `borderStyle`, `borderRadius`: one value for every side or corner. */
const everyBorder = (keys: readonly string[], read: (value: unknown, container: StyleContainer) => unknown): Expand =>
  (value, _key, container) => {
    const resolved = read(value, container)
    return Object.fromEntries(keys.map(key => [key, resolved]))
  }
const sides = (suffix: string) => ['Top', 'Right', 'Bottom', 'Left'].map(side => `border${side}${suffix}`)

const FLEX_KEYWORDS: Readonly<Record<string, readonly [number, number, string]>> = {
  auto: [1, 1, 'auto'],
  none: [0, 0, 'auto'],
  initial: [0, 1, 'auto'],
}

/**
 * `flex`: a keyword, or grow, shrink and basis split at single spaces; a
 * missing part is 1, 1 and 0 (not CSS's defaults).
 */
const flex: Expand = (value, _key, container) => {
  const keyword = typeof value === 'string' ? FLEX_KEYWORDS[value] : undefined
  const [grow = 1, shrink = 1, basis = 0] = keyword ?? String(value).split(' ')
  return { flexGrow: numberOf(grow), flexShrink: numberOf(shrink), flexBasis: toPoints(container, basis) }
}

/** `gap`: a row gap and a column gap split at a single space; one part sets both. */
const gap: Expand = (value, _key, container) => {
  const [row, column = row] = String(value).split(' ')
  return { rowGap: toPoints(container, row), columnGap: toPoints(container, column) }
}

/**
 * `columnGap: 'normal'` is unset: a column container then takes 1em
 * (styles/resolve-styles.ts), and yoga's flex gap stays 0, CSS's `normal`
 * for flex.
 */
const columnGap: Expand = (value, key, container) => (value === 'normal' ? { [key]: undefined } : { [key]: toPoints(container, value) })

/**
 * `columns`: a column count, a column width or both (admission:
 * shared/style-values.ts, `pdfColumnsParts`). The one not given is unset, as
 * CSS resets it.
 */
const columns: Expand = (value, _key, container) => {
  const { count, width } = pdfColumnsParts(String(value)) ?? {}
  return { columnCount: count, columnWidth: width === undefined ? undefined : toPoints(container, width) }
}

/**
 * `objectPosition` to the two keys the image painter reads
 * (paint/image.ts): a length in points is an offset, a percentage a share of
 * the free space; a keyword arrives as its percentage. A number is the
 * horizontal offset, centred vertically, as one CSS length is.
 */
const objectPosition: Expand = (value, _key, container) => {
  const parts = typeof value === 'number' ? { x: value, y: '50%' } : pdfObjectPositionParts(String(value))
  if (parts === undefined) return {}
  return { objectPositionX: toPoints(container, parts.x), objectPositionY: toPoints(container, parts.y) }
}

/** A weight name in any case to its number; a number string to its whole part. */
const fontWeight: Expand = (value, key) => {
  if (typeof value === 'number') return { [key]: value }
  const name = String(value).toLowerCase()
  return { [key]: PDF_FONT_WEIGHTS.get(name) ?? Number.parseInt(name, 10) }
}

/**
 * `lineHeight`: a unitless number stays a factor, which each text multiplies
 * by its own font size (text/fragments.ts), so children inherit the factor
 * as in CSS. A percentage stays as written: inheritance makes it points of
 * the element's computed font size (styles/inheritance.ts). A length is
 * points.
 */
const lineHeight: Expand = (value, key, container) => {
  if (percentOf(value) !== undefined) return { [key]: value }
  return { [key]: Number.isNaN(Number(value)) ? toPoints(container, value) : { factor: Number(value) } }
}

/** An angle in degrees; `rad` converted. */
const ANGLE = /(-?\d*\.?\d*)(\w*)/
const angleOf = (value: string): number => {
  // Every part of the pattern may be empty, so it always matches.
  const match = ANGLE.exec(value)!
  const angle = Number.parseFloat(match[1]!)
  return match[2] === 'rad' ? (angle * 180) / Math.PI : angle
}

/**
 * One transform operation in the painter's form: scale, rotate, translate or
 * skew with their full arguments; `translate` with one argument keeps an
 * undefined second one. `lengthOf` reads a translation. Splitting gives at
 * least one argument. Admission
 * lets through these names only, `rotate` with one angle
 * (shared/style-values.ts, `engineTransform`; renderer/validate-props.ts,
 * `SVG_TRANSFORM`).
 */
const operationOf = (operation: string, args: string[], lengthOf: (arg: string) => number): Transform => {
  const numbers = args.map(arg => Number.parseFloat(arg))
  const lengths = args.map(lengthOf)
  switch (operation) {
    case 'scale': return { operation: 'scale', value: [numbers[0]!, numbers[1] ?? numbers[0]!] }
    case 'scaleX': return { operation: 'scale', value: [numbers[0]!, 1] }
    case 'scaleY': return { operation: 'scale', value: [1, numbers[0]!] }
    case 'rotate': return { operation: 'rotate', value: [angleOf(args[0]!), 0, 0] }
    case 'translate': return { operation: 'translate', value: [lengths[0]!, lengths[1]] }
    case 'translateX': return { operation: 'translate', value: [lengths[0]!, 0] }
    case 'translateY': return { operation: 'translate', value: [0, lengths[0]!] }
    case 'skew': return { operation: 'skew', value: args.map(angleOf) }
    case 'skewX': return { operation: 'skew', value: [angleOf(args[0]!), 0] }
    case 'skewY': return { operation: 'skew', value: [0, angleOf(args[0]!)] }
    default: throw new NuxtPdfError(PDF_ERROR_CODES.RenderError, `The transform operation "${operation}" is not supported.`)
  }
}

/**
 * A transform string to its operations: split after each `)`, arguments at
 * commas or else at spaces (admission: shared/style-values.ts,
 * `engineTransform`). Admission takes strings only; an SVG `none` arrives
 * as null and stays. A style's translation is a length of the page, `px`
 * at its `dpi` like every other length (`toPoints`); an SVG transform is in
 * the SVG's own units, so it has no `container` and reads plain numbers.
 */
export const transformOf = (value: unknown, container?: StyleContainer): unknown => {
  if (typeof value !== 'string') return value
  const lengthOf = container === undefined ? Number.parseFloat : (arg: string) => Number(toPoints(container, arg))
  return value.trim().split(/\)[ ,]|\)/).filter(Boolean).map((step) => {
    const [name = '', raw = ''] = step.split('(')
    return operationOf(name.trim(), raw.split(raw.includes(',') ? ',' : ' ').map(arg => arg.trim()), lengthOf)
  })
}

const EXPAND: Readonly<Record<string, Expand>> = {
  borderColor: everyBorder(sides('Color'), value => value),
  borderStyle: everyBorder(sides('Style'), value => value),
  borderWidth: everyBorder(sides('Width'), (value, container) => toPoints(container, value)),
  borderRadius: everyBorder(['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'], (value, container) => toPoints(container, value)),

  opacity: asNumber,
  flexGrow: asNumber,
  flexShrink: asNumber,
  maxLines: asNumber,
  columnCount: asNumber,
  fillOpacity: asNumber,
  strokeOpacity: asNumber,

  width: asPoints,
  height: asPoints,
  minWidth: asPoints,
  minHeight: asPoints,
  maxWidth: asPoints,
  maxHeight: asPoints,
  top: asPoints,
  right: asPoints,
  bottom: asPoints,
  left: asPoints,
  flexBasis: asPoints,
  rowGap: asPoints,
  columnGap,
  columnWidth: asPoints,
  columnRuleWidth: asPoints,
  borderTopWidth: asPoints,
  borderRightWidth: asPoints,
  borderBottomWidth: asPoints,
  borderLeftWidth: asPoints,
  borderTopLeftRadius: asPoints,
  borderTopRightRadius: asPoints,
  borderBottomRightRadius: asPoints,
  borderBottomLeftRadius: asPoints,
  fontSize: asPoints,
  strokeWidth: asPoints,
  letterSpacing: asPoints,

  margin: boxSides('margin'),
  marginVertical: boxPair('marginTop', 'marginBottom'),
  marginHorizontal: boxPair('marginRight', 'marginLeft'),
  marginTop: boxSide,
  marginRight: boxSide,
  marginBottom: boxSide,
  marginLeft: boxSide,
  padding: boxSides('padding'),
  paddingVertical: boxPair('paddingTop', 'paddingBottom'),
  paddingHorizontal: boxPair('paddingRight', 'paddingLeft'),
  paddingTop: boxSide,
  paddingRight: boxSide,
  paddingBottom: boxSide,
  paddingLeft: boxSide,

  flex,
  gap,
  columns,
  fontWeight,
  lineHeight,
  objectPosition,
  transform: (value, key, container) => ({ [key]: transformOf(value, container) }),
}

/**
 * A flat style with its shorthands expanded to sides and corners, lengths in
 * points and transforms parsed. Keys without a rule (colours, keywords, the
 * font family) stay as written: the painter reads every colour form with the
 * one colour rule (shared/color.ts, `readPdfColor`). Each rule
 * reads the forms admission lets through (shared/style-values.ts).
 */
export const expandStyle = (container: StyleContainer, style: Style): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(style)) {
    const expand = Object.hasOwn(EXPAND, key) ? EXPAND[key] : undefined
    if (expand) Object.assign(result, expand(value, key, container, style))
    else result[key] = value
  }
  return result
}
