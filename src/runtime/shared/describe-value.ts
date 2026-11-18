/** The longest value an error message shows; a longer string is cut. */
const MAX_SHOWN_LENGTH = 40

/**
 * A wrong value for an error message: a string quoted and cut at 40
 * characters, a number or boolean as written, other values by kind. Never
 * pass a password or the text content of a node: messages reach logs.
 */
export function describePdfValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value.length > MAX_SHOWN_LENGTH ? `${value.slice(0, MAX_SHOWN_LENGTH - 3)}...` : value)
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return 'an array'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'an Invalid Date' : 'a Date'
  return value === null ? 'null' : typeof value === 'object' ? 'an object' : value === undefined ? 'undefined' : `a ${typeof value}`
}
