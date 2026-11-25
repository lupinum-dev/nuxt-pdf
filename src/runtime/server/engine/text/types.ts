// The shapes of the text layout (D36): what a
// text hands in (`Fragment`, `TextBox`, `TextOptions`) and the lines it gets
// back (`Line`, `Run`), which the painter, pagination and tagged output read.
import type { Font, Glyph, Position } from '../fonts'
import type { Bookmark } from '../layout/types'
import type { Decoration } from './decoration'
import type { PatternKey } from './hyphenation'
import type { ShapedRun } from './shape'

export type { Decoration, Font, Glyph, Position }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** An inline image: one U+FFFC character of a text, drawn at this size. */
export interface InlineImage {
  width: number
  height: number
  image: Buffer
  /** The structure index of its figure in a tagged document (`INLINE_FIGURE_PROP`). */
  figure?: number
}

/**
 * A leader (`PdfLeader`): one U+FFFC character of a text. The line breaker
 * joins it to the text on both sides, and after breaking it takes the room
 * its line has left (TeX's `\leaders \hfill`). The painter draws a line on
 * the baseline in its style, `before` points after its start and `after`
 * points before its end: its margins, which are its width before it grows.
 */
export interface Leader {
  style: 'solid' | 'dashed' | 'dotted'
  /** The thickness of the line, in points. */
  width: number
  color: string
  before: number
  after: number
}

/**
 * The `id` or the `bookmark` of a nested text, for a reader that places a
 * destination or an outline entry where that text starts (CONTRACTS.md, "A
 * run names where a nested text starts").
 */
export interface TextAnchor {
  readonly id?: string
  readonly bookmark?: Bookmark
}

/** The style of one stretch of text, as `layout/text/fragments.ts` and `layout/svg/text.ts` write it. */
export interface TextStyle {
  /** The families the text names, in order: font substitution takes the first font that has a character. */
  fonts: readonly Font[]
  fontSize: number
  /** Points. */
  lineHeight?: number
  color: string
  opacity?: number
  /** The painter draws the background of the outer text itself, so the outer text has none (`null`). */
  backgroundColor?: string | null
  characterSpacing?: number
  /** `'tabular-nums'` shapes with the font's `tnum` feature (`shape.ts`). */
  fontVariantNumeric?: 'normal' | 'tabular-nums'
  underline: boolean
  strike: boolean
  decorationStyle?: 'solid' | 'dashed' | 'dotted'
  underlineColor: string
  strikeColor: string
  /** The target of the innermost link around the text (an outer link wins); see CONTRACTS.md, "A run names its link". */
  link?: string
  align?: 'left' | 'right' | 'center' | 'justify'
  /** `'pretty'` adds demerits for a short last line and for hyphens the line breaker should avoid (`break.ts`); read from a paragraph's first run, as `align`. */
  textWrap?: 'wrap' | 'pretty'
  /** Points the run's baseline sits above the line's (`verticalAlign`), negative below it; 0 or unset on the line's. */
  baselineShift?: number
  /**
   * The `baselineShift` and the font size of the outermost text that sets
   * the underline: an underline is drawn at that text's baseline and in its
   * thickness, as CSS draws it for the decorating box, so 'x²' underlined as
   * a whole keeps one line and an underlined mark has its line under it.
   */
  underlineShift?: number
  underlineSize?: number
  /** Only on a fragment that is one U+FFFC character. */
  attachment?: InlineImage
  /** Only on a fragment that is one U+FFFC character. */
  leader?: Leader
  /**
   * Only on the first fragment of a nested text with an `id` or a
   * `bookmark`: those of every nested text that starts there, the outer one
   * first.
   */
  anchors?: readonly TextAnchor[]
}

export interface Fragment {
  readonly string: string
  readonly style: TextStyle
}

/** The box a text is laid out in. `height` Infinity: unbounded. */
export interface TextBox {
  x: number
  y: number
  width: number
  height: number
  maxLines?: number
  truncate?: 'ellipsis'
}

export interface TextOptions {
  /** False keeps every word whole: no automatic hyphenation, and soft hyphens are no break points. */
  hyphenate: boolean
  /**
   * The pattern file of the document's language (`patternKeyOf`), loaded
   * with `loadHyphenation` before the layout. Without it a word breaks only
   * at its soft hyphens.
   */
  patterns?: PatternKey
  hyphenationPenalty?: number
}

/**
 * A run of a line: one font, one bidi level, shaped, with its sizes in
 * points. `start` and `end` are offsets in `Line.string`. Its attributes are
 * the style of its text after itemization (`RunStyle`, attributed.ts).
 */
export interface Run extends ShapedRun {
  xAdvance: number
  height: number
  ascent: number
  descent: number
}

/**
 * One line. `string` has no `\n` and no soft hyphens, keeps trailing spaces,
 * and ends with an added `-` where the breaker split a word (CONTRACTS.md,
 * "Lines of a text"). A right-to-left line holds its characters in visual
 * order. Its spaces at both ends lie outside its box by `overflowLeft` and
 * `overflowRight`.
 */
export interface Line {
  string: string
  runs: Run[]
  box: Rect
  ascent: number
  descent: number
  /** How far the baseline lies below the top of `box`, with the half-leading (`baselineOf`). */
  baseline: number
  height: number
  xAdvance: number
  overflowLeft: number
  overflowRight: number
  decorationLines: Decoration[]
  /** The last line of its paragraph, aligned by `alignLastLine`. */
  isLast: boolean
  /** The width that justification spread between its glyphs; 0 when it is not justified. */
  spread: number
}
