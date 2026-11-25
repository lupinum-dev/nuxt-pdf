import type { FontStore } from '../../fonts'
import { PDF_PRIMITIVES } from '../../../../primitives'
import { DEFAULT_FONT_SIZE, type Font, type Fragment, type Leader, type TextAnchor, type TextStyle } from '../../text'
import { shapeText } from '../../text/shape'
import type { ResolvedStyle, StyledNode } from '../types'
import { transformText } from './transform'

type TextElement = StyledNode

/** The object replacement character: one glyph slot for an inline image or a leader. */
const OBJECT_REPLACEMENT = String.fromCharCode(0xFFFC)

const isDecoration = (value: unknown, line: 'underline' | 'line-through'): boolean =>
  value === line || value === 'underline line-through' || value === 'line-through underline'

// A string as a fragment; none for an empty string. Characters that draw
// nothing stay, also when the font lacks them: the word joiner holds its
// break (UAX #14), and a font without it gives it no room and paints
// nothing (`drawsNothing`, shape.ts). Line and paragraph separators end a
// paragraph (`splitParagraphs`), and a finished line does not paint them.
const leaf = (string: string, style: TextStyle): Fragment[] => string === '' ? [] : [{ string, style }]

/**
 * A footnote number that pagination decides (`footnotes: 'page'`): its text
 * holds as many digits as the number may have, and each is laid out as the
 * widest digit of its font, so the number the page walk prints
 * (footnote-numbers.ts) fits the width the line kept for it.
 */
export const NUMBER_RESERVE_PROP = '__nuxtPdfNumberReserve'

/**
 * On a text with page tokens while the page builder pages it: the ranges of
 * its string that hold a page number or count, `[start, end)`. Each digit there
 * is laid out as the widest digit of its font, so the value painted after
 * paging fits the width its line kept (paginate/dynamic.ts).
 */
export const RESERVED_DIGITS_PROP = '__nuxtPdfReservedDigits'
export type ReservedDigits = readonly (readonly [number, number])[]

/** `value` with `transform` applied and each reserved range set in `digit`. */
const withReserved = (value: string, ranges: ReservedDigits, digit: string, transform: ResolvedStyle['textTransform']): string => {
  let text = ''
  let from = 0
  for (const [start, end] of ranges) {
    text += transformText(value.slice(from, start), transform) + digit.repeat(end - start)
    from = end
  }
  return text + transformText(value.slice(from), transform)
}

/**
 * The structure index of an inline image's figure in a tagged document
 * (tagged.ts), absent for an artifact. The painter tags each image by it, as
 * images paint in visual order, which is not their reading order in
 * right-to-left text.
 */
export const INLINE_FIGURE_PROP = '__nuxtPdfInlineFigure'

const DIGITS = '0123456789'

const digitAdvances = new WeakMap<Font, number[]>()

/** The advance of each digit in `font`, in font units. */
const advancesOf = (font: Font): number[] => {
  let advances = digitAdvances.get(font)
  if (advances === undefined) {
    advances = [...DIGITS].map(digit => shapeText(font, digit).positions[0]?.xAdvance ?? 0)
    digitAdvances.set(font, advances)
  }
  return advances
}

/**
 * The digit a reserved number is laid out in: the widest digit of the first
 * font of `fonts` that has all ten, among the digits that itemization gives
 * that font (no font before it has them). The number is shaped later in the
 * run of these digits (`relabelRange`), so in this one font, which has every
 * digit. A number of n digits fits in n of this digit unless the font moves
 * its digits apart, or a font before it takes a wider digit of this font;
 * such a number fails as wider than its room, it never shows a missing glyph.
 * '0' when no font has all ten.
 */
const widestDigit = (fonts: readonly Font[]): string => {
  const has = (font: Font, digit: string) => font.hasGlyphForCodePoint(digit.codePointAt(0)!)
  const at = fonts.findIndex(font => [...DIGITS].every(digit => has(font, digit)))
  const font = fonts[at]
  if (font === undefined) return '0'
  const advances = advancesOf(font)
  let widest = '0'
  let width = -1
  for (const [index, digit] of [...DIGITS].entries()) {
    if (fonts.slice(0, at).some(before => has(before, digit))) continue
    if (advances[index]! > width) [widest, width] = [digit, advances[index]!]
  }
  return widest
}

/** The `id` and the `bookmark` of a nested text, if it has either. */
const anchorOf = (text: TextElement): TextAnchor | undefined => {
  const { id, bookmark } = text.props
  const named = typeof id === 'string' && id.length > 0
  if (!named && !bookmark) return undefined
  return { ...(named ? { id } : {}), ...(bookmark ? { bookmark } : {}) }
}

/** The fragments with `anchor` on the first one, before the anchors of texts nested in it there. */
const anchored = (fragments: Fragment[], anchor: TextAnchor | undefined): Fragment[] => {
  const [first, ...rest] = fragments
  if (!anchor || !first) return fragments
  return [{ ...first, style: { ...first.style, anchors: [anchor, ...first.style.anchors ?? []] } }, ...rest]
}

/**
 * The fonts of a family stack. The layout step loaded every face before it
 * lays out text, so each has its data.
 */
export const fontStack = (fontStore: FontStore, families: readonly string[], descriptor: Omit<Parameters<FontStore['getFont']>[0], 'fontFamily'>): Font[] =>
  families.flatMap((family) => {
    const font = fontStore.getFont({ ...descriptor, fontFamily: family }).data
    return font ? [font] : []
  })

/**
 * The size of an inline image: its width or height in points, else the font
 * size. A length that is not points (a percentage) has no base inside a line.
 */
const imageSize = (length: number | string | undefined, fontSize: number): number =>
  typeof length === 'number' && length !== 0 ? length : fontSize

/**
 * A leader's line: dotted, 0.75 points thick, grey, with a gap of 0.3em on
 * each side (the em of the text around it). These were the defaults of the
 * contents leader before it became a `PdfLeader`.
 */
const LEADER_DEFAULTS = { style: 'dotted', width: 0.75, color: '#6e6e6e', gap: 0.3 } as const

/**
 * The leader of a `PdfLeader` node. Validation admits only the bottom
 * border keys and the side margins (`validateLeaderStyle`), and inheritance
 * made an `em` margin points; a length without points falls back.
 */
const leaderOf = (style: ResolvedStyle | undefined, fontSize: number): Leader => {
  const gap = (length: number | string | undefined) => typeof length === 'number' ? length : LEADER_DEFAULTS.gap * fontSize
  return {
    style: style?.borderBottomStyle ?? LEADER_DEFAULTS.style,
    width: style?.borderBottomWidth ?? LEADER_DEFAULTS.width,
    color: style?.borderBottomColor ?? LEADER_DEFAULTS.color,
    before: gap(style?.marginLeft),
    after: gap(style?.marginRight),
  }
}

/** What a nested text takes from the text around it. */
interface Parent {
  link: string | undefined
  fontSize: number
  baselineShift: number
  /** The shift and font size of the outermost text with the underline; none when the parent has no underline. */
  underline: { shift: number, fontSize: number } | undefined
}

/**
 * The baseline of a nested text, in points above the line's: its parent's,
 * raised by a third (`super`) or lowered by a fifth (`sub`) of its parent's
 * font size, as Blink does it (without its extra pixel). Validation admits
 * `super` and `sub` on nested texts only.
 */
const baselineShiftOf = (verticalAlign: ResolvedStyle['verticalAlign'], parent: Parent | undefined): number => {
  if (parent === undefined) return 0
  if (verticalAlign === 'super') return parent.baselineShift + parent.fontSize / 3
  if (verticalAlign === 'sub') return parent.baselineShift - parent.fontSize / 5
  return parent.baselineShift
}

/**
 * The fragments of a text: each string in the attributes of its text, inline
 * images and leaders as one replacement character, nested texts and links
 * in theirs.
 */
const fragmentsOf = (fontStore: FontStore, text: TextElement, parent: Parent | undefined, level: number): Fragment[] => {
  const own = text.style ?? {}
  const { color = 'black', fontFamily = 'Helvetica', fontWeight, fontStyle, fontSize = DEFAULT_FONT_SIZE, textAlign, lineHeight, textDecoration, textDecorationColor, textDecorationStyle, textTransform, textWrap, letterSpacing, fontVariantNumeric, opacity, verticalAlign } = own
  const baselineShift = baselineShiftOf(verticalAlign, parent)
  // As in CSS, an underline has the position and thickness of the text that
  // declares it; inheritance gives a nested text its parent's underline too.
  const underline = isDecoration(textDecoration, 'underline')
    ? parent?.underline ?? { shift: baselineShift, fontSize }
    : undefined
  const style: TextStyle = {
    fonts: fontStack(fontStore, typeof fontFamily === 'string' ? [fontFamily] : fontFamily || [], { fontWeight, fontStyle }),
    color,
    opacity,
    fontSize,
    // A factor (a unitless lineHeight) times this text's own font size;
    // inheritance made a percentage points (styles/inheritance.ts).
    lineHeight: typeof lineHeight === 'object' ? lineHeight.factor * fontSize : typeof lineHeight === 'number' ? lineHeight : undefined,
    // The painter draws the background of the outer text itself.
    backgroundColor: level === 0 ? null : own.backgroundColor,
    characterSpacing: letterSpacing,
    fontVariantNumeric,
    decorationStyle: textDecorationStyle,
    underline: underline !== undefined,
    underlineShift: underline?.shift,
    underlineSize: underline?.fontSize,
    strike: isDecoration(textDecoration, 'line-through'),
    strikeColor: textDecorationColor || color,
    underlineColor: textDecorationColor || color,
    link: parent?.link || linkOf(text),
    baselineShift,
    // Admission takes no `direction`: every text runs left to right.
    align: textAlign || 'left',
    textWrap,
  }
  const fragments = (text.children ?? []).flatMap((child): Fragment[] => {
    if (child.type === PDF_PRIMITIVES.TextInstance) {
      if (text.props[NUMBER_RESERVE_PROP] === true) return leaf(widestDigit(style.fonts).repeat(child.value.length), style)
      const reserved = text.props[RESERVED_DIGITS_PROP] as ReservedDigits | undefined
      if (reserved !== undefined) return leaf(withReserved(child.value, reserved, widestDigit(style.fonts), textTransform), style)
      return leaf(transformText(child.value, textTransform), style)
    }
    if (child.type === PDF_PRIMITIVES.Leader) return leaf(OBJECT_REPLACEMENT, { ...style, leader: leaderOf(child.style, fontSize) })
    if (child.type !== PDF_PRIMITIVES.Image) return fragmentsOf(fontStore, child, { link: style.link, fontSize, baselineShift, underline }, level + 1)
    // An image whose bytes did not decode has no `image` and is left out.
    if (!child.image) return []
    const figure = child.props?.[INLINE_FIGURE_PROP]
    const attachment = { width: imageSize(child.style?.width, fontSize), height: imageSize(child.style?.height, fontSize), image: child.image.data, ...(typeof figure === 'number' ? { figure } : {}) }
    return leaf(OBJECT_REPLACEMENT, { ...style, attachment })
  })
  // The outer text's id and bookmark are its node's (paint/links.ts).
  return anchored(fragments, level === 0 ? undefined : anchorOf(text))
}

/** The target of a link (`href`) or a text inside one (`src`). */
const linkOf = (text: TextElement): string | undefined => {
  const target = text.props.src || text.props.href
  return typeof target === 'string' ? target : undefined
}

/** The fragments the text layout lays out for a text node. */
export const fragmentsOfText = (fontStore: FontStore, text: TextElement): Fragment[] => fragmentsOf(fontStore, text, undefined, 0)
