import { describePdfValue } from './describe-value'

/**
 * The longest wait Node's `setTimeout` honours. A longer delay warns
 * `TimeoutOverflowWarning` and fires after 1 ms, so a time limit above it
 * would fail every render at once.
 */
export const MAX_TIME_LIMIT_MS = 2_147_483_647

/**
 * Check one configured limit: a whole number from 1 to `max`. `name` is the
 * option as the author wrote it, such as `pdf.limits.timeoutMs`. A value
 * outside the range fails; it is never clamped, because a clamp would hide a
 * configuration mistake.
 */
export const checkLimitValue = (value: unknown, name: string, max: number, unit = ''): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(
      `${name} must be a whole number from 1 to ${max.toLocaleString('en-US')}${unit}, found ${describePdfValue(value)}.`,
    )
  }
  return value
}
