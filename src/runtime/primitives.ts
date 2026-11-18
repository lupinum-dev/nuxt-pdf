// The PDF primitives: their public prop types and the one table that declares
// each primitive. Vue-free, so the engine adapter and the render worker can
// import it.
import type { PdfStyleValue } from './authoring'
import type { EInvoice, EInvoiceProfile } from './einvoice/types'

export type PdfBookmark = string | {
  title: string
  expanded?: boolean
}

export type PdfBaseProps = {
  id?: string
  fixed?: boolean
  break?: boolean
  debug?: boolean
  minPresenceAhead?: number
  style?: PdfStyleValue
  /**
   * In a PDF/UA-1 document: the node and everything inside it is decoration,
   * which assistive technology skips (a PDF artifact). No effect otherwise.
   */
  decorative?: boolean
}

// Outline entries are typed only where they are claimed and tested
// (Page/View/Text/Image); see CONFORMANCE.md.
type PdfBookmarkProp = {
  bookmark?: PdfBookmark
}

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

export type PdfPageUnit = 'pt' | 'in' | 'mm' | 'cm' | 'px'
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

/** Numeric SVG values accepted by the pinned layout parser. */
export type PdfSvgNumber = number | `${number}`
export type PdfSvgLength = PdfSvgNumber | `${number}%`
export type PdfSvgTransformOperation
  = | `translate(${number})`
    | `translate(${number},${number})`
    | `translate(${number}, ${number})`
    | `translate(${number} ${number})`
    | `rotate(${number})`
export type PdfSvgTransform
  = | PdfSvgTransformOperation
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`
    | `${PdfSvgTransformOperation} ${PdfSvgTransformOperation} ${PdfSvgTransformOperation}`

/** The pages of its parent on which a `fixed` node appears. */
export const PDF_FIXED_PAGES = ['all', 'first', 'continuation'] as const

/** How an attached file relates to the document (the PDF `AFRelationship` key). */
export const PDF_ATTACHMENT_RELATIONSHIPS = ['Alternative', 'Data', 'Source', 'Supplement', 'Unspecified'] as const
export type PdfAttachmentRelationship = typeof PDF_ATTACHMENT_RELATIONSHIPS[number]

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
 * The levels a `conformance` value claims, in table order; empty for no
 * claim. Unknown entries are left out: tree validation rejects them first.
 */
export const pdfConformanceLevels = (value: unknown): PdfConformance[] => {
  const claimed: readonly unknown[] = Array.isArray(value) ? value : [value]
  return PDF_CONFORMANCE_LEVELS.filter(level => claimed.includes(level) && CONFORMANCE_LEVEL_SET.has(level))
}

/** Structure roles of a page-flow `PdfText` (HTML-like names). */
export const PDF_TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'] as const
export type PdfTextTag = typeof PDF_TEXT_TAGS[number]

/** Structure roles of a `PdfView` (HTML-like names). */
export const PDF_VIEW_TAGS = ['section', 'list', 'list-item', 'quote', 'caption', 'figure'] as const
export type PdfViewTag = typeof PDF_VIEW_TAGS[number]

/** Factur-X 1.0 profiles (the `fx:ConformanceLevel` values). */
export const PDF_FACTUR_X_PROFILES = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'] as const
export type PdfFacturXProfile = typeof PDF_FACTUR_X_PROFILES[number]

/** The `AFRelationship` values Factur-X 1.0 allows for the invoice XML. */
export const PDF_FACTUR_X_RELATIONSHIPS = ['Data', 'Alternative', 'Source'] as const
export type PdfFacturXRelationship = typeof PDF_FACTUR_X_RELATIONSHIPS[number]

/** The file name Factur-X fixes for the embedded XML of a profile. */
export const pdfFacturXFileName = (profile: PdfFacturXProfile): string =>
  profile === 'XRECHNUNG' ? 'xrechnung.xml' : 'factur-x.xml'
export type PdfFixedPages = typeof PDF_FIXED_PAGES[number]

type PdfFixedPagesProp = {
  /**
   * With `fixed`: on which pages of its parent the node appears. `'all'`
   * (default), `'first'` or `'continuation'` (every page but the first). Where
   * it does not appear it takes no space. The parent is the `PdfPage` for a
   * node directly on the page, else the view that holds it.
   */
  pages?: PdfFixedPages
}

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
  wrap?: boolean
  widows?: number
  orphans?: number
  /**
   * `false` keeps every word whole: a long word moves to the next line instead
   * of being split with a hyphen. Default `true`.
   */
  hyphenate?: boolean
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
 * Props every form field shares. A field is a leaf with a fixed box: give it
 * `width` and `height` in `style`. It never splits across pages and never
 * repeats, so it cannot be inside `fixed` content.
 */
type PdfFieldProps = {
  /**
   * The field name a reader exports with the value. Unique in the document,
   * without a period (a period separates names in a field hierarchy).
   */
  name: string
  /** The accessible name a reader shows as the tooltip (the PDF `TU` entry). */
  label?: string
  /** The reader shows the value but does not let the user change it. */
  readOnly?: boolean
  /** The reader asks for a value before it submits or exports the form. */
  required?: boolean
  style?: PdfStyleValue
}

/** A text field. The reader draws the value in Helvetica, so it uses WinAnsi characters only. */
export type PdfTextFieldProps = PdfFieldProps & {
  /** The value the field starts with. */
  value?: string
  /** Lets the user type several lines; `value` may then contain line breaks. */
  multiline?: boolean
  /** The most characters the user can type. */
  maxLength?: number
}

/** A checkbox. */
export type PdfCheckboxProps = PdfFieldProps & {
  checked?: boolean
  /** The value a reader exports when the box is checked. Default `'Yes'`. */
  exportValue?: string
}

/** A drop-down list (combo box). */
export type PdfSelectProps = PdfFieldProps & {
  /** The choices, in order. WinAnsi characters only. */
  options: readonly string[]
  /** The selected choice; one of `options` unless `editable`. */
  value?: string
  /** Lets the user type a value that is not in `options`. */
  editable?: boolean
}

/**
 * Fixture-proven subset of the engine's SVG presentation attributes. On SVG
 * nodes these are camelCase props. `transform` is a prop here (unlike
 * `PdfView`, where it is a style key).
 */
export type PdfSvgPresentationProps = {
  fill?: string
  stroke?: string
  transform?: PdfSvgTransform
  strokeWidth?: PdfSvgNumber
  fillOpacity?: PdfSvgLength
  strokeOpacity?: PdfSvgLength
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  clipPath?: string
}

export type PdfSvgProps = {
  width?: PdfSvgLength
  height?: PdfSvgLength
  viewBox?: string
  /** Page-flow sizing and positioning for the SVG root. */
  style?: PdfStyleValue
  /** What the graphic shows, for assistive technology. A PDF/UA-1 document needs it or `decorative`. */
  alt?: string
  /** In a PDF/UA-1 document: the graphic is decoration (a PDF artifact). */
  decorative?: boolean
}

export type PdfGProps = PdfSvgPresentationProps

export type PdfPathProps = PdfSvgPresentationProps & {
  d: string
}

export type PdfRectProps = PdfSvgPresentationProps & {
  x?: PdfSvgLength
  y?: PdfSvgLength
  width: PdfSvgLength
  height: PdfSvgLength
  rx?: PdfSvgLength
  ry?: PdfSvgLength
}

export type PdfCircleProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r: PdfSvgLength
}

export type PdfEllipseProps = PdfSvgPresentationProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  rx: PdfSvgLength
  ry: PdfSvgLength
}

export type PdfLineProps = PdfSvgPresentationProps & {
  x1: PdfSvgLength
  y1: PdfSvgLength
  x2: PdfSvgLength
  y2: PdfSvgLength
}

export type PdfPolylineProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfPolygonProps = PdfSvgPresentationProps & {
  points: string
}

export type PdfDefsProps = Record<never, never>

export type PdfClipPathProps = {
  id: string
}

type PdfGradientProps = {
  id: string
}

export type PdfLinearGradientProps = PdfGradientProps & {
  x1?: PdfSvgLength
  y1?: PdfSvgLength
  x2?: PdfSvgLength
  y2?: PdfSvgLength
}

export type PdfRadialGradientProps = PdfGradientProps & {
  cx?: PdfSvgLength
  cy?: PdfSvgLength
  r?: PdfSvgLength
  fx?: PdfSvgLength
  fy?: PdfSvgLength
}

export type PdfStopProps = {
  offset: PdfSvgLength
  stopColor: string
  stopOpacity?: PdfSvgLength
}

/** Prints the number of the page the surrounding text is painted on. */
export type PdfPageNumberProps = Record<never, never>

/** Prints the total number of pages in the document. */
export type PdfPageCountProps = Record<never, never>

/** Prints the number of the first page that shows the element with this id. */
export type PdfPageRefProps = {
  to: string
}

/** A file embedded in the PDF. It paints nothing. */
export type PdfAttachmentProps = {
  /** File name shown by PDF viewers, unique within the document. No path separators. */
  name: string
  /** File content: a string (embedded as UTF-8) or bytes. Never a path or URL. */
  data: string | Uint8Array
  /** MIME type such as `text/xml`. */
  type?: string
  description?: string
  /** Default `'Unspecified'`. */
  relationship?: PdfAttachmentRelationship
}

/**
 * The machine-readable invoice of a Factur-X (ZUGFeRD 2) hybrid invoice. It
 * paints nothing and makes the document PDF/A-3b. Give the invoice data
 * (`invoice`, written as XML during the render) or the finished XML (`xml`),
 * never both.
 */
export type PdfFacturXProps = {
  /** Default `'Data'` for MINIMUM and BASIC WL, else `'Alternative'`. */
  relationship?: PdfFacturXRelationship
} & (
  | {
    /** The CII XML content as a string (embedded as UTF-8) or bytes. Never a path or URL. */
    xml: string | Uint8Array
    invoice?: never
    /** The profile the XML follows; it must match the profile the XML names. */
    profile: PdfFacturXProfile
  }
  | {
    /**
     * The invoice data. The server writes the CII XML of `profile` from it
     * during the render; data that breaks a rule of the profile fails with
     * `PDF_INVOICE_INVALID` and its `issues`.
     */
    invoice: EInvoice
    xml?: never
    /** The profile to write. EXTENDED is not generated: give its XML with `xml`. */
    profile: EInvoiceProfile
  }
)

export type PdfTspanProps = {
  x?: PdfSvgLength
  y?: PdfSvgLength
  fill?: string
}

// ---------------------------------------------------------------------------
// The primitive table. Every other declaration of a primitive (tags, names,
// prop allowlists, nesting, text containers, components, stubs, global
// component types) is derived from it.
// ---------------------------------------------------------------------------

/**
 * Internal prop that `PdfTableCell` sets on the view or text it renders when
 * the author writes `header`; the structure planner reads it in a tagged
 * document (a body cell becomes a row header), and the engine adapter drops
 * it before layout. Not part of the public prop types.
 */
export const PDF_HEADER_CELL_PROP = '__nuxtPdfHeaderCell'

/** Props in the table that the public prop types leave out. */
type PdfInternalProp = typeof PDF_HEADER_CELL_PROP

/**
 * Runtime check for one prop value. `renderer/validate-tree.ts` implements
 * each check; a check without an implementation does not compile.
 */
export type PdfPropCheck
  = | 'attachmentData'
    | 'attachmentName'
    | 'altText'
    | 'attachmentRelationship'
    | 'bookmark'
    | 'boolean'
    | 'conformance'
    | 'facturXInvoice'
    | 'facturXProfile'
    | 'facturXRelationship'
    | 'fieldExportValue'
    | 'fieldName'
    | 'fieldOptions'
    | 'fieldText'
    | 'fixedPages'
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
    | 'string'
    | 'svgNonNegative'
    | 'strokeLinecap'
    | 'strokeLinejoin'
    | 'svgNumber'
    | 'svgStrokeWidth'
    | 'svgTransform'
    | 'svgUnitInterval'
    | 'textTag'
    | 'viewBox'
    | 'viewTag'

/**
 * `flow`: the element belongs to page flow and fails inside `PdfSvg`.
 * `svg`: the element (or prop) is only supported inside SVG text.
 */
export type PdfPrimitiveContext = 'flow' | 'svg'

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
const primitive = <Props>() =>
  <const Spec extends PdfPrimitiveSpec>(
    spec: Spec & { readonly props: MatchesProps<Props, Spec['props']> },
  ): Spec & { readonly propsType?: Props } => spec

const value = {} as const
const boolean = { check: 'boolean' } as const
const svgNumber = { check: 'svgNumber' } as const
const svgNonNegative = { check: 'svgNonNegative' } as const
const svgUnitInterval = { check: 'svgUnitInterval' } as const
const required = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, required: true }) as const
const flow = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, context: 'flow' }) as const
const svg = <const Rule extends PdfPropRule>(rule: Rule) =>
  ({ ...rule, context: 'svg' }) as const

const BASE_PROPS = {
  break: boolean,
  debug: boolean,
  decorative: boolean,
  fixed: boolean,
  id: value,
  minPresenceAhead: { check: 'nonNegativeNumber' },
  style: value,
} as const
const string = { check: 'string' } as const
const BOOKMARK_PROP = { bookmark: { check: 'bookmark' } } as const
const FIELD_PROPS = {
  label: { check: 'string' },
  name: required({ check: 'fieldName' }),
  readOnly: boolean,
  required: boolean,
  style: value,
} as const
const HEADER_CELL = { [PDF_HEADER_CELL_PROP]: boolean } as const
const FIXED_PAGES = { check: 'fixedPages' } as const
const SVG_PRESENTATION_PROPS = {
  clipPath: value,
  fill: value,
  fillOpacity: svgUnitInterval,
  stroke: value,
  strokeLinecap: { check: 'strokeLinecap' },
  strokeLinejoin: { check: 'strokeLinejoin' },
  strokeOpacity: svgUnitInterval,
  strokeWidth: { check: 'svgStrokeWidth' },
  transform: { check: 'svgTransform' },
} as const

const PAGE_FLOW = ['PdfView', 'PdfText', 'PdfImage', 'PdfLink', 'PdfNote', 'PdfSvg', 'PdfTextField', 'PdfCheckbox', 'PdfSelect'] as const
const SVG_SHAPES = ['PdfPath', 'PdfRect', 'PdfCircle', 'PdfEllipse', 'PdfLine', 'PdfPolyline', 'PdfPolygon'] as const
// PdfTspan is deliberately absent: upstream renderSvg only draws a Tspan
// inside Text, so a direct Tspan child would silently produce no output.
const SVG_GROUP = [...SVG_SHAPES, 'PdfG', 'PdfImage', 'PdfText'] as const

export const PDF_PRIMITIVE_TABLE = {
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
      pdfVersion: { check: 'pdfVersion' },
      producer: string,
      protection: { check: 'protection' },
      subject: string,
      title: string,
    },
    children: ['PdfPage', 'PdfAttachment', 'PdfFacturX'],
  }),
  // Not laid out: the engine adapter takes attachments out of the tree and
  // embeds them when the PDF is written (server/engine/plain-tree.ts).
  PdfAttachment: primitive<PdfAttachmentProps>()({
    tag: 'ATTACHMENT',
    props: {
      data: required({ check: 'attachmentData' }),
      description: { check: 'string' },
      name: required({ check: 'attachmentName' }),
      relationship: { check: 'attachmentRelationship' },
      type: { check: 'mimeType' },
    },
    children: [],
  }),
  // Not laid out either: embedded as `factur-x.xml` (server/engine/pdfa.ts).
  // Exactly one of `xml` and `invoice` (renderer/validate-tree.ts); the
  // invoice becomes XML when the attachments are admitted
  // (server/render-limits.ts).
  PdfFacturX: primitive<PdfFacturXProps>()({
    tag: 'FACTUR_X',
    props: {
      invoice: { check: 'facturXInvoice' },
      profile: required({ check: 'facturXProfile' }),
      relationship: { check: 'facturXRelationship' },
      xml: { check: 'attachmentData' },
    },
    children: [],
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
      break: flow(boolean),
      debug: flow(boolean),
      decorative: flow(boolean),
      fixed: flow(boolean),
      [PDF_HEADER_CELL_PROP]: flow(boolean),
      hyphenate: flow(boolean),
      id: flow(value),
      minPresenceAhead: flow(BASE_PROPS.minPresenceAhead),
      orphans: flow({ check: 'positiveInteger' }),
      pages: flow(FIXED_PAGES),
      tag: flow({ check: 'textTag' }),
      widows: flow({ check: 'positiveInteger' }),
      wrap: flow(boolean),
      style: value,
      fill: svg(value),
      x: svg(svgNumber),
      y: svg(svgNumber),
    },
    children: ['PdfText', 'PdfImage', 'PdfLink', 'PdfTspan', 'PdfPageNumber', 'PdfPageCount', 'PdfPageRef'],
    text: true,
    destination: true,
  }),
  PdfImage: primitive<PdfImageProps>()({
    tag: 'IMAGE',
    props: { ...BASE_PROPS, ...BOOKMARK_PROP, alt: { check: 'altText' }, src: required({ check: 'imageSource' }) },
    children: [],
    destination: true,
  }),
  PdfLink: primitive<PdfLinkProps>()({
    tag: 'LINK',
    props: { ...BASE_PROPS, hitSlop: value, href: required({ check: 'linkTarget' }), wrap: boolean },
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
  // Form fields (AcroForm widgets). The engine adapter maps the props to the
  // engine's own (server/engine/plain-tree.ts); server/engine/forms.ts sets
  // the field font and names.
  PdfTextField: primitive<PdfTextFieldProps>()({
    tag: 'TEXT_INPUT',
    props: { ...FIELD_PROPS, maxLength: { check: 'positiveInteger' }, multiline: boolean, value: { check: 'fieldText' } },
    children: [],
  }),
  PdfCheckbox: primitive<PdfCheckboxProps>()({
    tag: 'CHECKBOX',
    props: { ...FIELD_PROPS, checked: boolean, exportValue: { check: 'fieldExportValue' } },
    children: [],
  }),
  PdfSelect: primitive<PdfSelectProps>()({
    tag: 'SELECT',
    props: { ...FIELD_PROPS, editable: boolean, options: required({ check: 'fieldOptions' }), value: { check: 'fieldText' } },
    children: [],
  }),
  PdfTspan: primitive<PdfTspanProps>()({
    tag: 'TSPAN',
    props: { fill: value, x: svgNumber, y: svgNumber },
    children: [],
    text: true,
    context: 'svg',
  }),
  PdfSvg: primitive<PdfSvgProps>()({
    tag: 'SVG',
    props: {
      alt: { check: 'altText' },
      decorative: boolean,
      height: svgNonNegative,
      style: value,
      viewBox: { check: 'viewBox' },
      width: svgNonNegative,
    },
    children: [...SVG_GROUP, 'PdfDefs'],
  }),
  PdfG: primitive<PdfGProps>()({
    tag: 'G',
    props: SVG_PRESENTATION_PROPS,
    children: SVG_GROUP,
  }),
  PdfPath: primitive<PdfPathProps>()({
    tag: 'PATH',
    props: { ...SVG_PRESENTATION_PROPS, d: required(string) },
    children: [],
  }),
  PdfRect: primitive<PdfRectProps>()({
    tag: 'RECT',
    props: {
      ...SVG_PRESENTATION_PROPS,
      height: required(svgNonNegative),
      rx: svgNonNegative,
      ry: svgNonNegative,
      width: required(svgNonNegative),
      x: svgNumber,
      y: svgNumber,
    },
    children: [],
  }),
  PdfCircle: primitive<PdfCircleProps>()({
    tag: 'CIRCLE',
    props: { ...SVG_PRESENTATION_PROPS, cx: svgNumber, cy: svgNumber, r: required(svgNonNegative) },
    children: [],
  }),
  PdfEllipse: primitive<PdfEllipseProps>()({
    tag: 'ELLIPSE',
    props: {
      ...SVG_PRESENTATION_PROPS,
      cx: svgNumber,
      cy: svgNumber,
      rx: required(svgNonNegative),
      ry: required(svgNonNegative),
    },
    children: [],
  }),
  PdfLine: primitive<PdfLineProps>()({
    tag: 'LINE',
    props: {
      ...SVG_PRESENTATION_PROPS,
      x1: required(svgNumber),
      x2: required(svgNumber),
      y1: required(svgNumber),
      y2: required(svgNumber),
    },
    children: [],
  }),
  PdfPolyline: primitive<PdfPolylineProps>()({
    tag: 'POLYLINE',
    props: { ...SVG_PRESENTATION_PROPS, points: required(string) },
    children: [],
  }),
  PdfPolygon: primitive<PdfPolygonProps>()({
    tag: 'POLYGON',
    props: { ...SVG_PRESENTATION_PROPS, points: required(string) },
    children: [],
  }),
  PdfDefs: primitive<PdfDefsProps>()({
    tag: 'DEFS',
    props: {},
    children: ['PdfClipPath', 'PdfLinearGradient', 'PdfRadialGradient'],
  }),
  PdfClipPath: primitive<PdfClipPathProps>()({
    tag: 'CLIP_PATH',
    props: { id: required(value) },
    children: SVG_SHAPES,
  }),
  PdfLinearGradient: primitive<PdfLinearGradientProps>()({
    tag: 'LINEAR_GRADIENT',
    props: { id: required(value), x1: svgNumber, x2: svgNumber, y1: svgNumber, y2: svgNumber },
    children: ['PdfStop'],
  }),
  PdfRadialGradient: primitive<PdfRadialGradientProps>()({
    tag: 'RADIAL_GRADIENT',
    props: { cx: svgNumber, cy: svgNumber, fx: svgNumber, fy: svgNumber, id: required(value), r: svgNonNegative },
    children: ['PdfStop'],
  }),
  PdfStop: primitive<PdfStopProps>()({
    tag: 'STOP',
    props: { offset: required(svgUnitInterval), stopColor: required(value), stopOpacity: svgUnitInterval },
    children: [],
  }),
  // Inline page tokens. They are plain data in the mounted tree; the engine
  // adapter (server/engine/plain-tree.ts) replaces them before layout, so the
  // layout engine never sees these tags.
  PdfPageNumber: primitive<PdfPageNumberProps>()({
    tag: 'PAGE_NUMBER',
    props: {},
    children: [],
    context: 'flow',
  }),
  PdfPageCount: primitive<PdfPageCountProps>()({
    tag: 'PAGE_COUNT',
    props: {},
    children: [],
    context: 'flow',
  }),
  PdfPageRef: primitive<PdfPageRefProps>()({
    tag: 'PAGE_REF',
    props: { to: required({ check: 'nonEmptyId' }) },
    children: [],
    context: 'flow',
  }),
}

// ---------------------------------------------------------------------------
// Derived from the table.
// ---------------------------------------------------------------------------

type PdfPrimitiveTable = typeof PDF_PRIMITIVE_TABLE

/** Author-facing component name of a primitive, such as `'PdfText'`. */
export type PdfPrimitiveName = keyof PdfPrimitiveTable

/** Props type of one primitive component. */
export type PdfPrimitiveProps<Name extends PdfPrimitiveName>
  = NonNullable<PdfPrimitiveTable[Name]['propsType']>

/** Host tag of a primitive element in the mounted tree. */
export type PdfElementType = PdfPrimitiveTable[PdfPrimitiveName]['tag']

/** Primitives a `PdfPage` holds directly (the page-flow elements). */
export type PdfPageFlowName = PdfPrimitiveTable['PdfPage']['children'][number]

// A length with a unit and a percentage, as a PDF style accepts them (shared
// with the style-block compiler, build/pdf-style.ts).
const STYLE_NUMBER = String.raw`-?(?:\d+|\d*\.\d+)`
export const PDF_UNIT_LENGTH = new RegExp(`^${STYLE_NUMBER}(?:pt|px|in|mm|cm|rem|vh|vw)$`)
export const PDF_PERCENTAGE = new RegExp(`^${STYLE_NUMBER}%$`)

// Object.keys widens to string[]; the keys are exactly the table's.
export const PDF_PRIMITIVE_COMPONENT_NAMES = Object.keys(PDF_PRIMITIVE_TABLE) as PdfPrimitiveName[]

type ShortName<Name> = Name extends `Pdf${infer Short}` ? Short : never

/** Stable host tags by short name (`PDF_PRIMITIVES.Text === 'TEXT'`). */
export const PDF_PRIMITIVES = {
  ...Object.fromEntries(PDF_PRIMITIVE_COMPONENT_NAMES.map(name => [
    name.slice('Pdf'.length),
    PDF_PRIMITIVE_TABLE[name].tag,
  ])),
  TextInstance: 'TEXT_INSTANCE',
} as {
  readonly [Name in PdfPrimitiveName as ShortName<Name>]: PdfPrimitiveTable[Name]['tag']
} & { readonly TextInstance: 'TEXT_INSTANCE' }

/** What the renderer needs to know about one element type. */
export type PdfElementRules = {
  readonly name: PdfPrimitiveName
  readonly props: Readonly<Record<string, PdfPropRule>>
  readonly children: ReadonlySet<PdfElementType>
  readonly text: boolean
  readonly destination: boolean
  readonly context: PdfPrimitiveContext | undefined
}

const elementRules = (name: PdfPrimitiveName): PdfElementRules => {
  const spec: PdfPrimitiveTable[PdfPrimitiveName] = PDF_PRIMITIVE_TABLE[name]
  return {
    name,
    props: spec.props,
    children: new Set(spec.children.map(child => PDF_PRIMITIVE_TABLE[child].tag)),
    text: 'text' in spec,
    destination: 'destination' in spec,
    context: 'context' in spec ? spec.context : undefined,
  }
}

// The table has one entry per tag, so this record covers every element type.
export const PDF_ELEMENTS = Object.fromEntries(PDF_PRIMITIVE_COMPONENT_NAMES.map(name => [
  PDF_PRIMITIVE_TABLE[name].tag,
  elementRules(name),
])) as Record<PdfElementType, PdfElementRules>

/** Author-facing component name of each element type, for error messages. */
export const PDF_PRIMITIVE_NAMES = Object.fromEntries(PDF_PRIMITIVE_COMPONENT_NAMES.map(name => [
  PDF_PRIMITIVE_TABLE[name].tag,
  name,
])) as Record<PdfElementType, PdfPrimitiveName>

export const isPdfElementType = (value: string): value is PdfElementType =>
  Object.hasOwn(PDF_ELEMENTS, value)
