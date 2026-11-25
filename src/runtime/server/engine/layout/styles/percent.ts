// A percentage in every form admission takes (shared/style-values.ts,
// `PDF_PERCENTAGE`, for styles; renderer/validate-props.ts, `SVG_NUMBER`, for
// SVG attributes, which also allows a sign, an exponent and a trailing dot):
// the whole value, after `percentNumberOf` trims the whitespace around it.
const PERCENT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%$/i

/** The number before the `%` of a percentage (`'50%'` gives 50); undefined for any other value. */
export const percentNumberOf = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return PERCENT.test(text) ? Number.parseFloat(text) : undefined
}

/** The fraction a percentage stands for (`'50%'` gives 0.5); undefined for any other value. */
export const percentOf = (value: unknown): number | undefined => {
  const number = percentNumberOf(value)
  return number === undefined ? undefined : number / 100
}

/**
 * `value` with a percentage resolved against `base`. Other values stay as
 * they are. `base` may be a string or missing: `*` coerces it as before, and a
 * missing base gives NaN.
 */
export const resolvePercent = <Value>(value: Value, base: unknown): Value | number => {
  const fraction = percentOf(value)
  return fraction === undefined ? value : fraction * Number(base)
}
