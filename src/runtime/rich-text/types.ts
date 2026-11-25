// The rich text model: plain data that can be stored and sent as JSON. Every
// input of `PdfRichText` (HTML, a model from a project's own CMS mapping)
// becomes this model before it renders.

import type { PdfTableColumnWidth } from '../primitives'

/** Inline content: text with marks, a link, a line break, or a footnote. */
export type PdfRichInline = PdfRichTextRun | PdfRichLink | PdfRichBreak | PdfRichFootnote

/**
 * A run of text with its marks. A mark that is not set is left out (the HTML
 * adapter writes only `true`); `false` means the same.
 */
export interface PdfRichTextRun {
  type: 'text'
  /** The text as it prints. Whitespace is kept as written. */
  text: string
  /** Bold, through the bold face of the font family. */
  bold?: boolean
  /** Italic, through the italic face of the font family. */
  italic?: boolean
  underline?: boolean
  /** Struck through. */
  strike?: boolean
  /** Inline code: the `code` style (a background unless the author names a monospace family). */
  code?: boolean
  /**
   * Raised (`'super'`, from `<sup>`) or lowered (`'sub'`, from `<sub>`), as
   * the style `verticalAlign` does it, in the `sup` or `sub` style of
   * `PdfRichText` (70 % of the text size by default). Left out on the
   * baseline.
   */
  verticalAlign?: 'super' | 'sub'
}

/** A link around inline content. */
export interface PdfRichLink {
  type: 'link'
  /** An absolute `http:`, `https:`, `mailto:` or `tel:` URL. */
  href: string
  /** The link text: text runs and line breaks, no nested link. */
  children: PdfRichInline[]
}

/** A line break inside a block. */
export interface PdfRichBreak {
  type: 'break'
}

/**
 * A footnote at this place: `PdfRichText` prints it with `PdfFootnote`, a
 * numbered mark here and the note at the bottom of the page. A footnote with
 * `children` is a note. A footnote with only `key` marks the note of an
 * earlier footnote with that `key` again, with the same number, as a second
 * `[^1]` in Markdown does.
 */
export interface PdfRichFootnote {
  type: 'footnote'
  /** Names the note for a later repeat: 1 to 64 characters, unique in the content. */
  key?: string
  /** The note: text runs, links and line breaks, no footnote. */
  children?: PdfRichInline[]
}

/** Block content, in reading order. */
export type PdfRichBlock
  = | PdfRichParagraph
    | PdfRichHeading
    | PdfRichList
    | PdfRichQuote
    | PdfRichCode
    | PdfRichRule
    | PdfRichImage
    | PdfRichTable
    | PdfRichComponent

export interface PdfRichParagraph {
  type: 'paragraph'
  children: PdfRichInline[]
}

export interface PdfRichHeading {
  type: 'heading'
  /** 1 to 6, as `h1` to `h6`. */
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: PdfRichInline[]
}

export interface PdfRichList {
  type: 'list'
  /** Numbered (`true`) or with bullets (`false`). */
  ordered: boolean
  /** With `ordered`: the number of the first item, a whole number. Default 1. */
  start?: number
  /** One entry per item; an item holds blocks (paragraphs, nested lists). */
  items: PdfRichBlock[][]
}

export interface PdfRichQuote {
  type: 'quote'
  children: PdfRichBlock[]
}

/** A code block: the text prints with its spaces and line breaks. */
export interface PdfRichCode {
  type: 'code'
  text: string
  /** The language the source names (`js` for a Markdown fence ```` ```js ````). Kept, not highlighted. */
  language?: string
}

/** A plain JSON value: what a component prop from the content can hold. */
export type PdfRichJsonValue
  = | string
    | number
    | boolean
    | null
    | PdfRichJsonValue[]
    | { [key: string]: PdfRichJsonValue }

/**
 * A component that comark or Markdown content names (`::alert{type="info"}`).
 * `PdfRichText` renders it with the Vue component its `components` prop maps
 * the name to; without a mapping, the content stays and the wrapper goes.
 * The HTML input never makes one.
 */
export interface PdfRichComponent {
  type: 'component'
  /** The name as the content writes it, for example `alert`. */
  name: string
  /** Props for the component: plain JSON values. */
  props: { [key: string]: PdfRichJsonValue }
  /** The content of the default slot. */
  children: PdfRichBlock[]
  /** Named slots (`#title` in comark), by name; left out when there are none. */
  slots?: { [name: string]: PdfRichBlock[] }
}

/**
 * An image. `PdfRichText` renders it with `PdfImage`, under the same source
 * rules: a path in `pdfs/assets` or an `https:` URL on `pdf.remote.allow`. A
 * source those rules refuse fails the render, or prints `alt` in a placeholder
 * box with `brokenImages="placeholder"` (see the rich text docs).
 */
export interface PdfRichImage {
  type: 'image'
  /** A path in `pdfs/assets` (`photos/heron.jpg`) or an `http:`/`https:` URL. */
  src: string
  /** What the image shows, for assistive technology and the placeholder. A tagged document needs it. */
  alt?: string
  /** Width in points (CSS pixels), at most the column width. */
  width?: number
  /** Height in points (CSS pixels). With `width` too, the image fits inside both and keeps its proportions. */
  height?: number
  /** A caption below the image (`figcaption`). */
  caption?: PdfRichInline[]
}

/**
 * A table. `PdfRichText` renders it with `PdfTable`: the header row repeats
 * at the top of every page of the table, and a body row splits across pages
 * unless a `rowspan` covers it.
 */
export interface PdfRichTable {
  type: 'table'
  /**
   * One width per column, as `PdfTable` takes them: a share (a number),
   * `'auto'`, or a width such as `'30%'` or `'80pt'`. Left out, every column
   * is `'auto'`: as wide as its content, narrower together when the table
   * has less room.
   */
  columns?: PdfTableColumnWidth[]
  /** The header row: its cells are column headers. It cannot span rows and holds no footnote. */
  header?: PdfRichTableCell[]
  /** The body rows, each a list of cells. A row may have fewer cells than the table has columns. */
  rows: PdfRichTableCell[][]
  /** A caption, printed above the table. */
  caption?: PdfRichInline[]
}

/** A table cell. */
export interface PdfRichTableCell {
  /** The content: paragraphs only. An empty list is an empty cell. */
  children: PdfRichParagraph[]
  /** Number of columns the cell takes, a whole number from 1. Default 1. */
  colspan?: number
  /** Number of rows the cell takes, a whole number from 1, in the body only. Default 1. */
  rowspan?: number
  /** Horizontal alignment of the content. Default `'left'`. */
  align?: 'left' | 'center' | 'right'
  /** In a body row: the cell is the header of its row. */
  header?: boolean
}

/** A horizontal rule (decoration). */
export interface PdfRichRule {
  type: 'rule'
}

/**
 * A problem in rich text input: the rule (`PDF-RICH-NODE` for a wrong node or
 * field, `PDF-RICH-LIMIT` for input over a limit), the path in the model
 * (`content[2].items[0][1].children[3].href`, or `html` for the HTML input)
 * and what is wrong. A message never quotes the text of the article.
 */
export interface PdfRichTextIssue {
  readonly rule: 'PDF-RICH-NODE' | 'PDF-RICH-LIMIT'
  readonly path: string
  readonly message: string
}
