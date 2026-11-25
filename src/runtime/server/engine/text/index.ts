// The text layout: fragments in, lines out (D36).
// One fixed pipeline of direct calls, in the order of React PDF textkit's
// `layoutEngine`, whose results it reproduced to the last bit.
import { fromFragments, splitParagraphs } from './attributed'
import { decomposeUnicode, itemize, mirror } from './itemize'
import { finishLine, typeset } from './lines'
import { reorderLine } from './reorder'
import { shape } from './shape'
import type { Fragment, Line, TextBox, TextOptions } from './types'
import { wordPartsOf } from './hyphenation'
import { wrapWords } from './words'

export type { Decoration, Font, Fragment, Glyph, InlineImage, Leader, Line, Position, Rect, Run, TextAnchor, TextBox, TextOptions, TextStyle } from './types'
export { DEFAULT_FONT_SIZE } from './attributed'
export { lacksPatterns, loadHyphenation, patternKeyOf, type PatternKey } from './hyphenation'
export { measureParagraphs } from './measure'

/**
 * The lines of `fragments` in `box`, and how many more lines the box's height
 * cut off (`hiddenLines`, not drawn; lines past `maxLines` are not counted).
 */
export const fitParagraphs = (fragments: readonly Fragment[], box: TextBox, options: TextOptions): { lines: Line[], hiddenLines: number } => {
  const paragraphs = splitParagraphs(decomposeUnicode(fromFragments(fragments)))
    .map(paragraph => shape(wrapWords(mirror(itemize(paragraph)), wordPartsOf(options.hyphenate, options.patterns))))
  const { blocks, hidden } = typeset(paragraphs, box, options)
  return { lines: blocks.flatMap(lines => lines.map((line, index) => finishLine(reorderLine(line), index === lines.length - 1))), hiddenLines: hidden }
}

/** The lines of `fragments` in `box`. */
export const layoutParagraphs = (fragments: readonly Fragment[], box: TextBox, options: TextOptions): Line[] => fitParagraphs(fragments, box, options).lines
