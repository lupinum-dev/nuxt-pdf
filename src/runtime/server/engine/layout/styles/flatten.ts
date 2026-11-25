/** A style object, or a style array that may nest and hold `false`, `null` or `undefined`. */
export type StyleEntry = object | readonly StyleEntry[] | false | null | undefined

/**
 * One style object from a style or a style array: later entries win, a key
 * that holds `null` or `undefined` is skipped, and `false`, `null` and
 * `undefined` entries add nothing. A key keeps the place where it was first
 * set.
 */
export const flattenStyle = (style: StyleEntry): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  const merge = (entry: StyleEntry): void => {
    if (Array.isArray(entry)) {
      for (const item of entry) merge(item)
      return
    }
    if (!entry) return
    for (const [key, value] of Object.entries(entry)) {
      if (value !== null && value !== undefined) result[key] = value
    }
  }
  merge(style)
  return result
}
