import type { Font } from './fonts'
import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES } from '../../primitives'
import { treeInvalid } from '../../shared/errors'
import {
  checkboxContent,
  fieldLook,
  fillColor,
  num,
  radioContent,
  textContent,
  type Align,
  type FieldLook,
} from './form-appearance'
import { fontProgram, glyphCharacter, type FontProgram } from './form-font'
import type { SafeDocumentNode } from './layout/index'
import type { LaidOutNode } from './layout/types'
import type { FieldSpec, PdfWriter, StructureElement } from './pdf/writer'

// Form fields: what each field is and looks like. The writer
// writes the field (`PdfWriter.field`, CONTRACTS.md "Forms"). The drawing is
// in `form-appearance.ts`, the field font in `form-font.ts`:
// - Before the paint, every field node becomes the engine's `TEXT_INPUT`
//   node named by its key; the painter calls `paintField` with its box under
//   the current transform. `paintField` draws an appearance stream for each
//   state (`PdfWriter.appearance`) and gives the writer the field's spec. The
//   AcroForm has no `NeedAppearances`, so every reader shows the same field.
// - The border and background of a field are part of its appearance, not
//   of the page, so the paint layout drops them from the node.
// - In a document that claims a conformance level (PDF/A and PDF/UA-1 both
//   require embedded fonts; D31) the value is drawn in the field's own
//   registered font, embedded whole as a simple TrueType font with
//   WinAnsiEncoding, and `DA`/`DR` name that font, so a reader that draws a
//   typed value again uses an embedded font too. The layout step resolves the
//   font (`resolveFieldFonts`); without a level the field font stays Helvetica.
// - Radios with one name are one field: a parent field dictionary with
//   the value, and one widget per option as its kid, each with its own on
//   state and `Off`. The paint layout gives each radio node a key of its own,
//   so `paintField` knows which option it draws.

/** Field flags (ISO 32000-1, Table 226): a radio group, which keeps one option on once one is chosen. */
const RADIO_FLAGS = (1 << 15) | (1 << 14)
const READ_ONLY_FLAG = 1
const REQUIRED_FLAG = 2

type FieldKind = 'text' | 'checkbox' | 'radio' | 'select'

type Field = { kind: FieldKind, props: Record<string, unknown>, look: FieldLook, node: FieldNode }

const KINDS: Readonly<Record<string, FieldKind>> = {
  [PDF_PRIMITIVES.TextField]: 'text',
  [PDF_PRIMITIVES.Checkbox]: 'checkbox',
  [PDF_PRIMITIVES.Radio]: 'radio',
  [PDF_PRIMITIVES.Select]: 'select',
}
const QUADDING: Readonly<Record<Align, number>> = { left: 0, center: 1, right: 2 }

/** A laid-out field node; `resolveFieldFonts` gives a text or choice field its registered font. */
export type FieldNode = LaidOutNode & { fieldFont?: Font }

/** A radio group: the `value` of its checked option (or `Off`) and its field flags. */
type RadioGroup = { value: string, flags: number }

/**
 * The key of a field node in `fields`: its name, and for a radio also its
 * value (unique in its group). A field name has no control characters, so
 * the separator never occurs in it.
 */
const fieldKey = (kind: FieldKind, props: Record<string, unknown>): string =>
  kind === 'radio' ? `${String(props.name)}\u0000${String(props.value)}` : String(props.name)

/**
 * The layout to paint: each field node becomes a `TEXT_INPUT` without border
 * and background (the appearance draws them) and named by its key, and
 * `fields` gets its record. `groups` gets each radio group.
 */
const paintLayout = (node: FieldNode, fields: Map<string, Field>, groups: Map<string, RadioGroup>): LaidOutNode => {
  const kind = KINDS[node.type]
  if (kind !== undefined && typeof node.props.name === 'string') {
    const key = fieldKey(kind, node.props)
    fields.set(key, { kind, props: node.props, look: fieldLook(node), node })
    if (kind === 'radio') {
      // Tree validation made readOnly and required equal on every option.
      const group = groups.get(node.props.name) ?? {
        value: 'Off',
        flags: RADIO_FLAGS | (node.props.readOnly === true ? READ_ONLY_FLAG : 0) | (node.props.required === true ? REQUIRED_FLAG : 0),
      }
      if (node.props.checked === true) group.value = String(node.props.value)
      groups.set(node.props.name, group)
    }
    const { backgroundColor: _background, ...style } = node.style ?? {}
    return {
      ...node,
      type: PDF_PRIMITIVES.TextField,
      props: { ...node.props, name: key },
      style,
      box: { ...node.box, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
    }
  }
  const original = node.children
  if (!Array.isArray(original)) return node
  const children = original.map(child => child.type === PDF_PRIMITIVES.TextInstance ? child : paintLayout(child, fields, groups))
  // Only the path to a field is copied; a document without fields keeps its tree.
  return children.every((child, index) => child === original[index]) ? node : { ...node, children }
}

/**
 * The spec of a field, with its appearance streams drawn through the writer
 * in the order the file has always held them (on before off).
 */
const fieldSpec = (writer: PdfWriter, program: FontProgram | undefined, field: Field, group: RadioGroup | undefined, width: number, height: number): FieldSpec => {
  const { kind, props, look } = field
  const base = {
    name: String(props.name),
    readOnly: props.readOnly === true,
    required: props.required === true,
    ...(typeof props.label === 'string' && { label: props.label }),
    ...(look.background !== undefined && { background: look.background }),
    ...(look.border.top > 0 && { border: { width: look.border.top, color: look.borderColors.top } }),
  }
  const states = (draw: (on: boolean) => string[]) => ({
    on: writer.appearance(width, height, draw(true)),
    off: writer.appearance(width, height, draw(false)),
  })

  if (kind === 'radio') {
    const name = String(props.name)
    return {
      ...base,
      kind,
      on: String(props.value),
      checked: props.checked === true,
      appearances: states(on => radioContent(look, on, width, height)),
      group: { name, ...group! },
    }
  }
  if (kind === 'checkbox') {
    return {
      ...base,
      kind,
      on: typeof props.exportValue === 'string' ? props.exportValue : 'Yes',
      checked: props.checked === true,
      appearances: states(on => checkboxContent(look, on, width, height)),
    }
  }

  const value = typeof props.value === 'string' ? props.value : ''
  const multiline = kind === 'text' && props.multiline === true
  const font = writer.fieldFont(program)
  const textLike = {
    ...base,
    // The size the reader keeps when it draws the field again after an edit.
    defaultAppearance: `/${font.id} ${num(look.fontSize)} Tf ${fillColor(look.color)}`,
    ...(look.align !== 'left' && { quadding: QUADDING[look.align] }),
    value,
    appearance: writer.appearance(width, height, textContent(font, look, value, multiline, width, height), font),
  }
  return kind === 'text'
    ? { ...textLike, kind, multiline, ...(typeof props.maxLength === 'number' && { maxLength: props.maxLength }) }
    : { ...textLike, kind, editable: props.editable === true, options: props.options }
}

/** A text or choice field's text that an embedded field font must draw: its value and choices. */
const drawnText = (field: Field): string =>
  [field.props.value, ...(field.kind === 'select' && Array.isArray(field.props.options) ? field.props.options : [])]
    .filter((text): text is string => typeof text === 'string')
    .join('')
    .replace(/[\n\r]/g, '')

/**
 * The embedded fonts of the text and choice fields of a document that claims
 * a conformance level, one per registered font. A field without a registered font, a font with
 * PostScript outlines or without a Unicode cmap, and a character the font
 * does not have fail with `PDF_TREE_INVALID` at the field.
 */
const embeddedFieldFonts = (fields: ReadonlyMap<string, Field>, conformance: string): Map<Field, FontProgram> => {
  const fonts = new Map<Field, FontProgram>()
  for (const field of fields.values()) {
    if (field.kind !== 'text' && field.kind !== 'select') continue
    const fail = (problem: string): never => treeInvalid(
      `${conformance} requires embedded fonts, but <${PDF_PRIMITIVE_NAMES[field.node.type]}> "${String(field.props.name)}" ${problem}`,
      field.node.source,
    )
    const font = field.node.fieldFont
    if (font === undefined) {
      fail('draws its value in the standard font Helvetica, which is not embedded. Register a font in pdf.fonts (nuxt.config) and set fontFamily on the field, its page or a parent view.')
    }
    const program = fontProgram(font!)
    const family = String([field.node.style?.fontFamily].flat()[0])
    if (program.directory.tables.glyf === undefined) {
      fail(`uses font "${family}", which has PostScript (CFF) outlines; a form field in a ${conformance} document needs a font with TrueType outlines (a .ttf file).`)
    }
    if (!program.cmap.tables.some(table => table.platformID === 3 && table.encodingID === 1)) {
      fail(`uses font "${family}", which has no Windows Unicode cmap; a form field in a ${conformance} document needs one to find its glyphs.`)
    }
    for (const character of new Set(drawnText(field))) {
      const glyph = glyphCharacter(character)
      if (glyph === undefined || !program.hasGlyphForCodePoint(glyph.codePointAt(0)!)) {
        fail(`contains "${character}" (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}), which its font "${family}" does not have. Use a font that has it, or remove the character.`)
      }
    }
    fonts.set(field, program)
  }
  return fonts
}

/** The form of a document with fields: what the writer and the painter need. */
interface PreparedForm {
  /** The layout to paint: every field a `TEXT_INPUT` named by its key. */
  readonly layout: SafeDocumentNode
  /** The writer's form option: the embedded field fonts in first-use order, with a conformance level. */
  readonly writer: { embedded?: readonly FontProgram[] }
  /** Writes the field of a `TEXT_INPUT` node at its box under the current transform. */
  paintField(writer: PdfWriter, name: string, x: number, y: number, width: number, height: number, element?: StructureElement): void
}

/**
 * The form fields of `layout`, or undefined for a document without any
 * (its layout and bytes stay as they are). With a conformance level, a field
 * whose value the embedded field font cannot draw fails here.
 */
export const prepareForm = (layout: SafeDocumentNode, conformance?: string): PreparedForm | undefined => {
  const fields = new Map<string, Field>()
  const groups = new Map<string, RadioGroup>()
  const pages = layout.children.map(page => paintLayout(page, fields, groups))
  if (fields.size === 0) return undefined
  const programs = conformance === undefined ? undefined : embeddedFieldFonts(fields, conformance)
  return {
    layout: { ...layout, children: pages },
    writer: programs === undefined ? {} : { embedded: [...new Set(programs.values())] },
    paintField: (writer, name, x, y, width, height, element) => {
      const field = fields.get(name)
      if (field === undefined) throw new Error(`Nuxt PDF did not prepare the form field "${name}".`)
      const group = field.kind === 'radio' ? groups.get(String(field.props.name)) : undefined
      writer.field(fieldSpec(writer, programs?.get(field), field, group, width, height), x, y, width, height, element)
    },
  }
}
