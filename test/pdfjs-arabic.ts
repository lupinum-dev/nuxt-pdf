/**
 * The letters of a pdf.js reading of Arabic text, as a multiset: C0 control
 * characters and white space removed, the rest sorted. pdf.js reads a glyph
 * that maps to no characters (Noto Sans Arabic draws the dot of ب as one) as
 * a control character, and splits and reorders the words around it. So a
 * pdf.js reading of text in such a font is compared by its letters only,
 * which still shows a dropped or doubled glyph; Poppler holds the exact
 * text (`test/invariants/invariants.test.ts`).
 */
export const pdfjsArabicLetters = (text: string): string =>
  [...text].filter(character => character > '\u001F' && !/\s/.test(character)).sort().join('')
