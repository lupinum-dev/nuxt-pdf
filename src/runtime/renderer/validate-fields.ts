// Checks of form fields: each field on its own, and the names collected by the
// walk (unique names, radio groups, fields next to `PdfFacturX`).
import { treeInvalid } from '../shared/errors'
import { resolvedStyleValue } from '../authoring'
import { readPdfColor } from '../shared/color'
import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES, type PdfElementType } from '../primitives'
import type { PdfDocumentNode, PdfElementNode } from './types'

/**
 * A form field is a leaf with a fixed box (it never splits and never
 * repeats) and a unique name; its value must fit its other props.
 */
const FIELD_RADIUS_KEYS = ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const
const FIELD_BORDER_STYLE_KEYS = ['borderStyle', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'] as const
// A field's colours go into its appearance characteristics (/MK) and default
// appearance (/DA), which have no alpha.
const FIELD_COLOR_KEYS = ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'] as const

/**
 * The first node seen for a field name. Radios with one name are the options
 * of one field (a radio group): they share `readOnly` and `required`, and
 * each has its own `value`.
 */
export type FieldRecord = {
  readonly type: PdfElementType
  readonly source: string | undefined
  readonly readOnly: boolean
  readonly required: boolean
  readonly values: Set<unknown>
  checked: boolean
}

const validateRadioOption = (node: PdfElementNode, group: FieldRecord): void => {
  const name = PDF_PRIMITIVE_NAMES[node.type]
  const fieldName = String(node.props.name)
  for (const key of ['readOnly', 'required'] as const) {
    if ((node.props[key] === true) !== group[key]) {
      treeInvalid(`<${name}> "${fieldName}" sets "${key}" on some options only; set it on every option of the group or on none.`)
    }
  }
  if (group.values.has(node.props.value)) {
    treeInvalid(`<${name}> "${fieldName}" has the value "${String(node.props.value)}" twice; give each option of the group its own value.`)
  }
  group.values.add(node.props.value)
  if (node.props.checked === true) {
    if (group.checked) treeInvalid(`<${name}> "${fieldName}" has more than one checked option; check one option of the group at most.`)
    group.checked = true
  }
}

export const validateField = (node: PdfElementNode, insideFixed: boolean, fieldNames: Map<string, FieldRecord>): void => {
  const name = PDF_PRIMITIVE_NAMES[node.type]
  const fieldName = node.props.name
  if (insideFixed) {
    treeInvalid(`<${name}> "${String(fieldName)}" is inside fixed content, which repeats on every page, but a field exists once; move it out of the fixed node.`)
  }
  for (const key of ['width', 'height'] as const) {
    if (resolvedStyleValue(node.style, key) === undefined) {
      treeInvalid(`<${name}> "${String(fieldName)}" needs a "${key}" in its style: a field is a box of fixed size.`)
    }
  }
  // The appearance (server/engine/form-appearance.ts) draws a square, solid frame and
  // a left, centred or right-aligned value; the style must not ask for more.
  // A radio is always drawn round.
  for (const key of node.type === PDF_PRIMITIVES.Radio ? [] : FIELD_RADIUS_KEYS) {
    const radius = resolvedStyleValue(node.style, key)
    if (radius !== undefined && Number.parseFloat(String(radius)) !== 0) {
      treeInvalid(`<${name}> "${String(fieldName)}" sets "${key}", but a field border is square; remove it.`)
    }
  }
  for (const key of FIELD_BORDER_STYLE_KEYS) {
    const borderStyle = resolvedStyleValue(node.style, key)
    if (borderStyle !== undefined && borderStyle !== 'solid') {
      treeInvalid(`<${name}> "${String(fieldName)}" sets "${key}: ${borderStyle}", but a field border is solid; remove it.`)
    }
  }
  for (const key of FIELD_COLOR_KEYS) {
    const color = resolvedStyleValue(node.style, key)
    if (typeof color === 'string' && (readPdfColor(color)?.alpha ?? 1) < 1) {
      treeInvalid(`<${name}> "${String(fieldName)}" sets "${key}: ${color}", but a field draws its colors without alpha; use an opaque color.`)
    }
  }
  if (resolvedStyleValue(node.style, 'textAlign') === 'justify') {
    treeInvalid(`<${name}> "${String(fieldName)}" sets "textAlign: justify", which a field cannot draw; use left, center or right.`)
  }
  if (typeof fieldName === 'string') {
    const first = fieldNames.get(fieldName)
    if (first !== undefined && (first.type === PDF_PRIMITIVES.Radio) !== (node.type === PDF_PRIMITIVES.Radio)) {
      treeInvalid(`<${name}> "${fieldName}" is also the name of a <${PDF_PRIMITIVE_NAMES[first.type]}>; only the radios of one group share a name.`)
    }
    if (first !== undefined && node.type !== PDF_PRIMITIVES.Radio) {
      treeInvalid(`<${name}> "${fieldName}" is the name of another form field too; give each field its own name.`)
    }
    const record = first ?? {
      type: node.type,
      source: node.source,
      readOnly: node.props.readOnly === true,
      required: node.props.required === true,
      values: new Set(),
      checked: false,
    }
    fieldNames.set(fieldName, record)
    if (node.type === PDF_PRIMITIVES.Radio) validateRadioOption(node, record)
  }
  const { value } = node.props
  if (node.type === PDF_PRIMITIVES.TextField && typeof value === 'string') {
    if (node.props.multiline !== true && /[\n\r]/.test(value)) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a line break in "value"; set "multiline" or remove the line break.`)
    }
    const { maxLength } = node.props
    if (typeof maxLength === 'number' && [...value].length > maxLength) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a "value" longer than "maxLength" (${maxLength}); shorten the value or raise "maxLength".`)
    }
  }
  if (node.type === PDF_PRIMITIVES.Select && typeof value === 'string' && node.props.editable !== true) {
    const { options } = node.props
    if (Array.isArray(options) && !options.includes(value)) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a "value" that is not one of "options"; add it to "options", or set "editable" to accept any value.`)
    }
  }
}

/**
 * Form fields in a PDF/A document draw in an embedded font (the engine checks
 * the font, server/engine/form-font.ts). An e-invoice (`PdfFacturX`) takes no
 * fields: a reader could change what the invoice shows, while its XML stays.
 * A tagged document checks its fields in `validateTaggedDocument`.
 */
export const validateFieldsConformance = (document: PdfDocumentNode, fieldNames: ReadonlyMap<string, FieldRecord>): void => {
  const [first] = fieldNames
  if (first === undefined) return
  const facturX = document.children.find(child => child.type === PDF_PRIMITIVES.FacturX)
  if (facturX !== undefined) {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}> writes an e-invoice whose printed content must match its XML, and a form field (such as "${first[0]}") lets a reader change that content. Remove the form fields, or print their values as text.`, first[1].source)
  }
}
