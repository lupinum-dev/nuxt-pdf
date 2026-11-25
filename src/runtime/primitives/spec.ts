// The machinery of the primitive table: the internal props, the runtime
// checks of a prop, the spec of a table entry and the helpers that bind an
// entry to its public props type.

/**
 * Internal prop that `PdfTableCell` sets on the view or text it renders when
 * the author writes `header`; the structure planner reads it in a tagged
 * document (a body cell becomes a row header), and the engine adapter drops
 * it before layout. Not part of the public prop types.
 */
export const PDF_HEADER_CELL_PROP = '__nuxtPdfHeaderCell'

/**
 * Internal prop that `PdfTable` sets on its view when its columns hold an
 * `'auto'` column: the column list. The layout's measure step reads it, with
 * `PDF_TABLE_CELL_PROP`, to turn measured content widths into flex styles.
 */
export const PDF_TABLE_COLUMNS_PROP = '__nuxtPdfTableColumns'

/**
 * Internal prop that `PdfRichText` sets on a `PdfFootnote` without a note
 * when its content marks a note again (a second `[^1]` in Markdown): the
 * place of that note among the notes of the same `PdfRichText`, from 1. The
 * engine adapter prints the mark of that note.
 */
export const PDF_FOOTNOTE_REPEAT_PROP = '__nuxtPdfFootnoteRepeat'

/**
 * Internal prop that `PdfRichText` sets on the text it prints for a table
 * caption, right before the table. In a tagged document the structure
 * planner makes that text the table's `Caption` (server/engine/tagged.ts);
 * the engine adapter drops it before layout.
 */
export const PDF_TABLE_CAPTION_PROP = '__nuxtPdfTableCaption'

/**
 * Internal prop that `PdfTableCell` sets, in a table with `'auto'` columns, on
 * the node that takes the columns of a cell or of an empty column, when they
 * hold an `'auto'` or share column: the indices of those columns, in order.
 * That node is the visible cell (a view, or a text for a text-only cell), the
 * view around a cell over several rows, or the view of an empty column. The
 * measure step writes the flex styles of that node (`measureColumns`).
 */
export const PDF_TABLE_CELL_PROP = '__nuxtPdfTableCell'

/**
 * Internal prop that `PdfTableCell` sets on the view that takes its columns
 * in its first row when it spans rows: how many rows it spans, from 2. The
 * visible cell inside that view is absolute; the layout sets its height to
 * the rows it covers (`layout/dimensions/row-spans.ts`), pagination keeps
 * those rows on one page, the painter paints the cell after the rows, and
 * tagging writes `RowSpan`.
 */
export const PDF_ROW_SPAN_PROP = '__nuxtPdfRowSpan'

/**
 * Internal prop that `PdfTableRow` sets on its view when the author writes
 * `running`: the `{ name, text }` the row sets (layout/paginate/running.ts).
 * The engine adapter turns it into the setter of the row.
 */
export const PDF_RUNNING_ROW_PROP = '__nuxtPdfRunningRow'

/** Props in the table that the public prop types leave out. */
type PdfInternalProp = typeof PDF_HEADER_CELL_PROP | typeof PDF_TABLE_CAPTION_PROP | typeof PDF_TABLE_COLUMNS_PROP | typeof PDF_TABLE_CELL_PROP | typeof PDF_ROW_SPAN_PROP | typeof PDF_RUNNING_ROW_PROP | typeof PDF_FOOTNOTE_REPEAT_PROP

/**
 * Runtime check for one prop value. `renderer/validate-props.ts` implements
 * each check; a check without an implementation does not compile.
 */
export type PdfPropCheck
  = | 'attachmentData'
    | 'attachmentName'
    | 'altText'
    | 'attachmentRelationship'
    | 'bookmark'
    | 'boolean'
    | 'break'
    | 'conformance'
    | 'contentsLeader'
    | 'contentsLevels'
    | 'contentsStyles'
    | 'facturXInvoice'
    | 'facturXProfile'
    | 'facturXRelationship'
    | 'fieldExportValue'
    | 'fieldName'
    | 'fieldOptions'
    | 'fieldText'
    | 'fixedPages'
    | 'footnotes'
    | 'footnoteStyles'
    | 'hitSlop'
    | 'imageSource'
    | 'linkTarget'
    | 'mimeType'
    | 'nonEmptyId'
    | 'nonNegativeNumber'
    | 'orientation'
    | 'pageLayout'
    | 'pageSize'
    | 'pdfVersion'
    | 'positiveInteger'
    | 'positiveNumber'
    | 'protection'
    | 'running'
    | 'runningAt'
    | 'runningName'
    | 'runningRow'
    | 'string'
    | 'svgColor'
    | 'svgFill'
    | 'svgNonNegative'
    | 'strokeLinecap'
    | 'strokeLinejoin'
    | 'svgNumber'
    | 'svgStroke'
    | 'svgStrokeWidth'
    | 'svgTransform'
    | 'svgUnitInterval'
    | 'tableCellColumns'
    | 'tableColumns'
    | 'textTag'
    | 'viewBox'
    | 'viewTag'

/**
 * `flow`: the element belongs to page flow and fails inside `PdfSvg`.
 * `svg`: the element (or prop) is only supported inside SVG text.
 */
export type PdfPrimitiveContext = 'flow' | 'svg'

/**
 * A page token: an inline element that the engine adapter replaces by text.
 * `page`: its value differs per page (number, count, running value), so the
 * text that holds it is laid out on each page. `document`: one value for
 * every page, the page of a destination from the previous pass.
 */
export type PdfPageToken = 'page' | 'document'

export type PdfPropRule = {
  readonly check?: PdfPropCheck
  readonly required?: true
  /** Only `PdfText` props use this: they belong to flow text or SVG text. */
  readonly context?: PdfPrimitiveContext
}

type PdfPrimitiveSpec = {
  /** Host tag in the mounted tree and in the engine. */
  readonly tag: string
  readonly props: Readonly<Record<string, PdfPropRule>>
  /** Component names of the primitives this one may contain. */
  readonly children: readonly string[]
  /** Holds text runs (string children). */
  readonly text?: true
  /** Its `id` is a target for `#id` links and page references. */
  readonly destination?: true
  readonly context?: PdfPrimitiveContext
  readonly token?: PdfPageToken
}

type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never
type PropName<Props> = Extract<KeysOfUnion<Props>, string>
type IsRequiredIn<Props, Key> = Props extends unknown
  ? Key extends keyof Props
    ? Record<never, never> extends Pick<Props, Key> ? false : true
    : false
  : never
/** Props that every member of a props union requires. */
type AlwaysRequired<Props> = {
  [Key in PropName<Props>]: false extends IsRequiredIn<Props, Key> ? never : Key
}[PropName<Props>]
type RequiredRules<Rules> = {
  [Key in keyof Rules]: Rules[Key] extends { readonly required: true } ? Key : never
}[keyof Rules]

/** Props required in the type but not in the rules, or the other way round. */
type RequiredMismatch<Props, Rules>
  = | Exclude<AlwaysRequired<Props>, RequiredRules<Rules>>
    | Exclude<RequiredRules<Rules>, AlwaysRequired<Props>>

/** `unknown` when the rules match the props type exactly; otherwise a type that names the mismatch. */
type MatchesProps<Props, Rules>
  = [Exclude<PropName<Props>, keyof Rules>] extends [never]
    ? [Exclude<keyof Rules, PropName<Props> | PdfInternalProp>] extends [never]
        ? [RequiredMismatch<Props, Rules>] extends [never]
            ? unknown
            : { readonly __requiredMismatch: RequiredMismatch<Props, Rules> }
        : { readonly __unknownProps: Exclude<keyof Rules, PropName<Props> | PdfInternalProp> }
    : { readonly __missingProps: Exclude<PropName<Props>, keyof Rules> }

/**
 * Bind a table entry to its public props type. It does not compile when a prop
 * name is missing or unknown, or when `required` differs from the type.
 */
export const primitive = <Props>() =>
  <const Spec extends PdfPrimitiveSpec>(
    spec: Spec & { readonly props: MatchesProps<Props, Spec['props']> },
  ): Spec & { readonly propsType?: Props } => spec

export const value = {} as const
export const boolean = { check: 'boolean' } as const
export const svgNumber = { check: 'svgNumber' } as const
export const svgNonNegative = { check: 'svgNonNegative' } as const
export const svgUnitInterval = { check: 'svgUnitInterval' } as const
export const required = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, required: true }) as const
export const flow = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, context: 'flow' }) as const
export const svg = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, context: 'svg' }) as const

export const BASE_PROPS = {
  break: { check: 'break' },
  debug: boolean,
  decorative: boolean,
  fixed: boolean,
  id: value,
  keepWithNext: boolean,
  minPresenceAhead: { check: 'nonNegativeNumber' },
  style: value,
} as const
export const string = { check: 'string' } as const
export const BOOKMARK_PROP = { bookmark: { check: 'bookmark' } } as const

export const HEADER_CELL = { [PDF_HEADER_CELL_PROP]: boolean } as const
export const TABLE_MEASURE = {
  [PDF_TABLE_COLUMNS_PROP]: { check: 'tableColumns' },
  [PDF_TABLE_CELL_PROP]: { check: 'tableCellColumns' },
} as const
export const ROW_SPAN = { [PDF_ROW_SPAN_PROP]: { check: 'positiveInteger' } } as const
export const RUNNING_ROW = { [PDF_RUNNING_ROW_PROP]: { check: 'runningRow' } } as const
export const FIXED_PAGES = { check: 'fixedPages' } as const
