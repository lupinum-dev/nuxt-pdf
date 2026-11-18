import { describe, expect, it } from 'vitest'
import {
  add,
  decimal,
  divideRounded,
  formatAmount,
  formatDecimal,
  multiply,
  parseDecimal,
} from '../../src/runtime/einvoice/decimal'
import { NuxtPdfError } from '../../src/runtime/shared/errors'

const value = (input: number | string, maxDecimals = 6): string => formatDecimal(parseDecimal(input, 'field', maxDecimals))

describe('parseDecimal', () => {
  // Catches reading a number through binary floating point: 1.005 would
  // become 1.00499999999999989… and later round down.
  it.each([
    [0.1, '0.1'],
    [1.005, '1.005'],
    [149.9, '149.9'],
    [-3, '-3'],
    [1e20, '100000000000000000000'],
    ['12.50', '12.5'],
    ['-0.005', '-0.005'],
    ['007', '7'],
  ])('reads %j exactly as %s', (input, expected) => {
    expect(value(input)).toBe(expected)
  })

  // Catches accepting forms a template would print differently from the XML.
  it.each([
    [Number.NaN, 'must be a finite number'],
    [Number.POSITIVE_INFINITY, 'must be a finite number'],
    [1e21, 'must be a plain decimal'],
    [1e-7, 'must be a plain decimal'],
    ['1e3', 'must be a plain decimal'],
    ['+1', 'must be a plain decimal'],
    ['.5', 'must be a plain decimal'],
    ['1.', 'must be a plain decimal'],
    [' 1', 'must be a plain decimal'],
    ['1,5', 'must be a plain decimal'],
    ['', 'must be a plain decimal'],
    ['1.234', 'allows at most 2 decimals'],
    [0.125, 'allows at most 2 decimals'],
  ])('rejects %j', (input, message) => {
    expect(() => parseDecimal(input, 'invoice.lines[0].netPrice', 2)).toThrowError(NuxtPdfError)
    expect(() => parseDecimal(input, 'invoice.lines[0].netPrice', 2)).toThrowError(`invoice.lines[0].netPrice ${message}`)
  })
})

describe('arithmetic', () => {
  // Catches float addition (0.1 + 0.2 = 0.30000000000000004).
  it('adds and multiplies exactly', () => {
    expect(formatDecimal(add(parseDecimal(0.1, 'a', 2), parseDecimal(0.2, 'b', 2)))).toBe('0.3')
    expect(formatDecimal(multiply(parseDecimal('1234.5', 'a', 4), parseDecimal('0.28375', 'b', 6)))).toBe('350.289375')
  })

  // Catches banker's rounding (0.125 → 0.12), truncation, and rounding
  // negative halves toward zero (which would make a negated invoice differ).
  it.each([
    ['0.005', '1', '0.01'],
    ['0.004999', '1', '0.00'],
    ['0.125', '1', '0.13'],
    ['-0.005', '1', '-0.01'],
    ['-0.125', '1', '-0.13'],
    ['1', '3', '0.33'],
    ['2', '3', '0.67'],
    ['-2', '3', '-0.67'],
    ['2', '-3', '-0.67'],
    ['29.85', '100', '0.30'],
  ])('%s ÷ %s rounds half away from zero to %s', (numerator, denominator, expected) => {
    expect(formatAmount(divideRounded(parseDecimal(numerator, 'n', 6), parseDecimal(denominator, 'd', 6), 2))).toBe(expected)
  })
})

describe('formatDecimal', () => {
  // Catches losing the sign, the leading zero or the padding of amounts.
  it.each([
    [decimal(14990n, 2), undefined, '149.9'],
    [decimal(30n, 2), undefined, '0.3'],
    [decimal(500n, 2), undefined, '5'],
    [decimal(-5n, 2), undefined, '-0.05'],
    [decimal(0n), 2, '0.00'],
    [decimal(-5n, 1), 2, '-0.50'],
    [decimal(1005n, 3), 2, '1.01'],
    [decimal(7n), 2, '7.00'],
  ])('formats %o with %s decimals as %s', (input, decimals, expected) => {
    expect(formatDecimal(input, decimals)).toBe(expected)
  })
})
