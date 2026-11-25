// Words and syllables: the paragraph split at the places where a line may
// break (UAX #14, from `linebreak`, D44), each word into the parts the
// line breaker may hyphenate between (after textkit's `wrapWords` and
// `wordHyphenation`, with words across runs).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./linebreak.d.ts" />
import LineBreaker, { type Break } from 'linebreak'
import type { Paragraph } from './attributed'
import type { WordParts } from './hyphenation'

const SOFT_HYPHEN = '\u00AD'

/**
 * A paragraph with its syllables: the words and spaces, each word split into
 * the parts the breaker may break between, in string order.
 */
export interface WrappedParagraph extends Paragraph {
  syllables: string[]
  /**
   * The offsets in `string` between two words with no space between them
   * where a line may break with no hyphen: between two ideographs, after a
   * hyphen, a slash or a zero-width space, next to an inline image.
   */
  opportunities: ReadonlySet<number>
}

/**
 * The places where a line may start in `string` (UAX #14): after spaces,
 * between ideographs, after a hyphen, a slash or a zero-width space, and
 * where a line must start (`required`), after a line feed, a carriage
 * return, a line or paragraph separator. Never inside a surrogate pair, at
 * a no-break space or a word joiner, or before closing punctuation. The end
 * of the string is no place.
 */
export const breakOpportunities = (string: string): Break[] => {
  const breaks: Break[] = []
  const breaker = new LineBreaker(string)
  for (let found = breaker.nextBreak(); found; found = breaker.nextBreak()) {
    if (found.position < string.length) breaks.push(found)
  }
  return breaks
}

/**
 * The paragraph's words, each split into syllables, and its string and runs
 * without soft hyphens (the runs move up). A word ends where a line may
 * break (`breakOpportunities`), before the spaces that end it; the spaces
 * are a syllable of their own. A run boundary is no break, so a word that
 * goes on in the next run (a footnote mark, a link or a bold part inside a
 * word) is one word. The break UAX #14 gives after a soft hyphen is no
 * word end: it is a hyphen point of `wordParts` (it adds a hyphen, and
 * `hyphenate: false` drops it). A leader's U+FFFC is a word of its own, but
 * `breakNodes` breaks on neither side of it. Each word is split by
 * `wordParts` (`wordPartsOf`), a word of an address only at its soft
 * hyphens (`addressesOf`); without `wordParts`, a word is one syllable.
 */
/**
 * Where an e-mail address or a URL lies in `source`: the text between two
 * spaces that holds `@` or `://`. Its words split only at soft hyphens, as
 * a hyphen would change the address (`hello@ex-ample.com`).
 */
const addressesOf = (source: string): Array<[start: number, end: number]> =>
  [...source.matchAll(/\S+/g)]
    .filter(([token]) => token.includes('@') || token.includes('://'))
    .map(match => [match.index, match.index + match[0].length])

export const wrapWords = (paragraph: Paragraph, wordParts: WordParts | undefined): WrappedParagraph => {
  const source = paragraph.string
  const addresses = addressesOf(source)
  const inAddress = (position: number): boolean => addresses.some(([start, end]) => position >= start && position < end)
  const ends = breakOpportunities(source)
    .map(({ position }) => position)
    .filter(position => source[position - 1] !== SOFT_HYPHEN)
  const syllables: string[] = []
  const opportunities = new Set<number>()
  let length = 0
  let from = 0
  for (const to of [...ends, source.length]) {
    const pieces = source.slice(from, to).split(/( +)/g).filter(Boolean)
    // Spaces with more of the word after them are no place to break (such
    // as before "!" in French): they stay in the word.
    const words: string[] = []
    pieces.forEach((piece, index) => {
      const previous = words.at(-1)
      if (previous !== undefined && previous.trim() !== '' && (piece.trim() !== '' || pieces[index + 1]?.trim())) words[words.length - 1] = previous + piece
      else words.push(piece)
    })
    let at = from
    words.forEach((word, index) => {
      const start = at
      at += word.length
      if (word.trim() === '') {
        syllables.push(word)
        length += word.length
        return
      }
      if (index === 0 && syllables.length > 0 && syllables.at(-1)!.trim() !== '') opportunities.add(length)
      const parts = !wordParts ? [word] : inAddress(start + word.length - word.trimStart().length) ? word.split(SOFT_HYPHEN) : wordParts(word)
      for (const part of parts) {
        const kept = part.replaceAll(SOFT_HYPHEN, '')
        syllables.push(kept)
        length += kept.length
      }
    })
    from = to
  }
  const runs: Paragraph['runs'] = []
  let string = ''
  for (const run of paragraph.runs) {
    const kept = source.slice(run.start, run.end).replaceAll(SOFT_HYPHEN, '')
    runs.push({ ...run, start: string.length, end: string.length + kept.length })
    string += kept
  }
  return { string, runs, syllables, opportunities }
}
