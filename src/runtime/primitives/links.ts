// Links, notes, footnotes and the contents.
import type { PdfStyle } from '../authoring'
import type { PdfBaseProps } from './shared'
import { BASE_PROPS, PDF_FOOTNOTE_REPEAT_PROP, boolean, primitive, required } from './spec'
import type { PdfLeaderStyle } from './tokens'

/**
 * The three styles of footnotes, one place for all of them (`PdfDocument`
 * `footnoteStyles`), each merged over its default.
 */
export type PdfFootnoteStyles = {
  /** The number in the text, and the number at the start of the note. Default: raised, at 70 % of the text size. */
  mark?: PdfStyle
  /** Each note. */
  note?: PdfStyle
  /**
   * The box at the bottom of a page that holds its rule and notes, as any
   * view: `marginTop` is the least space above it, `gap` the space between
   * notes, and its text keys are inherited by the notes. Default: 8 pt above
   * it, the notes at 85 % of the page's text size.
   */
  area?: PdfStyle
  /**
   * The rule at the top of the area, a view above the notes, or `false` for
   * none. Default: a 0.5 pt line over a third of the width, 4 pt above the
   * notes.
   */
  rule?: PdfStyle | false
}

export type PdfLinkProps = PdfBaseProps & {
  /**
   * Link target. A string starting with `#` jumps to the element whose `id`
   * matches the rest of the string; every other value opens as an external URL.
   */
  href: string
  wrap?: boolean
  hitSlop?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
}

export type PdfNoteProps = PdfBaseProps

/**
 * A footnote. Its content is the note: text, nested `PdfText`, `PdfLink` and
 * `PdfPageRef`. The note prints at the bottom of the page that holds the
 * footnote's place, and a number marks that place. Only inside a `PdfText`.
 * It takes no style: `PdfDocument` `footnoteStyles` styles every footnote.
 */
export type PdfFootnoteProps = Record<never, never>

/**
 * The style of the title or the page number of a `PdfContents` entry: text
 * inside the entry's line, so only the keys that style characters.
 */
export type PdfContentsTextStyle = Pick<PdfStyle, typeof PDF_CONTENTS_TEXT_STYLE_KEYS[number]>

/** The keys of `PdfContentsTextStyle`. */
export const PDF_CONTENTS_TEXT_STYLE_KEYS = [
  'backgroundColor',
  'color',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'opacity',
  'textDecoration',
  'textDecorationColor',
  'textDecorationStyle',
  'textTransform',
  'verticalAlign',
] as const satisfies readonly (keyof PdfStyle)[]

/** The parts of a `PdfContents` entry that `styles` sets, each merged over its default. */
export type PdfContentsStyles = {
  /** Each entry: one link around the line of title, leader and page number. */
  entry?: PdfStyle
  /** The title of each entry. */
  title?: PdfContentsTextStyle
  /** The leader between the title and the page number: a `PdfLeader`. Default: a dotted line on the baseline. */
  leader?: PdfLeaderStyle
  /** The page number. It ends at the right edge of the entry. */
  page?: PdfContentsTextStyle
  /** The entries of the first level. Default: bold, with space above. */
  level1?: PdfStyle
  /** The entries of each deeper level. Default: indented by 1.5 em per level. */
  level2?: PdfStyle
  level3?: PdfStyle
  level4?: PdfStyle
  level5?: PdfStyle
  level6?: PdfStyle
}

/**
 * A table of contents: one entry for each outline entry (each `bookmark`),
 * in outline order, as a link to its place with its page number. A block in
 * the page flow.
 */
export type PdfContentsProps = {
  /** How many outline levels it lists, from 1 to 6. Default 3. */
  levels?: number
  /** The leader between a title and its page number. Default `'dots'`. */
  leader?: 'dots' | 'none'
  styles?: PdfContentsStyles
}

/**
 * The start of the destination id of a footnote's note: the engine
 * adapter names the n-th note of a document `__nuxtPdfFootnote-<n>`, and the
 * id check keeps an author's id from starting with it.
 */
export const PDF_FOOTNOTE_ID_PREFIX = '__nuxtPdfFootnote-'

/**
 * The start of the destination id the engine adapter gives a node that a
 * `PdfContents` lists and that has no id of its own: `__nuxtPdfContents-<n>`
 * for the n-th entry of the document. The id check keeps an author's id from
 * starting with it.
 */
export const PDF_CONTENTS_ID_PREFIX = '__nuxtPdfContents-'

/**
 * Prop on the views that the engine adapter writes for a `PdfContents`
 * (server/engine/contents.ts): the structure element each one is in a tagged
 * document (`TOC`, `TOCI`, `Reference`). Authors cannot set it: the adapter
 * writes these views after the tree is validated.
 */
export const PDF_CONTENTS_PART_PROP = '__nuxtPdfContentsPart'

/** The outline levels a `PdfContents` lists at most. */
export const PDF_CONTENTS_MAX_LEVELS = 6

/**
 * The title a `PdfContents` lists for a node's `bookmark`, or undefined: an
 * empty title makes no outline entry, and `contents: false` leaves the entry
 * out. The mount check (no entries) and the adapter read this one rule.
 */
export const pdfContentsTitle = (bookmark: unknown): string | undefined => {
  if (typeof bookmark === 'string') return bookmark === '' ? undefined : bookmark
  if (typeof bookmark !== 'object' || bookmark === null || !('title' in bookmark)) return undefined
  if ('contents' in bookmark && bookmark.contents === false) return undefined
  return typeof bookmark.title === 'string' && bookmark.title !== '' ? bookmark.title : undefined
}

export const LINK_PRIMITIVES = {
  PdfLink: primitive<PdfLinkProps>()({
    tag: 'LINK',
    props: { ...BASE_PROPS, hitSlop: { check: 'hitSlop' }, href: required({ check: 'linkTarget' }), wrap: boolean },
    children: ['PdfView', 'PdfImage', 'PdfText'],
    text: true,
    destination: true,
  }),
  PdfNote: primitive<PdfNoteProps>()({
    tag: 'NOTE',
    props: BASE_PROPS,
    children: [],
    text: true,
    destination: true,
  }),
  // Not laid out where it stands: the engine adapter (server/engine/plain-tree.ts)
  // puts a numbered mark in its place and gives its content to the page as a note.
  PdfFootnote: primitive<PdfFootnoteProps>()({
    tag: 'FOOTNOTE',
    props: { [PDF_FOOTNOTE_REPEAT_PROP]: { check: 'positiveInteger' } },
    children: ['PdfText', 'PdfLink', 'PdfPageRef'],
    text: true,
    context: 'flow',
  }),
  // Not laid out where it stands either: the engine adapter
  // (server/engine/contents.ts) writes its entries in its place.
  PdfContents: primitive<PdfContentsProps>()({
    tag: 'CONTENTS',
    props: {
      leader: { check: 'contentsLeader' },
      levels: { check: 'contentsLevels' },
      styles: { check: 'contentsStyles' },
    },
    children: [],
    context: 'flow',
  }),
}
