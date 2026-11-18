import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'

/**
 * An exact decimal number: `units / 10^scale`. Invoice amounts must not pass
 * through binary floating point, so every sum, product and rounding step works
 * on these scaled integers.
 */
export interface Decimal {
  readonly units: bigint
  readonly scale: number
}

/** An amount, quantity, price or rate as the author writes it. */
export type DecimalInput = number | string

// A plain decimal: optional minus, digits, optional fraction. No `+`, no
// exponent, no leading or trailing dot, no spaces, no thousands separators.
const PLAIN_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

const POWERS: bigint[] = [1n]
const power = (exponent: number): bigint => {
  for (let index = POWERS.length; index <= exponent; index += 1) POWERS.push(POWERS[index - 1]! * 10n)
  return POWERS[exponent]!
}

/**
 * A malformed invoice value: `PDF_INVOICE_INVALID` with one `PDF-VALUE` issue,
 * the same issue `validateEInvoice` reports for it, so a caller handles every
 * invalid invoice through `error.issues`.
 */
export const invalidInvoiceValue = (field: string, message: string): NuxtPdfError => {
  const text = `${field} ${message}`
  return new NuxtPdfError(PDF_ERROR_CODES.InvoiceInvalid, text, { issues: [{ rule: 'PDF-VALUE', path: field, message: text }] })
}

const invalid = invalidInvoiceValue

/**
 * Read an author value. A number is read through its shortest decimal form
 * (`String(0.1)` is `"0.1"`), so `0.1` is exactly one tenth. A string must be
 * a plain decimal such as `"12.50"` or `"-3"`. NaN, Infinity, exponent forms
 * (also numbers JavaScript prints with one, such as `1e21` or `1e-7`) and more
 * than `maxDecimals` fraction digits fail with `PDF_INVOICE_INVALID` and an
 * issue that names the field.
 */
export const parseDecimal = (value: DecimalInput, field: string, maxDecimals: number): Decimal => {
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(field, `must be a finite number, got ${String(value)}.`)
    text = String(value)
  }
  else if (typeof value === 'string') {
    text = value
  }
  else {
    throw invalid(field, `must be a number or a decimal string, got ${typeof value}.`)
  }
  const match = PLAIN_DECIMAL.exec(text)
  if (match === null) {
    throw invalid(field, `must be a plain decimal such as "12.50", got ${JSON.stringify(text)}.`)
  }
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > maxDecimals) {
    throw invalid(field, `allows at most ${maxDecimals} decimals, got ${JSON.stringify(text)}.`)
  }
  const units = BigInt(`${whole}${fraction}`)
  return { units: sign === '-' ? -units : units, scale: fraction.length }
}

export const decimal = (units: bigint, scale = 0): Decimal => ({ units, scale })

export const ZERO: Decimal = decimal(0n)

const rescale = (value: Decimal, scale: number): bigint => value.units * power(scale - value.scale)

export const add = (left: Decimal, right: Decimal): Decimal => {
  const scale = Math.max(left.scale, right.scale)
  return { units: rescale(left, scale) + rescale(right, scale), scale }
}

export const negate = (value: Decimal): Decimal => ({ units: -value.units, scale: value.scale })

export const subtract = (left: Decimal, right: Decimal): Decimal => add(left, negate(right))

export const multiply = (left: Decimal, right: Decimal): Decimal =>
  ({ units: left.units * right.units, scale: left.scale + right.scale })

export const sum = (values: readonly Decimal[]): Decimal => values.reduce(add, ZERO)

/**
 * `numerator / denominator` rounded to `scale` decimals, half away from zero
 * (0.005 becomes 0.01 and -0.005 becomes -0.01). This is the commercial
 * "half up" rule of EN 16931, applied to the magnitude so that a negated
 * invoice gives exactly the negated numbers.
 */
export const divideRounded = (numerator: Decimal, denominator: Decimal, scale: number): Decimal => {
  if (denominator.units === 0n) throw new RangeError('Division by zero.')
  // value = (n.units / 10^n.scale) / (d.units / 10^d.scale); scaled by 10^scale.
  let top = numerator.units * power(denominator.scale + scale)
  let bottom = denominator.units * power(numerator.scale)
  if (bottom < 0n) {
    top = -top
    bottom = -bottom
  }
  const negative = top < 0n
  const magnitude = negative ? -top : top
  let quotient = magnitude / bottom
  if ((magnitude % bottom) * 2n >= bottom) quotient += 1n
  return { units: negative ? -quotient : quotient, scale }
}

/** Round to `scale` decimals, half away from zero. */
export const round = (value: Decimal, scale: number): Decimal => divideRounded(value, decimal(1n), scale)

export const isZero = (value: Decimal): boolean => value.units === 0n

export const compare = (left: Decimal, right: Decimal): number => {
  const difference = subtract(left, right).units
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

/**
 * The decimal string. With `decimals`, exactly that many fraction digits (the
 * value is rounded half away from zero first). Without, the shortest exact
 * form: no trailing zeros, no dot for a whole number.
 */
export const formatDecimal = (value: Decimal, decimals?: number): string => {
  let { units, scale } = decimals === undefined ? value : round(value, decimals)
  if (decimals === undefined) {
    while (scale > 0 && units % 10n === 0n) {
      units /= 10n
      scale -= 1
    }
  }
  const negative = units < 0n
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** An amount with exactly two decimals, the format of every EN 16931 amount. */
export const formatAmount = (value: Decimal): string => formatDecimal(value, 2)
