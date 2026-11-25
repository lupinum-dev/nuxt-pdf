import type { Node as YogaNode } from 'yoga-layout/load'
import type { PdfAlignContent, PdfAlignItems, PdfBorderStyle, PdfFlexDirection, PdfFlexWrap, PdfJustifyContent, PdfObjectFit, PdfStyleValue, PdfTextAlign } from '../../../authoring'
import type { PdfFontStyle } from '../../../fonts'
import type { PDF_PRIMITIVES, PdfDocumentProps, PdfPageSize } from '../../../primitives'
import type { ImageFormat } from '../image'
import type { Line } from '../text'

/**
 * A style before the style step (styles/resolve-styles.ts): the admitted
 * `PdfStyle` keys as written, numbers or strings (shared/style-values.ts),
 * the keys the engine writes itself (SVG paint), or on
 * relayout a resolved style. Its keys are closed by admission, its values
 * read by the style step only.
 */
export type Style = { readonly [key: string]: unknown }

/**
 * A node's style before the style step: as the author wrote it
 * (`PdfStyleValue`, a style or a nested style array that may hold `false`,
 * `null` or `undefined`), or as the engine wrote it (`Style`). The style step
 * flattens either (styles/flatten.ts).
 */
export type InputStyle = PdfStyleValue | Style | readonly Style[]

/** One transform operation as the style step writes it (styles/expand.ts, `transformOf`). */
export type Transform
  = | { operation: 'scale', value: [x: number, y: number] }
    | { operation: 'rotate', value: [degrees: number, cx: number, cy: number] }
    | { operation: 'translate', value: [x: number, y: number | undefined] }
    | { operation: 'skew', value: number[] }

/** A length after the style step: points, or a percentage or `auto` that yoga reads. */
type Length = number | string

/**
 * A resolved style: one flat object of final values (`resolveStyles`), with
 * the keys the layout and the painter read. Lengths are points or what yoga
 * reads as a string; colours stay as written (the painter reads them with
 * `readPdfColor`). Text decorations add up through inheritance
 * (`underline line-through`), so that value is any list of them.
 */
/**
 * A unitless `lineHeight`: a factor of the font size of each text it reaches
 * (text/fragments.ts). As in CSS, children inherit the factor, not the points
 * one element computed from it.
 */
export type LineHeightFactor = { readonly factor: number }

/**
 * An image as the layout holds it (layout/assets): its size on the page,
 * with an EXIF orientation applied, and the admitted file. `key` names the
 * file for the PDF writer.
 */
export interface LayoutImage {
  readonly format: ImageFormat
  readonly width: number
  readonly height: number
  readonly data: Buffer
  key?: string
}

export interface ResolvedStyle {
  width?: Length
  height?: Length
  minWidth?: Length
  minHeight?: Length
  maxWidth?: Length
  maxHeight?: Length
  position?: 'absolute' | 'relative' | 'static'
  top?: Length
  right?: Length
  bottom?: Length
  left?: Length
  marginTop?: Length
  marginRight?: Length
  marginBottom?: Length
  marginLeft?: Length
  paddingTop?: Length
  paddingRight?: Length
  paddingBottom?: Length
  paddingLeft?: Length
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderTopColor?: string
  borderRightColor?: string
  borderBottomColor?: string
  borderLeftColor?: string
  borderTopStyle?: PdfBorderStyle
  borderRightStyle?: PdfBorderStyle
  borderBottomStyle?: PdfBorderStyle
  borderLeftStyle?: PdfBorderStyle
  borderTopLeftRadius?: Length
  borderTopRightRadius?: Length
  borderBottomRightRadius?: Length
  borderBottomLeftRadius?: Length
  flexDirection?: PdfFlexDirection
  flexWrap?: PdfFlexWrap
  flexGrow?: number
  flexShrink?: number
  flexBasis?: Length
  alignItems?: PdfAlignItems
  alignSelf?: PdfAlignItems | 'auto'
  alignContent?: PdfAlignContent
  justifyContent?: PdfJustifyContent
  rowGap?: Length
  columnGap?: Length
  /** A column container (layout/columns): its column count, column width in points, how it fills, and whether a child spans every column. */
  columnCount?: number
  columnWidth?: number
  columnFill?: 'auto' | 'balance'
  columnSpan?: 'none' | 'all'
  /** A float (D49): placed at the top or the bottom of its column or page by the page builder. */
  float?: 'none' | 'top' | 'bottom'
  /** The line in each gap between two columns that both hold content (paint/columns.ts), as borders: drawn with a width, solid and black by default. */
  columnRuleWidth?: number
  columnRuleStyle?: PdfBorderStyle
  columnRuleColor?: string
  backgroundColor?: string
  color?: string
  opacity?: number
  fontFamily?: string
  /**
   * Points. A percentage as written also lives from the style step to
   * inheritance (`merged`), which makes it points before any reader; the
   * type stays a number for the text layout, which reads only the result.
   */
  fontSize?: number
  fontStyle?: PdfFontStyle
  fontWeight?: number
  fontVariantNumeric?: 'normal' | 'tabular-nums'
  hyphens?: 'auto' | 'manual'
  letterSpacing?: number
  /**
   * Points, or a factor (a unitless value). A percentage as written lives
   * only from the style step to inheritance, which makes it points.
   */
  lineHeight?: number | LineHeightFactor | `${number}%`
  maxLines?: number
  textAlign?: PdfTextAlign
  textDecoration?: string
  textDecorationColor?: string
  textDecorationStyle?: PdfBorderStyle
  textOverflow?: 'ellipsis'
  textTransform?: 'none' | 'capitalize' | 'lowercase' | 'uppercase' | 'upperfirst'
  textWrap?: 'wrap' | 'pretty'
  verticalAlign?: 'baseline' | 'super' | 'sub'
  objectFit?: PdfObjectFit
  objectPositionX?: Length
  objectPositionY?: Length
  transform?: Transform[]
  fill?: string
  stroke?: string
  strokeWidth?: number
  fillOpacity?: number
  strokeOpacity?: number
}

// The shapes of the layout tree. One node shape for every element: which
// children an element may hold is checked once, at admission
// (renderer/validate-tree.ts), so the layout does not repeat it in its types.
// Each stage adds fields; the names below say which stage guarantees what.

/**
 * A string inside a text. From `resolveStyles` on it carries a style: the
 * text style it inherits, which text layout reads.
 */
export type StringNode<NodeStyle = InputStyle> = {
  type: typeof PDF_PRIMITIVES.TextInstance
  value: string
  style?: NodeStyle
  /** Inside an SVG text only: the SVG props it inherits (svg/index.ts). */
  props?: NumberedProps
  /**
   * SVG resolution rebuilds every node with this key (undefined), and on a
   * page with `render` callbacks pagination rebuilds every node with `box`,
   * `lines` and `children` keys (paginate/dynamic.ts), strings too.
   */
  children?: []
  box?: undefined
  lines?: undefined
}

/** Every element type that reaches the layout. */
export type ElementType = Exclude<
  (typeof PDF_PRIMITIVES)[keyof typeof PDF_PRIMITIVES],
  'DOCUMENT' | 'ATTACHMENT' | 'FACTUR_X' | 'PAGE_NUMBER' | 'PAGE_COUNT' | 'PAGE_REF' | 'RUNNING_TEXT' | 'FOOTNOTE' | 'CONTENTS' | 'TEXT_INSTANCE'
>

export type Box = {
  width: number
  height: number
  top: number
  left: number
  right: number
  bottom: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
}

export type Origin = { left: number, top: number }

/** A bookmark after numbering (`prepare/bookmarks.ts`); before, it may be a title alone. */
export type Bookmark = {
  title: string
  fit?: boolean
  expanded?: boolean
  ref?: number
  parent?: number
}

/**
 * The running values of a page, by name (paginate/running.ts): at its top
 * (the start rule), before it, and at its end. The end is known once the page
 * is split, so a page laid out for its split has none.
 */
export type RunningValues = {
  readonly top: Readonly<Record<string, string>>
  readonly before: Readonly<Record<string, string>>
  readonly end?: Readonly<Record<string, string>>
}

/** The argument of a `render` callback (page tokens, page-conditional carriers). */
export type PageInfo = {
  pageNumber: number
  running?: RunningValues
  totalPages?: number
  subPageNumber?: number
  subPageTotalPages?: number
  /**
   * While the page builder pages a document: the digits a page number or count
   * takes, each laid out as the widest digit of its font, so the value painted
   * after paging fits the room (paginate/dynamic.ts, `relabelPageTokens`).
   */
  reserve?: number
}

/**
 * What a `render` callback returns: the text of a dynamic text, or an element
 * (plain-tree.ts, `toEngineElement`); read by paginate/dynamic.ts.
 */
export type RenderResult = unknown

/**
 * The props the layout reads, and the SVG and link props the painter reads
 * that the layout writes or that admission shapes. Other props (structure,
 * form fields, SVG attributes) pass through to the painter unchanged.
 */
export interface NodeProps {
  [prop: string]: unknown
  id?: string
  fixed?: boolean
  /** `true` starts the next page; `'column'` the next column of a column container (paginate/rules.ts, `breakKindOf`). */
  break?: boolean | 'column'
  wrap?: boolean
  /** Checked at mount: never in a row, a table cell or on a fixed node (validate-tree.ts). */
  keepWithNext?: boolean
  minPresenceAhead?: number
  /** Positive whole numbers (admission, plain-tree.ts). */
  widows?: number
  orphans?: number
  /** A title or a bookmark; null on the parts of a split node after the first (paginate/split-node.ts). */
  bookmark?: string | Bookmark | null
  render?: (page: PageInfo) => RenderResult
  /**
   * An admitted size, or `{ width }` alone: a page with an automatic height,
   * which `measureNaturalHeights` lays out to read the natural height of its
   * content.
   */
  size?: PdfPageSize | { width: number }
  orientation?: 'portrait' | 'landscape'
  dpi?: number
  /** A link's clickable margin on each side (admission: renderer/validate-props.ts). */
  hitSlop?: { top?: number, right?: number, bottom?: number, left?: number }
  /** An SVG element's transform: as admitted, then parsed by SVG resolution (svg/props.ts). */
  transform?: string | Transform[]
  /**
   * An SVG paint or clip: a colour or a `url(#id)` reference as admitted;
   * `none` becomes null, and SVG resolution puts the definition a reference
   * names in its place (svg/index.ts, `replaceDefinitions`).
   */
  fill?: string | LayoutNode<ResolvedStyle> | null
  clipPath?: string | LayoutNode<ResolvedStyle> | null
}

/** The props from numbering on (`prepare/bookmarks.ts`): every bookmark is an object. */
export type NumberedProps = NodeProps & { bookmark?: Bookmark | null }

export interface ElementNode<NodeStyle = InputStyle, Props extends NodeProps = NodeProps> {
  type: ElementType
  props: Props
  style?: NodeStyle
  /** From `resolveDimensions` on; `{}` before. */
  box?: Partial<Box>
  /** From `resolveOrigin`; `null` for a node without a box. */
  origin?: Origin | null
  yogaNode?: YogaNode
  children?: LayoutNode<NodeStyle, Props>[]
  /** A text's laid-out lines, from `resolveTextLayout`; null on a dynamic text until it is laid out again. */
  lines?: Line[] | null
  /**
   * The lines of a text that the height of its box cut off after `lines`:
   * not drawn, reported as `PDF_CONTENT_HIDDEN` (`fitParagraphs`).
   */
  hiddenLines?: number
  /** A text measured in a width it may use up to: its box width and the shift of its aligned lines (dimensions/measure.ts). */
  alignedBoxWidth?: number
  alignOffset?: number
  /** An image's format, size on the page and admitted bytes, from `resolveAssets`. */
  image?: LayoutImage | null
  /**
   * `"<file>:<line>:<column>"` of the template element in development builds:
   * host data that `toEngineDocument` copies for diagnostics. The layout
   * copies it with the node and reads it only for its errors and warnings.
   */
  source?: string
}

export type LayoutNode<NodeStyle = InputStyle, Props extends NodeProps = NodeProps> = StringNode<NodeStyle> | ElementNode<NodeStyle, Props>

export type YogaInstance = { node: { create: () => YogaNode } }

/**
 * The document's metadata and PDF options: what plain-tree.ts passes on from
 * `PdfDocument` and the write stage adds (passwords, permissions), read by
 * the painter. The layout reads only `language`, for the hyphenation
 * patterns (D41).
 */
export type DocumentProps = {
  title?: string
  author?: string
  subject?: string
  creator?: string
  keywords?: string
  producer?: string
  language?: string
  creationDate?: Date
  modificationDate?: Date
  pdfVersion?: PdfDocumentProps['pdfVersion']
  pageMode?: 'useNone' | 'useOutlines' | 'useThumbs' | 'fullScreen' | 'useOC' | 'useAttachments'
  pageLayout?: PdfDocumentProps['pageLayout']
  ownerPassword?: string
  userPassword?: string
  permissions?: {
    printing?: 'lowResolution' | 'highResolution'
    modifying?: boolean
    copying?: boolean
    annotating?: boolean
    fillingForms?: boolean
    contentAccessibility?: boolean
    documentAssembly?: boolean
  }
}

/**
 * A page with the bodies of its footnotes, each a text whose `id` its marks
 * link to (`#id`), beside the flow, and its note area: a view without
 * children whose style is the area's. The layout lays the notes out once, as
 * the children of the area at the page's content width (notes.ts), and
 * pagination places the ones a page part needs in its area
 * (paginate/notes.ts); between the two, no step sees them.
 */
export type WithNotes<Page> = Page & { notes?: Page[], noteArea?: Page }

export interface DocumentNode<Page = WithNotes<ElementNode>> {
  type: typeof PDF_PRIMITIVES.Document
  props: DocumentProps
  /** The document's own style; the layout never resolves it. */
  style?: InputStyle
  yoga?: YogaInstance
  /**
   * Called once for every page pagination makes; it throws to end the render
   * (plain-tree.ts: the render deadline). A pagination that never ends then
   * stops at the deadline in every render path.
   */
  onPage?: () => void
  children: Page[]
}

/** After `resolvePageSizes`: each page style is one flat object with the page size. */
export type SizedPage = WithNotes<ElementNode> & { style: Style }
export type SizedDocument = DocumentNode<SizedPage>

/** After `resolveBookmarks`: the bookmarks numbered. */
export type PreparedNode = ElementNode<InputStyle, NumberedProps>
export type PreparedDocument = DocumentNode<PreparedNode & { style: Style }>

/** After `resolveStyles`: every style is one flat, resolved object. */
export type StyledNode = ElementNode<ResolvedStyle, NumberedProps>
export type StyledLayoutNode = LayoutNode<ResolvedStyle, NumberedProps>
export type StyledDocument = DocumentNode<StyledNode>

/**
 * After `resolveDimensions`: every element has the box yoga computed (the
 * measured tree). Pagination splits it into page fragments of the same shape.
 */
export type MeasuredNode = Omit<StyledNode, 'box' | 'children' | 'style'> & {
  box: Required<Box>
  style: ResolvedStyle
  children: (StringNode<ResolvedStyle> | MeasuredNode)[]
}
/** From `foldNotes` (notes.ts) to pagination, a page holds its notes measured. */
export type MeasuredDocument = DocumentNode<WithNotes<MeasuredNode>>

/**
 * The layout result: one laid-out page node per page, every element with its
 * full box (`MeasuredNode`) and the origin of its transforms (`resolveOrigin`).
 */
export type LaidOutNode = Omit<MeasuredNode, 'children'> & {
  origin: Origin | null
  children: (StringNode<ResolvedStyle> | LaidOutNode)[]
}
export type LaidOutDocument = DocumentNode<LaidOutNode>
