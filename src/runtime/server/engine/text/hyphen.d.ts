declare module 'hyphen' {
  /**
   * A pattern file of `hyphen/patterns/`: its levels and patterns, opaque,
   * and its exceptions (word to markers), which a hyphenator writes every
   * word it splits into.
   */
  export type HyphenationPatterns = readonly [levels: unknown, patterns: unknown, exceptions?: Readonly<Record<string, unknown>>]
  /**
   * A synchronous hyphenator: the text with a soft hyphen (U+00AD) at every
   * hyphenation point. hyphen 1.14 ships no types.
   */
  export default function hyphen(patterns: HyphenationPatterns): (text: string) => string
}

declare module 'hyphen/patterns/*.js' {
  import type { HyphenationPatterns } from 'hyphen'

  const patterns: HyphenationPatterns
  export default patterns
}
