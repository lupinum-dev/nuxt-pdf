// The forms profile of the invariant harness: documents of form fields alone
// (text fields, checkboxes, selects and radio groups, some across a page
// break, some in sections), tagged as PDF/UA-1 or not, rendered through the
// public render. Two rules:
//
// - F1 form-fields: one field per name with its type and value, one widget per
//   field or radio option, each widget inside its page and none over another.
// - F2 form-tagged: in a tagged document each widget has its own structure
//   parent key and one Form element that names it, the Form elements follow
//   the template order across pages, the label is the Form element's `Alt`
//   and the widget's `TU`, and each page with widgets has tab order by
//   structure; an untagged document has none of this.
//
// The `mixed` profile has fields too, never in a tagged document and never in
// a radio group; this profile covers both.
import { Buffer } from 'node:buffer'
import fc from 'fast-check'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { ROBOTO } from '../fixtures/tagged-document'

const { PdfCheckbox, PdfDocument, PdfPage, PdfRadio, PdfSelect, PdfText, PdfTextField, PdfView } = PDF_COMPONENTS

// ---------------------------------------------------------------------------
// Specs

export type FormField
  = | { kind: 'text', name: string, label?: string, value: string }
    | { kind: 'checkbox', name: string, label?: string, checked: boolean }
    | { kind: 'select', name: string, label?: string, options: string[], value: string }
    | { kind: 'radio', name: string, label?: string, value: string, checked: boolean }

/** A field or a paragraph; `breakBefore` starts a new page, `section` puts it in a view (a `Sect` when tagged). */
export type FormItem = ({ field: FormField } | { text: string }) & { breakBefore: boolean, section: boolean }

export type FormSpec = { tagged: boolean, items: FormItem[] }

/** What fast-check draws and shrinks; `normalizeForm` makes any of it a valid spec. */
export type RawFormItem = { kind: number, labeled: boolean, value: number, breakBefore: boolean, section: boolean, options: number }

export const rawFormItems = fc.array(fc.record({
  kind: fc.nat(4),
  labeled: fc.boolean(),
  value: fc.nat(1000),
  breakBefore: fc.boolean(),
  section: fc.boolean(),
  options: fc.integer({ min: 2, max: 4 }),
}), { minLength: 1, maxLength: 8 })

const WORDS = ['Ada', 'Brightwater', 'meadow', 'Reed', 'survey', 'north', 'Grüße', 'café']

export const normalizeForm = (tagged: boolean, raw: readonly RawFormItem[]): FormSpec => {
  const items: FormItem[] = []
  raw.forEach((item, index) => {
    // A tagged document needs a label on every field (validate-conformance.ts).
    const label = (text: string) => tagged || item.labeled ? { label: text } : {}
    const place = { breakBefore: item.breakBefore && item.value % 3 === 0, section: item.section }
    const name = `f${index}`
    if (item.kind === 0) items.push({ ...place, field: { kind: 'text', name, ...label(`Text ${index}`), value: `${WORDS[item.value % WORDS.length]} ${item.value}` } })
    else if (item.kind === 1) items.push({ ...place, field: { kind: 'checkbox', name, ...label(`Check ${index}`), checked: item.value % 2 === 0 } })
    else if (item.kind === 2) {
      const options = Array.from({ length: item.options }, (_, option) => `Option ${option}`)
      items.push({ ...place, field: { kind: 'select', name, ...label(`Select ${index}`), options, value: options[item.value % options.length]! } })
    }
    else if (item.kind === 3) {
      // A group of options; the second may start a new page. `checked` past the last option: none on.
      const checked = item.value % (item.options + 1)
      for (let option = 0; option < item.options; option += 1) {
        items.push({
          breakBefore: option === 1 && item.breakBefore,
          section: item.section,
          field: { kind: 'radio', name, ...label(`Choice ${index} ${option}`), value: `v${option}`, checked: option === checked },
        })
      }
    }
    else items.push({ ...place, text: `Note ${index}: ${WORDS[item.value % WORDS.length]}` })
  })
  return { tagged, items }
}

// ---------------------------------------------------------------------------
// Rendering

const FIELD_STYLES = {
  text: { width: 150, height: 18, marginTop: 4 },
  checkbox: { width: 12, height: 12, marginTop: 4 },
  select: { width: 120, height: 18, marginTop: 4 },
  radio: { width: 12, height: 12, marginTop: 4 },
} as const

const fieldNode = (field: FormField): VNode => {
  const base = { name: field.name, style: FIELD_STYLES[field.kind], ...(field.label === undefined ? {} : { label: field.label }) }
  if (field.kind === 'text') return h(PdfTextField, { ...base, value: field.value })
  if (field.kind === 'checkbox') return h(PdfCheckbox, { ...base, checked: field.checked })
  if (field.kind === 'select') return h(PdfSelect, { ...base, options: field.options, value: field.value })
  return h(PdfRadio, { ...base, value: field.value, checked: field.checked })
}

const itemNode = (item: FormItem, tagged: boolean): VNode => {
  const node = 'field' in item ? fieldNode(item.field) : h(PdfText, null, () => item.text)
  if (!item.breakBefore && !item.section) return node
  return h(PdfView, {
    ...(item.breakBefore ? { break: true } : {}),
    ...(item.section ? { style: { padding: 4 }, ...(tagged ? { tag: 'section' } : {}) } : {}),
  }, () => [node])
}

export const renderForm = async (spec: FormSpec): Promise<Uint8Array> => {
  const component = defineComponent(() => () => h(PdfDocument, {
    creationDate: new Date(Date.UTC(2026, 0, 2)),
    ...(spec.tagged ? { conformance: 'PDF/UA-1', title: 'Form document', language: 'en' } : {}),
  }, () => h(PdfPage, { size: [298, 420], style: { padding: 24, fontFamily: 'Roboto', fontSize: 10 } }, () =>
    spec.items.map(item => itemNode(item, spec.tagged)))))
  return (await renderPreparedPdfTemplate(component, {}, { fonts: [ROBOTO] })).bytes
}

// ---------------------------------------------------------------------------
// Reading

/** A widget as pdf.js reads it; `key` is the field name, with `=value` for a radio option. */
export type ReadWidget = {
  page: number
  key: string
  name: string
  fieldType: unknown
  value: unknown
  label: unknown
  structParent: unknown
  rect: [number, number, number, number]
}

export type ReadForm = {
  pages: { width: number, height: number, tabsByStructure: boolean }[]
  widgets: ReadWidget[]
  /** The Form elements of all pages in structure order: their `Alt` and the widget keys they name. */
  forms: { alt: unknown, keys: string[] }[]
  /**
   * `V` of each button field (checkbox, radio group), the value a reader
   * exports, read from the file: pdf.js reports a checkbox by its appearance
   * state (`AS`) and keeps a wrong `V` hidden.
   */
  buttonValues: Map<string, string>
}

type StructNode = { role?: unknown, alt?: unknown, type?: unknown, id?: unknown, children?: unknown }

const isStructNode = (value: unknown): value is StructNode => typeof value === 'object' && value !== null

export const readForm = async (bytes: Uint8Array): Promise<ReadForm> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const document = await task.promise
  // The output is not compressed: each dictionary is plain text, one key per line.
  const text = Buffer.from(bytes).toString('latin1')
  const pageDictionaries = text.match(/\/Type \/Page\n[\s\S]*?>>\nendobj/g) ?? []
  const buttonValues = new Map<string, string>()
  for (const [object] of text.matchAll(/\n\d+ 0 obj\n<<[\s\S]*?>>\nendobj/g)) {
    const name = /\n\/T \((\w+)\)\n/.exec(object)?.[1]
    const value = /\n\/V \/(\w+)\n/.exec(object)?.[1]
    if (object.includes('\n/FT /Btn\n') && name !== undefined && value !== undefined) buttonValues.set(name, value)
  }
  const read: ReadForm = { pages: [], widgets: [], forms: [], buttonValues }
  try {
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view
      read.pages.push({ width: x2 - x1, height: y2 - y1, tabsByStructure: /\/Tabs \/S\n/.test(pageDictionaries[number - 1] ?? '') })
      const keys = new Map<string, string>()
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype !== 'Widget') continue
        const name = String(annotation.fieldName)
        const key = typeof annotation.buttonValue === 'string' && annotation.radioButton === true ? `${name}=${annotation.buttonValue}` : name
        keys.set(`pdfjs_internal_id_${String(annotation.id)}`, key)
        const [r1 = 0, r2 = 0, r3 = 0, r4 = 0] = Array.isArray(annotation.rect) ? annotation.rect.map(Number) : []
        read.widgets.push({
          page: number,
          key,
          name,
          fieldType: annotation.fieldType,
          value: Array.isArray(annotation.fieldValue) ? annotation.fieldValue[0] : annotation.fieldValue,
          label: annotation.alternativeText,
          structParent: annotation.structParent,
          rect: [Math.min(r1, r3), Math.min(r2, r4), Math.max(r1, r3), Math.max(r2, r4)],
        })
      }
      const walk = (node: unknown) => {
        if (!isStructNode(node)) return
        const children = Array.isArray(node.children) ? node.children : []
        if (node.role === 'Form') {
          read.forms.push({
            alt: node.alt,
            keys: children.flatMap(child => isStructNode(child) && child.type === 'annotation' ? [keys.get(String(child.id)) ?? `unknown ${String(child.id)}`] : []),
          })
          return
        }
        children.forEach(walk)
      }
      walk(await page.getStructTree())
      page.cleanup()
    }
    return read
  }
  finally {
    await task.destroy()
  }
}

// ---------------------------------------------------------------------------
// Rules

const fieldsOf = (spec: FormSpec): FormField[] => spec.items.flatMap(item => 'field' in item ? [item.field] : [])

const keyOf = (field: FormField): string => field.kind === 'radio' ? `${field.name}=${field.value}` : field.name

const FIELD_TYPES = { text: 'Tx', checkbox: 'Btn', select: 'Ch', radio: 'Btn' } as const

/** The value pdf.js reads for a field: a radio group has the value of its option that is on. */
const expectedValue = (field: FormField, fields: readonly FormField[]): string => {
  if (field.kind === 'text' || field.kind === 'select') return field.value
  if (field.kind === 'checkbox') return field.checked ? 'Yes' : 'Off'
  const on = fields.find((other): other is Extract<FormField, { kind: 'radio' }> => other.kind === 'radio' && other.name === field.name && other.checked)
  return on?.value ?? 'Off'
}

const overlap = (a: ReadWidget, b: ReadWidget): boolean =>
  a.page === b.page && Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0]) > 0.01 && Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]) > 0.01

/** F1 form-fields. */
export const checkFormFields = (spec: FormSpec, read: ReadForm): string[] => {
  const messages: string[] = []
  const fields = fieldsOf(spec)
  const expected = new Set(fields.map(keyOf))
  for (const widget of read.widgets) if (!expected.has(widget.key)) messages.push(`F1: widget ${widget.key} on p${widget.page} belongs to no field of the template`)
  for (const field of fields) {
    const own = read.widgets.filter(widget => widget.key === keyOf(field))
    if (own.length !== 1) {
      messages.push(`F1: ${keyOf(field)} has ${own.length} widgets, expected 1`)
      continue
    }
    const widget = own[0]!
    if (widget.fieldType !== FIELD_TYPES[field.kind]) messages.push(`F1: ${keyOf(field)} is ${String(widget.fieldType)}, expected ${FIELD_TYPES[field.kind]}`)
    const value = expectedValue(field, fields)
    if (widget.value !== value) messages.push(`F1: ${keyOf(field)} has the value ${JSON.stringify(widget.value)}, expected ${JSON.stringify(value)}`)
    const exported = read.buttonValues.get(field.name)
    if ((field.kind === 'checkbox' || field.kind === 'radio') && exported !== value) messages.push(`F1: field ${field.name} exports V ${JSON.stringify(exported)}, expected ${JSON.stringify(value)}`)
    const page = read.pages[widget.page - 1]!
    const [x1, y1, x2, y2] = widget.rect
    if (x1 < 0 || y1 < 0 || x2 > page.width || y2 > page.height) messages.push(`F1: ${keyOf(field)} at [${widget.rect.join(', ')}] is outside page ${widget.page}`)
  }
  read.widgets.forEach((widget, index) => {
    for (const other of read.widgets.slice(index + 1)) {
      if (overlap(widget, other)) messages.push(`F1: ${widget.key} and ${other.key} overlap on p${widget.page}`)
    }
  })
  return messages
}

/** F2 form-tagged. */
export const checkFormTagged = (spec: FormSpec, read: ReadForm): string[] => {
  const messages: string[] = []
  const keyed = (widget: ReadWidget) => typeof widget.structParent === 'number' && widget.structParent >= 0
  if (!spec.tagged) {
    if (read.forms.length > 0) messages.push(`F2: an untagged document has ${read.forms.length} Form elements`)
    for (const widget of read.widgets) if (keyed(widget)) messages.push(`F2: ${widget.key} has a structure parent key in an untagged document`)
    return messages
  }
  const fields = fieldsOf(spec)
  const order = fields.map(keyOf)
  const formKeys = read.forms.map(form => form.keys.length === 1 ? form.keys[0]! : `[${form.keys.join(', ')}]`)
  if (JSON.stringify(formKeys) !== JSON.stringify(order)) messages.push(`F2: the Form elements name ${JSON.stringify(formKeys)}, expected ${JSON.stringify(order)} in template order`)
  const labels = new Map(fields.map(field => [keyOf(field), field.label]))
  for (const form of read.forms) {
    const key = form.keys[0]
    if (form.keys.length === 1 && key !== undefined && form.alt !== labels.get(key)) messages.push(`F2: the Form element of ${key} has Alt ${JSON.stringify(form.alt)}, expected ${JSON.stringify(labels.get(key))}`)
  }
  const parents = new Set<unknown>()
  for (const widget of read.widgets) {
    if (widget.label !== labels.get(widget.key)) messages.push(`F2: ${widget.key} has TU ${JSON.stringify(widget.label)}, expected ${JSON.stringify(labels.get(widget.key))}`)
    if (!keyed(widget)) messages.push(`F2: ${widget.key} has no structure parent key`)
    else if (parents.has(widget.structParent)) messages.push(`F2: ${widget.key} shares the structure parent key ${String(widget.structParent)}`)
    parents.add(widget.structParent)
  }
  for (const page of new Set(read.widgets.map(widget => widget.page))) {
    if (!read.pages[page - 1]!.tabsByStructure) messages.push(`F2: page ${page} has widgets but no tab order by structure (/Tabs /S)`)
  }
  return messages
}
