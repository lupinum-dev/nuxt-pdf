import { percentOf } from '../styles/percent'
import { transformOf } from '../styles/expand'
import type { NumberedProps } from '../types'

/** What percentages and transform units of an SVG element resolve against. */
export type SvgContainer = { width: number, height: number }

type Parser = (value: unknown) => unknown

/** A paint colour as written (the painter reads it); `none` arrives as null and gives undefined. */
const transformColor: Parser = value => typeof value === 'string' ? value : undefined

/** Strings to numbers (`'12px'` gives 12); other values stay as they are. */
export const parseNumber: Parser = value => typeof value === 'string' ? Number.parseFloat(value) : value

/** A percentage to its fraction (`'50%'` gives 0.5), else as `parseNumber`. */
const parsePercent: Parser = value => percentOf(value) ?? parseNumber(value)

// Gradients and patterns are referenced as `url(#id)`; `replaceDefs` resolves them later.
const parseColorOrUrl: Parser = value => typeof value === 'string' && value.startsWith('url(') ? value : transformColor(value)

/**
 * Applies the parser of each key the props have; keys without one are copied.
 * Like the package helper it replaces, the result has no prototype; the
 * painter only asks `key in props`.
 */
const parseKeys = (parsers: Record<string, Parser>, props: NumberedProps): NumberedProps => {
  const result: NumberedProps = Object.create(null)
  for (const [key, value] of Object.entries(props)) {
    const parse = Object.hasOwn(parsers, key) ? parsers[key] : undefined
    result[key] = parse ? parse(value) : value
  }
  return result
}

const VERTICAL = new Set(['y', 'y1', 'y2', 'height', 'cy', 'ry'])
const HORIZONTAL = new Set(['x', 'x1', 'x2', 'width', 'cx', 'rx'])

/** Percentages of positions and sizes, against the height or the width of the container. */
const withPercentsResolved = (container: SvgContainer, props: NumberedProps): NumberedProps =>
  Object.fromEntries(Object.entries(props).map(([key, value]) => {
    const fraction = percentOf(value)
    if (fraction !== undefined && VERTICAL.has(key)) return [key, fraction * container.height]
    if (fraction !== undefined && HORIZONTAL.has(key)) return [key, fraction * container.width]
    return [key, value]
  }))

const NUMBER_KEYS = ['x', 'x1', 'x2', 'y', 'y1', 'y2', 'r', 'rx', 'ry', 'cx', 'cy', 'width', 'height', 'fontSize', 'strokeWidth', 'strokeMiterlimit', 'strokeDashoffset']
const FRACTION_KEYS = ['offset', 'fillOpacity', 'opacity', 'strokeOpacity', 'stopOpacity']

/** The props of a drawn SVG element: numbers, fractions, colors and transforms parsed. */
export const parseElementProps = (container: SvgContainer, props: NumberedProps): NumberedProps => {
  return parseKeys({
    ...Object.fromEntries(NUMBER_KEYS.map(key => [key, parseNumber])),
    ...Object.fromEntries(FRACTION_KEYS.map(key => [key, parsePercent])),
    fill: parseColorOrUrl,
    stroke: parseColorOrUrl,
    stopColor: transformColor,
    transform: transformOf,
  }, withPercentsResolved(container, props))
}

const DEFS_FRACTION_KEYS = ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'fx', 'fy', 'r', 'offset', 'stopOpacity']

/**
 * The props of a gradient or stop in `<defs>`: coordinates stay fractions of
 * the shape they fill (`'50%'` gives 0.5), not points of the container.
 */
export const parseDefsProps = (props: NumberedProps): NumberedProps => parseKeys({
  ...Object.fromEntries(DEFS_FRACTION_KEYS.map(key => [key, parsePercent])),
  stopColor: transformColor,
}, props)

export type ViewBox = { minX: number, minY: number, maxX: number, maxY: number }

/**
 * `'0 0 100 50'` to its four numbers, read as admission reads them
 * (renderer/validate-props.ts, `viewBoxIsValid`): trimmed, split at commas
 * and whitespace.
 */
export const parseViewBox = (value: unknown): ViewBox | null => {
  if (typeof value !== 'string' || !value) return null
  const values = value.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4) return null
  const [minX, minY, maxX, maxY] = values as [number, number, number, number]
  return { minX, minY, maxX, maxY }
}

/** The props of the `<svg>` element itself: its size and view box parsed. */
export const parseSvgRootProps = (props: NumberedProps): NumberedProps => parseKeys({
  width: parseNumber,
  height: parseNumber,
  viewBox: parseViewBox,
}, props)

/** The SVG props the painter reads from the style. */
export const STYLE_PROPS = ['width', 'height', 'color', 'stroke', 'strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity', 'fill', 'fillRule', 'clipPath', 'offset', 'transform', 'strokeLinejoin', 'strokeLinecap', 'strokeDasharray', 'gradientUnits', 'gradientTransform', 'stopColor', 'stopOpacity']
