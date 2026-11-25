import type { FontProgram } from '../form-font'
import type { Font, Glyph, Position } from '../fonts'
import type { StructureSpec } from '../tagged'

// The seam between painting and writing (D37).
// The painter (`engine/paint/**`) walks the laid-out document and calls only
// this interface; our PDF writer (`pdf-writer.ts`) implements it.
//
// Coordinates are points with the origin at the top left of the page and y
// growing down, under the current transform, as the painter sees the layout.

/** A colour, 0 to 255 per channel. */
export type Rgb = readonly [red: number, green: number, blue: number]

/** `evenodd` fills by the even-odd rule; anything else by non-zero winding. */
export type FillRule = string

export interface GradientStop {
  offset: number
  color: Rgb
  opacity: number
}

/** A gradient in user space, as the painter resolved it from the shape it fills. */
export type Gradient
  = | { kind: 'linear', x1: number, y1: number, x2: number, y2: number, stops: readonly GradientStop[] }
    | { kind: 'radial', cx: number, cy: number, fx: number, fy: number, r: number, stops: readonly GradientStop[] }

export type Matrix = readonly [a: number, b: number, c: number, d: number, e: number, f: number]

/** One run of shaped glyphs in one font at one size, drawn from the current origin. */
export interface GlyphRun {
  font: Font
  /** Without a size the previous run's size stays. */
  size: number | undefined
  glyphs: readonly Glyph[]
  positions: readonly Position[]
}

/** An image file's bytes; images with the same `key` are embedded once per document. */
export interface ImageSource {
  key?: string
  data: unknown
}

/** An outline entry as the painter resolved it; `left` and `top` are in the current user space. */
export interface OutlineItem {
  /** The bookmark's number, in source order (`resolveBookmarks`); `parent` is its nearest bookmarked ancestor's. */
  ref: number
  parent?: number
  title: string
  pageNumber: number
  top: number
  left: number
  expanded?: boolean
  fit?: boolean
}

/** A structure element of a tagged document (planned by `tagged.ts`). */
export type StructureElement = StructureSpec

/** A colour as PDF operands: 1 (gray), 3 (RGB) or 4 (CMYK) numbers from 0 to 1. */
export type FieldColor = readonly number[]

/** What every field kind has: its name, flags and the look a reader draws it with again. */
interface FieldBase {
  /** The field's name (`T`); a radio option's widget has none of its own. */
  name: string
  readOnly: boolean
  required: boolean
  /** The description a reader shows (`TU`). */
  label?: string
  background?: FieldColor
  /** The top border's width and colour, when it has one. */
  border?: { width: number, color: FieldColor }
}

/** A text or choice field: its value drawn in a field font (`fieldFont`). */
interface TextLikeField extends FieldBase {
  /** `DA`: the font, size and colour a reader draws an edited value in. */
  defaultAppearance: string
  /** Centred (1) or right (2); left is the default. */
  quadding?: number
  value: string
  appearance: number
}

export type FieldSpec
  = | (TextLikeField & { kind: 'text', multiline: boolean, maxLength?: number })
    | (TextLikeField & { kind: 'select', editable: boolean, options: unknown })
    | (FieldBase & { kind: 'checkbox', on: string, checked: boolean, appearances: { on: number, off: number } })
    | (FieldBase & {
      kind: 'radio'
      /** The option's state name: its value. */
      on: string
      checked: boolean
      appearances: { on: number, off: number }
      /** The group, one field for all options with this name. */
      group: { name: string, value: string, flags: number }
    })

/** A field font's metrics, per 1000 units of the size; `id` is its resource name. */
export interface FieldFontMetrics {
  readonly id: string
  readonly ascender: number
  readonly descender: number
  lineHeight(size: number): number
  /** WinAnsi codes in hex, and each glyph's unkerned advance width. */
  encode(text: string): [string[], number[]]
}

export interface PdfWriter {
  // Pages
  addPage(width: number, height: number): void

  // Graphics state
  save(): void
  restore(): void
  transform(...matrix: Matrix): void
  /** A point of the current user space in page space: x from the page's left edge, y from its bottom. */
  toPage(x: number, y: number): [number, number]

  // Path construction
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  rect(x: number, y: number, width: number, height: number): void
  closePath(): void

  // Path painting
  fill(rule?: FillRule): void
  stroke(): void
  fillAndStroke(rule?: FillRule): void
  clip(rule?: FillRule): void

  // Paint state; colour setters take `null` for a colour the painter cannot read (no operator)
  fillColor(color: Rgb | null): void
  strokeColor(color: Rgb | null): void
  fillGradient(gradient: Gradient): void
  fillOpacity(opacity: number): void
  strokeOpacity(opacity: number): void
  opacity(opacity: number): void
  lineWidth(width: number): void
  lineCap(cap: string): void
  lineJoin(join: string): void
  dash(lengths: readonly number[], phase?: number): void
  undash(): void

  // Content
  glyphs(run: GlyphRun): void
  /**
   * The image stretched to the box; `opacity` is set after the image is
   * embedded. Without a width or height the image keeps its ratio, and
   * without both it takes its own size (a pixel per point).
   */
  image(image: ImageSource, x: number, y: number, width: number | undefined, height: number | undefined, opacity?: number): void
  /** An image inside a text line: scaled to fit the box, centred, at its bottom. */
  inlineImage(image: ImageSource, x: number, y: number, width: number, height: number): void
  /**
   * One line of text at `size` in the fill colour, its top left at (x, y): the
   * debug overlay's box size, always in Helvetica.
   */
  label(text: string, x: number, y: number, size: number): void

  // Marked content (a tagged document only). Content outside any marked
  // sequence is written as an artifact. Sequences nest as the painter calls
  // them; the writer closes and reopens marked content around an inner one,
  // so the file has flat sequences, each element's parts in paint order.
  /**
   * The content that follows belongs to `element`. `order` places it among
   * the element's kids (the leaf's tree position); an inner sequence takes its
   * leaf's. `actualText` is the source text of a leaf whose glyphs differ.
   */
  beginMarked(element: StructureElement, order?: number, actualText?: string): void
  /** The content that follows is an artifact; `pagination` marks a repeated table header. */
  beginArtifact(pagination?: boolean): void
  endMarked(): void

  // Navigation, at points and boxes of the current user space (the writer
  // maps them to the page); in a tagged document every annotation names its element
  linkToUri(x: number, y: number, width: number, height: number, uri: string, element?: StructureElement): void
  /** `printed`: the text of the link's run, the description of an element whose link has none (a footnote's number). */
  linkToDestination(x: number, y: number, width: number, height: number, name: string, element?: StructureElement, printed?: string): void
  destination(name: string, left: number, top: number): void
  note(x: number, y: number, contents: string, color: string | undefined): void
  /** Adds an outline entry; the outline nests and orders the entries by their numbers when it ends. */
  outline(item: OutlineItem): void

  // Form fields, at the box under the current transform
  /** The font of text and choice fields: Helvetica, or `program` embedded (a conformance level). */
  fieldFont(program?: FontProgram): FieldFontMetrics
  /** A form XObject with these content lines; returns its number for a field's states. */
  appearance(width: number, height: number, lines: readonly string[], font?: FieldFontMetrics): number
  field(spec: FieldSpec, x: number, y: number, width: number, height: number, element?: StructureElement): void

  /** Ends the document. */
  end(): void
}
