// The document, its pages and the page flow: views, texts and images.
import type { PdfStyleValue } from '../authoring'
import type { PDF_PAGE_UNITS } from '../shared/style-values'
import type { PdfFootnoteStyles } from './links'
import type { PdfBaseProps, PdfBookmarkProp, PdfFixedPagesProp } from './shared'
import { BASE_PROPS, BOOKMARK_PROP, FIXED_PAGES, HEADER_CELL, PDF_HEADER_CELL_PROP, PDF_TABLE_CAPTION_PROP, PDF_TABLE_CELL_PROP, ROW_SPAN, RUNNING_ROW, TABLE_MEASURE, boolean, flow, primitive, required, string, svg, svgNumber, value } from './spec'
import type { PdfSvgLength } from './svg'
import type { PdfRunning } from './tokens'

export type PdfDocumentProps = {
  title?: string
  author?: string
  subject?: string
  creator?: string
  keywords?: string
  producer?: string
  language?: string
  creationDate?: Date
  pdfVersion?: '1.3' | '1.4' | '1.5' | '1.6' | '1.7' | '1.7ext3'
  /**
   * The standard the PDF claims and meets, or a list of them with at most
   * one PDF/A level. The render fails with a typed error when the document
   * cannot meet it. All write PDF 1.7 and need a registered font on every
   * text. `'PDF/UA-1'` and `'PDF/A-3a'` write a tagged PDF and need
   * `language` and `alt` (or `decorative`) on images; `'PDF/UA-1'` needs a
   * `title` too.
   */
  conformance?: PdfConformance | readonly PdfConformance[]
  /**
   * Encrypt the PDF with AES-256 and set what a reader permits. Needs at
   * least one password. Conflicts with PDF/A (and so with `PdfFacturX`).
   */
  protection?: PdfProtection
  pageLayout?:
    | 'singlePage'
    | 'oneColumn'
    | 'twoColumnLeft'
    | 'twoColumnRight'
    | 'twoPageLeft'
    | 'twoPageRight'
  /**
   * How `PdfFootnote` marks are numbered: through the whole document in
   * reading order (`'document'`, the default), or from 1 on each page (`'page'`).
   */
  footnotes?: 'document' | 'page'
  /** The styles of every footnote, merged over the defaults. */
  footnoteStyles?: PdfFootnoteStyles
}

/** How well a reader of a protected PDF may print it. */
export const PDF_PRINTING_PERMISSIONS = ['none', 'low', 'high'] as const
export type PdfPrintingPermission = typeof PDF_PRINTING_PERMISSIONS[number]

/**
 * What a reader of a protected PDF permits without the owner password.
 * Every permission is allowed unless it is set to `false` (`'none'` for
 * `printing`). Readers honour these flags; the encryption does not enforce
 * them.
 */
export type PdfPermissions = {
  /** `'low'` permits a degraded print only. Default `'high'`. */
  printing?: PdfPrintingPermission
  /** Copy or extract text and graphics. Default `true`. */
  copying?: boolean
  /** Change the content (other than annotations, forms and assembly). Default `true`. */
  changing?: boolean
  /** Add or change comments, and fill forms. Default `true`. */
  annotating?: boolean
  /** Fill existing form fields. Default `true`. */
  fillingForms?: boolean
  /** Extract text and graphics for assistive technology. Default `true`. */
  extractingForAccessibility?: boolean
  /** Insert, rotate or delete pages, and add bookmarks. Default `true`. */
  assembling?: boolean
}

/** The keys of `PdfPermissions`, in the order the docs list them. */
export const PDF_PERMISSION_KEYS = [
  'printing',
  'copying',
  'changing',
  'annotating',
  'fillingForms',
  'extractingForAccessibility',
  'assembling',
] as const satisfies readonly (keyof PdfPermissions)[]

type PdfProtectionPasswords
  = | { openPassword: string, ownerPassword?: string }
    | { openPassword?: string, ownerPassword: string }

/**
 * `openPassword` is needed to open the PDF. `ownerPassword` opens it with
 * every permission. With only `openPassword`, the owner password is random
 * and not kept, so nobody can lift the permissions with a password. With
 * only `ownerPassword`, anyone can open the PDF and `allow` applies.
 */
export type PdfProtection = PdfProtectionPasswords & {
  allow?: PdfPermissions
}

export const PDF_PAGE_SIZE_NAMES = [
  '4A0',
  '2A0',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
  'B0',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'C0',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'RA0',
  'RA1',
  'RA2',
  'RA3',
  'RA4',
  'SRA0',
  'SRA1',
  'SRA2',
  'SRA3',
  'SRA4',
  'EXECUTIVE',
  'FOLIO',
  'LEGAL',
  'LETTER',
  'TABLOID',
  'ID1',
] as const

export type PdfPageSizeName = (typeof PDF_PAGE_SIZE_NAMES)[number]

export type PdfPageUnit = typeof PDF_PAGE_UNITS[number]
export type PdfPageDimension = number | `${number}${PdfPageUnit}`
export type PdfPageSize
  = | PdfPageSizeName
    | readonly [PdfPageDimension, PdfPageDimension]
    | { width: PdfPageDimension, height: PdfPageDimension }

export type PdfPageProps = PdfBaseProps & PdfBookmarkProp & {
  wrap?: boolean
  size?: PdfPageSize
  orientation?: 'portrait' | 'landscape'
  dpi?: number
}

/** The standards a document can claim with `conformance`. */
export const PDF_CONFORMANCE_LEVELS = ['PDF/A-3b', 'PDF/A-3a', 'PDF/UA-1'] as const
export type PdfConformance = typeof PDF_CONFORMANCE_LEVELS[number]

/** The PDF/A levels; a document claims at most one of them. */
export const PDF_A_LEVELS: readonly PdfConformance[] = ['PDF/A-3b', 'PDF/A-3a']

/** Whether the claimed levels include a PDF/A level. */
export const claimsPdfA = (levels: readonly PdfConformance[]): boolean =>
  levels.some(level => PDF_A_LEVELS.includes(level))

/**
 * Whether the claimed levels need a tagged PDF: PDF/UA-1, and PDF/A-3a (the
 * accessible PDF/A level).
 */
export const claimsTaggedPdf = (levels: readonly PdfConformance[]): boolean =>
  levels.includes('PDF/UA-1') || levels.includes('PDF/A-3a')

const CONFORMANCE_LEVEL_SET: ReadonlySet<unknown> = new Set(PDF_CONFORMANCE_LEVELS)

/**
 * The levels a document's `conformance` claims, in table order; empty for no
 * claim. Unknown entries are left out: tree validation rejects them first.
 * Only `conformance` claims a level: a `PdfFacturX` needs a PDF/A level
 * there (tree validation).
 */
export const pdfClaimedLevels = (conformance: unknown): PdfConformance[] => {
  const claimed: readonly unknown[] = Array.isArray(conformance) ? conformance : [conformance]
  return PDF_CONFORMANCE_LEVELS.filter(level => claimed.includes(level) && CONFORMANCE_LEVEL_SET.has(level))
}

/** Structure roles of a page-flow `PdfText` (HTML-like names). */
export const PDF_TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const
export type PdfTextTag = typeof PDF_TEXT_TAGS[number]

/** Structure roles of a `PdfView` (HTML-like names). */
export const PDF_VIEW_TAGS = ['section', 'list', 'list-item', 'quote', 'caption', 'figure'] as const
export type PdfViewTag = typeof PDF_VIEW_TAGS[number]

export type PdfViewProps = PdfBaseProps & PdfBookmarkProp & PdfFixedPagesProp & {
  wrap?: boolean
  /** The structure role in a PDF/UA-1 document. Default: none (a plain group). */
  tag?: PdfViewTag
  /**
   * With `tag="figure"`: what the figure shows, for assistive technology. A
   * PDF/UA-1 document needs it or `decorative` on the figure.
   */
  alt?: string
}

type PdfFlowTextProps = PdfBaseProps & PdfBookmarkProp & PdfFixedPagesProp & {
  /**
   * Sets a running value: `PdfRunningText` with this name prints the plain
   * text of this text (or `text`) on the pages from here on. A page shows the
   * value set by the node at its very top, otherwise the last value set
   * before the page.
   */
  running?: PdfRunning
  wrap?: boolean
  widows?: number
  orphans?: number
  /**
   * The structure role in a PDF/UA-1 document: a heading level or a
   * paragraph. Default `'p'`. No effect otherwise.
   */
  tag?: PdfTextTag
}

type PdfSvgTextProps = {
  /** SVG text positioning is explicit and required inside a `PdfSvg`. */
  x: PdfSvgLength
  y: PdfSvgLength
  fill?: string
  style?: PdfStyleValue
}

export type PdfTextProps = PdfFlowTextProps | PdfSvgTextProps

export type PdfImageSource
  = | string
    | Uint8Array
    | ArrayBuffer
    | { data: Uint8Array, format: 'png' | 'jpg' }
    | { uri: string, format?: 'png' | 'jpg' }

export type PdfImageProps = PdfBaseProps & PdfBookmarkProp & {
  /** Local bundled path, remote allowlisted URL, or inline bytes. */
  src: PdfImageSource
  /** What the image shows, for assistive technology. A PDF/UA-1 document needs it or `decorative`. */
  alt?: string
}

const PAGE_FLOW = ['PdfView', 'PdfText', 'PdfImage', 'PdfLink', 'PdfNote', 'PdfSvg', 'PdfTextField', 'PdfCheckbox', 'PdfRadio', 'PdfSelect', 'PdfContents'] as const

export const DOCUMENT_PRIMITIVES = {
  PdfDocument: primitive<PdfDocumentProps>()({
    tag: 'DOCUMENT',
    props: {
      author: string,
      conformance: { check: 'conformance' },
      creationDate: value,
      creator: string,
      keywords: string,
      language: string,
      pageLayout: { check: 'pageLayout' },
      footnotes: { check: 'footnotes' },
      footnoteStyles: { check: 'footnoteStyles' },
      pdfVersion: { check: 'pdfVersion' },
      producer: string,
      protection: { check: 'protection' },
      subject: string,
      title: string,
    },
    children: ['PdfPage', 'PdfAttachment', 'PdfFacturX'],
  }),
  PdfPage: primitive<PdfPageProps>()({
    tag: 'PAGE',
    props: {
      ...BASE_PROPS,
      ...BOOKMARK_PROP,
      dpi: { check: 'positiveNumber' },
      orientation: { check: 'orientation' },
      size: { check: 'pageSize' },
      wrap: boolean,
    },
    children: PAGE_FLOW,
    destination: true,
  }),
  PdfView: primitive<PdfViewProps>()({
    tag: 'VIEW',
    props: {
      ...BASE_PROPS,
      ...BOOKMARK_PROP,
      ...HEADER_CELL,
      ...TABLE_MEASURE,
      ...ROW_SPAN,
      ...RUNNING_ROW,
      alt: { check: 'altText' },
      pages: FIXED_PAGES,
      tag: { check: 'viewTag' },
      wrap: boolean,
    },
    children: PAGE_FLOW,
    destination: true,
  }),
  PdfText: primitive<PdfTextProps>()({
    tag: 'TEXT',
    props: {
      bookmark: flow(BOOKMARK_PROP.bookmark),
      break: flow(BASE_PROPS.break),
      debug: flow(boolean),
      decorative: flow(boolean),
      fixed: flow(boolean),
      [PDF_HEADER_CELL_PROP]: flow(boolean),
      [PDF_TABLE_CAPTION_PROP]: flow(boolean),
      [PDF_TABLE_CELL_PROP]: flow(TABLE_MEASURE[PDF_TABLE_CELL_PROP]),
      id: flow(value),
      keepWithNext: flow(boolean),
      minPresenceAhead: flow(BASE_PROPS.minPresenceAhead),
      orphans: flow({ check: 'positiveInteger' }),
      pages: flow(FIXED_PAGES),
      running: flow({ check: 'running' }),
      tag: flow({ check: 'textTag' }),
      widows: flow({ check: 'positiveInteger' }),
      wrap: flow(boolean),
      style: value,
      fill: svg({ check: 'svgColor' }),
      x: svg(svgNumber),
      y: svg(svgNumber),
    },
    children: ['PdfText', 'PdfImage', 'PdfLink', 'PdfTspan', 'PdfPageNumber', 'PdfPageCount', 'PdfPageRef', 'PdfRunningText', 'PdfFootnote', 'PdfLeader'],
    text: true,
    destination: true,
  }),
  PdfImage: primitive<PdfImageProps>()({
    tag: 'IMAGE',
    props: { ...BASE_PROPS, ...BOOKMARK_PROP, alt: { check: 'altText' }, src: required({ check: 'imageSource' }) },
    children: [],
    destination: true,
  }),
}
