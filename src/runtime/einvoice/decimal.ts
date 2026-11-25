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

// `BigInt(…)` instead of literals such as `10n`: Nitro 2 transforms
// TypeScript outside node_modules with esbuild for target es2019, which warns
// "Big integer literals are not available" once per literal (playground and
// linked checkouts). Node runs the literals; the warning is only noise.
const BIG_0 = BigInt(0)
const BIG_1 = BigInt(1)
const BIG_2 = BigInt(2)
const BIG_10 = BigInt(10)

const POWERS: bigint[] = [BIG_1]
const power = (exponent: number): bigint => {
  for (let index = POWERS.length; index <= exponent; index += 1) POWERS.push(POWERS[index - 1]! * BIG_10)
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
    if (!Number.isFinite(value)) throw invalidInvoiceValue(field, `must be a finite number, got ${String(value)}.`)
    text = String(value)
  }
  else if (typeof value === 'string') {
    text = value
  }
  else {
    throw invalidInvoiceValue(field, `must be a number or a decimal string, got ${typeof value}.`)
  }
  const match = PLAIN_DECIMAL.exec(text)
  if (match === null) {
    throw invalidInvoiceValue(field, `must be a plain decimal such as "12.50", got ${JSON.stringify(text)}.`)
  }
  const [, sign, whole, fraction = ''] = match
  if (fraction.length > maxDecimals) {
    throw invalidInvoiceValue(field, `allows at most ${maxDecimals} decimals, got ${JSON.stringify(text)}.`)
  }
  const units = BigInt(`${whole}${fraction}`)
  return { units: sign === '-' ? -units : units, scale: fraction.length }
}

export const decimal = (units: bigint, scale = 0): Decimal => ({ units, scale })

export const ZERO: Decimal = decimal(BIG_0)

const rescale = (value: Decimal, scale: number): bigint => value.units * power(scale - value.scale)

export const add = (left: Decimal, right: Decimal): Decimal => {
  const scale = Math.max(left.scale, right.scale)
  return { units: rescale(left, scale) + rescale(right, scale), scale }
}

const negate = (value: Decimal): Decimal => ({ units: -value.units, scale: value.scale })

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
  if (denominator.units === BIG_0) throw new RangeError('Division by zero.')
  // value = (n.units / 10^n.scale) / (d.units / 10^d.scale); scaled by 10^scale.
  let top = numerator.units * power(denominator.scale + scale)
  let bottom = denominator.units * power(numerator.scale)
  if (bottom < BIG_0) {
    top = -top
    bottom = -bottom
  }
  const negative = top < BIG_0
  const magnitude = negative ? -top : top
  let quotient = magnitude / bottom
  if ((magnitude % bottom) * BIG_2 >= bottom) quotient += BIG_1
  return { units: negative ? -quotient : quotient, scale }
}

/** Round to `scale` decimals, half away from zero. */
export const round = (value: Decimal, scale: number): Decimal => divideRounded(value, decimal(BIG_1), scale)

export const compare = (left: Decimal, right: Decimal): number => {
  const difference = subtract(left, right).units
  return difference === BIG_0 ? 0 : difference < BIG_0 ? -1 : 1
}

/**
 * The decimal string. With `decimals`, exactly that many fraction digits (the
 * value is rounded half away from zero first). Without, the shortest exact
 * form: no trailing zeros, no dot for a whole number.
 */
export const formatDecimal = (value: Decimal, decimals?: number): string => {
  let { units, scale } = decimals === undefined ? value : round(value, decimals)
  if (decimals === undefined) {
    while (scale > 0 && units % BIG_10 === BIG_0) {
      units /= BIG_10
      scale -= 1
    }
  }
  const negative = units < BIG_0
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** An amount with exactly two decimals, the format of every EN 16931 amount. */
export const formatAmount = (value: Decimal): string => formatDecimal(value, 2)
