// The form fields.
import type { PdfStyleValue } from '../authoring'
import { boolean, primitive, required, value } from './spec'

/**
 * Props every form field shares. A field is a leaf with a fixed box: give it
 * `width` and `height` in `style`. It never splits across pages and never
 * repeats, so it cannot be inside `fixed` content.
 */
type PdfFieldProps = {
  /**
   * The field name a reader exports with the value. Unique in the document,
   * without a period (a period separates names in a field hierarchy).
   */
  name: string
  /** The accessible name a reader shows as the tooltip (the PDF `TU` entry). */
  label?: string
  /** The reader shows the value but does not let the user change it. */
  readOnly?: boolean
  /** The reader asks for a value before it submits or exports the form. */
  required?: boolean
  style?: PdfStyleValue
}

/** A text field. The reader draws the value in Helvetica, so it uses WinAnsi characters only. */
export type PdfTextFieldProps = PdfFieldProps & {
  /** The value the field starts with. */
  value?: string
  /** Lets the user type several lines; `value` may then contain line breaks. */
  multiline?: boolean
  /** The most characters the user can type. */
  maxLength?: number
}

/** A checkbox. */
export type PdfCheckboxProps = PdfFieldProps & {
  checked?: boolean
  /** The value a reader exports when the box is checked. Default `'Yes'`. */
  exportValue?: string
}

/**
 * One option of a radio group. Radios with the same `name` form one field:
 * the reader keeps at most one of them on and exports its `value`. Give
 * every option of a group the same `readOnly` and `required`.
 */
export type PdfRadioProps = PdfFieldProps & {
  /** The value a reader exports when this option is on; unique in its group. */
  value: string
  /** This option is on; at most one option of a group. */
  checked?: boolean
}

/** A drop-down list (combo box). */
export type PdfSelectProps = PdfFieldProps & {
  /** The choices, in order. WinAnsi characters only. */
  options: readonly string[]
  /** The selected choice; one of `options` unless `editable`. */
  value?: string
  /** Lets the user type a value that is not in `options`. */
  editable?: boolean
}

const FIELD_PROPS = {
  label: { check: 'string' },
  name: required({ check: 'fieldName' }),
  readOnly: boolean,
  required: boolean,
  style: value,
} as const

export const FORM_PRIMITIVES = {
  // Form fields (AcroForm widgets). The engine adapter maps the props to the
  // engine's own (server/engine/plain-tree.ts); server/engine/forms.ts writes
  // the field names and server/engine/form-font.ts the field font.
  PdfTextField: primitive<PdfTextFieldProps>()({
    tag: 'TEXT_INPUT',
    props: { ...FIELD_PROPS, maxLength: { check: 'positiveInteger' }, multiline: boolean, value: { check: 'fieldText' } },
    children: [],
  }),
  PdfCheckbox: primitive<PdfCheckboxProps>()({
    tag: 'CHECKBOX',
    props: { ...FIELD_PROPS, checked: boolean, exportValue: { check: 'fieldExportValue' } },
    children: [],
  }),
  PdfRadio: primitive<PdfRadioProps>()({
    tag: 'RADIO',
    props: { ...FIELD_PROPS, checked: boolean, value: required({ check: 'fieldExportValue' }) },
    children: [],
  }),
  PdfSelect: primitive<PdfSelectProps>()({
    tag: 'SELECT',
    props: { ...FIELD_PROPS, editable: boolean, options: required({ check: 'fieldOptions' }), value: { check: 'fieldText' } },
    children: [],
  }),
}
