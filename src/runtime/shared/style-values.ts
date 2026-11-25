import { PDF_EM_STYLE_KEYS, PDF_FONT_WEIGHTS, PDF_STYLE_SIGNS, PDF_STYLE_VALUES, type PdfStyle, type PdfStyleSign, type PdfStyleValueRule } from '../authoring'
import { PDF_COLOR_FORMS, readPdfColor } from './color'

/**
 * The value rules of PDF styles: one source for the `<style>` compiler at
 * build time and for the style check at render time. Pure code, so the
 * runtime can import it without the CSS parser. It owns the number, unit and
 * length syntax of styles, table columns, page sizes and SVG values.
 */

/** The length units of styles and table columns (`PdfLengthUnit`). */
export const PDF_LENGTH_UNITS = ['pt', 'px', 'in', 'mm', 'cm', 'rem', 'vh', 'vw'] as const
/** The units of a page dimension string (`PdfPageUnit`). */
export const PDF_PAGE_UNITS = ['pt', 'in', 'mm', 'cm', 'px'] as const

/** A CSS number as the style compiler reads it. */
export const NUMBER = String.raw`-?(?:\d+|\d*\.\d+)`
export const PLAIN_NUMBER = new RegExp(`^${NUMBER}$`)
/** A length with a unit and a percentage, as a PDF style accepts them. */
export const PDF_UNIT_LENGTH = new RegExp(`^${NUMBER}(?:${PDF_LENGTH_UNITS.join('|')})$`)
export const PDF_PERCENTAGE = new RegExp(`^${NUMBER}%$`)
/** An `em` length (`PdfEmLength`); only the keys of `PDF_EM_STYLE_KEYS` take it. */
export const PDF_EM_LENGTH = new RegExp(`^${NUMBER}em$`)
const EM_PARTS = new RegExp(`(?<=^|\\s)${NUMBER}em(?=\\s|$)`, 'g')
const EM_KEYS: ReadonlySet<string> = PDF_EM_STYLE_KEYS

/** Whether `key` takes an `em` length (`PDF_EM_STYLE_KEYS`). */
export const takesPdfEm = (key: string): boolean => EM_KEYS.has(key)

/**
 * An unsigned decimal with an optional exponent: the number of SVG values
 * (with a sign) and of page dimension strings.
 */
export const DECIMAL = String.raw`(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`

/**
 * A page dimension string: a number with a unit, a leading `+`, an exponent
 * and units in any case allowed. Admission (renderer/validate-props.ts) and
 * the layout (layout/prepare/page-size.ts) read it with this one pattern.
 */
export const PAGE_DIMENSION = new RegExp(String.raw`^\+?(${DECIMAL})(${PDF_PAGE_UNITS.join('|')})$`, 'i')

const FONT_FAMILY = /^[a-z_][\w -]*$/i
const BUILD_ANGLE = new RegExp(`^${NUMBER}(?:deg|rad)$`)
/**
 * The `<style>` grammar of each transform operation: its least and most
 * arguments and their form. Angles need a unit, as in CSS; translations are
 * unitless points (see `PdfTransformOperation`).
 */
const BUILD_TRANSFORMS = new Map<string, readonly [least: number, most: number, argument: RegExp]>([
  ['rotate', [1, 1, BUILD_ANGLE]],
  ['scale', [1, 2, PLAIN_NUMBER]],
  ['scaleX', [1, 1, PLAIN_NUMBER]],
  ['scaleY', [1, 1, PLAIN_NUMBER]],
  ['translate', [2, 2, PLAIN_NUMBER]],
  ['translateX', [1, 1, PLAIN_NUMBER]],
  ['translateY', [1, 1, PLAIN_NUMBER]],
  ['skew', [1, 2, BUILD_ANGLE]],
  ['skewX', [1, 1, BUILD_ANGLE]],
  ['skewY', [1, 1, BUILD_ANGLE]],
])
const BUILD_TRANSFORM_STEP = /^([a-z]+)\(([^()]*)\)$/i

const EXPECTED: Record<Exclude<PdfStyleValueRule, { keywords: readonly string[] }>, string> = {
  color: PDF_COLOR_FORMS,
  columns: 'a whole number of columns, a column width such as 120pt, or both, such as 2 120pt',
  fontFamily: 'one font family name',
  fontWeight: 'a number or a weight name such as bold',
  length: 'a number of points or a length such as 12pt or 4mm',
  lengthOrPercentage: 'a number of points, a length such as 12pt, or a percentage',
  lengthOrPercentageOrAuto: 'a number of points, a length such as 12pt, a percentage or auto',
  lengthOrNormal: 'a number of points, a length such as 12pt, or normal',
  lineHeight: 'a number, a length or a percentage',
  number: 'a number',
  objectPosition: 'one or two parts, each a length, a percentage, or left, center, right, top or bottom, such as right 10pt',
  transform: 'rotate(), scale(), translate() or skew() operations, or their X and Y forms',
}

export const expectedPdfStyleValue = (rule: PdfStyleValueRule): string =>
  typeof rule === 'string'
    ? EXPECTED[rule]
    : `one of ${rule.keywords.join(', ')}`

/** Splits a value at whitespace outside parentheses. */
export const splitValue = (value: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const character of value.trim()) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (/\s/.test(character) && depth === 0) {
      if (current) parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current) parts.push(current)
  return parts
}

/** A colour in the one colour rule (shared/color.ts), as written without surrounding whitespace. */
const parseColor = (value: string): string | undefined => readPdfColor(value) === undefined ? undefined : value.trim()

const parseTransform = (value: string): string | undefined => {
  const operations = splitValue(value.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*,\s*/g, ','))
  if (operations.length < 1 || operations.length > 3) return undefined
  const normalized: string[] = []
  for (const operation of operations) {
    const [, name = '', raw = ''] = BUILD_TRANSFORM_STEP.exec(operation) ?? []
    const grammar = BUILD_TRANSFORMS.get(name)
    const args = raw.split(/,|\s+/)
    if (!grammar || args.length < grammar[0] || args.length > grammar[1] || !args.every(arg => grammar[2].test(arg))) return undefined
    normalized.push(`${name}(${args.join(', ')})`)
  }
  return normalized.join(' ')
}

type PositionAxis = 'x' | 'y' | 'either'
const POSITION_KEYWORDS: Readonly<Record<string, readonly [PositionAxis, string]>> = {
  left: ['x', '0%'],
  right: ['x', '100%'],
  top: ['y', '0%'],
  bottom: ['y', '100%'],
  center: ['either', '50%'],
}
const positionAxis = (part: string): PositionAxis => POSITION_KEYWORDS[part]?.[0] ?? 'either'

/**
 * CSS `object-position` as the horizontal and the vertical part, each a
 * length as written or a percentage (a keyword becomes its percentage), or
 * `undefined` when CSS rejects the value. One part is the horizontal place,
 * unless it is `top` or `bottom`; the other part is `50%`. Of two parts, two
 * keywords may come in either order; with a length or a percentage, the
 * first is horizontal. The CSS forms with three or four parts (offsets from
 * an edge, such as `right 10pt bottom 4pt`) are rejected.
 */
export const pdfObjectPositionParts = (value: string): { x: string, y: string } | undefined => {
  const parts = value.trim().split(/\s+/)
  if (!parts.every(part => Object.hasOwn(POSITION_KEYWORDS, part) || PLAIN_NUMBER.test(part) || PDF_UNIT_LENGTH.test(part) || PDF_PERCENTAGE.test(part))) return undefined
  const engine = (part: string): string => POSITION_KEYWORDS[part]?.[1] ?? part
  if (parts.length === 1) {
    const [part = ''] = parts
    return positionAxis(part) === 'y' ? { x: '50%', y: engine(part) } : { x: engine(part), y: '50%' }
  }
  if (parts.length !== 2) return undefined
  let [x = '', y = ''] = parts
  if (Object.hasOwn(POSITION_KEYWORDS, x) && Object.hasOwn(POSITION_KEYWORDS, y) && (positionAxis(x) === 'y' || positionAxis(y) === 'x')) [x, y] = [y, x]
  if (positionAxis(x) === 'y' || positionAxis(y) === 'x') return undefined
  return { x: engine(x), y: engine(y) }
}

const parseFontFamily = (value: string): string | undefined => {
  if (value.includes(',')) return undefined
  const quoted = /^(['"])(.+)\1$/.exec(value)
  if (quoted) return quoted[2]
  return FONT_FAMILY.test(value) ? value.replace(/\s+/g, ' ') : undefined
}

/**
 * The parts of a `columns` value: a whole number of 1 or more is the column
 * count, a length with a unit (or 0) of 0 or more the column width; one of
 * them or one of each, in either order. `undefined` when the value is not
 * that. The `<style>` compiler and the style step expand it with this one
 * reading.
 */
export const pdfColumnsParts = (value: string): { count?: number, width?: string } | undefined => {
  const parts = value.trim().split(/\s+/)
  if (parts.length > 2) return undefined
  const result: { count?: number, width?: string } = {}
  for (const part of parts) {
    const number = PLAIN_NUMBER.test(part) ? Number(part) : undefined
    if (number !== undefined && number !== 0) {
      if (result.count !== undefined || !Number.isInteger(number) || number < 1) return undefined
      result.count = number
    }
    else if (number === 0 || PDF_UNIT_LENGTH.test(part)) {
      if (result.width !== undefined || Number.parseFloat(part) < 0) return undefined
      result.width = part
    }
    else return undefined
  }
  return result
}

/**
 * Parses one CSS value by its rule into the form the engine reads (keywords
 * in lower case, a font family without quotes, a normalized transform);
 * `undefined` means the value is invalid.
 */
export const parsePdfStyleValue = (rule: PdfStyleValueRule, value: string): number | string | undefined => {
  if (typeof rule !== 'string') {
    const words = value.toLowerCase().split(/\s+/).join(' ')
    return rule.keywords.find(keyword => keyword === words)
  }
  const number = PLAIN_NUMBER.test(value) ? Number(value) : undefined
  switch (rule) {
    case 'number':
      return number
    case 'columns':
      return pdfColumnsParts(value) === undefined ? undefined : (number ?? value.trim().split(/\s+/).join(' '))
    case 'lengthOrNormal':
      if (value === 'normal') return value
      // falls through
    case 'length':
      return number ?? (PDF_UNIT_LENGTH.test(value) ? value : undefined)
    case 'lengthOrPercentageOrAuto':
      if (value === 'auto') return value
      // falls through
    case 'lengthOrPercentage':
    case 'lineHeight':
      return number ?? (PDF_UNIT_LENGTH.test(value) || PDF_PERCENTAGE.test(value) ? value : undefined)
    case 'color':
      return parseColor(value)
    case 'fontFamily':
      return parseFontFamily(value)
    case 'fontWeight':
      if (number !== undefined) return Number.isInteger(number) && number >= 1 && number <= 1000 ? number : undefined
      return PDF_FONT_WEIGHTS.has(value.toLowerCase()) ? value.toLowerCase() : undefined
    case 'objectPosition': {
      if (number !== undefined) return number
      const parts = pdfObjectPositionParts(value)
      return parts === undefined ? undefined : `${parts.x} ${parts.y}`
    }
    case 'transform':
      return parseTransform(value)
  }
}

/*
 * Engine forms: strings that the pinned engine reads correctly although the
 * `<style>` grammar does not take them. A `:style` or `v-bind()` value reaches
 * the engine as written, so the render-time check accepts a string when it
 * matches the build rule of its key or the engine form of its key. Each form
 * follows one engine code path, named in its comment, and each was compared
 * with the output of the renderer before the check existed (D16). A string
 * outside both fails.
 */

/** What `parseFloat` reads to the end: a sign, a trailing dot, an exponent. */
const FLOAT = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`
const ENGINE_NUMBER = new RegExp(`^\\s*${FLOAT}\\s*$`, 'i')
/**
 * A length without a unit the style step converts (layout/styles/units.ts)
 * is read as points with `parseFloat`, as Yoga reads it, and a percentage
 * from the first `<digits>%` in it. So only a point value or a plain
 * percentage keeps its meaning.
 */
const YOGA_POINTS = new RegExp(`^${FLOAT}(?:pt)?$`, 'i')

/**
 * A point length as admission reads it and Yoga's `parseFloat` does: an
 * optional sign, a trailing dot, an exponent, `pt` (`'+0'`, `'1e1'`,
 * `'5.'`, `'5pt'`). The layout reads such a string as this number too
 * (layout/styles/units.ts, `toPoints`), so no box edge stays a string.
 */
export const readPdfPoints = (value: string): number | undefined =>
  YOGA_POINTS.test(value.trim()) ? Number.parseFloat(value) : undefined
const YOGA_PERCENT = /^[+-]?\d+(?:\.\d*)?%$/
const isLengthOrPercentage = (value: string): boolean =>
  PLAIN_NUMBER.test(value) || PDF_UNIT_LENGTH.test(value) || PDF_PERCENTAGE.test(value)
const yogaPart = (value: string): boolean =>
  isLengthOrPercentage(value) || YOGA_POINTS.test(value) || YOGA_PERCENT.test(value)

/** Sizes, insets and flexBasis: the style step converts a unit and reads point lengths, Yoga reads percentages. */
const yogaValue = (value: string): boolean =>
  value === 'auto' || isLengthOrPercentage(value) || readPdfPoints(value) !== undefined || YOGA_PERCENT.test(value.trim())

/**
 * Margins and paddings: the style step splits the value at CSS whitespace
 * and expands up to `count` parts to the sides like CSS
 * (layout/styles/expand.ts). The parts keep the forms `@react-pdf/stylesheet`
 * read before the port (units in lower case, no trailing dot).
 */
const BOX_POINTS = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:pt)?$/
const BOX_PERCENT = /^[+-]?\d+(?:\.\d+)?%$/
const boxValue = (count: number, auto: boolean) => (value: string): boolean => {
  const parts = value.split(/[ \t\n\r\f]+/).filter(Boolean)
  return parts.length >= 1 && parts.length <= count && parts.every(part =>
    (auto && part === 'auto') || isLengthOrPercentage(part) || BOX_POINTS.test(part) || BOX_PERCENT.test(part))
}

/**
 * `gap`: one row gap and one column gap, split at a single space, in points
 * or a unit. Not a percentage, as the types say: in a column yoga takes it
 * from a height the column does not have, and pagination broke a column with
 * `gap: '2%'` after every child.
 */
const gapValue = (value: string): boolean => {
  const parts = value.split(' ')
  return parts.length <= 2 && parts.every(part => PLAIN_NUMBER.test(part) || PDF_UNIT_LENGTH.test(part) || YOGA_POINTS.test(part))
}

/**
 * `flex`: `auto`, `none`, `initial`, or grow, shrink and basis split at a
 * single space. The engine reads the second part as the shrink factor, so
 * `flex: 1 30pt` is not CSS's grow and basis and fails.
 */
const FLEX_FACTOR = new RegExp(`^${FLOAT}$`, 'i')
const flexValue = (value: string): boolean => {
  if (value === 'auto' || value === 'none' || value === 'initial') return true
  const parts = value.split(' ')
  return parts.length <= 3 && parts.every((part, index) =>
    index < 2 ? FLEX_FACTOR.test(part) : part === 'auto' || yogaPart(part))
}

/**
 * SVG paint (`fill`, `stroke`, `stopColor`, the `fill` of SVG text) takes the
 * one colour rule (shared/color.ts), its alpha multiplied into the fill or
 * stroke opacity; `none` (`allowNone`) paints nothing and works for the fill
 * and stroke of shapes only. Returns the expected form, or `undefined`.
 */
export function svgColorProblem(value: unknown, allowNone: boolean): string | undefined {
  if (allowNone && value === 'none') return undefined
  if (typeof value === 'string' && readPdfColor(value) !== undefined) return undefined
  return allowNone ? `${PDF_COLOR_FORMS}, or "none"` : PDF_COLOR_FORMS
}

/**
 * `transform`, read by the style step (layout/styles/expand.ts): operations separated by
 * nothing, whitespace or a comma right after `)`; arguments split at commas,
 * or else at single spaces. Lengths are points or `px` at the page's `dpi`
 * (`toPoints`); angles take deg, rad or no unit. matrix() is applied without the transform origin, and rotate()
 * with a center is SVG's form, so both fail.
 */
const TRANSFORM_ANGLE = new RegExp(`^${NUMBER}(?:deg|rad)?$`)
const TRANSFORM_LENGTH = new RegExp(`^${NUMBER}(?:px|pt)?$`)
/** The operation names, case-sensitive, with their most arguments and the argument form. */
const TRANSFORM_OPERATIONS = new Map<string, readonly [maximum: number, argument: RegExp]>([
  ['rotate', [1, TRANSFORM_ANGLE]],
  ['scale', [2, PLAIN_NUMBER]],
  ['scaleX', [1, PLAIN_NUMBER]],
  ['scaleY', [1, PLAIN_NUMBER]],
  ['skew', [2, TRANSFORM_ANGLE]],
  ['skewX', [1, TRANSFORM_ANGLE]],
  ['skewY', [1, TRANSFORM_ANGLE]],
  ['translate', [2, TRANSFORM_LENGTH]],
  ['translateX', [1, TRANSFORM_LENGTH]],
  ['translateY', [1, TRANSFORM_LENGTH]],
])
const TRANSFORM_STEP = /(?:,\s*|\s*)([a-z]+)\s*\(([^()]*)\)/iy
const engineTransform = (value: string): boolean => {
  const text = value.trim()
  TRANSFORM_STEP.lastIndex = 0
  let operations = 0
  while (TRANSFORM_STEP.lastIndex < text.length) {
    const start = TRANSFORM_STEP.lastIndex
    const match = TRANSFORM_STEP.exec(text)
    // The first operation cannot start with a comma.
    if (!match || (start === 0 && text.startsWith(','))) return false
    const [, name = '', raw = ''] = match
    const operation = TRANSFORM_OPERATIONS.get(name)
    if (!operation) return false
    const args = raw.includes(',') ? raw.split(',').map(argument => argument.trim()) : raw.split(' ')
    if (args.length > operation[0] || !args.every(argument => operation[1].test(argument))) return false
    operations += 1
  }
  return operations > 0
}

/** The engine forms by key; a key without an entry takes only its build rule. */
const ENGINE_FORMS: Readonly<Record<string, (value: string) => boolean>> = {
  width: yogaValue,
  height: yogaValue,
  minWidth: yogaValue,
  minHeight: yogaValue,
  maxWidth: yogaValue,
  maxHeight: yogaValue,
  top: yogaValue,
  right: yogaValue,
  bottom: yogaValue,
  left: yogaValue,
  flexBasis: yogaValue,
  margin: boxValue(4, true),
  marginHorizontal: boxValue(2, true),
  marginVertical: boxValue(2, true),
  marginTop: boxValue(1, true),
  marginRight: boxValue(1, true),
  marginBottom: boxValue(1, true),
  marginLeft: boxValue(1, true),
  padding: boxValue(4, false),
  paddingHorizontal: boxValue(2, false),
  paddingVertical: boxValue(2, false),
  paddingTop: boxValue(1, false),
  paddingRight: boxValue(1, false),
  paddingBottom: boxValue(1, false),
  paddingLeft: boxValue(1, false),
  gap: gapValue,
  flex: flexValue,
  // Read with parseFloat.
  flexGrow: value => ENGINE_NUMBER.test(value),
  flexShrink: value => ENGINE_NUMBER.test(value),
  opacity: value => ENGINE_NUMBER.test(value),
  maxLines: value => ENGINE_NUMBER.test(value),
  transform: engineTransform,
} satisfies { readonly [Key in keyof PdfStyle]?: (value: string) => boolean }

const RULES: Readonly<Record<string, PdfStyleValueRule>> = PDF_STYLE_VALUES
const NUMBER_RULES = new Set<PdfStyleValueRule>(['columns', 'fontWeight', 'length', 'lengthOrNormal', 'lengthOrPercentage', 'lengthOrPercentageOrAuto', 'lineHeight', 'number', 'objectPosition'])

/**
 * Values the engine took once that are not CSS, with what to write instead.
 * They fail with the expected form and this hint, in a style object and in
 * the `<style>` block.
 */
const RETIRED_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  textTransform: {
    upperfirst: '"upperfirst" is not CSS; "capitalize" sets the first letter of every word in upper case, so to raise only the first letter of the text, write it in upper case',
  },
}

/**
 * The expected form of an invalid value, with the hint of a retired value.
 * `gap` names its second value, as the `<style>` shorthand does.
 */
export const expectedPdfStyleValueOf = (key: string, rule: PdfStyleValueRule, value: string): string => {
  if (key === 'gap') return `one or two values, each ${expectedPdfStyleValue(rule)}`
  const hint = RETIRED_VALUES[key]?.[value.trim()]
  return hint === undefined ? expectedPdfStyleValue(rule) : `${expectedPdfStyleValue(rule)}. ${hint}`
}

/** Whether a string passes the build rule in the form the compiler writes. */
const matchesBuildRule = (rule: PdfStyleValueRule, value: string): boolean => {
  // The compiler writes a transform normalized; a :style string reaches the
  // engine as written (`translate(10  20)` loses its y), so only the engine
  // form decides.
  if (rule === 'transform') return false
  const parsed = parsePdfStyleValue(rule, value)
  if (parsed === undefined) return false
  // The compiler writes keywords in lower case; the engine compares them as
  // written. A font weight name passes in any case: the stylesheet lower-cases
  // it before it looks it up.
  return !(typeof rule !== 'string' && parsed !== value)
}

/**
 * Checks one style value at render time. It rejects only what the engine
 * cannot read correctly: a string passes when it matches the build rule of
 * its key (a keyword in lower case) or an engine form of its key (see
 * ENGINE_FORMS). Returns the expected form when the value is invalid, or
 * `undefined`. Every value that the `<style>` compiler writes passes. A
 * number is not parsed, but it must keep the sign rule of its key
 * (`pdfStyleSignProblem`). `fontFamily` takes any non-empty string here: a
 * family registered with pdf.fonts may have a name that the CSS syntax does
 * not allow.
 */
export function pdfStyleValueProblem(key: string, value: unknown): string | undefined {
  const rule = RULES[key]
  if (rule === undefined) return undefined
  // An em part checks as a length of 0 here; its sign is checked as written.
  if (typeof value === 'string' && takesPdfEm(key)) {
    const lengths = value.replace(EM_PARTS, '0')
    if (lengths !== value) return pdfStyleValueProblem(key, lengths) ?? pdfStyleSignProblem(key, value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !NUMBER_RULES.has(rule)) return expectedPdfStyleValue(rule)
    if (rule === 'fontWeight' && !(Number.isInteger(value) && value >= 1 && value <= 1000)) return expectedPdfStyleValue(rule)
    if (rule === 'columns' && !(Number.isInteger(value) && value >= 1)) return expectedPdfStyleValue(rule)
    return pdfStyleSignProblem(key, value)
  }
  if (typeof value !== 'string') return expectedPdfStyleValue(rule)
  if (rule === 'fontFamily') return value.trim() ? undefined : expectedPdfStyleValue(rule)
  if (!matchesBuildRule(rule, value) && !ENGINE_FORMS[key]?.(value)) return expectedPdfStyleValueOf(key, rule, value)
  return pdfStyleSignProblem(key, value)
}

const SIGNS: Readonly<Record<string, PdfStyleSign>> = PDF_STYLE_SIGNS

/** The numbers of a style value: a number, or each part of a string up to its unit. */
const styleNumbers = (value: unknown): number[] => {
  if (typeof value === 'number') return [value]
  if (typeof value !== 'string') return []
  return value.trim().split(/\s+/).map(part => Number.parseFloat(part)).filter(Number.isFinite)
}

/**
 * Checks the sign rule of a style key (`PDF_STYLE_SIGNS`): the expected form
 * when a value breaks it, or `undefined`. The render-time check and the
 * `<style>` compiler both call it, so `:style`, `v-bind()` and class values
 * follow one rule. Each part of a shorthand (`padding: 4pt -2pt`) counts.
 */
export function pdfStyleSignProblem(key: string, value: unknown): string | undefined {
  const sign = SIGNS[key]
  if (sign === 'nonNegative') return styleNumbers(value).some(number => number < 0) ? 'a value of 0 or more' : undefined
  if (sign === 'positive') return styleNumbers(value).some(number => number <= 0) ? 'a value above 0' : undefined
  if (sign === 'unitInterval') return styleNumbers(value).some(number => number < 0 || number > 1) ? 'a number from 0 to 1' : undefined
  if (sign === 'positiveWhole') return styleNumbers(value).some(number => !Number.isInteger(number) || number < 1) ? 'a whole number of 1 or more' : undefined
  return undefined
}
