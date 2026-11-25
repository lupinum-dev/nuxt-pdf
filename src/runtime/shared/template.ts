import type {
  AllowedComponentProps,
  Component,
  ComponentCustomProps,
  FunctionalComponent,
  VNodeProps,
} from 'vue'

import type { PdfPageFlowName } from '../primitives'
import type { PdfSourcePosition } from './errors'

export const PDF_DEFINITION_PROPERTY = '__nuxtPdf' as const
/** Compiled `<style>` rules on a PDF component (`PdfClassRule[]`), in source order. */
export const PDF_CLASSES_PROPERTY = '__nuxtPdfClasses' as const
/** The `v-bind()` expressions of a PDF component's `<style>` block, by index; error messages name them. */
export const PDF_BINDINGS_PROPERTY = '__nuxtPdfBindings' as const
/** The runtime helper that resolves classes, a global property of the PDF app; compiled class bindings call it. */
export const PDF_CLASS_HELPER = '$nuxtPdfClass' as const

/**
 * The `<style>` block of a PDF SFC, compiled at build time. Each rule keeps
 * its selectors, a plain `PdfStyle` object and, when it uses `v-bind()`, the
 * keys whose value comes from a bound expression (key → index into
 * `PdfCompiledStyles.bindings`, build/style/compile.ts). The order is the source
 * order, which decides between rules of equal specificity as in CSS.
 *
 * A selector is a string: compounds separated by a space (descendant steps),
 * classes of one compound joined by `.`. `"title"`, `"row.total"`,
 * `"total cell"`. Class names hold neither.
 */
export type PdfClassRule = readonly [
  selectors: readonly string[],
  style: Readonly<Record<string, number | string>>,
  bound?: Readonly<Record<string, number>>,
]

/**
 * A class name a `<style>` selector may use, as a pattern source: a CSS
 * identifier of ASCII letters, digits, `-`, `_` and any non-ASCII letter that
 * does not start with a digit, `--` or `-` and a digit.
 */
export const PDF_CLASS_NAME = '-?[_a-z\\u0080-\\u{10FFFF}][\\w\\u0080-\\u{10FFFF}-]*'

/** A `PdfClassRule` selector as compounds, outermost first; each compound lists its classes. */
export const parsePdfSelector = (selector: string): string[][] =>
  selector.split(' ').map(compound => compound.split('.'))

/** The names of a class list as written: `" row  total"` is `row` and `total`. */
export const classNames = (text: string): string[] => text.split(/\s+/).filter(Boolean)

/**
 * Internal attribute that development builds put on every `Pdf*` element of a
 * template: `"<file>:<line>:<column>"` of its opening tag. The renderer keeps
 * it on the host node (`PdfElementNode.source`), never as an engine prop.
 */
export const PDF_SOURCE_PROP = '__nuxtPdfSource' as const

/** The source position a component got in its attrs, for its errors. */
export const pdfSourceOf = (attrs: Record<string, unknown> | undefined): string | undefined => {
  const source = attrs?.[PDF_SOURCE_PROP]
  return typeof source === 'string' ? source : undefined
}

export type PdfMetadataValue<Props extends object>
  = | string
    | ((props: Readonly<Props>) => string)

export interface PdfDefinition<Props extends object = Record<string, unknown>> {
  title?: PdfMetadataValue<Props>
  filename?: PdfMetadataValue<Props>
  language?: string
  /**
   * Maximum number of layout passes before the render declares the page numbers
   * non-convergent and throws `PDF_LIMIT_EXCEEDED`. A positive integer;
   * defaults to 5. A document needs more than one pass only when it prints a
   * `PdfPageRef`, limits `fixed` content with `pages`, or has a view that would
   * end a page with only its `fixed` children.
   */
  maxPasses?: number
  sampleData?: Props
  scenarios?: Readonly<Record<string, Props>>
}

/**
 * The `definePdf` keys, in the order of `PdfDefinition`. `production`: kept in
 * a production build (sample data and scenarios are for development).
 * `function`: may be a function of the props.
 */
export const PDF_DEFINITION_KEYS = {
  title: { production: true, function: true },
  filename: { production: true, function: true },
  language: { production: true, function: false },
  maxPasses: { production: true, function: false },
  sampleData: { production: false, function: false },
  scenarios: { production: false, function: false },
} as const satisfies Record<keyof PdfDefinition, { production: boolean, function: boolean }>

export const isPdfDefinitionKey = (key: string): key is keyof PdfDefinition =>
  Object.hasOwn(PDF_DEFINITION_KEYS, key)

export interface ResolvedPdfMetadata {
  readonly title?: string
  readonly filename?: string
  readonly language?: string
}

export type PdfComponent<Props extends object = Record<string, unknown>>
  = Component & {
    readonly [PDF_DEFINITION_PROPERTY]?: PdfDefinition<Props>
  }

type VueFrameworkProps = VNodeProps & AllowedComponentProps & ComponentCustomProps

/** Props authored by a component, excluding Vue's renderer-level vnode props. */
export type PdfComponentProps<C extends Component>
  = C extends abstract new (...args: never[]) => { $props: infer Props extends object }
    ? Omit<Props, keyof VueFrameworkProps>
    : C extends FunctionalComponent<infer Props extends object>
      ? Props
      : Record<string, unknown>

export type PdfDisposition = 'attachment' | 'inline'

export interface PdfResponseInit extends Omit<ResponseInit, 'headers'> {
  disposition?: PdfDisposition
  filename?: string
  headers?: HeadersInit
}

/** Safe, content-free measurements from one completed PDF render. */
export interface PdfRenderDiagnostics {
  readonly durationMs: number
  readonly byteLength: number
  readonly pageCount: number
  readonly passes: number
  readonly layoutWarnings: readonly PdfLayoutWarning[]
  /** Rich text images whose source was refused and that printed their placeholder. */
  readonly imageWarnings: readonly PdfImageWarning[]
  /** Rich text input that `PdfRichText` dropped or changed: one entry per code and name. */
  readonly richTextWarnings: readonly PdfRichTextWarning[]
  readonly registeredFontFaces: readonly PdfRegisteredFontFace[]
}

/**
 * Layout that rendered but needs attention. Check `code` before reading the
 * other fields: each code has its own.
 */
export type PdfLayoutWarning = UnbreakableNodeOverflowWarning | ContentHiddenWarning | TableColumnsTooNarrowWarning | FootnotesMovedWarning | GlyphMissingWarning | HyphenationUnavailableWarning | KeepIgnoredWarning

/** A node that cannot split and is higher than its page's content. */
interface UnbreakableNodeOverflowWarning {
  readonly code: 'PDF_UNBREAKABLE_NODE_OVERFLOW'
  readonly pageNumber: number
  /** A page-flow primitive: one that a `PdfPage` holds directly. */
  readonly nodeType: PdfPageFlowName
  readonly nodeHeight: number
  readonly availableHeight: number
  /** The template element of the node, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * A `keepWithNext` chain or a `minPresenceAhead` that pagination could not
 * hold: the chain is higher than the page's content area, or the node starts
 * a page, where a move gains nothing. The nodes break as without the keep.
 * One warning per chain, on the first page where the keep is dropped.
 */
interface KeepIgnoredWarning {
  readonly code: 'PDF_KEEP_IGNORED'
  readonly pageNumber: number
  /** The first node of the chain: the node with `minPresenceAhead`, or the first that keeps with the next. */
  readonly nodeType: PdfPageFlowName
  /** The template element of that node, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * Content that is cut off and not drawn: the lines of a text past its own
 * `height` or `maxHeight` or that of a view around it, or the lines and boxes
 * of an absolute node that start below the page end. One warning per node.
 */
interface ContentHiddenWarning {
  readonly code: 'PDF_CONTENT_HIDDEN'
  readonly pageNumber: number
  /** The text whose lines are cut off, or the absolute node. */
  readonly nodeType: PdfPageFlowName
  /** Text lines that are not drawn. */
  readonly hiddenLines: number
  /** Images, SVGs and form fields of an absolute node below the page end; 0 for a text. */
  readonly hiddenNodes: number
  /** The template element of the node, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * A table with `'auto'` columns narrower than the longest words of its
 * columns (and its width columns): words wider than their column break or
 * run over it. One warning per table, on the page where it starts.
 */
interface TableColumnsTooNarrowWarning {
  readonly code: 'PDF_TABLE_COLUMNS_TOO_NARROW'
  readonly pageNumber: number
  /** The width the table's columns share, in points. */
  readonly tableWidth: number
  /** The width they need to keep every longest word whole, in points. */
  readonly neededWidth: number
  /** The template element of the `PdfTable`, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * Footnotes whose marks are on `pageNumber` but whose first line did not fit
 * there with the others: they print at the top of the note area of the next
 * page, in order. One warning per page.
 */
interface FootnotesMovedWarning {
  readonly code: 'PDF_FOOTNOTES_MOVED'
  readonly pageNumber: number
  /** The numbers the moved footnotes print, in order. */
  readonly footnotes: readonly number[]
  /** The template element of the first moved `PdfFootnote`, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * A text asks for hyphenation (`hyphens: 'auto'`), but the document's
 * `language` has no hyphenation patterns, so its words break only at soft
 * hyphens (U+00AD). One warning per render. A language whose writing does not
 * hyphenate (Chinese, Japanese, Arabic, …) gives none.
 */
interface HyphenationUnavailableWarning {
  readonly code: 'PDF_HYPHENATION_UNAVAILABLE'
  /** The `language` of the document, as written. */
  readonly language: string
  /** Not set: `language` belongs to `PdfDocument` or `definePdf`, not to one element. */
  readonly source?: PdfSourcePosition
}

/**
 * A character that no font of its text contains: it shows the `.notdef`
 * glyph of the text's font (often an empty box), and a reader that copies
 * the text gets U+FFFD. One warning per character and render, on the first
 * page where it occurs. A PDF/A or PDF/UA document fails instead
 * (`PDF_TREE_INVALID`): both forbid the `.notdef` glyph.
 */
interface GlyphMissingWarning {
  readonly code: 'PDF_GLYPH_MISSING'
  readonly pageNumber: number
  /** The character, such as `0x1F600` for 😀. */
  readonly codePoint: number
  /** The font family the text asks for; `'Helvetica'`, the default, when it asks for none. */
  readonly fontFamily: string
  /** The template element of the `PdfText`, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * A `PdfRichText` image whose source the image rules refused (a path not in
 * `pdfs/assets`, a host off `pdf.remote.allow`, bytes that are not a PNG or
 * JPEG, a failed request) and `brokenImages="placeholder"`: the PDF shows its
 * placeholder. Content-free like every diagnostic: no source and no text;
 * render without `brokenImages="placeholder"` to see the full error.
 */
export interface PdfImageWarning {
  readonly code: 'PDF_RICH_TEXT_IMAGE_REPLACED'
  /** The error code a `PdfImage` with this source fails with. */
  readonly reason: 'PDF_ASSET_BLOCKED' | 'PDF_ASSET_INVALID'
  /** The image block in the rich text model, such as `content[3]`. */
  readonly path: string
  /** The template element of the `PdfRichText`, in development builds. */
  readonly source?: PdfSourcePosition
}

/**
 * What a rich text warning is about:
 * - `PDF_RICH_TEXT_LINK_DROPPED`: a link prints as plain text (a target that
 *   is not an absolute `http:`, `https:`, `mailto:` or `tel:` URI, a link
 *   inside a link, a link around an image);
 * - `PDF_RICH_TEXT_ATTRIBUTE_DROPPED`: an attribute the PDF does not read,
 *   such as `style` or `class`;
 * - `PDF_RICH_TEXT_TAG_DROPPED`: a tag dropped with its content, such as
 *   `script` or `iframe`;
 * - `PDF_RICH_TEXT_TAG_UNKNOWN`: a tag off the allowlist; its content prints
 *   without its formatting;
 * - `PDF_RICH_TEXT_VALUE_CHANGED`: a value cut or left out (an `alt` over
 *   its length, an image without a usable `src`, a `width` or `height` out of
 *   range, a span cut to fit);
 * - `PDF_RICH_TEXT_COMPONENT_DROPPED`: a content component that prints its
 *   content without its Vue component;
 * - `PDF_RICH_TEXT_PROP_DROPPED`: a prop of a content component that its Vue
 *   component does not get.
 */
export type PdfRichTextWarningCode
  = | 'PDF_RICH_TEXT_LINK_DROPPED'
    | 'PDF_RICH_TEXT_ATTRIBUTE_DROPPED'
    | 'PDF_RICH_TEXT_TAG_DROPPED'
    | 'PDF_RICH_TEXT_TAG_UNKNOWN'
    | 'PDF_RICH_TEXT_VALUE_CHANGED'
    | 'PDF_RICH_TEXT_COMPONENT_DROPPED'
    | 'PDF_RICH_TEXT_PROP_DROPPED'

/**
 * Rich text input that `PdfRichText` did not keep as written. HTML stays
 * forgiving: the render succeeds. A render has one entry per `code` and
 * `name`, with the number of times it met it, so content with thousands of
 * `data-*` attributes gives one entry. Content-free in production: the
 * `snippet` of the content and the `source` come only in development builds.
 */
export interface PdfRichTextWarning {
  readonly code: PdfRichTextWarningCode
  /**
   * What it is about: a tag, an attribute (all `data-*` as `data-*`, all
   * `aria-*` as `aria-*`), a link kind (a scheme such as `javascript:`,
   * `relative`, `#`, `nested` or `image`), a component, or `component.prop`.
   */
  readonly name: string
  readonly message: string
  /** How many times the render met it. */
  readonly count: number
  /**
   * The first occurrence as the parser read it, at most 80 characters: a
   * start tag or an attribute. In development builds.
   */
  readonly snippet?: string
  /** The template element of the first `PdfRichText` that met it, in development builds. */
  readonly source?: PdfSourcePosition
}

export interface PdfRegisteredFontFace {
  readonly family: string
  readonly fontStyle?: string
  readonly fontWeight?: number
}

export interface PdfRenderResult {
  readonly metadata: Readonly<ResolvedPdfMetadata>
  readonly diagnostics: PdfRenderDiagnostics
  toUint8Array(): Promise<Uint8Array>
  toBuffer(): Promise<Buffer>
  response(init?: PdfResponseInit): Promise<Response>
}

export interface PdfTemplate<Props extends object = Record<string, unknown>> {
  readonly key: string
  resolveMetadata(props: Props): ResolvedPdfMetadata
  render(props: Props): Promise<PdfRenderResult>
}
