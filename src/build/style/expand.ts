// CSS declarations as PdfStyle longhands: values, box shorthands, border, column rule and flex.

import { PDF_STYLE_VALUES, type PdfStyleValueRule } from '../../runtime/authoring'
import { kebabCase } from '../../runtime/shared/case'
import { expectedPdfStyleValue as expectedText, expectedPdfStyleValueOf, parsePdfStyleValue, PDF_EM_LENGTH, pdfColumnsParts, splitValue, takesPdfEm } from '../../runtime/shared/style-values'

export type StyleValue = number | string

/** A bound value inside a value string while it is expanded: NUL, index, NUL. */
const BOUND_MARK = '\u0000'

export const BOUND_VALUE = /^\0(\d+)\0$/

export const boundValue = (index: number): string => `${BOUND_MARK}${index}${BOUND_MARK}`

const BOUND_WHOLE = 'v-bind() must be a whole value. Put the unit into the bound value, such as \'12pt\'.'

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const

const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const

export const isStyleKey = (key: string): key is keyof typeof PDF_STYLE_VALUES =>
  Object.hasOwn(PDF_STYLE_VALUES, key)

/** Parses one value by its rule. A bound value passes as it is: the render-time check validates it. */
const parseValue = (rule: PdfStyleValueRule, value: string): StyleValue | undefined =>
  BOUND_VALUE.test(value) ? value : parsePdfStyleValue(rule, value)

/** CSS box order: one to four values for top, right, bottom, left. */
const boxValues = <Value>(values: readonly Value[]): readonly [Value, Value, Value, Value] => {
  const [top, right = top, bottom = top, left = right] = values
  return [top!, right!, bottom!, left!]
}

/** A rejection with its own message instead of "Invalid value … expected …". */
export class ExpansionFailure {
  constructor(readonly message: string) {}
}

type Expansion = Record<string, StyleValue> | string | ExpansionFailure

/**
 * Turns one declaration into `PdfStyle` longhands. A string result is the
 * "expected …" text of an invalid value.
 */
export const expandDeclaration = (key: string, value: string): Expansion => {
  const parts = splitValue(value)
  if (parts.some(part => part.includes(BOUND_MARK) && !BOUND_VALUE.test(part))) return new ExpansionFailure(BOUND_WHOLE)
  // The spacing keys and width take an em length besides their rule (PDF_EM_STYLE_KEYS).
  const em = takesPdfEm(key)
  const parse = (rule: PdfStyleValueRule, part: string): StyleValue | undefined =>
    em && PDF_EM_LENGTH.test(part) ? part : parseValue(rule, part)
  const each = (rule: PdfStyleValueRule): StyleValue[] | undefined => {
    const values = parts.map(part => parse(rule, part))
    return values.every((item): item is StyleValue => item !== undefined) ? values : undefined
  }
  const box = (prefix: string, suffix: string, rule: PdfStyleValueRule, names: readonly string[] = SIDES): Expansion => {
    const values = parts.length >= 1 && parts.length <= 4 ? each(rule) : undefined
    if (!values) return `one to four values, each ${expectedText(rule)}`
    const sides = boxValues(values)
    return Object.fromEntries(names.map((name, index) => [`${prefix}${name}${suffix}`, sides[index]!]))
  }
  const pair = (prefix: string, names: readonly [string, string], rule: PdfStyleValueRule): Expansion => {
    const values = parts.length === 1 ? each(rule) : undefined
    if (!values) return expectedText(rule)
    return { [`${prefix}${names[0]}`]: values[0]!, [`${prefix}${names[1]}`]: values[0]! }
  }

  switch (key) {
    case 'margin':
    case 'padding':
      return box(key, '', PDF_STYLE_VALUES[`${key}Top`])
    case 'marginHorizontal':
    case 'paddingHorizontal':
      return pair(key.replace('Horizontal', ''), ['Right', 'Left'], PDF_STYLE_VALUES[key])
    case 'marginVertical':
    case 'paddingVertical':
      return pair(key.replace('Vertical', ''), ['Top', 'Bottom'], PDF_STYLE_VALUES[key])
    case 'borderWidth':
    case 'borderColor':
    case 'borderStyle':
      return box('border', key.slice('border'.length), PDF_STYLE_VALUES[`borderTop${key.slice('border'.length) as 'Width' | 'Color' | 'Style'}`])
    case 'borderRadius':
      return box('border', 'Radius', PDF_STYLE_VALUES.borderTopLeftRadius, CORNERS)
    case 'border':
    case 'borderTop':
    case 'borderRight':
    case 'borderBottom':
    case 'borderLeft':
    case 'columnRule':
      return expandBorder(key, parts)
    case 'flex':
      return expandFlex(parts)
    case 'gap':
      return expandGap(parts, each)
    case 'columns':
      if (!value.includes(BOUND_MARK)) return expandColumns(value)
  }

  if (!isStyleKey(key)) throw new Error(`Unhandled PDF style key ${key}`)
  if (value.includes(BOUND_MARK)) {
    return parts.length === 1 ? { [key]: parts[0]! } : new ExpansionFailure(BOUND_WHOLE)
  }
  const rule = PDF_STYLE_VALUES[key]
  const single = typeof rule === 'string' && rule !== 'fontFamily' && rule !== 'transform' && rule !== 'objectPosition' && parts.length !== 1
  const parsed = single ? undefined : parse(rule, value.trim())
  return parsed === undefined ? expectedPdfStyleValueOf(key, rule, value) : { [key]: parsed }
}

/**
 * `gap`: a row gap, then a column gap; one value sets both. A style object
 * takes the same one or two values (shared/style-values.ts, `gapValue`), and
 * the engine splits them at one space (layout/styles/expand.ts). One value
 * stays as it is; two are written joined by one space. A bound value must be
 * the whole gap, because the compiler binds whole values only.
 */
const expandGap = (parts: readonly string[], each: (rule: PdfStyleValueRule) => StyleValue[] | undefined): Expansion => {
  if (parts.length === 2 && parts.some(part => BOUND_VALUE.test(part))) return new ExpansionFailure(BOUND_WHOLE)
  const values = parts.length >= 1 && parts.length <= 2 ? each(PDF_STYLE_VALUES.gap) : undefined
  if (!values) return `one or two values, each ${expectedText(PDF_STYLE_VALUES.gap)}`
  return { gap: values.length === 1 ? values[0]! : values.join(' ') }
}

/**
 * `columns`: a column count, a column width or both (shared/style-values.ts,
 * `pdfColumnsParts`). A bound value passes as `columns`, and the style step
 * expands it (layout/styles/expand.ts).
 */
const expandColumns = (value: string): Expansion => {
  const parts = pdfColumnsParts(value)
  if (!parts) return expectedText(PDF_STYLE_VALUES.columns)
  const longhands: Record<string, StyleValue> = {}
  if (parts.count !== undefined) longhands.columnCount = parts.count
  if (parts.width !== undefined) longhands.columnWidth = parsePdfStyleValue('length', parts.width)!
  return longhands
}

const BORDER_EXPECTED = 'a width, a color and optionally a style, in any order, such as 1pt solid #CCCCCC'

/**
 * `border`, `border-<side>` and `column-rule`, which takes the same parts.
 * Without a style the engine paints `solid` (its default in `renderBorders`
 * and `renderColumnRules`); the style is written out so that the shorthand
 * also resets the style of an earlier rule, as in CSS. A bound part takes
 * the one slot that the static parts leave open.
 */
const expandBorder = (key: string, parts: readonly string[]): Expansion => {
  const property = kebabCase(key)
  const boundFailure = new ExpansionFailure(`v-bind() in "${property}" needs the other parts written out, such as "1pt solid v-bind(color)". Or use the longhands ${property}-width, ${property}-style and ${property}-color.`)
  if (parts.length === 1 && BOUND_VALUE.test(parts[0]!)) return boundFailure
  if (parts.length < 2 || parts.length > 3) return BORDER_EXPECTED
  const slots: { color?: StyleValue, style?: StyleValue, width?: StyleValue } = {}
  const bound: string[] = []
  for (const part of parts) {
    if (BOUND_VALUE.test(part)) {
      bound.push(part)
      continue
    }
    const asStyle = parseValue(PDF_STYLE_VALUES.borderStyle, part)
    const asWidth = parseValue('length', part)
    const asColor = parseValue('color', part)
    if (asStyle !== undefined && slots.style === undefined) slots.style = asStyle
    else if (asWidth !== undefined && slots.width === undefined) slots.width = asWidth
    else if (asColor !== undefined && slots.color === undefined) slots.color = asColor
    else return BORDER_EXPECTED
  }
  if (bound.length > 0) {
    const open = (['width', 'color'] as const).filter(slot => slots[slot] === undefined)
    const target = bound.length === 1 && open.length <= 1 ? open[0] ?? (slots.style === undefined ? 'style' : undefined) : undefined
    if (target === undefined) return boundFailure
    slots[target] = bound[0]!
  }
  const { width, style = 'solid', color } = slots
  if (width === undefined || color === undefined) return BORDER_EXPECTED
  if (key === 'columnRule') return { columnRuleWidth: width, columnRuleStyle: style, columnRuleColor: color }
  const sides = key === 'border' ? SIDES : [key.slice('border'.length)]
  return Object.fromEntries(sides.flatMap(side => [
    [`border${side}Width`, width],
    [`border${side}Style`, style],
    [`border${side}Color`, color],
  ]))
}

const FLEX_EXPECTED = 'a number, auto, none, or grow shrink basis (such as 1 0 auto)'

const expandFlex = (parts: readonly string[]): Expansion => {
  const flex = (flexGrow: StyleValue, flexShrink: StyleValue, flexBasis: StyleValue) =>
    ({ flexGrow, flexShrink, flexBasis })
  if (parts.length === 1) {
    if (BOUND_VALUE.test(parts[0]!)) {
      return new ExpansionFailure('v-bind() in "flex" needs three parts (grow shrink basis), such as "v-bind(grow) 1 0". Or use flex-grow, flex-shrink and flex-basis.')
    }
    if (parts[0] === 'auto') return flex(1, 1, 'auto')
    if (parts[0] === 'none') return flex(0, 0, 'auto')
    const grow = parseValue('number', parts[0]!)
    // The engine reads `flex: n` as grow n, shrink 1, basis 0.
    return grow === undefined ? FLEX_EXPECTED : flex(grow, 1, 0)
  }
  if (parts.length !== 3) return FLEX_EXPECTED
  const grow = parseValue('number', parts[0]!)
  const shrink = parseValue('number', parts[1]!)
  const basis = parseValue('lengthOrPercentageOrAuto', parts[2]!)
  return grow === undefined || shrink === undefined || basis === undefined
    ? FLEX_EXPECTED
    : flex(grow, shrink, basis)
}
