/**
 * `textTransform` applied to one string, the one copy of this rule: the
 * tagged writer reads it to map painted text back to its source. `capitalize`
 * upper-cases the first character after the start and after each whitespace,
 * so `(a)` stays `(a)`, where CSS gives `(A)`; `upperfirst` only the first
 * character of the string.
 */
export const transformText = (text: string, transform: unknown): string => {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/(^|\s)\S/g, letter => letter.toUpperCase())
  if (transform === 'upperfirst') return text.charAt(0).toUpperCase() + text.slice(1)
  return text
}
