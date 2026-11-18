// Seed → valid document spec → what the PDF must show.
//
// fast-check draws a *raw* document: plain numbers and choices with no
// cross-field rules, so it shrinks freely. `normalizeDocument` turns any raw
// document into a valid one: it clamps sizes to the room the context leaves
// and drops what the exclusion list forbids. A shrunk raw document therefore
// is still valid, and the expectations come from the normalized spec only.
import fc from 'fast-check'
import type { PdfTableColumn } from '../../src/runtime/components/table'
import type { PdfPageSizeName } from '../../src/runtime/primitives'
import type { VNode } from 'vue'

// ---------------------------------------------------------------------------
// Exclusions: known limits and inputs whose expected result is not defined by
// a rule here. Each is either not generated or turned into its documented
// behavior. `normalizeDocument` enforces every entry; the ids appear in
// comments where it does.

export const EXCLUSIONS = [
  {
    id: 'fixed-fills-page',
    reason: 'Fixed content that fills the page fails with PDF_LAYOUT_ERROR (engine test "fails fast when fixed content fills the page"). Not generated: in-flow fixed nodes are one line high and at most three per PdfPage, far below the smallest content area; a table header higher than half the room is dropped.',
  },
  {
    id: 'fixed-leaves-less-than-unbreakable',
    reason: 'Fixed content that leaves less room than a block that cannot break never ends pagination; it ends at timeoutMs (dream-summary "Known limits"). Not generated: an unbreakable block is only kept when its estimated height fits the room left after all in-flow fixed nodes (and, for a table row, after its header).',
  },
  {
    id: 'continuation-keeps-first-page-room',
    reason: 'An in-flow pages="continuation" node keeps its room on the first page (D15). Generated; it only changes free space, which no rule here measures.',
  },
  {
    id: 'unbreakable-higher-than-page',
    reason: 'An unbreakable block higher than its page is shrunk by the engine with PDF_UNBREAKABLE_NODE_OVERFLOW (engine test "warns about an unbreakable block higher than the page"). Not generated: wrap={false} is dropped when the estimated height does not fit; a table row that does not fit gets :wrap="true".',
  },
  {
    id: 'break-inside-unbreakable',
    reason: 'A forced break inside a wrap={false} block contradicts it. Not generated.',
  },
  {
    id: 'word-wider-than-line',
    reason: 'A token wider than its line overflows or is cut, by design. Not generated: every text keeps at least MIN_TEXT_WIDTH pt, and every table column the widest token at the table\'s font size plus the cell padding.',
  },
  {
    id: 'negative-margin',
    reason: 'Negative margins place text outside the padding on purpose; the padding rule (I5) would need the offset. Not generated.',
  },
  {
    id: 'rows',
    reason: 'Views in row direction make several columns; I4 orders one column. Not generated. Table rows (profile table) are the only rows: I4 orders a table as one unit, and I9 checks its rows and columns.',
  },
  {
    id: 'fixed-after-flow',
    reason: 'A fixed node after flow content repeats only from the page it reaches; the expected page set needs the layout. Not generated: fixed nodes are the first children of their PdfPage. A table header is fixed inside its table; I9 expects it on the pages of the table\'s rows.',
  },
  {
    id: 'fixed-inside-view',
    reason: 'A fixed node inside a view repeats on the pages of that view, which needs the layout to predict. Not generated: fixed nodes are direct children of PdfPage, except a table header (I9).',
  },
  {
    id: 'dynamic-text-across-pages',
    reason: 'A text with PdfPageNumber or PdfPageCount is re-rendered per page by the engine; one that breaks across pages has no single number to expect. Not generated: such texts hold at most three tokens and fit one line.',
  },
  {
    id: 'number-word-hyphenated',
    reason: 'A fused page number such as "r2p16" is a word with letters, which the hyphenator splits ("r2p-" "16"). A rule correction: texts that hold a page number, count or reference get hyphenate={false}, the documented way to keep words whole. Since the F6 fix (L3b) this holds for page references too.',
  },
  {
    id: 'absolute-over-text',
    reason: 'R4: pdf.js reads two texts that touch on one baseline as one word ("h1h2"), so an absolute text painted over other text hides both tokens from I3 and I7. Absolute fixed texts go into the top or bottom padding band of their page, stacked one line apart, so they share no baseline with flow, in-flow fixed or other absolute text. A band too low for its texts grows when the content area keeps MIN_CONTENT; otherwise those texts are in flow.',
  },
  {
    id: 'd13-rowspan',
    reason: 'D13: no rowspan. PdfTableCell has no rowspan prop; not generated.',
  },
  {
    id: 'nested-table',
    reason: 'A PdfTable inside a cell: the inner column edges need the outer cell\'s layout. Not generated; tables sit in pages and views.',
  },
  {
    id: 'column-units',
    reason: 'Columns are shares, pt lengths and whole percentages. px depends on dpi and rem/vw/vh on context; a span over columns whose units do not add up fails with PDF_TREE_INVALID by design (table docs), which this profile does not generate.',
  },
  {
    id: 'cell-page-tokens',
    reason: 'Page tokens in table cells are not generated: their numbers are I8\'s, which the fixed profile covers. A cell holds tokens and at most one inline link.',
  },
  {
    id: 'nested-link',
    reason: 'A link inside a link gives one text two targets. Not generated: the texts of a block link hold no inline link.',
  },
  {
    id: 'fixed-link',
    reason: 'The validator rejects a PdfLink in a fixed node with "pages" ("may contain only <PdfView>, <PdfText> and page tokens") and in a PdfText with PdfPageNumber or PdfPageCount ("cannot contain other elements"). A fixed text gets a link only with pages="all" and no page number.',
  },
  {
    id: 'link-next-to-page-token',
    reason: 'A text with a page number or reference holds no link: the printed number joins the text instances around it (F6), and a link between them is not a text instance. Not generated in this slice.',
  },
  {
    id: 'bookmark-without-text',
    reason: 'A bookmark points to the page where its node starts, and I14 expects the page of the node\'s first token. Bookmarks go only on pages, views and texts whose first leaf is a text, table or SVG: a view that starts with an image or field can start a page before its first token (H5, mixed).',
  },
  {
    id: 'mixed-fonts-without-links',
    reason: 'Word positions inside a line come from advance-width tables (Helvetica, and Roboto for tagged documents, with its five kerning pairs over the generated letters). Texts in another face (Lora, Inter, CJK, Arabic) have no table, so they hold no link and no page token, and sit in no table cell: I9 and I14 measure words.',
  },
  {
    id: 'rtl-subset-glyphs',
    reason: 'The Arabic fixture font is a subset that holds only the glyph forms of its two test words (test/international-text.test.ts); other letter sequences shape to glyphs it lacks and extract as control characters. A right-to-left text is one of those two words and a Latin code of letters A to C and digits 1 to 3 that starts and ends with a letter (a code that starts with a digit is reordered into the Arabic word by the bidi algorithm).',
  },
  {
    id: 'cjk-one-line',
    reason: 'CJK text may break between any two ideographs, so a CJK token could split over two lines. A CJK text holds as many tokens as fit one line.',
  },
  {
    id: 'tagged-embedded-fonts',
    reason: 'PDF/UA-1 needs every font embedded, so a tagged document draws all its text in Roboto (a fixture font) and SVG text names Roboto too; a CJK text holds one token, since the CJK subset has no space and the engine would draw it in Helvetica; form fields draw in the standard font Helvetica and are not written in tagged documents (validateFieldsConformance), so a tagged document has none; a fixed text holds no link (links must be in the reading order).',
  },
  {
    id: 'field-places',
    reason: 'Form fields sit in pages and views, never in tables, links or fixed nodes (a field in fixed content fails by design). A field\'s box is checked against the background of a wrapper view of the same size (`boxed`); a field without the wrapper is checked for size, page, content box and overlap.',
  },
  {
    id: 'd17-template-code',
    reason: 'D17: the time limit cannot stop synchronous template code. The generator writes no template code; specs become plain render functions.',
  },
] as const

// ---------------------------------------------------------------------------
// Constants

export const FONT_SIZES = [8, 9, 10, 11, 12, 14] as const
export const LINE_HEIGHTS = [undefined, 1, 1.2, 1.5, 2] as const
export const ALIGNS = ['left', 'center', 'right', 'justify'] as const
export const CELL_ALIGNS = ['left', 'center', 'right'] as const
export const FIXED_PAGES = ['all', 'first', 'continuation'] as const
export type FixedPages = typeof FIXED_PAGES[number]

/** Page sizes in pt (portrait). Named sizes go through the engine's table. */
export const PAGE_SIZES = [
  { name: 'A4', width: 595.28, height: 841.89 },
  { name: 'A5', width: 419.53, height: 595.28 },
  { name: 'A6', width: 297.64, height: 419.53 },
  { name: 'LETTER', width: 612, height: 792 },
  { name: undefined, width: 300, height: 400 },
  { name: undefined, width: 500, height: 260 },
] as const

/** Helvetica: widest token "w99999" is 0.722 + 5 × 0.556 em; a space is 0.278 em. */
const TOKEN_EM = 3.6
const SPACE_EM = 0.278
/** Widest glyph the generator writes ("w"), in em: a bound for a line's width. */
const GLYPH_EM = 0.722
const MAX_FONT = 14
/** Every text keeps this width, so no token is wider than its line. */
export const MIN_TEXT_WIDTH = Math.ceil(TOKEN_EM * MAX_FONT * 1.6)
const MIN_CONTENT = 150
/** Upper bound of the default line height of Helvetica, in em. */
const DEFAULT_LINE_EM = 1.3
/**
 * Cell padding. Two cells' texts are at least 2 × CELL_PAD_X apart, more than
 * 0.6 em at the largest font, so pdf.js keeps them in separate runs.
 */
export const CELL_PAD_X = 5
export const CELL_PAD_Y = 2
/** Tokens per table at most; a table with many rows gets short cells. */
const TABLE_TOKEN_BUDGET = 1500

/**
 * The faces of the `mixed` profile (fixture fonts in playground/pdfs/fonts).
 * `tokenEm` bounds the widest token ("w99999"), `lineEm` the default line
 * height, both in em, measured with fontkit (Inter 600: 4.04 and 1.21).
 */
export const FONT_FACES = [
  { file: 'Lora-400.ttf', family: 'Lora', postscript: 'Lora-Regular', tokenEm: 3.75, lineEm: 1.3 },
  { file: 'Lora-700.ttf', family: 'Lora', fontWeight: 700, postscript: 'Lora-Bold', tokenEm: 3.75, lineEm: 1.3 },
  { file: 'Lora-400-italic.ttf', family: 'Lora', fontStyle: 'italic', postscript: 'Lora-Italic', tokenEm: 3.75, lineEm: 1.3 },
  { file: 'Inter-400.ttf', family: 'Inter', postscript: 'Inter-Regular', tokenEm: 4.1, lineEm: 1.25 },
  { file: 'Inter-600.ttf', family: 'Inter', fontWeight: 600, postscript: 'Inter-SemiBold', tokenEm: 4.1, lineEm: 1.25 },
] as const
/** Every text of a tagged document (tagged-embedded-fonts); narrower than Helvetica (w99999: 3.56 em, line 1.17 em). */
export const BODY_FONT = { file: 'Roboto-Regular.ttf', family: 'Roboto', postscript: 'Roboto-Regular' } as const
/** The fixture subsets of test/fixtures/fonts/international (line height 1.45 and 2.11 em). */
export const SCRIPT_FONTS = {
  cjk: { file: 'NotoSansCJKsc-Subset.ttf', family: 'Noto CJK', postscript: 'NotoSansSC-Thin', lineEm: 1.5 },
  rtl: { file: 'NotoSansArabic-Subset.ttf', family: 'Noto Arabic', postscript: 'NotoSansArabic-Regular', lineEm: 2.2 },
} as const
/** The ideographs the CJK subset holds (its punctuation left out). */
const CJK_CHARACTERS = [...'世中你好文日本测界語试']
/** rtl-subset-glyphs: the two words the Arabic subset can shape. */
export const RTL_WORDS = ['مرحبا', 'العربية'] as const
const CODE_ENDS = ['A', 'B', 'C'] as const
const CODE_INNER = ['1', '2', '3', 'A', 'B', 'C'] as const
/** The fixture images and their aspect ratio as whole numbers (700 × 420, 48 × 32). */
export const IMAGES = {
  png: { file: 'test/fixtures/assets/sample.png', src: 'images/sample.png', ratio: [5, 3] },
  jpg: { file: 'test/fixtures/corpus/images-sample.jpg', src: 'images/sample.jpg', ratio: [3, 2] },
} as const
/** The background of the view around a boxed image or field, and the full-size rect of an SVG: unique per box. */
export const boxColor = (boxId: number): string => `#e0${(boxId >> 8).toString(16).padStart(2, '0')}${(boxId & 255).toString(16).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// Raw documents: what fast-check draws and shrinks. Fields added after cases
// were saved are optional: a saved case without them replays unchanged.

export interface RawText {
  t: 'text'
  n: number
  font: number
  lineHeight: number
  align: number
  wrap: boolean
  brk: boolean
  marginTop: number
  marginBottom: number
  /** fixed profile: 0 none, 1 a page number at the end, 2 a page reference. */
  extra: number
  /** Index of the reference target among the flow texts. */
  ref: number
  /** 0 no link, 1 an external link, 2 an internal link over some tokens. */
  link?: number
  /** Start and length of the link's tokens, as shares of the text. */
  linkAt?: number
  linkSize?: number
  /** Index of an internal link's target among the flow texts. */
  linkTo?: number
  bookmark?: boolean
  /** mixed: 0 the document's font, 1 to 5 a face of FONT_FACES, 6 CJK, 7 right-to-left. */
  face?: number
}

export interface RawView {
  t: 'view'
  margin: [number, number, number, number]
  padding: [number, number, number, number]
  border: number
  minHeight: number
  wrap: boolean
  brk: boolean
  children: RawNode[]
  bookmark?: boolean
}

/** A PdfLink around texts (a block link). */
export interface RawLink {
  t: 'link'
  /** 1 external, 2 internal. */
  kind: number
  linkTo: number
  children: RawText[]
}

export interface RawCell {
  n: number
  /** Columns covered beyond the first. */
  span: number
  align: number
  link: number
  linkAt: number
  linkSize: number
  linkTo: number
}

export interface RawRow {
  wrap: boolean
  cells: RawCell[]
}

export interface RawColumn {
  /** 0 a share, 1 a pt length, 2 a percentage. */
  kind: number
  value: number
}

export interface RawTable {
  t: 'table'
  font: number
  columns: RawColumn[]
  header: boolean
  headerCells: RawCell[]
  rows: RawRow[]
  marginTop: number
  marginBottom: number
}

/** mixed: an image, an SVG or a form field. */
export interface RawBox {
  t: 'box'
  /** 0 PNG, 1 JPEG, 2 SVG, 3 text field, 4 checkbox, 5 select. */
  what: number
  width: number
  height: number
  /** Share of the free width left of the box; SVG: also the text's x. */
  x: number
  /** SVG: the text's baseline, as a share of the free height. */
  y: number
  marginTop: number
  /** Image and field: inside a view of the same size with a background (`boxed`); checkbox: checked; text field: has maxLength. */
  flag: boolean
  /** Field value, option count and SVG text tokens. */
  value: number
}

export type RawNode = RawText | RawView | RawLink | RawTable | RawBox

export interface RawFixed {
  /** 0 a text, 1 a text inside a view. */
  kind: number
  pages: number
  absolute: boolean
  n: number
  font: number
  /** 0 none, 1 page number, 2 page count, 3 both. */
  numbers: number
  /** absolute: where the stack of absolute texts starts in its padding band, as a share of the free band. */
  offset: number
  fromBottom: boolean
  inset: number
  marginBottom: number
  /** An external link over the tokens. */
  link?: boolean
}

export interface RawPage {
  size: number
  landscape: boolean
  padding: [number, number, number, number]
  fixed: RawFixed[]
  children: RawNode[]
  bookmark?: boolean
}

export interface RawDocument {
  pages: RawPage[]
  /** mixed: a PDF/UA-1 document. */
  tagged?: boolean
}

export type Profile = 'flow' | 'fixed' | 'table' | 'mixed'

/** Profiles with fixed nodes and page tokens; profiles with tables. */
const withFixed = (profile: Profile): boolean => profile === 'fixed' || profile === 'mixed'
const withTables = (profile: Profile): boolean => profile === 'table' || profile === 'mixed'

const side = fc.integer({ min: 0, max: 60 })
const box = fc.tuple(side, side, side, side)
const small = fc.integer({ min: 0, max: 24 })
const share = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true })
const rarely = (weight: number) => fc.oneof({ weight, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) })
/** 0 none (mostly), 1 external, 2 internal. */
const linkKind = (none: number) => fc.oneof({ weight: none, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.constant(1) }, { weight: 1, arbitrary: fc.constant(2) })

/** Mostly short texts; a few long ones make the multi-page documents. */
const tokenCount = fc.oneof(
  { weight: 12, arbitrary: fc.integer({ min: 1, max: 30 }) },
  { weight: 3, arbitrary: fc.integer({ min: 31, max: 120 }) },
  { weight: 1, arbitrary: fc.integer({ min: 121, max: 400 }) },
)
/** mixed: its new content needs no long documents (the other profiles have them), and a mixed document costs more to read. */
const mixedTokenCount = fc.oneof(
  { weight: 12, arbitrary: fc.integer({ min: 1, max: 30 }) },
  { weight: 2, arbitrary: fc.integer({ min: 31, max: 80 }) },
)

const rawText = (profile: Profile): fc.Arbitrary<RawText> => fc.record({
  t: fc.constant('text' as const),
  n: profile === 'mixed' ? mixedTokenCount : tokenCount,
  font: fc.nat({ max: FONT_SIZES.length - 1 }),
  lineHeight: fc.nat({ max: LINE_HEIGHTS.length - 1 }),
  align: fc.nat({ max: ALIGNS.length - 1 }),
  wrap: fc.boolean(),
  brk: rarely(9),
  marginTop: small,
  marginBottom: small,
  extra: withFixed(profile)
    ? fc.oneof({ weight: 6, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.constant(1) }, { weight: 1, arbitrary: fc.constant(2) })
    : fc.constant(0),
  ref: fc.nat({ max: 1000 }),
  link: linkKind(6),
  linkAt: share,
  linkSize: share,
  linkTo: fc.nat({ max: 1000 }),
  bookmark: rarely(7),
  ...(profile === 'mixed'
    ? { face: fc.oneof({ weight: 10, arbitrary: fc.constant(0) }, { weight: 3, arbitrary: fc.integer({ min: 1, max: FONT_FACES.length }) }, { weight: 1, arbitrary: fc.constant(6) }, { weight: 1, arbitrary: fc.constant(7) }) }
    : {}),
})

const rawBox: fc.Arbitrary<RawBox> = fc.record({
  t: fc.constant('box' as const),
  what: fc.nat({ max: 5 }),
  width: share,
  height: share,
  x: share,
  y: share,
  marginTop: fc.integer({ min: 0, max: 12 }),
  flag: fc.boolean(),
  value: fc.nat({ max: 1000 }),
})

const rawCell = (maxTokens: number): fc.Arbitrary<RawCell> => fc.record({
  n: maxTokens > 5
    ? fc.oneof({ weight: 6, arbitrary: fc.integer({ min: 1, max: 5 }) }, { weight: 2, arbitrary: fc.integer({ min: 6, max: maxTokens }) })
    : fc.integer({ min: 1, max: maxTokens }),
  span: fc.oneof({ weight: 5, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 3 }) }),
  align: fc.nat({ max: CELL_ALIGNS.length - 1 }),
  link: linkKind(10),
  linkAt: share,
  linkSize: share,
  linkTo: fc.nat({ max: 1000 }),
})

const rawRow: fc.Arbitrary<RawRow> = fc.record({
  wrap: rarely(5),
  cells: fc.array(rawCell(40), { minLength: 1, maxLength: 6 }),
})

/** 1 to 300 rows: mostly short tables, some long ones that cross pages; mixed: at most 30. */
const rawRows = (profile: Profile) => profile === 'mixed'
  ? fc.oneof(
      { weight: 8, arbitrary: fc.array(rawRow, { minLength: 1, maxLength: 12 }) },
      { weight: 1, arbitrary: fc.array(rawRow, { minLength: 13, maxLength: 30, size: 'max' }) },
    )
  : fc.oneof(
      { weight: 8, arbitrary: fc.array(rawRow, { minLength: 1, maxLength: 12 }) },
      { weight: 3, arbitrary: fc.array(rawRow, { minLength: 13, maxLength: 60, size: 'max' }) },
      { weight: 1, arbitrary: fc.array(rawRow, { minLength: 61, maxLength: 300, size: 'max' }) },
    )

const rawTable = (profile: Profile): fc.Arbitrary<RawTable> => fc.record({
  t: fc.constant('table' as const),
  font: fc.nat({ max: FONT_SIZES.length - 1 }),
  columns: fc.array(fc.record({ kind: fc.nat({ max: 2 }), value: share }), { minLength: 1, maxLength: 6 }),
  header: fc.oneof({ weight: 3, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
  headerCells: fc.array(rawCell(4), { minLength: 1, maxLength: 6 }),
  rows: rawRows(profile),
  marginTop: small,
  marginBottom: small,
})

const rawNodes = (profile: Profile): fc.Arbitrary<RawNode[]> => {
  const { nodes } = fc.letrec<{ node: RawNode, nodes: RawNode[], view: RawView, link: RawLink }>(tie => ({
    node: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      { weight: 4, arbitrary: rawText(profile) },
      { weight: 4, arbitrary: tie('view') },
      { weight: 1, arbitrary: tie('link') },
      ...(withTables(profile) ? [{ weight: profile === 'mixed' ? 2 : 4, arbitrary: rawTable(profile) }] : []),
      ...(profile === 'mixed' ? [{ weight: 3, arbitrary: rawBox }] : []),
    ),
    nodes: fc.array(tie('node'), { minLength: 1, maxLength: 6, depthIdentifier: 'tree' }),
    view: fc.record({
      t: fc.constant('view' as const),
      margin: box.map(values => values.map(value => Math.floor(value / 3)) as [number, number, number, number]),
      padding: box.map(values => values.map(value => Math.floor(value / 3)) as [number, number, number, number]),
      border: fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 4 }) }),
      minHeight: fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 500 }) }),
      wrap: fc.boolean(),
      brk: rarely(9),
      children: tie('nodes'),
      bookmark: rarely(7),
    }),
    link: fc.record({
      t: fc.constant('link' as const),
      kind: fc.integer({ min: 1, max: 2 }),
      linkTo: fc.nat({ max: 1000 }),
      children: fc.array(rawText(profile), { minLength: 1, maxLength: 3 }),
    }),
  }))
  return nodes
}

const rawFixed: fc.Arbitrary<RawFixed> = fc.record({
  kind: fc.nat({ max: 1 }),
  pages: fc.nat({ max: FIXED_PAGES.length - 1 }),
  absolute: fc.boolean(),
  n: fc.integer({ min: 1, max: 3 }),
  font: fc.nat({ max: FONT_SIZES.length - 1 }),
  numbers: fc.nat({ max: 3 }),
  offset: fc.double({ min: 0, max: 1, noNaN: true }),
  fromBottom: fc.boolean(),
  inset: fc.integer({ min: 0, max: 60 }),
  marginBottom: fc.integer({ min: 0, max: 10 }),
  link: rarely(4),
})

const rawPage = (profile: Profile): fc.Arbitrary<RawPage> => fc.record({
  size: fc.nat({ max: PAGE_SIZES.length - 1 }),
  landscape: fc.boolean(),
  padding: box,
  fixed: withFixed(profile) ? fc.array(rawFixed, { minLength: 0, maxLength: 3 }) : fc.constant([]),
  children: rawNodes(profile),
  bookmark: rarely(3),
})

export const rawDocument = (profile: Profile): fc.Arbitrary<RawDocument> => profile === 'mixed'
  // Two or three PdfPage elements, so a document has several page sizes or orientations; a quarter tagged.
  ? fc.record({ pages: fc.array(rawPage(profile), { minLength: 2, maxLength: 3 }), tagged: rarely(3) })
  : fc.record({ pages: fc.array(rawPage(profile), { minLength: 1, maxLength: 2 }) })

/**
 * A short version of a raw document: its first page, at most `nodes` nodes per
 * container and `rows` rows per table. The rules that render one document
 * several times (I11, I12) or check a fault (I15) need a valid document, not
 * a long one.
 */
export const shortDocument = (raw: RawDocument, { nodes = 6, rows = 12 }: { nodes?: number, rows?: number } = {}): RawDocument => {
  const shorten = (node: RawNode): RawNode => {
    if (node.t === 'view') return { ...node, children: node.children.slice(0, nodes).map(shorten) }
    if (node.t === 'table') return { ...node, rows: node.rows.slice(0, rows) }
    if (node.t === 'link') return { ...node, children: node.children.slice(0, nodes) }
    return node
  }
  return { ...raw, pages: raw.pages.slice(0, 1).map(page => ({ ...page, children: page.children.slice(0, nodes).map(shorten) })) }
}

// ---------------------------------------------------------------------------
// Normalized specs: valid documents.

/**
 * Props, style and children that the template adds to one node of a spec: the
 * one fault of an `invalid` document (faults.ts), or the protection of a
 * document in the isolation rule (I11). A normalized spec has none.
 */
export interface NodePatch {
  props?: Record<string, unknown>
  style?: Record<string, unknown>
  append?: () => Array<VNode | string>
  /** The node's children are only `append` (a document without its pages). */
  replaceChildren?: boolean
}

export interface LinkSpec {
  linkId: number
  kind: 'external' | 'internal'
  /** External: a unique URL. Internal: `#id` of the target, set once the document exists. */
  href: string
  tokens: string[]
  /** internal: index among the flow texts; then the target's id and first token. */
  pick: number
  id?: string
  target?: string
}

/** An inline link over `link.tokens`, which start at `start` among the text's tokens. */
export interface InlineLink {
  start: number
  link: LinkSpec
}

export interface TextSpec {
  patch?: NodePatch
  kind: 'text'
  /** Index of this text among all texts, in tree order. */
  textId: number
  tokens: string[]
  fontSize: number
  lineHeight?: number
  align: typeof ALIGNS[number]
  wrap: boolean
  brk: boolean
  marginTop: number
  marginBottom: number
  /** Element id for a page reference or link target. */
  id?: string
  /** A fused page number or page reference at the end. */
  suffix?: { kind: 'pageNumber', prefix: string } | { kind: 'pageRef', prefix: string, to: string, target: string, pick: number }
  link?: InlineLink
  bookmark?: string
  /** mixed: index in FONT_FACES. */
  face?: number
  /** mixed: CJK tokens, or right-to-left: an Arabic word before the one code token. */
  script?: { kind: 'cjk' } | { kind: 'rtl', word: string }
  /** tagged: tag="h<level>". */
  heading?: number
  /** Height upper bound in pt, margins excluded. */
  estimate: number
}

/** Shared by the boxes of the mixed profile. */
interface BoxBase {
  patch?: NodePatch
  boxId: number
  width: number
  height: number
  marginTop: number
  marginLeft: number
  /** Absolute x of the box's left edge, from the spec alone. */
  left: number
  estimate: number
}

export interface ImageSpec extends BoxBase {
  kind: 'image'
  format: keyof typeof IMAGES
}

/** An SVG of the box's size (viewBox in pt), filled by a rect in the box colour, with a triangle and one text. */
export interface SvgSpec extends BoxBase {
  kind: 'svg'
  text: { tokens: string[], x: number, y: number, fontSize: number }
}

export interface FieldSpec extends BoxBase {
  kind: 'field'
  field: 'text' | 'checkbox' | 'select'
  name: string
  /** Inside a view of the same size with the box colour as background. */
  boxed: boolean
  value?: string
  checked?: boolean
  exportValue?: string
  options?: string[]
  maxLength?: number
}

export type BoxSpec = ImageSpec | SvgSpec | FieldSpec

export interface ViewSpec {
  patch?: NodePatch
  kind: 'view'
  margin: [number, number, number, number]
  padding: [number, number, number, number]
  border: number
  minHeight: number
  wrap: boolean
  brk: boolean
  children: NodeSpec[]
  bookmark?: string
  estimate: number
}

export interface LinkNodeSpec {
  patch?: NodePatch
  kind: 'link'
  link: LinkSpec
  children: TextSpec[]
  estimate: number
}

export interface CellSpec {
  patch?: NodePatch
  tokens: string[]
  /** First column covered. */
  start: number
  span: number
  align: typeof CELL_ALIGNS[number]
  link?: InlineLink
}

export interface RowSpec {
  patch?: NodePatch
  wrap: boolean
  cells: CellSpec[]
}

export interface TableSpec {
  patch?: NodePatch
  kind: 'table'
  tableId: number
  fontSize: number
  /** What the template passes as `columns`. */
  columns: PdfTableColumn[]
  /** Absolute x of each column edge, from the spec alone: columns.length + 1 values. */
  edges: number[]
  header?: CellSpec[]
  rows: RowSpec[]
  marginTop: number
  marginBottom: number
  estimate: number
}

export type NodeSpec = TextSpec | ViewSpec | LinkNodeSpec | TableSpec | BoxSpec

export interface FixedSpec {
  patch?: NodePatch
  container: 'text' | 'view'
  pages: FixedPages
  absolute?: { top?: number, bottom?: number, left: number, right: number }
  tokens: string[]
  fontSize: number
  numbers: Array<{ kind: 'pageNumber' | 'pageCount', prefix: string }>
  marginBottom: number
  link?: LinkSpec
}

export interface PageSpec {
  patch?: NodePatch
  size: { name?: PdfPageSizeName, width: number, height: number }
  landscape: boolean
  padding: [number, number, number, number]
  fixed: FixedSpec[]
  children: NodeSpec[]
  bookmark?: string
}

export interface DocumentSpec {
  patch?: NodePatch
  profile: Profile
  pages: PageSpec[]
  /** conformance PDF/UA-1, with a title, a language and Roboto for every text. */
  tagged?: boolean
}

/** What the generator knows about each token. */
export interface TokenFact {
  token: string
  /** cell: a table row's token (once); header: a header token (once on each page of its table). */
  kind: 'flow' | 'fixed' | 'cell' | 'header'
  /** Index of the PdfPage element. */
  pdfPage: number
  pages?: FixedPages
  absolute: boolean
  /** Outermost unbreakable block that fits a page, if any. */
  block?: number
  /** Document order among flow tokens; all row tokens of one table share one value. */
  order: number
}

export interface NumberFact {
  prefix: string
  kind: 'pageNumber' | 'pageCount' | 'pageRef'
  fixed: boolean
  pdfPage: number
  pages?: FixedPages
  absolute: boolean
  /** pageRef: the first token of the target text. */
  target?: string
  block?: number
  order: number
}

export interface CellFact {
  tokens: string[]
  /** Absolute x of the cell's edges, padding included. */
  left: number
  right: number
  align: typeof CELL_ALIGNS[number]
}

export interface TableFact {
  tableId: number
  fontSize: number
  header: CellFact[]
  rows: Array<{ wrap: boolean, cells: CellFact[] }>
}

export interface LinkFact {
  linkId: number
  kind: 'external' | 'internal'
  href: string
  tokens: string[]
  /** internal: the destination name and the first token of its target. */
  id?: string
  target?: string
}

export interface BookmarkFact {
  title: string
  /** The node's first token, or the PdfPage whose first PDF page it names. */
  at: { token: string } | { pdfPage: number }
  children: BookmarkFact[]
}

/** An image, SVG or form field: where its box is, from the spec. */
export interface BoxFact {
  boxId: number
  kind: BoxSpec['kind']
  color: string
  width: number
  height: number
  left: number
  /** image, SVG and boxed fields: a filled rectangle in `color` shows the laid-out box. */
  painted: boolean
}

export interface SvgTextFact {
  boxId: number
  tokens: string[]
  x: number
  y: number
}

export interface FieldFact {
  boxId: number
  name: string
  field: FieldSpec['field']
  width: number
  height: number
  pdfPage: number
  boxed: boolean
  /** What pdf.js reads back: the text, the checkbox state, the select choice. */
  value: string | string[]
}

export interface Expectations {
  tokens: Map<string, TokenFact>
  numbers: NumberFact[]
  /** First flow token (or number prefix) of each PdfPage: marks its first PDF page. */
  markers: string[]
  blocks: number
  tables: TableFact[]
  links: LinkFact[]
  bookmarks: BookmarkFact[]
  boxes: BoxFact[]
  svgTexts: SvgTextFact[]
  fields: FieldFact[]
  /** Tokens of texts in a face of FONT_FACES (or a script font), and that font's PostScript name. */
  faces: Array<{ tokens: string[], postscript: string }>
  /** Right-to-left texts: the code token and the Arabic word. */
  rtl: Array<{ code: string, word: string }>
  /** Heading levels of a tagged document, in document order. */
  headings: number[]
  /** Images and SVGs: each a figure with alt in a tagged document. */
  figures: number
  tagged: boolean
}

const pageDimensions = (page: PageSpec): { width: number, height: number } =>
  page.landscape
    ? { width: page.size.height, height: page.size.width }
    : { width: page.size.width, height: page.size.height }

export const pageGeometry = pageDimensions

const lineEm = (lineHeight: number | undefined, fallback = DEFAULT_LINE_EM): number => lineHeight ?? fallback

/** Upper bound of a text's height at a given width (`em`: a face's token width and default line height). */
const textEstimate = (count: number, fontSize: number, lineHeight: number | undefined, width: number, em: { token: number, line: number } = { token: TOKEN_EM, line: DEFAULT_LINE_EM }): number => {
  const perLine = Math.max(1, Math.floor((width + SPACE_EM * fontSize) / ((em.token + SPACE_EM) * fontSize)))
  return Math.ceil(count / perLine) * fontSize * lineEm(lineHeight, em.line) + 2
}

const clampBox = (values: readonly number[], room: number): [number, number, number, number] => {
  const [top = 0, right = 0, bottom = 0, left = 0] = values
  // Keep MIN_TEXT_WIDTH: drop horizontal space first when the room is short.
  return room - left - right >= MIN_TEXT_WIDTH ? [top, right, bottom, left] : [top, 0, bottom, 0]
}

interface Context {
  width: number
  /** Absolute x of the content box's left edge. */
  left: number
  /** Room for an unbreakable block on a fresh page, after ancestors and fixed content. */
  fitRoom: number
  insideUnbreakable: boolean
  insideLink: boolean
}

class Builder {
  /** `prefix` starts every token, number prefix and id, so two documents share no token (I11). */
  constructor(readonly prefix: string, readonly profile: Profile, readonly tagged: boolean) {}

  private nextCjk = 0
  private nextCode = 0
  private nextBox = 0
  private nextField = 0

  /** Two ideographs, then three: unique in a document. */
  cjkToken(): string {
    let index = this.nextCjk++
    const size = CJK_CHARACTERS.length
    const length = index < size * size ? 2 : 3
    if (length === 3) index -= size * size
    return Array.from({ length }, (_, position) => CJK_CHARACTERS[Math.floor(index / size ** position) % size]!).join('')
  }

  /** A code of four characters, letters at both ends (rtl-subset-glyphs); undefined after 324. */
  rtlCode(): string | undefined {
    const index = this.nextCode++
    if (index >= 324) return undefined
    return `${CODE_ENDS[index % 3]}${CODE_INNER[Math.floor(index / 3) % 6]}${CODE_INNER[Math.floor(index / 18) % 6]}${CODE_ENDS[Math.floor(index / 108) % 3]}`
  }

  boxId(): number {
    return this.nextBox++
  }

  fieldName(): string {
    this.nextField += 1
    return `${this.prefix}f${this.nextField}`
  }

  private nextToken = 0
  private nextText = 0
  private nextNumber = 0
  private nextLink = 0
  private nextBookmark = 0
  private nextTable = 0

  token(letter: 'w' | 'h' | 'k'): string {
    this.nextToken += 1
    return `${this.prefix}${letter}${this.nextToken}`
  }

  numberPrefix(letter: 'n' | 'c' | 'r'): string {
    this.nextNumber += 1
    return `${this.prefix}${letter}${this.nextNumber}p`
  }

  textId(): number {
    return this.nextText++
  }

  tableId(): number {
    return this.nextTable++
  }

  bookmark(): string {
    this.nextBookmark += 1
    return `b${this.nextBookmark}`
  }

  link(kind: number, tokens: string[], pick: number): LinkSpec {
    const linkId = this.nextLink++
    return kind === 2
      ? { linkId, kind: 'internal', href: '', tokens, pick }
      : { linkId, kind: 'external', href: `https://example.com/l${linkId}`, tokens, pick }
  }
}

/** An inline link over a slice of `tokens`, or none. */
const inlineLink = (
  raw: { link?: number, linkAt?: number, linkSize?: number, linkTo?: number },
  tokens: string[],
  builder: Builder,
): InlineLink | undefined => {
  if (raw.link !== 1 && raw.link !== 2) return undefined
  const start = Math.min(tokens.length - 1, Math.floor((raw.linkAt ?? 0) * tokens.length))
  const count = Math.min(tokens.length - start, 1 + Math.floor((raw.linkSize ?? 0) * (tokens.length - start)))
  return { start, link: builder.link(raw.link, tokens.slice(start, start + count), raw.linkTo ?? 0) }
}

const normalizeText = (raw: RawText, context: Context, builder: Builder, profile: Profile): TextSpec => {
  const fontSize = FONT_SIZES[raw.font] ?? 10
  const lineHeight = LINE_HEIGHTS[raw.lineHeight]
  const face = profile === 'mixed' ? raw.face ?? 0 : 0
  // rtl-subset-glyphs: a document has codes for 324 right-to-left texts; later ones use the document's font.
  const code = face === 7 ? builder.rtlCode() : undefined
  if (face === 7 && code === undefined) return normalizeText({ ...raw, face: 0 }, context, builder, profile)
  // mixed-fonts-without-links: only texts in the document's font hold page tokens and links.
  const hasSuffix = withFixed(profile) && raw.extra !== 0 && face === 0
  let tokens: string[]
  let em = { token: TOKEN_EM, line: DEFAULT_LINE_EM }
  let script: TextSpec['script']
  if (face === 6) {
    // cjk-one-line: two or three ideographs and a space per token, at most 4 em
    // each; tagged-embedded-fonts: one token in a tagged document (the subset has no space).
    tokens = Array.from({ length: builder.tagged ? 1 : Math.max(1, Math.min(raw.n, Math.floor(context.width / (4 * fontSize)))) }, () => builder.cjkToken())
    em = { token: 4, line: SCRIPT_FONTS.cjk.lineEm }
    script = { kind: 'cjk' }
  }
  else if (code !== undefined) {
    // The word (at most 2.6 em) and the code (3.7 em): two tokens.
    tokens = [code]
    em = { token: 3.7, line: SCRIPT_FONTS.rtl.lineEm }
    script = { kind: 'rtl', word: RTL_WORDS[raw.n % RTL_WORDS.length]! }
  }
  else {
    // dynamic-text-across-pages: a text with a page number holds at most three
    // tokens, which fit one line at MIN_TEXT_WIDTH.
    tokens = Array.from({ length: hasSuffix && raw.extra === 1 ? Math.min(raw.n, 2) : raw.n }, () => builder.token('w'))
    const faceSpec = FONT_FACES[face - 1]
    if (faceSpec) em = { token: faceSpec.tokenEm, line: faceSpec.lineEm }
  }
  const estimate = textEstimate(tokens.length + (hasSuffix || script?.kind === 'rtl' ? 1 : 0), fontSize, lineHeight, context.width, em)
  const fits = estimate + raw.marginTop + raw.marginBottom <= context.fitRoom * 0.9
  const spec: TextSpec = {
    kind: 'text',
    textId: builder.textId(),
    tokens,
    fontSize,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    align: ALIGNS[raw.align] ?? 'left',
    // unbreakable-higher-than-page
    wrap: raw.wrap || !fits,
    // break-inside-unbreakable
    brk: raw.brk && !context.insideUnbreakable,
    marginTop: raw.marginTop,
    marginBottom: raw.marginBottom,
    estimate,
  }
  if (hasSuffix && raw.extra === 1) {
    spec.suffix = { kind: 'pageNumber', prefix: builder.numberPrefix('n') }
  }
  else if (hasSuffix && raw.extra === 2) {
    // The target is resolved after the whole document exists.
    spec.suffix = { kind: 'pageRef', prefix: builder.numberPrefix('r'), to: '', target: '', pick: raw.ref }
  }
  // nested-link, link-next-to-page-token, mixed-fonts-without-links
  const link = context.insideLink || hasSuffix || face !== 0 ? undefined : inlineLink(raw, tokens, builder)
  if (link) spec.link = link
  if (raw.bookmark) spec.bookmark = builder.bookmark()
  if (face >= 1 && face <= FONT_FACES.length) spec.face = face - 1
  if (script) spec.script = script
  return spec
}

/** Words a text field value is made of: WinAnsi characters beyond ASCII too (ü, é, €, en dash). */
const FIELD_WORDS = ['', ' Ab', ' Zürich', ' café €5', ' naïve – ok'] as const

/** An image, SVG or field that fits its context, or none (field-places, tagged-embedded-fonts). */
const normalizeBox = (raw: RawBox, context: Context, builder: Builder): BoxSpec | undefined => {
  // unbreakable-higher-than-page: a box is unbreakable and stays below 80 % of the room.
  const room = Math.floor(context.fitRoom * 0.8) - raw.marginTop
  const placed = (width: number) => {
    const marginLeft = Math.floor(raw.x * Math.max(0, context.width - width))
    return { marginTop: raw.marginTop, marginLeft, left: context.left + marginLeft }
  }
  if (raw.what <= 1) {
    const format = raw.what === 0 ? 'png' : 'jpg'
    const [across, down] = IMAGES[format].ratio
    const most = Math.min(Math.floor(context.width / across), Math.floor(room / down), 60)
    if (most < 4) return undefined
    const unit = Math.min(most, 4 + Math.floor(raw.width * (most - 3)))
    const [width, height] = [unit * across, unit * down]
    return { kind: 'image', boxId: builder.boxId(), format, width, height, ...placed(width), estimate: height }
  }
  if (raw.what === 2) {
    const fontSize = FONT_SIZES[raw.value % FONT_SIZES.length]!
    let count = 1 + (raw.value >> 3) % 2
    const textWidth = () => Math.ceil(count * TOKEN_EM * fontSize + (count - 1) * SPACE_EM * fontSize)
    if (textWidth() + 4 > context.width) count = 1
    const width = Math.min(context.width, Math.max(textWidth() + 4, 60 + Math.floor(raw.width * 240)))
    const height = Math.min(room, Math.max(Math.ceil(fontSize * 1.5) + 4, 24 + Math.floor(raw.height * 120)))
    if (height < Math.ceil(fontSize * 1.5) + 4 || width < textWidth() + 4) return undefined
    const tokens = Array.from({ length: count }, () => builder.token('w'))
    const x = Math.floor(((raw.value >> 4) % 10) / 10 * (width - textWidth()))
    // The baseline leaves one em above (the ascent) and 0.3 em below (the descent).
    const y = Math.ceil(fontSize) + Math.floor(raw.y * Math.max(0, height - Math.ceil(fontSize * 1.3)))
    return { kind: 'svg', boxId: builder.boxId(), width, height, ...placed(width), text: { tokens, x, y, fontSize }, estimate: height }
  }
  if (builder.tagged) return undefined
  const field = raw.what === 3 ? 'text' : raw.what === 4 ? 'checkbox' : 'select'
  const side = 8 + Math.floor(raw.width * 12)
  const width = Math.min(context.width, field === 'checkbox' ? side : field === 'text' ? 40 + Math.floor(raw.width * 210) : 40 + Math.floor(raw.width * 160))
  const height = field === 'checkbox' ? side : field === 'text' ? 12 + Math.floor(raw.height * 24) : 12 + Math.floor(raw.height * 12)
  if (height > room) return undefined
  const name = builder.fieldName()
  const spec: FieldSpec = { kind: 'field', boxId: builder.boxId(), field, name, boxed: (raw.value >> 1) % 2 === 0, width, height, ...placed(width), estimate: height }
  if (field === 'text') {
    spec.value = `${name}v${FIELD_WORDS[raw.value % FIELD_WORDS.length]}`
    if (raw.flag) spec.maxLength = [...spec.value].length + raw.value % 4
  }
  else if (field === 'checkbox') {
    spec.checked = raw.flag
    if (raw.value % 3 === 0) spec.exportValue = 'Agreed'
  }
  else {
    const count = 2 + raw.value % 3
    spec.options = Array.from({ length: count }, (_, index) => `${name}o${'abcd'[index]}`)
    spec.value = spec.options[(raw.value >> 2) % count]!
  }
  return spec
}

/** Height of a node with its vertical margins. */
const outerHeight = (node: NodeSpec): number => {
  if (node.kind === 'text' || node.kind === 'table') return node.estimate + node.marginTop + node.marginBottom
  if (node.kind === 'view') return node.estimate + node.margin[0] + node.margin[2]
  if (node.kind === 'link') return node.estimate
  return node.estimate + node.marginTop
}

/** The nodes inside a view or block link; none for the other kinds. */
export const childrenOf = (node: NodeSpec): readonly NodeSpec[] => node.kind === 'view' || node.kind === 'link' ? node.children : []

/** The first leaf in reading order; views and links that hold nothing are passed over. */
const firstLeaf = (nodes: readonly NodeSpec[]): NodeSpec | undefined => {
  for (const node of nodes) {
    if (node.kind !== 'view' && node.kind !== 'link') return node
    const inner = firstLeaf(childrenOf(node))
    if (inner) return inner
  }
  return undefined
}

/**
 * The first leaf holds a token (a text, table or SVG), so the node's first
 * token is on the page where the node starts. An image or field first can
 * fill that page and push the first token to the next one (H5). In the
 * profiles without images and fields this is "holds a token".
 */
const startsWithText = (nodes: readonly NodeSpec[]): boolean => {
  const leaf = firstLeaf(nodes)
  return leaf !== undefined && leaf.kind !== 'image' && leaf.kind !== 'field'
}

/** Widths of the columns at a table width, or undefined when one is narrower than `minimum` or they overflow. */
const columnWidths = (columns: readonly PdfTableColumn[], width: number, minimum: number): number[] | undefined => {
  const fixed = columns.map(column => typeof column === 'number'
    ? 0
    : column.endsWith('%') ? Number(column.slice(0, -1)) / 100 * width : Number(column.slice(0, -2)))
  const shares = columns.reduce<number>((sum, column) => sum + (typeof column === 'number' ? column : 0), 0)
  const free = width - fixed.reduce((sum, value) => sum + value, 0)
  const widths = columns.map((column, index) => typeof column === 'number' ? free * column / shares : fixed[index]!)
  return free >= 0 && widths.every(value => value >= minimum) ? widths : undefined
}

const normalizeTable = (raw: RawTable, context: Context, builder: Builder): TableSpec => {
  const fontSize = FONT_SIZES[raw.font] ?? 10
  const width = context.width
  // word-wider-than-line: a column holds the widest token and the padding.
  const minimum = Math.ceil(TOKEN_EM * fontSize * 1.1) + 2 * CELL_PAD_X
  const count = Math.max(1, Math.min(raw.columns.length, Math.floor(width / minimum)))
  // column-units: shares 1 to 4, whole pt lengths, whole percentages.
  let columns = raw.columns.slice(0, count).map(({ kind, value }): PdfTableColumn => {
    if (kind === 1) return `${Math.round(minimum + value * width / 2)}pt`
    if (kind === 2) return `${Math.min(90, Math.ceil(100 * minimum / width) + Math.floor(value * 30))}%`
    return 1 + Math.floor(value * 4)
  })
  if (columns.length === 0) columns = [1]
  let widths = columnWidths(columns, width, minimum)
  if (!widths) {
    columns = columns.map(() => 1)
    widths = columnWidths(columns, width, minimum)!
  }
  const edges = [context.left]
  for (const value of widths) edges.push(edges.at(-1)! + value)
  const rawRows: RawRow[] = raw.rows.length > 0 ? raw.rows : [{ wrap: false, cells: [] }]
  const perCell = Math.max(1, Math.floor(TABLE_TOKEN_BUDGET / (rawRows.length * columns.length)))
  const cellHeight = (cell: CellSpec): number =>
    textEstimate(cell.tokens.length, fontSize, undefined, edges[cell.start + cell.span]! - edges[cell.start]! - 2 * CELL_PAD_X) + 2 * CELL_PAD_Y
  const cells = (raws: readonly RawCell[], letter: 'w' | 'k', maxTokens: number): CellSpec[] => {
    const result: CellSpec[] = []
    let used = 0
    for (const rawCell of raws) {
      if (used >= columns.length) break
      const span = Math.min(1 + rawCell.span, columns.length - used)
      const tokens = Array.from({ length: Math.max(1, Math.min(rawCell.n, maxTokens)) }, () => builder.token(letter))
      const cell: CellSpec = { tokens, start: used, span, align: CELL_ALIGNS[rawCell.align] ?? 'left' }
      const link = inlineLink(rawCell, tokens, builder)
      if (link) cell.link = link
      result.push(cell)
      used += span
    }
    // Every row holds a token, so I9 can find its page.
    while (result.length === 0) {
      result.push({ tokens: [builder.token(letter)], start: used, span: 1, align: 'left' })
      used += 1
    }
    return result
  }
  let header = raw.header ? cells(raw.headerCells, 'k', 4) : undefined
  let headerHeight = header ? Math.max(...header.map(cellHeight)) : 0
  // fixed-fills-page: the header repeats on every page of the table.
  if (header && headerHeight > context.fitRoom * 0.5) {
    header = undefined
    headerHeight = 0
  }
  // unbreakable-higher-than-page, fixed-leaves-less-than-unbreakable: the
  // room of an unbreakable row on a fresh page, below the header.
  const room = (context.fitRoom - headerHeight) * 0.9
  const rows = rawRows.map((rawRow) => {
    const rowCells = cells(rawRow.cells, 'w', perCell)
    const estimate = Math.max(...rowCells.map(cellHeight))
    const wrap = rawRow.wrap || estimate > room
    return { row: { wrap, cells: rowCells }, estimate }
  })
  return {
    kind: 'table',
    tableId: builder.tableId(),
    fontSize,
    columns,
    edges,
    ...(header ? { header } : {}),
    rows: rows.map(({ row }) => row),
    marginTop: raw.marginTop,
    marginBottom: raw.marginBottom,
    estimate: headerHeight + rows.reduce((sum, { estimate }) => sum + estimate, 0),
  }
}

const normalizeNodes = (raws: readonly RawNode[], context: Context, builder: Builder, profile: Profile): NodeSpec[] =>
  raws.flatMap((raw): NodeSpec | NodeSpec[] => {
    if (raw.t === 'text') return normalizeText(raw, context, builder, profile)
    if (raw.t === 'table') return normalizeTable(raw, context, builder)
    if (raw.t === 'box') return normalizeBox(raw, context, builder) ?? []
    if (raw.t === 'link') {
      const children = raw.children.map(child => normalizeText(child, { ...context, insideLink: true }, builder, profile))
      // A link with no text has no line its rectangle could lie on (shrinking
      // can empty one).
      if (children.length === 0) return []
      const estimate = children.reduce((sum, child) => sum + outerHeight(child), 0)
      // The link's tokens: all tokens of its texts, in order.
      const link = builder.link(raw.kind, children.flatMap(child => child.tokens), raw.linkTo)
      return { kind: 'link', link, children, estimate }
    }
    const margin = clampBox(raw.margin, context.width)
    const afterMargin = context.width - margin[1] - margin[3]
    const padding = clampBox(raw.padding, afterMargin - 2 * raw.border)
    const border = afterMargin - 2 * raw.border - padding[1] - padding[3] >= MIN_TEXT_WIDTH ? raw.border : 0
    const inner = afterMargin - padding[1] - padding[3] - 2 * border
    const vertical = margin[0] + margin[2] + padding[0] + padding[2] + 2 * border
    const minHeight = Math.min(raw.minHeight, Math.max(0, Math.floor(context.fitRoom * 0.8 - vertical)))
    const childContext: Context = {
      width: inner,
      left: context.left + margin[3] + border + padding[3],
      fitRoom: context.fitRoom - vertical,
      insideUnbreakable: context.insideUnbreakable || !raw.wrap,
      insideLink: context.insideLink,
    }
    const children = normalizeNodes(raw.children, childContext, builder, profile)
    const content = children.reduce((sum, child) => sum + outerHeight(child), 0)
    const estimate = Math.max(minHeight, content + padding[0] + padding[2] + 2 * border)
    const fits = estimate + margin[0] + margin[2] <= context.fitRoom * 0.9
    const wrap = raw.wrap || !fits
    const view: ViewSpec = {
      kind: 'view',
      margin,
      padding,
      border,
      minHeight,
      wrap,
      brk: raw.brk && !context.insideUnbreakable,
      children,
      estimate,
    }
    // bookmark-without-text
    if (raw.bookmark && startsWithText(children)) view.bookmark = builder.bookmark()
    // A view that turned breakable may hold a child the child context
    // marked as inside an unbreakable block: such children only lost a
    // break, which stays valid.
    return view
  })

/** Height bound of a fixed node: one line, its margin, the view's padding (none). */
const fixedHeight = (fixed: FixedSpec): number => fixed.fontSize * DEFAULT_LINE_EM + 2 + fixed.marginBottom

const normalizeFixed = (raw: RawFixed, page: PageSpec, builder: Builder): FixedSpec => {
  const { width } = pageDimensions(page)
  const fontSize = FONT_SIZES[raw.font] ?? 10
  const tokens = Array.from({ length: raw.n }, () => builder.token('h'))
  const numbers: FixedSpec['numbers'] = []
  if (raw.numbers === 1 || raw.numbers === 3) numbers.push({ kind: 'pageNumber', prefix: builder.numberPrefix('n') })
  if (raw.numbers === 2 || raw.numbers === 3) numbers.push({ kind: 'pageCount', prefix: builder.numberPrefix('c') })
  const spec: FixedSpec = {
    container: raw.kind === 0 ? 'text' : 'view',
    pages: FIXED_PAGES[raw.pages] ?? 'all',
    tokens,
    fontSize,
    numbers,
    marginBottom: raw.marginBottom,
  }
  // fixed-link
  if (raw.link && spec.pages === 'all' && numbers.length === 0 && !builder.tagged) spec.link = builder.link(1, tokens, 0)
  if (raw.absolute) {
    // absolute-over-text: wide enough for the whole text on one line (numbers
    // of up to four digits), so it cannot wrap out of its band.
    const characters = [...tokens, ...numbers.map(number => `${number.prefix}9999`)].join(' ').length
    const room = Math.floor((width - characters * GLYPH_EM * fontSize) / 2)
    const inset = Math.max(0, Math.min(raw.inset, Math.floor((width - 2 * MIN_TEXT_WIDTH) / 2), room))
    // Its band position comes from placeAbsolute.
    spec.absolute = { top: 0, left: inset, right: inset }
  }
  return spec
}

/**
 * absolute-over-text (R4): stack the absolute texts of each band (the top
 * one, or the bottom one with `fromBottom`) inside that padding band, from
 * `offset` of the free band on. A band too low grows if the content area keeps
 * MIN_CONTENT; otherwise its texts are in flow.
 */
const placeAbsolute = (page: PageSpec, raws: readonly RawFixed[]): void => {
  const { height } = pageDimensions(page)
  for (const fromBottom of [false, true]) {
    const band = page.fixed.filter((fixed, index) => fixed.absolute && raws[index]!.fromBottom === fromBottom)
    if (band.length === 0) continue
    const side = fromBottom ? 2 : 0
    const needed = Math.ceil(band.reduce((sum, fixed) => sum + fixedHeight(fixed), 0))
    if (needed > page.padding[side]) {
      if (height - page.padding[0] - page.padding[2] - (needed - page.padding[side]) < MIN_CONTENT) {
        for (const fixed of band) delete fixed.absolute
        continue
      }
      page.padding[side] = needed
    }
    let at = Math.floor(raws[page.fixed.indexOf(band[0]!)]!.offset * (page.padding[side] - needed))
    for (const fixed of band) {
      const { left, right } = fixed.absolute!
      fixed.absolute = fromBottom ? { bottom: at, left, right } : { top: at, left, right }
      at += fixedHeight(fixed)
    }
  }
}

const visitTexts = (nodes: readonly NodeSpec[], visit: (text: TextSpec) => void): void => {
  for (const node of nodes) {
    if (node.kind === 'text') visit(node)
    else visitTexts(childrenOf(node), visit)
  }
}

/** Every link of a page, in tree order. */
const visitLinks = (page: PageSpec, visit: (link: LinkSpec) => void): void => {
  for (const fixed of page.fixed) if (fixed.link) visit(fixed.link)
  const nodes = (list: readonly NodeSpec[]): void => {
    for (const node of list) {
      if (node.kind === 'text') {
        if (node.link) visit(node.link.link)
      }
      else if (node.kind === 'link') visit(node.link)
      else if (node.kind === 'table') {
        for (const cell of [...node.header ?? [], ...node.rows.flatMap(row => row.cells)]) if (cell.link) visit(cell.link.link)
      }
      else nodes(childrenOf(node))
    }
  }
  nodes(page.children)
}

/** Turn any raw document into a valid spec. */
/**
 * field-at-page-end (mixed, untagged, every document whose first page has an
 * even top padding): a last page whose text and spacer view end half a free
 * text field above the bottom of the content box, so the field meets the page
 * edge. A field never splits (f5a): it moves whole to the next PDF page. The
 * page comes after the page references and links are chosen, so it changes
 * no other node of the document.
 */
const edgePage = (last: PageSpec, builder: Builder, profile: Profile): PageSpec => {
  const page: PageSpec = { size: last.size, landscape: !last.landscape, padding: [20, 20, 20, 20], fixed: [], children: [] }
  const { width, height } = pageDimensions(page)
  const contentHeight = height - 40
  const context: Context = { width: width - 40, left: 20, fitRoom: contentHeight, insideUnbreakable: false, insideLink: false }
  const text = normalizeText({
    t: 'text', n: 1, font: 2, lineHeight: 0, align: 0, wrap: true, brk: false,
    marginTop: 0, marginBottom: 0, extra: 0, ref: 0,
  }, context, builder, profile)
  page.children = [text]
  const [field] = normalizeNodes([{ t: 'box', what: 3, width: 0.5, height: 0.5, x: 0, y: 0, marginTop: 0, flag: false, value: 2 }], context, builder, profile)
  if (field?.kind !== 'field') return page
  const minHeight = contentHeight - outerHeight(text) - field.height / 2
  page.children.push(
    { kind: 'view', margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], border: 0, minHeight, wrap: true, brk: false, children: [], estimate: minHeight },
    field,
  )
  return page
}

export const normalizeDocument = (raw: RawDocument, profile: Profile, { prefix = '' }: { prefix?: string } = {}): DocumentSpec => {
  const tagged = profile === 'mixed' && raw.tagged === true
  const builder = new Builder(prefix, profile, tagged)
  let previous: PageSpec | undefined
  const pages = raw.pages.map((rawPage): PageSpec => {
    const size = PAGE_SIZES[rawPage.size] ?? PAGE_SIZES[0]
    // mixed: a page differs from the one before in size or orientation.
    const same = profile === 'mixed' && previous !== undefined && previous.size.width === size.width && previous.size.height === size.height && previous.landscape === rawPage.landscape
    const page: PageSpec = {
      size: { ...(size.name ? { name: size.name } : {}), width: size.width, height: size.height },
      landscape: same ? !rawPage.landscape : rawPage.landscape,
      padding: [0, 0, 0, 0],
      fixed: [],
      children: [],
    }
    previous = page
    const { width, height } = pageDimensions(page)
    const [top, right, bottom, left] = rawPage.padding
    // Content area at least MIN_CONTENT in both directions.
    page.padding = [
      height - top - bottom >= MIN_CONTENT ? top : 0,
      width - left - right >= MIN_CONTENT ? right : 0,
      height - top - bottom >= MIN_CONTENT ? bottom : 0,
      width - left - right >= MIN_CONTENT ? left : 0,
    ]
    // Fixed nodes first, in raw order (fixed-after-flow, fixed-inside-view).
    if (withFixed(profile)) {
      page.fixed = rawPage.fixed.map(fixed => normalizeFixed(fixed, page, builder))
      placeAbsolute(page, rawPage.fixed)
    }
    const contentHeight = height - page.padding[0] - page.padding[2]
    // fixed-fills-page, fixed-leaves-less-than-unbreakable: every in-flow
    // fixed node counts against the room, whatever its pages value.
    const reserve = page.fixed.filter(fixed => !fixed.absolute).reduce((sum, fixed) => sum + fixedHeight(fixed), 0)
    const context: Context = {
      width: width - page.padding[1] - page.padding[3],
      left: page.padding[3],
      fitRoom: contentHeight - reserve,
      insideUnbreakable: false,
      insideLink: false,
    }
    page.children = normalizeNodes(rawPage.children, context, builder, profile)
    // A page needs one flow token to mark its first PDF page (I5, I7). R3: a
    // page whose nodes hold no text (an emptied page, or only empty views)
    // gets a text first, so that token is on the page's first PDF page. H5:
    // so does a page whose first leaf is an image or field (startsWithText).
    if (!startsWithText(page.children)) {
      page.children.unshift(normalizeText({
        t: 'text', n: 1, font: 2, lineHeight: 0, align: 0, wrap: true, brk: false,
        marginTop: 0, marginBottom: 0, extra: 0, ref: 0,
      }, context, builder, profile))
    }
    if (rawPage.bookmark) page.bookmark = builder.bookmark()
    return page
  })

  // Page reference targets: texts without a suffix, chosen by the raw index.
  const texts: TextSpec[] = []
  for (const page of pages) visitTexts(page.children, text => texts.push(text))
  const targets = texts.filter(text => text.suffix === undefined)
  const idOf = (target: TextSpec): string => {
    target.id ??= `${prefix}t${target.textId}`
    return target.id
  }
  for (const page of pages) {
    visitTexts(page.children, (text) => {
      if (text.suffix?.kind !== 'pageRef') return
      const target = targets[text.suffix.pick % targets.length]
      if (!target) {
        delete text.suffix
        return
      }
      text.suffix.to = idOf(target)
      text.suffix.target = target.tokens[0]!
    })
  }
  // Internal link targets: a different text for each link, so each named
  // destination has one link and the rectangles of a link can be told apart.
  // Links left without a text point outside.
  const taken = new Set<TextSpec>()
  for (const page of pages) {
    visitLinks(page, (link) => {
      if (link.kind !== 'internal') return
      const start = link.pick % texts.length
      const target = [...texts.slice(start), ...texts.slice(0, start)].find(text => !taken.has(text))
      if (!target) {
        Object.assign(link, { kind: 'external', href: `https://example.com/l${link.linkId}` })
        return
      }
      taken.add(target)
      link.id = idOf(target)
      link.href = `#${link.id}`
      link.target = target.tokens[0]!
    })
  }
  // tagged: the first top-level text of each page is a heading, h1 on the
  // first page and h2 after it, so the levels never skip.
  if (tagged) {
    let level = 1
    for (const page of pages) {
      const first = page.children.find((node): node is TextSpec => node.kind === 'text')
      if (!first) continue
      first.heading = level
      level = 2
    }
  }
  if (profile === 'mixed' && !tagged && raw.pages[0]!.padding[0] % 2 === 0) pages.push(edgePage(pages.at(-1)!, builder, profile))
  return { profile, pages, ...(tagged ? { tagged } : {}) }
}

/** What the PDF must show, from the spec alone. */
export const expectationsOf = (spec: DocumentSpec): Expectations => {
  const tokens = new Map<string, TokenFact>()
  const numbers: NumberFact[] = []
  const markers: string[] = []
  const tables: TableFact[] = []
  const links: LinkFact[] = []
  const bookmarks: BookmarkFact[] = []
  const boxes: BoxFact[] = []
  const svgTexts: SvgTextFact[] = []
  const fields: FieldFact[] = []
  const faces: Expectations['faces'] = []
  const rtl: Expectations['rtl'] = []
  const headings: number[] = []
  let figures = 0
  let order = 0
  let blocks = 0

  const linkFact = (link: LinkSpec): LinkFact => ({
    linkId: link.linkId,
    kind: link.kind,
    href: link.href,
    tokens: link.tokens,
    ...(link.id === undefined ? {} : { id: link.id, target: link.target! }),
  })

  spec.pages.forEach((page, pdfPage) => {
    for (const fixed of page.fixed) {
      const absolute = fixed.absolute !== undefined
      for (const token of fixed.tokens) tokens.set(token, { token, kind: 'fixed', pdfPage, pages: fixed.pages, absolute, order: -1 })
      for (const number of fixed.numbers) numbers.push({ ...number, fixed: true, pdfPage, pages: fixed.pages, absolute, order: -1 })
      if (fixed.link) links.push(linkFact(fixed.link))
    }
    let marker: string | undefined
    const pageBookmark: BookmarkFact | undefined = page.bookmark ? { title: page.bookmark, at: { pdfPage }, children: [] } : undefined
    if (pageBookmark) bookmarks.push(pageBookmark)
    // Bookmarks of views and texts wait for the first token inside them.
    const waiting: BookmarkFact[] = []
    const placeToken = (token: string) => {
      marker ??= token
      for (const bookmark of waiting.splice(0)) bookmark.at = { token }
    }
    const visit = (nodes: readonly NodeSpec[], block: number | undefined, outline: BookmarkFact[]) => {
      for (const node of nodes) {
        if (node.kind === 'table') {
          const tableOrder = order++
          const cellFact = (cell: CellSpec): CellFact => ({ tokens: cell.tokens, left: node.edges[cell.start]!, right: node.edges[cell.start + cell.span]!, align: cell.align })
          for (const cell of node.rows.flatMap(row => row.cells)) {
            for (const token of cell.tokens) {
              placeToken(token)
              tokens.set(token, { token, kind: 'cell', pdfPage, absolute: false, order: tableOrder, ...(block === undefined ? {} : { block }) })
            }
          }
          for (const cell of node.header ?? []) {
            for (const token of cell.tokens) tokens.set(token, { token, kind: 'header', pdfPage, absolute: false, order: -1 })
          }
          for (const cell of [...node.header ?? [], ...node.rows.flatMap(row => row.cells)]) if (cell.link) links.push(linkFact(cell.link.link))
          tables.push({
            tableId: node.tableId,
            fontSize: node.fontSize,
            header: (node.header ?? []).map(cellFact),
            rows: node.rows.map(row => ({ wrap: row.wrap, cells: row.cells.map(cellFact) })),
          })
          continue
        }
        if (node.kind === 'image' || node.kind === 'svg' || node.kind === 'field') {
          const { boxId, width, height, left } = node
          boxes.push({ boxId, kind: node.kind, color: boxColor(boxId), width, height, left, painted: node.kind !== 'field' || node.boxed })
          if (node.kind === 'svg') {
            figures += 1
            svgTexts.push({ boxId, tokens: node.text.tokens, x: node.text.x, y: node.text.y })
            faces.push({ tokens: node.text.tokens, postscript: BODY_FONT.postscript })
            for (const token of node.text.tokens) {
              placeToken(token)
              tokens.set(token, { token, kind: 'flow', pdfPage, absolute: false, order: order++, ...(block === undefined ? {} : { block }) })
            }
          }
          else if (node.kind === 'image') figures += 1
          else {
            const value = node.field === 'checkbox' ? node.checked ? node.exportValue ?? 'Yes' : 'Off' : node.field === 'select' ? [node.value!] : node.value!
            fields.push({ boxId, name: node.name, field: node.field, width, height, pdfPage, boxed: node.boxed, value })
          }
          continue
        }
        // A block link wraps like any view.
        if (node.kind === 'link') {
          links.push(linkFact(node.link))
          visit(node.children, block, outline)
          continue
        }
        // The outermost unbreakable block counts: every token inside it
        // shares its page.
        const own = block ?? (node.wrap ? undefined : blocks++)
        const bookmark: BookmarkFact | undefined = node.bookmark ? { title: node.bookmark, at: { token: '' }, children: [] } : undefined
        if (bookmark) {
          outline.push(bookmark)
          waiting.push(bookmark)
        }
        if (node.kind === 'view') {
          visit(node.children, own, bookmark?.children ?? outline)
          continue
        }
        if (node.link) links.push(linkFact(node.link.link))
        if (node.heading !== undefined) headings.push(node.heading)
        if (node.face !== undefined) faces.push({ tokens: node.tokens, postscript: FONT_FACES[node.face]!.postscript })
        if (node.script) faces.push({ tokens: node.tokens, postscript: SCRIPT_FONTS[node.script.kind].postscript })
        if (node.script?.kind === 'rtl') rtl.push({ code: node.tokens[0]!, word: node.script.word })
        for (const token of node.tokens) {
          placeToken(token)
          tokens.set(token, { token, kind: 'flow', pdfPage, absolute: false, order: order++, ...(own === undefined ? {} : { block: own }) })
        }
        if (node.suffix) {
          marker ??= node.suffix.prefix
          numbers.push({
            kind: node.suffix.kind,
            prefix: node.suffix.prefix,
            fixed: false,
            pdfPage,
            absolute: false,
            order: order++,
            ...(node.suffix.kind === 'pageRef' ? { target: node.suffix.target } : {}),
            ...(own === undefined ? {} : { block: own }),
          })
        }
      }
    }
    visit(page.children, undefined, pageBookmark?.children ?? bookmarks)
    markers.push(marker!)
  })
  return { tokens, numbers, markers, blocks, tables, links, bookmarks, boxes, svgTexts, fields, faces, rtl, headings, figures, tagged: spec.tagged === true }
}
