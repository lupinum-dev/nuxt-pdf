declare module 'bidi-js' {
  /** The levels of a string: one per UTF-16 code unit. */
  export interface EmbeddingLevels {
    levels: Uint8Array
  }
  /** The levels of a line, for reordering: one per UTF-16 code unit, and its paragraphs. */
  export interface LineLevels {
    paragraphs: ReadonlyArray<{ start: number, end: number, level: number }>
    levels: ArrayLike<number>
  }
  export interface Bidi {
    getEmbeddingLevels(string: string, baseDirection?: 'ltr' | 'rtl'): EmbeddingLevels
    /** The ranges, first and last code unit, that rule L2 reverses, in the order it reverses them. */
    getReorderSegments(string: string, levels: LineLevels): Array<[number, number]>
    /** The string in visual order, with the characters at odd levels mirrored. */
    getReorderedString(string: string, levels: LineLevels): string
    /** The mirrored character of a bracket or similar character, else null. */
    getMirroredCharacter(char: string): string | null
  }
  /** bidi-js 1.0 ships no types; these are the calls the text layout makes. */
  export default function bidiFactory(): Bidi
}

declare module 'unicode-properties' {
  /** unicode-properties 1.4 ships no types; these are the calls the text layout makes. */
  const unicode: {
    /** The script name of a code point, such as `Latin`, `Common` or `Unknown`. */
    getScript(codePoint: number): string
    /** The general category of a code point, such as `Lu`, `Cc` or `Zs`. */
    getCategory(codePoint: number): string
  }
  export default unicode
}
