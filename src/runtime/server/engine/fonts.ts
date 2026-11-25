// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./fontkit.d.ts" />
import { Buffer } from 'node:buffer'
import * as fontkit from 'fontkit'
import { PDF_FONT_WEIGHTS } from '../../authoring'
import type {
  BundledPdfFontDescriptor,
  PdfFontDataUrl,
} from '../../fonts'
import { createInstanceSubset, type InstanceSource } from './instance-subset'
import { countWork } from './work'
import { STANDARD_FAMILIES, type StandardFont, standardFont, type StandardFontName, type StandardGlyph } from './standard-fonts'
import { assertSfnt, decodeWoff2, isWoff2 } from './woff2'

declare const pdfFontStoreBrand: unique symbol

/** Opaque server-only font store accepted by the PDF engine. */
export type PdfFontStore = {
  readonly [pdfFontStoreBrand]: true
}

declare const fontkitFontBrand: unique symbol

/** A glyph of a fontkit font: what the text layout, the painter and the writer read of it. */
export interface FontkitGlyph {
  readonly id: number
  /** The characters it draws; none for a part of a letter, such as the dot of an Arabic letter. */
  readonly codePoints: number[]
  /** Font units. */
  readonly advanceWidth: number
  readonly isLigature: boolean
  readonly isMark: boolean
}

/** Where shaping puts a glyph, in font units. */
export interface Position {
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
  advanceWidth?: number
}

/**
 * A font parsed by fontkit. fontkit 2.0 ships no types: declared here is what
 * the layout step and the painter read from every font of a render; each
 * other reader names the fields it reads at its own boundary
 * (`FontkitInternals` below, `FontProgram` in form-font.ts, `EmbeddableFont`
 * in pdf/fonts.ts).
 */
export interface FontkitFont {
  readonly [fontkitFontBrand]: true
  /** Never `'STANDARD'`: fontkit gets only TTF and OTF bytes here (WOFF2 is decoded first). */
  readonly type: 'TTF'
  readonly unitsPerEm: number
  hasGlyphForCodePoint(codePoint: number): boolean
  glyphForCodePoint(codePoint: number): FontkitGlyph
  /**
   * Shapes a string: one glyph and one position per glyph. The text layout
   * passes `'ltr'`, so fontkit keeps the order of the string. A render's
   * font returns the same frozen object for the same arguments
   * (`fontForRender`), so nothing may write into it.
   */
  layout(text: string, features: FontFeatures | undefined, script: undefined, language: undefined, direction: 'ltr'): ShapedRun
}

/** OpenType features to turn on (`true`) or off, by tag, as fontkit's `layout` takes them. fontkit writes its defaults into the object. */
export type FontFeatures = Record<string, boolean>

/** The parts of fontkit's `GlyphRun` that the shaping cache freezes (fontForRender). */
export interface ShapedRun {
  readonly glyphs: readonly FontkitGlyph[]
  readonly positions: readonly Position[]
  readonly features: object
}

/** A font of a render: a registered font parsed by fontkit, or a standard font. */
export type Font = FontkitFont | StandardFont

/** A glyph of a font of a render. */
export type Glyph = FontkitGlyph | StandardGlyph

const isBundledFontSource = (src: string): src is PdfFontDataUrl =>
  /^data:font\/(?:otf|ttf|woff2);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)

/**
 * The fontkit internals that a font for one render is built from (fontkit
 * 2.0, `TTFFont`; fontkit only receives TTF and OTF bytes). The published
 * types do not declare them. CONTRACTS.md, "Font contract", says what each
 * field holds.
 */
interface FontkitInternals {
  directory: { tables: Record<string, object> }
  /** The axes of a variable font. */
  fvar?: { axis: ReadonlyArray<{ axisTag: string, minValue: number, maxValue: number }> }
  /** A new font at these axis values, sharing the file and the decoded tables. */
  getVariation: (settings: { wght: number }) => FontkitFont
  /** Shapes a run of text (the layout step calls it with the run's string and options). */
  layout: (...args: unknown[]) => ShapedRun
  /** The glyph with this id, cached by id; `characters` are the code points it was looked up for. */
  getGlyph: (id: number, characters?: number[]) => FontkitGlyph | null
  [field: string]: unknown
}

// The one cast to fontkit's private fields: fontkit 2.0 ships no types.
const internals = (font: FontkitFont): FontkitInternals => font as unknown as FontkitInternals

/**
 * Parsed fonts of this process (a render worker), one per registered font
 * source. A parsed font is only a source of font data, the same for every
 * render: the file bytes (a WOFF2 font decoded to TTF or OTF) and the decoded
 * tables. It is never laid out or painted itself. The map is
 * bounded by the font sources the application registers and lives as long as
 * the process.
 */
const parsedFonts = new Map<string, FontkitFont>()

/**
 * The font program fontkit reads: the data URL's bytes, a WOFF2 font decoded
 * to TTF or OTF bytes first (fontkit subsets a WOFF2 font without its
 * outlines, see woff2.ts), in an array of their own as `@react-pdf/font` gave them.
 */
const parseFont = (src: string, label: string): FontkitFont => {
  const bytes = Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')
  const sfnt = isWoff2(bytes) ? decodeWoff2(bytes, label) : bytes
  assertSfnt(sfnt, label)
  // `assertSfnt` admits TrueType and OpenType only, never a collection, so fontkit gives one font.
  return fontkit.create(new Uint8Array(sfnt)) as FontkitFont
}

/** The parsed font of a source. A font that fails to parse fails each render again with the same error. */
const parsedFont = (src: string, label: string): FontkitFont => {
  let parsed = parsedFonts.get(src)
  if (!parsed) {
    parsed = parseFont(src, label)
    parsedFonts.set(src, parsed)
  }
  return parsed
}

/**
 * Instances of variable fonts, one per font source and weight, kept like the parsed fonts: an instance is font data too, never
 * laid out or painted itself.
 */
const fontInstances = new Map<string, FontkitFont>()
const instances = new WeakSet<FontkitFont>()

/** The `wght` axis of a variable font, else none. */
const weightAxis = (parsed: FontkitFont): FontWeightRange | undefined => {
  const axis = internals(parsed).fvar?.axis.find(entry => entry.axisTag === 'wght')
  return axis && { min: axis.minValue, max: axis.maxValue }
}

/**
 * The parsed font that paints a weight. A variable font with a `wght` axis
 * gives its instance at that weight, which `FontSource#at` keeps inside the
 * axis: its outlines, advances and subset come from that instance; its other
 * axes stay at their defaults. Any other font is the parsed font itself.
 */
const parsedFontAt = (src: string, wght: number, label: string): FontkitFont => {
  const parsed = parsedFont(src, label)
  if (weightAxis(parsed) === undefined) return parsed
  const key = `${wght} ${src}`
  let instance = fontInstances.get(key)
  if (!instance) {
    instance = internals(parsed).getVariation({ wght })
    instances.add(instance)
    fontInstances.set(key, instance)
  }
  return instance
}

/** The one cast to the fields `instance-subset.ts` reads of an instance. */
const instanceSource = (font: FontkitInternals): InstanceSource => font as unknown as InstanceSource

/**
 * A font object for one render around the shared font data. It has its own
 * glyph cache: fontkit caches a glyph that it first loads as a part of a
 * composite glyph (the O in Ö) without its code point, so a glyph cache shared
 * between renders lost letters in later renders (#83). Its layout engine, cmap
 * processor and variation processor are built again on first use: fontkit's
 * `@cache` stores them as non-enumerable fields, which are not copied.
 */
const fontPrograms = new WeakMap<object, object>()

/**
 * What identifies a font's program in a PDF: the parsed font (or variable
 * font instance) that a render's font object was built from, or the font
 * itself. Two faces of one file share it, unless they are two weights of a
 * variable font; two files share it never, even under one PostScript name.
 */
export const fontProgramOf = (font: object): object => fontPrograms.get(font) ?? font

const sameCodePoints = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((codePoint, index) => codePoint === right[index])

/** The cached glyph with other code points: its outline and metrics stay the cached glyph's. */
const withCodePoints = (glyph: FontkitGlyph, codePoints: number[]): FontkitGlyph =>
  Object.create(glyph, { codePoints: { value: codePoints, enumerable: true } })

/**
 * A glyph that stands for other characters: a precomposed glyph drawn for a
 * base character and its marks (compose.ts), or none for the rest of its
 * composed form. The line string and the text layer read these characters.
 */
export const glyphWithCodePoints = (glyph: Glyph, codePoints: number[]): Glyph =>
  'isMark' in glyph ? withCodePoints(glyph, codePoints) : { ...glyph, codePoints }

const fontForRender = (parsed: FontkitFont): FontkitFont => {
  const source = internals(parsed)
  const font: FontkitInternals = Object.create(Object.getPrototypeOf(parsed))
  for (const field of Object.keys(source)) {
    if (field !== '_glyphs') font[field] = source[field]
  }
  font._glyphs = {}
  // The constructor defines one getter per table on the parsed font. The
  // render's font reads its tables through those getters, so each table is
  // decoded once into the shared `_tables` with the parsed font as its hidden
  // `parent` (restructure keeps the decoding font there). Decoded through the
  // render's font, a shared table pointed back at that font object, and the
  // first render's font, with every string it shaped, stayed reachable for
  // the life of the process.
  for (const tag of Object.keys(source.directory.tables)) {
    const table = Object.getOwnPropertyDescriptor(parsed, tag)?.get
    if (table) Object.defineProperty(font, tag, { get: table })
  }
  // fontkit caches one glyph object per id with the code points of the first
  // lookup: every character the font lacks is glyph 0, a glyph can serve
  // several characters, and a part of a composite glyph is cached without
  // any. A lookup for other characters gets its own glyph with theirs, so the
  // line string, the space tests and an inline image's width read the
  // character that was asked for, whatever an earlier text asked first.
  const getGlyph = font.getGlyph
  font.getGlyph = (id, characters = []) => {
    const glyph = getGlyph.call(font, id, characters)
    return glyph === null || characters.length === 0 || sameCodePoints(glyph.codePoints, characters) ? glyph : withCodePoints(glyph, characters)
  }
  // fontkit cannot subset an instance (instance-subset.ts); the writer calls `createSubset`.
  if (instances.has(parsed)) font.createSubset = () => createInstanceSubset(instanceSource(font))
  // A render shapes each string once per font: every caller of one string
  // gets the same run. Shaping is the larger part of laying text out, and a
  // table repeats its figures. Counted work (work.ts): each string shaped.
  // The run, its arrays and its positions are frozen, so a caller that
  // writes to them instead of a copy throws at once. The glyphs stay open:
  // they belong to the font's glyph cache, which fills their metrics lazily.
  const shape = font.layout
  const shaped = new Map<string, ShapedRun>()
  font.layout = (...args) => {
    const key = JSON.stringify(args)
    let run = shaped.get(key)
    if (run === undefined) {
      countWork('runsShaped')
      run = shape.apply(font, args)
      run.positions.forEach(position => Object.freeze(position))
      Object.freeze(run.positions)
      Object.freeze(run.glyphs)
      Object.freeze(run.features)
      shaped.set(key, Object.freeze(run))
    }
    return run
  }
  fontPrograms.set(font, parsed)
  // Back from fontkit's private fields to the declared font (fontkit boundary).
  return font as unknown as FontkitFont
}

export type FontStyle = 'normal' | 'italic' | 'oblique'

const numericWeight = (weight: number | string): number | undefined =>
  typeof weight === 'string' ? PDF_FONT_WEIGHTS.get(weight) : weight

export interface FontDescriptor {
  fontFamily: string
  fontStyle?: FontStyle
  fontWeight?: number | string
}

/** The weights a face paints, from `min` to `max`. A static face paints one. */
export interface FontWeightRange {
  readonly min: number
  readonly max: number
}

/**
 * One face of a family. Its font loads once, on the first `load()`. A face
 * of a variable font paints every weight on its `wght` axis: `at` gives the
 * face for one weight.
 */
export class FontSource {
  data: Font | null = null
  #loading: Promise<void> | undefined

  readonly fontFamily: string
  readonly fontStyle: FontStyle
  readonly fontWeight: number
  readonly #read: (fontWeight: number) => Font
  readonly #axis: (() => FontWeightRange | undefined) | undefined
  readonly #instances = new Map<number, FontSource>()

  // Plain fields, no parameter properties: render workers load this file with Node's type stripping.
  constructor(fontFamily: string, fontStyle: FontStyle, fontWeight: number, read: (fontWeight: number) => Font, axis?: () => FontWeightRange | undefined) {
    this.fontFamily = fontFamily
    this.fontStyle = fontStyle
    this.fontWeight = fontWeight
    this.#read = read
    this.#axis = axis
  }

  /** The weights this face paints: its own, or the `wght` axis of a variable font. */
  get weights(): FontWeightRange {
    return this.#axis?.() ?? { min: this.fontWeight, max: this.fontWeight }
  }

  /** The face that paints `fontWeight`: this one, an instance of its variable font, or none. */
  at(fontWeight: number): FontSource | undefined {
    const { min, max } = this.weights
    if (!(fontWeight >= min && fontWeight <= max)) return undefined
    if (fontWeight === this.fontWeight) return this
    let instance = this.#instances.get(fontWeight)
    if (!instance) {
      instance = new FontSource(this.fontFamily, this.fontStyle, fontWeight, this.#read)
      this.#instances.set(fontWeight, instance)
    }
    return instance
  }

  load(): Promise<void> {
    this.#loading ??= this.#load()
    return this.#loading
  }

  // Async so that a font that fails to parse rejects; `data` is set before
  // `load()` returns, which the layout step expects of the default Helvetica.
  async #load(): Promise<void> {
    this.data = this.#read(this.fontWeight)
  }
}

export interface FontFamily {
  readonly sources: FontSource[]
}

/** A face as the error lists it: its style and the weights it paints. */
const faceName = (source: FontSource): string => {
  const { min, max } = source.weights
  return `${source.fontStyle} ${min === max ? min : `${min} to ${max}`}`
}

/**
 * A family has no face for the style and weight a node asks for: neither
 * falls back to another face. The layout names the node (`resolveAssets`).
 */
export class MissingFontFaceError extends Error {
  constructor(family: string, sources: readonly FontSource[], fontStyle: FontStyle, fontWeight: number | string, weight: number) {
    const faces = [...new Set(sources.map(faceName))].join(', ')
    const hasStyle = sources.some(source => source.fontStyle === fontStyle)
    const missing = hasStyle ? `no ${fontStyle} face of weight ${weight}` : `no ${fontStyle} face`
    const fix = hasStyle
      ? `Register the ${fontStyle} ${weight} face of ${family} in \`pdf.fonts\`, or use a registered weight.`
      : `Register an ${fontStyle} file for ${family} in \`pdf.fonts\`, or use another family.`
    super(`asks for ${family} in fontStyle ${fontStyle}, fontWeight ${fontWeight}, but ${family} has ${missing} (registered: ${faces}). ${fix}`)
    this.name = 'MissingFontFaceError'
  }
}

/**
 * The face of a family for a weight and style: the face registered at that
 * weight, else the first variable face whose axis holds it. No weight or
 * style falls back to another.
 */
const resolveSource = (family: string, sources: readonly FontSource[], { fontWeight = 400, fontStyle = 'normal' }: FontDescriptor): FontSource => {
  const weight = numericWeight(fontWeight) ?? Number.NaN
  const styleSources = sources.filter(source => source.fontStyle === fontStyle)
  const registered = styleSources.find(source => source.fontWeight === weight)?.at(weight)
  if (registered) return registered
  for (const source of styleSources) {
    const instance = source.at(weight)
    if (instance) return instance
  }
  throw new MissingFontFaceError(family, sources, fontStyle, fontWeight, weight)
}

/**
 * The fonts of one render: the standard fonts and the application's
 * registered fonts. The layout step resolves a face with `getFont`, loads it
 * with `load` and reads its font from `data`.
 */
export class FontStore {
  readonly #families: Record<string, FontFamily> = {}

  constructor() {
    for (const [family, [regular, bold, italic, boldItalic]] of STANDARD_FAMILIES) {
      this.#standard(family, regular!, 'normal', 400)
      this.#standard(family, bold!, 'normal', 700)
      this.#standard(family, italic!, 'italic', 400)
      this.#standard(family, boldItalic!, 'italic', 700)
    }
    // Each standard face is also a family of its own name, as in React PDF.
    for (const [, faces] of STANDARD_FAMILIES) {
      for (const face of faces.slice(1)) this.#standard(face, face, 'normal', 400)
    }
    for (const fontStyle of ['normal', 'italic'] as const) {
      for (const fontWeight of [400, 700]) void this.getFont({ fontFamily: 'Helvetica', fontStyle, fontWeight }).load()
    }
  }

  #standard(family: string, name: StandardFontName, fontStyle: FontStyle, fontWeight: number): void {
    this.register(new FontSource(family, fontStyle, fontWeight, () => standardFont(name)))
  }

  register(source: FontSource): void {
    this.#families[source.fontFamily] ??= { sources: [] }
    this.#families[source.fontFamily]!.sources.push(source)
  }

  getFont(descriptor: FontDescriptor): FontSource {
    const family = Object.hasOwn(this.#families, descriptor.fontFamily) ? this.#families[descriptor.fontFamily] : undefined
    if (!family) throw new Error(`Font family not registered: ${descriptor.fontFamily}. Register it in \`pdf.fonts\` in nuxt.config.ts.`)
    return resolveSource(descriptor.fontFamily, family.sources, descriptor)
  }

  async load(descriptor: FontDescriptor): Promise<void> {
    await this.getFont(descriptor).load()
  }

  getRegisteredFonts(): Readonly<Record<string, FontFamily>> {
    return this.#families
  }
}

export const createPdfFontStore = (
  fonts: readonly BundledPdfFontDescriptor[] = [],
): PdfFontStore => {
  const fontStore = new FontStore()

  for (const font of fonts) {
    // A source in the map passed this check before; the check reads every
    // character of the data URL (about 2 ms for a 340 KB font).
    if (!parsedFonts.has(font.src) && !isBundledFontSource(font.src)) {
      throw new TypeError(
        `PDF font "${font.family}" must use a validated embedded font source.`,
      )
    }
    const fontWeight = font.fontWeight ?? 400
    const fontStyle = font.fontStyle ?? 'normal'
    const label = `${font.family} ${fontWeight} ${fontStyle}`
    fontStore.register(new FontSource(font.family, fontStyle, fontWeight,
      weight => fontForRender(parsedFontAt(font.src, weight, label)),
      () => weightAxis(parsedFont(font.src, label))))
  }

  // The store behind the opaque public type (`fontStoreOf` opens it again).
  return fontStore as unknown as PdfFontStore
}

/** The store behind the opaque type, for the engine's own steps. */
export const fontStoreOf = (store: PdfFontStore): FontStore => store as unknown as FontStore
