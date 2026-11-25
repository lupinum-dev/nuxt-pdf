// The PDF primitives: their public prop types and the one table that declares
// each primitive, put together from one file per component group in
// `primitives/`. Vue-free, so the engine adapter and the render worker can
// import it.
import type { PdfLengthOrPercentage } from './authoring'
import { PDF_PERCENTAGE, PDF_UNIT_LENGTH } from './shared/style-values'
import { ATTACHMENT_PRIMITIVES } from './primitives/attachments'
import { DOCUMENT_PRIMITIVES } from './primitives/document'
import { FORM_PRIMITIVES } from './primitives/forms'
import { LINK_PRIMITIVES } from './primitives/links'
import type { PdfPageToken, PdfPrimitiveContext, PdfPropRule } from './primitives/spec'
import { SVG_PRIMITIVES } from './primitives/svg'
import { TOKEN_PRIMITIVES } from './primitives/tokens'

export * from './primitives/attachments'
export * from './primitives/document'
export * from './primitives/forms'
export * from './primitives/links'
export * from './primitives/shared'
export {
  PDF_FOOTNOTE_REPEAT_PROP,
  PDF_HEADER_CELL_PROP,
  PDF_ROW_SPAN_PROP,
  PDF_RUNNING_ROW_PROP,
  PDF_TABLE_CAPTION_PROP,
  PDF_TABLE_CELL_PROP,
  PDF_TABLE_COLUMNS_PROP,
  type PdfPageToken,
  type PdfPrimitiveContext,
  type PdfPropCheck,
  type PdfPropRule,
} from './primitives/spec'
export * from './primitives/svg'
export * from './primitives/tokens'

// ---------------------------------------------------------------------------
// The primitive table. Every other declaration of a primitive (tags, names,
// prop allowlists, nesting, text containers, components, stubs, global
// component types) is derived from it.
// ---------------------------------------------------------------------------

// The document comes first and its attachments right after it: the order of
// the table is the order of the component names.
const { PdfDocument, ...PAGE_PRIMITIVES } = DOCUMENT_PRIMITIVES

export const PDF_PRIMITIVE_TABLE = {
  PdfDocument,
  ...ATTACHMENT_PRIMITIVES,
  ...PAGE_PRIMITIVES,
  ...LINK_PRIMITIVES,
  ...FORM_PRIMITIVES,
  ...SVG_PRIMITIVES,
  ...TOKEN_PRIMITIVES,
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

/**
 * Primitives a `PdfPage` holds directly and lays out (the page-flow elements).
 * `PdfContents` is left out: the engine adapter replaces it by views before
 * the layout, so no layout warning names it.
 */
export type PdfPageFlowName = Exclude<PdfPrimitiveTable['PdfPage']['children'][number], 'PdfContents'>

/**
 * The width of a table column: a number is a share of the free width (like
 * `flex-grow`), a string is a width such as `'30%'` or `'80pt'`, and `'auto'`
 * is as wide as the content of its cells.
 */
export type PdfTableColumnWidth = number | 'auto' | Exclude<PdfLengthOrPercentage, number>

export const isPdfTableColumnWidth = (value: unknown): value is PdfTableColumnWidth =>
  typeof value === 'number'
    ? Number.isFinite(value) && value > 0
    : typeof value === 'string'
      && (value === 'auto' || ((PDF_UNIT_LENGTH.test(value) || PDF_PERCENTAGE.test(value)) && Number.parseFloat(value) > 0))

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
  /** `props` as a list in table order, for the checks that walk every rule. */
  readonly propRules: readonly (readonly [string, PdfPropRule])[]
  readonly children: ReadonlySet<PdfElementType>
  readonly text: boolean
  readonly destination: boolean
  readonly context: PdfPrimitiveContext | undefined
  readonly token: PdfPageToken | undefined
}

const elementRules = (name: PdfPrimitiveName): PdfElementRules => {
  const spec: PdfPrimitiveTable[PdfPrimitiveName] = PDF_PRIMITIVE_TABLE[name]
  return {
    name,
    props: spec.props,
    propRules: Object.entries(spec.props),
    children: new Set(spec.children.map(child => PDF_PRIMITIVE_TABLE[child].tag)),
    text: 'text' in spec,
    destination: 'destination' in spec,
    context: 'context' in spec ? spec.context : undefined,
    token: 'token' in spec ? spec.token : undefined,
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

const tokenTypes = (kinds: readonly PdfPageToken[]): ReadonlySet<PdfElementType> =>
  new Set(PDF_PRIMITIVE_COMPONENT_NAMES.flatMap((name) => {
    const { token } = PDF_ELEMENTS[PDF_PRIMITIVE_TABLE[name].tag]
    return token !== undefined && kinds.includes(token) ? [PDF_PRIMITIVE_TABLE[name].tag] : []
  }))

/** The page tokens (`token` in the table). */
export const PDF_PAGE_TOKENS = tokenTypes(['page', 'document'])

/** The page tokens whose value differs per page: a text that holds one is laid out per page. */
export const PDF_PER_PAGE_TOKENS = tokenTypes(['page'])

/** The form field elements: leaves with a fixed box and a unique name. */
export const PDF_FIELD_TYPES: ReadonlySet<PdfElementType> = new Set([PDF_PRIMITIVES.TextField, PDF_PRIMITIVES.Checkbox, PDF_PRIMITIVES.Radio, PDF_PRIMITIVES.Select])

export const isPdfElementType = (value: string): value is PdfElementType =>
  Object.hasOwn(PDF_ELEMENTS, value)
