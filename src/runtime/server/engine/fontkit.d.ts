declare module 'fontkit' {
  /**
   * Parses the bytes of a font file. fontkit 2.0 ships no types; the font it
   * returns is a `FontkitFont` (engine/fonts.ts), whose readers each name the
   * fields they read.
   */
  export function create(buffer: Uint8Array, postscriptName?: string): object
}
