import { Buffer } from 'node:buffer'
import type PDFDocument from '@react-pdf/pdfkit'
import type { PDFReference, PDFStandardFont } from '@react-pdf/pdfkit'
import { PDF_PRIMITIVES } from '../../primitives'
import type { SafeDocumentNode } from './layout/index'

// Form fields (F5a, F5b). Nuxt PDF writes each field and its appearance
// itself, at one seam of the engine (CONTRACTS.md, "Forms"):
// - Before the paint, every field node becomes the engine's `TEXT_INPUT`
//   node. Its paint function (`renderTextInput`) only passes the field's
//   name and box, under the current transform, to pdfkit's `formText`. The
//   engine's checkbox paint would add a ZapfDingbats font and its own
//   appearances; this way it never runs.
// - `formAnnotation`, which `formText` calls, is replaced on the document:
//   it writes the field dictionary from our props, with an appearance stream
//   (`/AP /N`) for each state, drawn in Helvetica at a fixed size. The
//   AcroForm has no `NeedAppearances`, so every reader shows the same field.
// - The border and background of a field are part of its appearance, not
//   of the page, so the paint layout drops them from the node.

/** The field look a style does not set (one source for each default; the forms docs page lists them). */
const FIELD_APPEARANCE_DEFAULTS = {
  fontSize: 10,
  color: 'black',
  padding: 2,
  textAlign: 'left',
} as const

/** The field font: a standard font with WinAnsiEncoding, never subset. */
const FIELD_FONT = 'Helvetica'
/** Line width of the checkbox cross, as a share of the smaller content side. */
const CROSS_WIDTH = 0.15

type FieldKind = 'text' | 'checkbox' | 'select'
type Align = 'left' | 'center' | 'right'
type Sides = { top: number, right: number, bottom: number, left: number }
type Color = number[]

type FieldLook = {
  fontSize: number
  color: Color
  background: Color | undefined
  border: Sides
  borderColors: { top: Color, right: Color, bottom: Color, left: Color }
  padding: Sides
  align: Align
}

type Field = { kind: FieldKind, props: Record<string, unknown>, look: FieldLook }

const KINDS: Readonly<Record<string, FieldKind>> = {
  [PDF_PRIMITIVES.TextField]: 'text',
  [PDF_PRIMITIVES.Checkbox]: 'checkbox',
  [PDF_PRIMITIVES.Select]: 'select',
}
const PDFKIT_TYPES: Readonly<Record<FieldKind, string>> = { text: 'text', checkbox: 'checkbox', select: 'combo' }
const QUADDING: Readonly<Record<Align, number>> = { left: 0, center: 1, right: 2 }
const SIDES = ['top', 'right', 'bottom', 'left'] as const
const capitalized = (side: typeof SIDES[number]) => `${side[0]!.toUpperCase()}${side.slice(1)}` as 'Top' | 'Right' | 'Bottom' | 'Left'

/** The parts of a laid-out node this module reads (the engine's resolved style and box). */
type LayoutNode = {
  type: string
  props?: Record<string, unknown>
  style?: Record<string, unknown>
  box?: Record<string, number | undefined>
  children?: readonly LayoutNode[]
}

/** A number in a content stream: at most four decimals, no exponent. */
const num = (value: number): string => {
  const fixed = Number(value.toFixed(4))
  return Object.is(fixed, -0) ? '0' : String(fixed)
}

const colorOperands = (color: Color): string => color.map(num).join(' ')
const fillColor = (color: Color): string => `${colorOperands(color)} ${color.length === 4 ? 'k' : color.length === 1 ? 'g' : 'rg'}`
const strokeColor = (color: Color): string => `${colorOperands(color)} ${color.length === 4 ? 'K' : color.length === 1 ? 'G' : 'RG'}`

/**
 * WinAnsi codes (hex, from pdfkit's `encode`) as a PDF literal string:
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
const fieldLook = (context: PDFDocument, node: LayoutNode): FieldLook => {
  const style = node.style ?? {}
  const box = node.box ?? {}
  const color = (value: unknown, fallback: string): Color =>
    context._normalizeColor(typeof value === 'string' ? value : fallback) ?? [0, 0, 0]
  const fontSize = typeof style.fontSize === 'number' && style.fontSize > 0 ? style.fontSize : FIELD_APPEARANCE_DEFAULTS.fontSize
  const align = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left'
  const side = (prefix: 'border' | 'padding', suffix: '' | 'Width', fallback: number) =>
    Object.fromEntries(SIDES.map((name) => {
      const key = `${prefix}${capitalized(name)}${suffix}`
      // The box holds the resolved length (a percentage padding too); the
      // style says whether the author set it at all.
      return [name, style[key] === undefined ? fallback : box[key] ?? fallback]
    })) as Sides
  return {
    fontSize,
    color: color(style.color, FIELD_APPEARANCE_DEFAULTS.color),
    background: typeof style.backgroundColor === 'string' ? color(style.backgroundColor, 'white') : undefined,
    border: side('border', 'Width', 0),
    // The engine paints a border without a color black; so does the appearance.
    borderColors: Object.fromEntries(SIDES.map(name => [name, color(style[`border${capitalized(name)}Color`], 'black')])) as FieldLook['borderColors'],
    padding: side('padding', '', FIELD_APPEARANCE_DEFAULTS.padding),
    align,
  }
}

/**
 * The layout to paint: each field node becomes a `TEXT_INPUT` without border
 * and background (the appearance draws them), and `fields` gets its record.
 */
const paintLayout = (context: PDFDocument, node: LayoutNode, fields: Map<string, Field>): LayoutNode => {
  const kind = KINDS[node.type]
  if (kind !== undefined && typeof node.props?.name === 'string') {
    fields.set(node.props.name, { kind, props: node.props, look: fieldLook(context, node) })
    const { backgroundColor: _background, ...style } = node.style ?? {}
    return {
      ...node,
      type: PDF_PRIMITIVES.TextField,
      style,
      box: { ...node.box, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
    }
  }
  const original = node.children
  if (original === undefined) return node
  const children = original.map(child => paintLayout(context, child, fields))
  // Only the path to a field is copied; a document without fields keeps its tree.
  return children.every((child, index) => child === original[index]) ? node : { ...node, children }
}

/** The background and border of a field, outside the `/Tx` marked content. */
const frame = (look: FieldLook, width: number, height: number): string[] => {
  const { top, right, bottom, left } = look.border
  const lines: string[] = []
  if (look.background !== undefined) lines.push(fillColor(look.background), `0 0 ${num(width)} ${num(height)} re f`)
  const rects: Record<typeof SIDES[number], [number, number, number, number]> = {
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

const measure = (font: PDFStandardFont, text: string, size: number): Measured => {
  const [codes, positions] = font.encode(text)
  // Unkerned widths: a `Tj` string advances by the glyph widths only.
  return { codes, width: positions.reduce((sum, position) => sum + position.advanceWidth, 0) * size / 1000 }
}

/**
 * The value broken into lines no wider than `width`: at its own line breaks,
 * then at spaces, and inside a word that is wider than a line.
 */
const wrapLines = (font: PDFStandardFont, value: string, size: number, width: number): string[] => {
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
const textContent = (font: PDFStandardFont, look: FieldLook, value: string, multiline: boolean, width: number, height: number): string[] => {
  const content = contentBox(look, width, height)
  const size = look.fontSize
  const ascent = font.ascender * size / 1000
  const descent = -font.descender * size / 1000
  const lines = value === '' ? [] : multiline ? wrapLines(font, value, size, content.width) : [value]
  const leading = font.lineHeight(size, true)
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
const checkboxContent = (look: FieldLook, on: boolean, width: number, height: number): string[] => {
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

/** A form XObject with this content; `font` goes in its resources when the content shows text. */
const appearance = (context: PDFDocument, lines: readonly string[], width: number, height: number, font?: PDFStandardFont): PDFReference => {
  const stream = context.ref({
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, width, height],
    Resources: font === undefined ? {} : { Font: { [font.id]: font.ref() } },
  })
  // ASCII only (see `literalString`); a Buffer, so pdfkit adds nothing.
  stream.end(Buffer.from(lines.join('\n'), 'latin1'))
  return stream
}

/** The pdfkit options of a field: its dictionary entries before `_fieldDict`. */
const fieldOptions = (context: PDFDocument, font: PDFStandardFont, field: Field, width: number, height: number): Record<string, unknown> => {
  const { kind, props, look } = field
  // `MK` and `BS`: the colours and border width a reader uses when it draws
  // the field again (one width and colour; the top side's).
  const characteristics: Record<string, Color> = {
    ...(look.background !== undefined && { BG: look.background }),
    ...(look.border.top > 0 && { BC: look.borderColors.top }),
  }
  const options: Record<string, unknown> = {
    readOnly: props.readOnly === true,
    required: props.required === true,
    ...(typeof props.label === 'string' && { TU: new String(props.label) }),
    ...(Object.keys(characteristics).length > 0 && { MK: characteristics }),
    ...(look.border.top > 0 && { BS: { W: look.border.top, S: 'S' } }),
  }

  if (kind === 'checkbox') {
    const on = typeof props.exportValue === 'string' ? props.exportValue : 'Yes'
    const state = props.checked === true ? on : 'Off'
    return {
      ...options,
      value: state,
      defaultValue: state,
      AS: state,
      AP: {
        N: {
          [on]: appearance(context, checkboxContent(look, true, width, height), width, height),
          Off: appearance(context, checkboxContent(look, false, width, height), width, height),
        },
      },
    }
  }

  const value = typeof props.value === 'string' ? props.value : ''
  const multiline = kind === 'text' && props.multiline === true
  Object.assign(options, {
    // The size the reader keeps when it draws the field again after an edit.
    DA: new String(`/${font.id} ${num(look.fontSize)} Tf ${fillColor(look.color)}`),
    ...(look.align !== 'left' && { Q: QUADDING[look.align] }),
    ...(value !== '' && { value }),
    AP: { N: appearance(context, textContent(font, look, value, multiline, width, height), width, height, font) },
  })
  if (kind === 'text') {
    return { ...options, multiline, ...(typeof props.maxLength === 'number' && { MaxLen: props.maxLength }) }
  }
  return { ...options, edit: props.editable === true, select: props.options }
}

/**
 * Prepare `context` for the form fields of `layout`, and return the layout
 * to paint. A document without fields gets `layout` back unchanged and
 * writes the same bytes as before.
 */
export const prepareForm = (context: PDFDocument, layout: SafeDocumentNode): SafeDocumentNode => {
  const fields = new Map<string, Field>()
  const painted = paintLayout(context, layout as unknown as LayoutNode, fields)
  if (fields.size === 0) return layout

  context.font(FIELD_FONT)
  const font = context._font
  context.initForm()
  const acroForm = context._root.data.AcroForm as PDFReference
  delete acroForm.data.NeedAppearances
  acroForm.data.DA = new String(`/${font.id} ${num(FIELD_APPEARANCE_DEFAULTS.fontSize)} Tf 0 g`)
  // Each field carries its own `DA`; pdfkit would replace it with the font
  // painted last.
  context._resolveFont = options => options

  const fieldDict = context._fieldDict
  context._fieldDict = function (name, type, options) {
    const dictionary = fieldDict.call(this, name, type, options)
    // A checkbox value is a name (`/Yes`); `_resolveStrings` made it a text string.
    if (type === 'checkbox') {
      dictionary.V = String(dictionary.V)
      dictionary.DV = String(dictionary.DV)
    }
    return dictionary
  }

  const formAnnotation = context.formAnnotation
  context.formAnnotation = function (name, _type, x, y, width, height) {
    const field = fields.get(name)
    if (field === undefined) throw new Error(`Nuxt PDF did not prepare the form field "${name}".`)
    return formAnnotation.call(this, name, PDFKIT_TYPES[field.kind], x, y, width, height, fieldOptions(this, font, field, width, height))
  }

  return painted as unknown as SafeDocumentNode
}
