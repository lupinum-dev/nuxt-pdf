import { PDF_FONT_WEIGHT_NAMES, PDF_STYLE_SIGNS, PDF_STYLE_VALUES, type PdfStyle, type PdfStyleSign, type PdfStyleValueRule } from '../authoring'
import { PDF_PERCENTAGE as PERCENTAGE, PDF_UNIT_LENGTH as UNIT_LENGTH } from '../primitives'

/**
 * The value rules of PDF styles: one source for the `<style>` compiler at
 * build time and for the style check at render time. Pure code, so the
 * runtime can import it without the CSS parser.
 */

/** A CSS number as the style compiler reads it. */
export const NUMBER = String.raw`-?(?:\d+|\d*\.\d+)`
export const PLAIN_NUMBER = new RegExp(`^${NUMBER}$`)

// The color forms below are a subset of what the engine's parser
// (`color-string`, through `@react-pdf/stylesheet` and `@react-pdf/render`)
// reads; test/pdf-style.test.ts checks each form against that parser. A
// form it rejects would paint black.
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const RGB_ALPHA = `${NUMBER}%?`
const HUE = String.raw`-?(?:\d+|\d{0,3}\.\d+)(?:deg)?`
const HSL_ALPHA = String.raw`-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)`
const COLOR_FUNCTIONS = [
  // rgb(1, 2, 3) and rgb(1, 2, 3, 0.5)
  new RegExp(String.raw`^rgba?\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*(?:,\s*(${RGB_ALPHA})\s*)?\)$`, 'i'),
  // rgb(1 2 3) and rgb(1 2 3 / 50%)
  new RegExp(String.raw`^rgba?\(\s*(${NUMBER})\s+(${NUMBER})\s+(${NUMBER})\s*(?:/\s*(${RGB_ALPHA})\s*)?\)$`, 'i'),
  // rgb(10%, 20%, 30%) and rgb(10% 20% 30% / 0.5)
  new RegExp(String.raw`^rgba?\(\s*(${NUMBER}%)\s*,\s*(${NUMBER}%)\s*,\s*(${NUMBER}%)\s*(?:,\s*(${RGB_ALPHA})\s*)?\)$`, 'i'),
  new RegExp(String.raw`^rgba?\(\s*(${NUMBER}%)\s+(${NUMBER}%)\s+(${NUMBER}%)\s*(?:/\s*(${RGB_ALPHA})\s*)?\)$`, 'i'),
  // hsl(120, 50%, 50%) and hsl(120deg 50% 50% / 0.5); the alpha takes no %.
  new RegExp(String.raw`^hsla?\(\s*(${HUE})\s*,\s*(${NUMBER}%)\s*,\s*(${NUMBER}%)\s*(?:,\s*(${HSL_ALPHA})\s*)?\)$`, 'i'),
  new RegExp(String.raw`^hsla?\(\s*(${HUE})\s+(${NUMBER}%)\s+(${NUMBER}%)\s*(?:/\s*(${HSL_ALPHA})\s*)?\)$`, 'i'),
]
const FONT_FAMILY = /^[a-z_][\w -]*$/i
const TRANSFORM_OPERATION = new RegExp(
  String.raw`^(?:rotate\((${NUMBER})(deg|rad)\)|scale\((${NUMBER})(?:(?:,|\s+)(${NUMBER}))?\)|translate\((${NUMBER})(?:,|\s+)(${NUMBER})\))$`,
)

/** Named colors that the pinned pdfkit resolves; others are ignored silently. */
const NAMED_COLORS = new Set((
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue '
  + 'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk '
  + 'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki '
  + 'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
  + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue '
  + 'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite '
  + 'gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki '
  + 'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen '
  + 'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen '
  + 'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen '
  + 'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream '
  + 'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid '
  + 'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell '
  + 'sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal '
  + 'thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
).split(' '))

const EXPECTED: Record<Exclude<PdfStyleValueRule, { keywords: readonly string[] }>, string> = {
  color: 'a hex color (#rgb, #rrggbb, #rgba or #rrggbbaa), rgb(), hsl() or a color name',
  fontFamily: 'one font family name',
  fontWeight: 'a number or a weight name such as bold',
  length: 'a number of points or a length such as 12pt or 4mm',
  lengthOrPercentage: 'a number of points, a length such as 12pt, or a percentage',
  lengthOrPercentageOrAuto: 'a number of points, a length such as 12pt, a percentage or auto',
  lineHeight: 'a number, a length or a percentage',
  number: 'a number',
  transform: 'rotate(), scale() or translate() operations',
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

const parseColor = (value: string): string | undefined => {
  if (HEX_COLOR.test(value)) return value
  if (NAMED_COLORS.has(value.toLowerCase())) return value.toLowerCase()
  return COLOR_FUNCTIONS.some(pattern => pattern.test(value)) ? value : undefined
}

/**
 * Whether a parsed color is not fully opaque. The engine strokes borders
 * through pdfkit, which reads only `#rgb` and `#rrggbb`, so such a color
 * paints a wrong border.
 */
export const hasAlpha = (color: string): boolean => {
  if (color.startsWith('#')) return color.length === 5 || color.length === 9
  const alpha = COLOR_FUNCTIONS.map(pattern => pattern.exec(color)).find(Boolean)?.[4]
  if (alpha === undefined) return false
  return (alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)) < 1
}

const parseTransform = (value: string): string | undefined => {
  const operations = splitValue(value.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s*,\s*/g, ','))
  if (operations.length < 1 || operations.length > 3) return undefined
  const normalized: string[] = []
  for (const operation of operations) {
    const match = TRANSFORM_OPERATION.exec(operation)
    if (!match) return undefined
    const [, angle, angleUnit, scaleX, scaleY, translateX, translateY] = match
    if (angle !== undefined) normalized.push(`rotate(${angle}${angleUnit})`)
    else if (scaleX !== undefined) normalized.push(scaleY === undefined ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`)
    else normalized.push(`translate(${translateX}, ${translateY})`)
  }
  return normalized.join(' ')
}

const parseFontFamily = (value: string): string | undefined => {
  if (value.includes(',')) return undefined
  const quoted = /^(['"])(.+)\1$/.exec(value)
  if (quoted) return quoted[2]
  return FONT_FAMILY.test(value) ? value.replace(/\s+/g, ' ') : undefined
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
    case 'length':
      return number ?? (UNIT_LENGTH.test(value) ? value : undefined)
    case 'lengthOrPercentageOrAuto':
      if (value === 'auto') return value
      // falls through
    case 'lengthOrPercentage':
    case 'lineHeight':
      return number ?? (UNIT_LENGTH.test(value) || PERCENTAGE.test(value) ? value : undefined)
    case 'color':
      return parseColor(value)
    case 'fontFamily':
      return parseFontFamily(value)
    case 'fontWeight':
      if (number !== undefined) return Number.isInteger(number) && number >= 1 && number <= 1000 ? number : undefined
      return PDF_FONT_WEIGHT_NAMES.find(name => name === value.toLowerCase())
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
 * with the output of the renderer before the check existed
 * (internals/dream-r2/p21-d1-style-values.md). A string outside both fails.
 */

/** What `parseFloat` reads to the end: a sign, a trailing dot, an exponent. */
const FLOAT = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`
const ENGINE_NUMBER = new RegExp(`^\\s*${FLOAT}\\s*$`, 'i')
/**
 * A string that `@react-pdf/stylesheet` does not convert reaches Yoga
 * (yoga-layout `wrapAssembly`): it reads points with `parseFloat` and ignores
 * a unit, and `@react-pdf/layout` reads a percentage from the first
 * `<digits>%` it finds. So only a point value or a plain percentage survives.
 */
const YOGA_POINTS = new RegExp(`^${FLOAT}(?:pt)?$`, 'i')
const YOGA_PERCENT = /^[+-]?\d+(?:\.\d*)?%$/
const isLengthOrPercentage = (value: string): boolean =>
  PLAIN_NUMBER.test(value) || UNIT_LENGTH.test(value) || PERCENTAGE.test(value)
const yogaPart = (value: string): boolean =>
  isLengthOrPercentage(value) || YOGA_POINTS.test(value) || YOGA_PERCENT.test(value)

/** Sizes, insets and flexBasis: the stylesheet converts a unit, Yoga reads the rest. */
const yogaValue = (value: string): boolean =>
  value === 'auto' || isLengthOrPercentage(value) || YOGA_POINTS.test(value.trim()) || YOGA_PERCENT.test(value.trim())

/**
 * Margins and paddings: the stylesheet splits the value at CSS whitespace,
 * reads each part with postcss-value-parser (units in lower case, no trailing
 * dot) and expands up to `count` parts to the sides like CSS. A part it cannot
 * read drops the whole value.
 */
const BOX_POINTS = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:pt)?$/
const BOX_PERCENT = /^[+-]?\d+(?:\.\d+)?%$/
const boxValue = (count: number, auto: boolean) => (value: string): boolean => {
  const parts = value.split(/[ \t\n\r\f]+/).filter(Boolean)
  return parts.length >= 1 && parts.length <= count && parts.every(part =>
    (auto && part === 'auto') || isLengthOrPercentage(part) || BOX_POINTS.test(part) || BOX_PERCENT.test(part))
}

/** `gap`: one row gap and one column gap, split at a single space. */
const gapValue = (value: string): boolean => {
  const parts = value.split(' ')
  return parts.length <= 2 && parts.every(yogaPart)
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

// The patterns of color-string 2.1.4, which `@react-pdf/stylesheet` and
// `@react-pdf/render` use to read rgb(), hsl(), hwb(), hex and color names,
// copied as written so the check reads exactly what the engine reads. They
// backtrack polynomially, so a color longer than MAX_COLOR_LENGTH fails
// before they run (64 characters: at most 0.05 ms per pattern, measured).
const MAX_COLOR_LENGTH = 64
/* eslint-disable regexp/no-super-linear-backtracking, regexp/no-misleading-capturing-group, regexp/no-unused-capturing-group -- verbatim color-string patterns, input length capped above */
const CS_HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}(?:[\da-f]{2})?)$/i
const CS_RGB = /^rgba?\(\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)\s*(?:[\s,|/]\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(%?)\s*)?\)$/i
const CS_RGB_PERCENT = /^rgba?\(\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[\s,|/]\s*([+-]?[\d.]+)(%?)\s*)?\)$/i
const CS_HSL = /^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg)?\s*,?\s*([+-]?[\d.]+)%\s*,?\s*([+-]?[\d.]+)%\s*(?:[,|/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?)\s*)?\)$/i
const CS_HWB = /^hwb\(\s*([+-]?\d{0,3}(?:\.\d+)?)(?:deg)?\s*[\s,]\s*([+-]?[\d.]+)%\s*[\s,]\s*([+-]?[\d.]+)%\s*(?:[\s,]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?)\s*)?\)$/i
/* eslint-enable regexp/no-super-linear-backtracking, regexp/no-misleading-capturing-group, regexp/no-unused-capturing-group */

/** The alpha of an rgb() or hsl() color, or `undefined` when color-string cannot read it. */
const functionAlpha = (color: string): number | undefined => {
  const rgb = CS_RGB.exec(color) ?? CS_RGB_PERCENT.exec(color)
  const match = rgb ?? CS_HSL.exec(color)
  if (!match) return undefined
  if (match[4] === undefined) return 1
  return rgb?.[5] ? Number.parseFloat(match[4]) / 100 : Number.parseFloat(match[4])
}

/**
 * `backgroundColor`, `color` and `textDecorationColor` are painted after
 * `@react-pdf/render` reads them with color-string, so every color-string
 * form works: `transparent`, `rebeccapurple`, hwb(), names in any case,
 * surrounding whitespace (the stylesheet trims it).
 */
const paintColor = (value: string): boolean => {
  const color = value.trim()
  if (color.length > MAX_COLOR_LENGTH) return false
  const prefix = color.slice(0, 3).toLowerCase()
  if (prefix === 'hsl') return CS_HSL.test(color)
  if (prefix === 'hwb') return CS_HWB.test(color)
  if (CS_HEX.test(color) || CS_RGB.test(color) || CS_RGB_PERCENT.test(color)) return true
  const name = color.toLowerCase()
  return name === 'transparent' || name === 'rebeccapurple' || NAMED_COLORS.has(name)
}

const OPAQUE = 'an opaque color (#rgb or #rrggbb): the PDF engine paints a border color with alpha in a wrong color'
const BORDER_COLOR = 'an opaque color (#rgb, #rrggbb, rgb() or hsl()) or a color name in lower case: the PDF engine paints other border colors black'

/**
 * Border colors are stroked by pdfkit. The stylesheet trims the value and
 * turns rgb() and hsl() into hex; pdfkit then reads only `#rgb`, `#rrggbb`
 * and its own color names in lower case. Any other value paints black.
 */
const borderColorProblem = (value: string): string | undefined => {
  const color = value.trim()
  if (color.length > MAX_COLOR_LENGTH) return BORDER_COLOR
  if (/^(?:rgba?|hsla?)\(/i.test(color)) {
    const alpha = functionAlpha(color)
    if (alpha === undefined) return BORDER_COLOR
    return alpha < 1 ? OPAQUE : undefined
  }
  if (color.startsWith('#')) {
    if (!CS_HEX.test(color)) return BORDER_COLOR
    return color.length === 4 || color.length === 7 ? undefined : OPAQUE
  }
  if (NAMED_COLORS.has(color)) return undefined
  return color.toLowerCase() === 'transparent' ? OPAQUE : BORDER_COLOR
}

/**
 * `transform`, read by `@react-pdf/stylesheet`: operations separated by
 * nothing, whitespace or a comma right after `)`; arguments split at commas,
 * or else at single spaces. Lengths are read with `parseFloat`, so only
 * points and `px` (at the default 72 dpi) are right; angles take deg, rad or
 * no unit. matrix() is applied without the transform origin, and rotate()
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

const keywordValue = (words: readonly string[]) => (value: string): boolean => words.includes(value)

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
  backgroundColor: paintColor,
  color: paintColor,
  textDecorationColor: paintColor,
  transform: engineTransform,
  objectFit: keywordValue(['fill', 'none', 'scale-down']),
  position: keywordValue(['static']),
  textTransform: keywordValue(['upperfirst']),
} satisfies { readonly [Key in keyof PdfStyle]?: (value: string) => boolean }

const RULES: Readonly<Record<string, PdfStyleValueRule>> = PDF_STYLE_VALUES
const NUMBER_RULES = new Set<PdfStyleValueRule>(['fontWeight', 'length', 'lengthOrPercentage', 'lengthOrPercentageOrAuto', 'lineHeight', 'number'])
const BORDER_COLOR_KEY = /^border\w*Color$/

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
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !NUMBER_RULES.has(rule)) return expectedPdfStyleValue(rule)
    if (rule === 'fontWeight' && !(Number.isInteger(value) && value >= 1 && value <= 1000)) return expectedPdfStyleValue(rule)
    return pdfStyleSignProblem(key, value)
  }
  if (typeof value !== 'string') return expectedPdfStyleValue(rule)
  if (rule === 'fontFamily') return value.trim() ? undefined : expectedPdfStyleValue(rule)
  if (BORDER_COLOR_KEY.test(key)) return borderColorProblem(value)
  if (!matchesBuildRule(rule, value) && !ENGINE_FORMS[key]?.(value)) return expectedPdfStyleValue(rule)
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
  if (sign === 'unitInterval') return styleNumbers(value).some(number => number < 0 || number > 1) ? 'a number from 0 to 1' : undefined
  return undefined
}
