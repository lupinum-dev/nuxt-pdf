import { FIELD_APPEARANCE_DEFAULTS, num } from '../form-appearance'
import { embeddedFieldFont, type FieldFont, type FontProgram } from '../form-font'
import { standardFont } from '../standard-fonts'
import type { Annotations } from './annotations'
import { pageRect, type PageContent } from './content'
import type { PdfFile } from './file'
import { PdfText, type PdfRef, type PdfValue } from './objects'
import { HELVETICA, type TextWriter } from './text'
import type { FieldSpec, PdfWriter } from './writer'

// Form fields in our writer: the field fonts, the appearance streams, the
// widgets and the AcroForm.

/** A radio group: one parent field, written at the end with its options as kids. */
interface RadioGroup {
  readonly ref: PdfRef
  readonly name: string
  readonly value: string
  readonly flags: number
  readonly kids: PdfRef[]
}

/** Field flags (ISO 32000-1, Tables 221, 226 and 230). */
const FIELD_FLAGS = { readOnly: 1, required: 2, multiline: 0x1000, combo: 0x20000, edit: 0x40000 }

export interface Form {
  readonly operators: Pick<PdfWriter, 'fieldFont' | 'appearance' | 'field'>
  /** Writes the radio groups and returns the AcroForm, or nothing without a form. */
  finish(): PdfRef | undefined
}

/**
 * The field fonts are made here, before the first page, as pdfkit made them:
 * Helvetica takes the first font name.
 */
export const createForm = (
  file: PdfFile,
  form: { embedded?: readonly FontProgram[] } | undefined,
  content: PageContent,
  text: TextWriter,
  annotations: Annotations,
): Form => {
  const fieldFonts = new Map<FontProgram | undefined, FieldFont>()
  if (form !== undefined) {
    if (form.embedded === undefined) {
      const entry = text.standardFontEntry('Helvetica')
      const helvetica = standardFont('Helvetica')
      fieldFonts.set(undefined, {
        id: entry.name,
        ref: () => entry.ref,
        ascender: HELVETICA.ascender,
        descender: HELVETICA.descender,
        lineHeight: size => HELVETICA.lineHeight * size,
        encode: (value) => {
          const [codes, positions] = helvetica.encode(value)
          return [codes, positions.map(position => position.advanceWidth)]
        },
      })
    }
    else {
      form.embedded.forEach((program, index) => fieldFonts.set(program, embeddedFieldFont(file, program, `FF${index + 1}`)))
    }
  }
  const fields: PdfRef[] = []
  const appearances: PdfRef[] = []
  const radioGroups = new Map<string, RadioGroup>()

  /** What every widget of `spec` has: its description, the look a reader draws it with again, its states. */
  const widgetEntries = (spec: FieldSpec): Record<string, PdfValue | undefined> => ({
    Subtype: 'Widget',
    F: 4,
    // pdfkit gave every annotation but a link a black colour.
    C: [0, 0, 0],
    TU: spec.label === undefined ? undefined : new PdfText(spec.label),
    MK: spec.background === undefined && spec.border === undefined ? undefined : { BG: spec.background && [...spec.background], BC: spec.border && [...spec.border.color] },
    BS: spec.border === undefined ? undefined : { W: spec.border.width, S: 'S' },
  })

  /** The field entries of a field that is its own widget. */
  const fieldEntries = (spec: Exclude<FieldSpec, { kind: 'radio' }>): Record<string, PdfValue | undefined> => {
    const flags = (spec.readOnly ? FIELD_FLAGS.readOnly : 0) | (spec.required ? FIELD_FLAGS.required : 0)
    const entries = { T: new PdfText(spec.name), ...widgetEntries(spec) }
    if (spec.kind === 'checkbox') {
      // A checkbox's value and state are names.
      const state = spec.checked ? spec.on : 'Off'
      return { ...entries, FT: 'Btn', Ff: flags || undefined, V: state, DV: state, AS: state, AP: { N: { [spec.on]: appearances[spec.appearances.on]!, Off: appearances[spec.appearances.off]! } } }
    }
    const textLike = {
      ...entries,
      DA: new PdfText(spec.defaultAppearance),
      Q: spec.quadding,
      V: spec.value === '' ? undefined : new PdfText(spec.value),
      AP: { N: appearances[spec.appearance]! },
    }
    if (spec.kind === 'text') return { ...textLike, FT: 'Tx', Ff: (flags | (spec.multiline ? FIELD_FLAGS.multiline : 0)) || undefined, MaxLen: spec.maxLength }
    const choices = Array.isArray(spec.options) ? spec.options.map(option => new PdfText(String(option))) : undefined
    return { ...textLike, FT: 'Ch', Ff: flags | FIELD_FLAGS.combo | (spec.editable ? FIELD_FLAGS.edit : 0), Opt: choices }
  }

  const operators: Form['operators'] = {
    fieldFont: (program) => {
      const font = fieldFonts.get(program)
      if (font === undefined) throw new Error('Nuxt PDF did not prepare the font of a form field.')
      return font
    },
    appearance: (width, height, lines, font) => {
      const owned = font === undefined ? undefined : [...fieldFonts.values()].find(item => item.id === font.id)
      return appearances.push(file.stream({
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, width, height],
        Resources: owned === undefined ? {} : { Font: { [owned.id]: owned.ref() } },
      }, lines.join('\n'))) - 1
    },
    field: (spec, x, y, width, height, element) => {
      const rect = pageRect(content.ctm(), x, y, width, height)
      if (spec.kind !== 'radio') {
        fields.push(annotations.annotate(rect, fieldEntries(spec), { element }))
        return
      }
      // A radio option is a widget without a name of its own: a kid of its group.
      let group = radioGroups.get(spec.group.name)
      if (group === undefined) {
        group = { ...spec.group, ref: file.reserve(), kids: [] }
        radioGroups.set(group.name, group)
        fields.push(group.ref)
      }
      const state = spec.checked ? spec.on : 'Off'
      group.kids.push(annotations.annotate(rect, {
        ...widgetEntries(spec),
        Parent: group.ref,
        AS: state,
        AP: { N: { [spec.on]: appearances[spec.appearances.on]!, Off: appearances[spec.appearances.off]! } },
      }, { element }))
    },
  }

  const finish = (): PdfRef | undefined => {
    // A radio group's value and default are names; `T` is a text string.
    for (const group of radioGroups.values()) {
      file.set({ FT: 'Btn', Ff: group.flags, T: new PdfText(group.name), V: group.value, DV: group.value, Kids: group.kids }, group.ref)
    }
    if (form === undefined) return undefined
    const fieldFontList = [...fieldFonts.values()]
    return file.set({
      Fields: fields,
      DA: fieldFontList[0] === undefined ? undefined : new PdfText(`/${fieldFontList[0].id} ${num(FIELD_APPEARANCE_DEFAULTS.fontSize)} Tf 0 g`),
      DR: { Font: Object.fromEntries(fieldFontList.map(font => [font.id, font.ref()])) },
    })
  }

  return { operators, finish }
}
