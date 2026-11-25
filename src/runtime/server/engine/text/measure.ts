// Content widths of a text, for automatic table columns (D39): the pipeline of
// `layoutParagraphs` up to shaping, then the nodes the line breaker reads
// (break.ts), so the widths are the breaker's own sums. It shapes the same
// run strings as the layout of the same text, so the shaping cache of the
// render serves both (fonts.ts) and `runsShaped` does not grow.
import { fromFragments, splitParagraphs } from './attributed'
import { breakNodes, breaksAt, type BreakNode } from './break'
import { decomposeUnicode, itemize, mirror } from './itemize'
import { shape } from './shape'
import type { Fragment, TextOptions } from './types'
import { wordPartsOf } from './hyphenation'
import { wrapWords } from './words'

/**
 * The widths of one paragraph's nodes: on one line, the sum the breaker
 * reaches at the forced break that ends the paragraph; and the widest piece
 * between two breaks, with the hyphen of a break inside a word, the least a
 * line must hold. A piece is a box, or boxes joined across a leader: the
 * glue after a penalty that forbids a break counts until the next box.
 */
const widthsOf = (nodes: readonly BreakNode[]): { maxContent: number, minContent: number } => {
  let line = 0
  let widest = 0
  let piece = 0
  let joined = false
  nodes.forEach((node, index) => {
    if (node.type !== 'penalty') line += node.width
    if (node.type === 'box') {
      piece += node.width
      joined = false
    }
    else if (breaksAt(nodes, index)) {
      widest = Math.max(widest, piece + (node.type === 'penalty' ? node.width : 0))
      piece = 0
    }
    else if (node.type === 'penalty') {
      joined = true
    }
    else if (joined) {
      piece += node.width
    }
  })
  return { maxContent: line, minContent: widest }
}

/**
 * How wide `fragments` are, in points, at the most and at the least:
 *
 * - `maxContent`: the widest paragraph on one line, without the spaces at
 *   its start and end, which the line breaker gives no room (`breakNodes`).
 * - `minContent`: the widest piece between two places where the line
 *   breaker may break, with the hyphen it adds when it breaks inside a word.
 *   With `options.hyphenate` false a piece reaches from one break of
 *   UAX #14 to the next (`breakOpportunities`): a word, a word up to its
 *   hyphen or slash, one ideograph; also across two runs with no space
 *   between. With it true, each syllable of the whole word is a piece,
 *   as the line breaker sees it.
 *
 * Letter spacing counts, an inline image counts at its width, a leader at
 * its margins with the word before it and the text after it, and a
 * paragraph ends at each line break. A text no wider than `minContent`
 * breaks without overflowing a line; one `maxContent` wide fits on one line
 * per paragraph.
 */
export const measureParagraphs = (fragments: readonly Fragment[], options: TextOptions): { maxContent: number, minContent: number } =>
  splitParagraphs(decomposeUnicode(fromFragments(fragments)))
    .map(paragraph => widthsOf(breakNodes(shape(wrapWords(mirror(itemize(paragraph)), wordPartsOf(options.hyphenate, options.patterns))))))
    .reduce((widths, paragraph) => ({
      maxContent: Math.max(widths.maxContent, paragraph.maxContent),
      minContent: Math.max(widths.minContent, paragraph.minContent),
    }), { maxContent: 0, minContent: 0 })
