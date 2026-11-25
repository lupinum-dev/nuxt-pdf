import type { LaidOutNode } from './layout/types'
import { readPdfColor } from '../../shared/color'
import type { FieldFontMetrics } from './pdf/writer'

// The appearance streams of form fields: what a field looks like in
// every reader, read from its resolved style and box and drawn as a form
// XObject per state. `forms.ts` puts them into the field dictionaries.

/** The field look a style does not set (one source for each default; the forms docs page lists them). */
export const FIELD_APPEARANCE_DEFAULTS = {
  fontSize: 10,
  color: 'black',
  padding: 2,
  textAlign: 'left',
} as const

/** Line width of the checkbox cross, as a share of the smaller content side. */
const CROSS_WIDTH = 0.15
/** Control-point distance of a quarter circle drawn as one Bézier curve, per unit radius. */
const KAPPA = 0.5522847498

export type Align = 'left' | 'center' | 'right'
type Sides = { top: number, right: number, bottom: number, left: number }
export type Color = number[]

export type FieldLook = {
  fontSize: number
  color: Color
  background: Color | undefined
  border: Sides
  borderColors: { top: Color, right: Color, bottom: Color, left: Color }
  padding: Sides
  align: Align
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const
type Side = typeof SIDES[number]
// The style and box keys of each side.
const BORDER_WIDTH = { top: 'borderTopWidth', right: 'borderRightWidth', bottom: 'borderBottomWidth', left: 'borderLeftWidth' } as const
const PADDING = { top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft' } as const
const BORDER_COLOR = { top: 'borderTopColor', right: 'borderRightColor', bottom: 'borderBottomColor', left: 'borderLeftColor' } as const

/** A number in a content stream: at most four decimals, no exponent. */
export const num = (value: number): string => {
  const fixed = Number(value.toFixed(4))
  return Object.is(fixed, -0) ? '0' : String(fixed)
}

const colorOperands = (color: Color): string => color.map(num).join(' ')
export const fillColor = (color: Color): string => `${colorOperands(color)} ${color.length === 4 ? 'k' : color.length === 1 ? 'g' : 'rg'}`
const strokeColor = (color: Color): string => `${colorOperands(color)} ${color.length === 4 ? 'K' : color.length === 1 ? 'G' : 'RG'}`

/**
 * WinAnsi codes (hex, from the font's `encode`) as a PDF literal string:
 * `(`, `)` and `\` escaped, bytes outside printable ASCII as octal escapes,
 * so the stream stays ASCII.
 */
const literalString = (codes: readonly string[]): string => {
  let body = ''
  for (const code of codes) {
    const byte = Number.parseInt(code, 16)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5C) body += `\\${String.fromCharCode(byte)}`
    else if (byte < 0x20 || byte > 0x7E) body += `\\${byte.toString(8).padStart(3, '0')}`
    else body += String.fromCharCode(byte)
  }
  return `(${body})`
}

/** Read the look of a field from its resolved style and box. */
export const fieldLook = (node: Pick<LaidOutNode, 'style' | 'box'>): FieldLook => {
  const { style, box } = node
  // As operands from 0 to 1; validation admits only opaque field colours.
  const color = (value: unknown, fallback: string): Color =>
    readPdfColor(typeof value === 'string' ? value : fallback)?.rgb.map(part => part / 255) ?? [0, 0, 0]
  const fontSize = typeof style.fontSize === 'number' && style.fontSize > 0 ? style.fontSize : FIELD_APPEARANCE_DEFAULTS.fontSize
  const align = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
  const side = (keys: typeof BORDER_WIDTH | typeof PADDING, fallback: number): Sides => {
    // The box holds the resolved length (a percentage padding too); the
    // style says whether the author set it at all.
    const read = (name: Side): number => style[keys[name]] === undefined ? fallback : box[keys[name]] ?? fallback
    return { top: read('top'), right: read('right'), bottom: read('bottom'), left: read('left') }
  }
  const borderColor = (name: Side): Color => color(style[BORDER_COLOR[name]], 'black')
  return {
    fontSize,
    color: color(style.color, FIELD_APPEARANCE_DEFAULTS.color),
    background: typeof style.backgroundColor === 'string' ? color(style.backgroundColor, 'white') : undefined,
    border: side(BORDER_WIDTH, 0),
    // The engine paints a border without a color black; so does the appearance.
    borderColors: { top: borderColor('top'), right: borderColor('right'), bottom: borderColor('bottom'), left: borderColor('left') },
    padding: side(PADDING, FIELD_APPEARANCE_DEFAULTS.padding),
    align,
  }
}

/** The background and border of a field, outside the `/Tx` marked content. */
const frame = (look: FieldLook, width: number, height: number): string[] => {
  const { top, right, bottom, left } = look.border
  const lines: string[] = []
  if (look.background !== undefined) lines.push(fillColor(look.background), `0 0 ${num(width)} ${num(height)} re f`)
  const rects: Record<Side, [number, number, number, number]> = {
    top: [0, height - top, width, top],
    right: [width - right, 0, right, height],
    bottom: [0, 0, width, bottom],
    left: [0, 0, left, height],
  }
  let color: string | undefined
  for (const name of SIDES) {
    if (look.border[name] <= 0) continue
    const next = fillColor(look.borderColors[name])
    if (next !== color) lines.push(next)
    color = next
    lines.push(`${rects[name].map(num).join(' ')} re f`)
  }
  return lines.length === 0 ? [] : ['q', ...lines, 'Q']
}

/** The content box (inside border and padding) in appearance coordinates. */
const contentBox = (look: FieldLook, width: number, height: number) => {
  const left = look.border.left + look.padding.left
  const bottom = look.border.bottom + look.padding.bottom
  return {
    left,
    bottom,
    width: width - left - look.border.right - look.padding.right,
    height: height - bottom - look.border.top - look.padding.top,
  }
}

type Measured = { codes: string[], width: number }

const measure = (font: FieldFontMetrics, text: string, size: number): Measured => {
  const [codes, widths] = font.encode(text)
  // Unkerned widths: a `Tj` string advances by the glyph widths only.
  return { codes, width: widths.reduce((sum, width) => sum + width, 0) * size / 1000 }
}

/**
 * The value broken into lines no wider than `width`: at its own line breaks,
 * then at spaces, and inside a word that is wider than a line.
 */
const wrapLines = (font: FieldFontMetrics, value: string, size: number, width: number): string[] => {
  const lines: string[] = []
  for (const paragraph of value.split(/\r\n|\r|\n/)) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (measure(font, candidate, size).width <= width) {
        line = candidate
        continue
      }
      if (line !== '') lines.push(line)
      line = ''
      for (const character of word) {
        if (line !== '' && measure(font, line + character, size).width > width) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}

/**
 * The text of a text or choice field: `/Tx BMC … EMC`, clipped to the
 * content box. A single line has its baseline centred vertically; multiple
 * lines start at the top. An empty value draws no text.
 */
export const textContent = (font: FieldFontMetrics, look: FieldLook, value: string, multiline: boolean, width: number, height: number): string[] => {
  const content = contentBox(look, width, height)
  const size = look.fontSize
  const ascent = font.ascender * size / 1000
  const descent = -font.descender * size / 1000
  const lines = value === '' ? [] : multiline ? wrapLines(font, value, size, content.width) : [value]
  const leading = font.lineHeight(size)
  const firstBaseline = multiline
    ? content.bottom + content.height - ascent
    : content.bottom + (content.height - ascent - descent) / 2 + descent
  const shown = lines.map((line, index) => {
    const { codes, width: lineWidth } = measure(font, line, size)
    const x = look.align === 'left'
      ? content.left
      : look.align === 'center'
        ? content.left + (content.width - lineWidth) / 2
        : content.left + content.width - lineWidth
    return `1 0 0 1 ${num(x)} ${num(firstBaseline - index * leading)} Tm ${literalString(codes)} Tj`
  })
  const text = shown.length === 0
    ? []
    : ['q', `${num(content.left)} ${num(content.bottom)} ${num(content.width)} ${num(content.height)} re W n`, 'BT', `/${font.id} ${num(size)} Tf`, fillColor(look.color), ...shown, 'ET', 'Q']
  return [...frame(look, width, height), '/Tx BMC', ...text, 'EMC']
}

/** A checkbox state: the frame, and in the On state a cross inside the content box. */
export const checkboxContent = (look: FieldLook, on: boolean, width: number, height: number): string[] => {
  const content = contentBox(look, width, height)
  const lineWidth = Math.min(content.width, content.height) * CROSS_WIDTH
  if (!on || lineWidth <= 0) return frame(look, width, height)
  // Round caps reach half the line width past each end point.
  const x0 = content.left + lineWidth / 2
  const y0 = content.bottom + lineWidth / 2
  const x1 = content.left + content.width - lineWidth / 2
  const y1 = content.bottom + content.height - lineWidth / 2
  return [
    ...frame(look, width, height),
    'q',
    strokeColor(look.color),
    `${num(lineWidth)} w 1 J`,
    `${num(x0)} ${num(y0)} m ${num(x1)} ${num(y1)} l`,
    `${num(x0)} ${num(y1)} m ${num(x1)} ${num(y0)} l`,
    'S',
    'Q',
  ]
}

/** A closed circle path: four Bézier quarters, counter-clockwise from the right. */
const circlePath = (cx: number, cy: number, r: number): string[] => {
  const k = r * KAPPA
  const point = (...values: number[]) => values.map(num).join(' ')
  return [
    `${point(cx + r, cy)} m`,
    `${point(cx + r, cy + k, cx + k, cy + r, cx, cy + r)} c`,
    `${point(cx - k, cy + r, cx - r, cy + k, cx - r, cy)} c`,
    `${point(cx - r, cy - k, cx - k, cy - r, cx, cy - r)} c`,
    `${point(cx + k, cy - r, cx + r, cy - k, cx + r, cy)} c`,
    'h',
  ]
}

/**
 * A radio state, round in the box: the background as a disc and the border
 * (the top side's width and colour) as a ring, both as large as the smaller
 * side; in the On state a dot that fills the content box.
 */
export const radioContent = (look: FieldLook, on: boolean, width: number, height: number): string[] => {
  const radius = Math.min(width, height) / 2
  const border = Math.min(look.border.top, radius)
  const lines: string[] = []
  if (look.background !== undefined) lines.push('q', fillColor(look.background), ...circlePath(width / 2, height / 2, radius), 'f', 'Q')
  if (border > 0) lines.push('q', strokeColor(look.borderColors.top), `${num(border)} w`, ...circlePath(width / 2, height / 2, radius - border / 2), 'S', 'Q')
  const content = contentBox(look, width, height)
  const dot = Math.min(content.width, content.height) / 2
  if (on && dot > 0) {
    lines.push('q', fillColor(look.color), ...circlePath(content.left + content.width / 2, content.bottom + content.height / 2, dot), 'f', 'Q')
  }
  return lines
}
