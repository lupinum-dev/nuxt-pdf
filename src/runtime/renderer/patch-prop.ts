import { toRaw, type RendererOptions } from 'vue'
import type { PdfStyleValue } from '../authoring'
import { isPdfLibraryComponentName, PDF_COMPONENT_PROP, PDF_RICH_IMAGE_PROP, PDF_RICH_TEXT_WARNINGS_PROP, pdfRichImageMark } from '../component-names'
import { isRichTextWarningEntries } from '../rich-text/warnings'
import { PDF_ELEMENTS, PDF_PRIMITIVES } from '../primitives'
import { treeInvalid } from '../shared/errors'
import { unsupportedPdfPropMessage } from '../shared/removed-props'
import { PDF_SOURCE_PROP } from '../shared/template'
import {
  pdfElementName,
  type PdfElementNode,
  type PdfHostElement,
  type PdfHostNode,
} from './types'

const EVENT_PROP = /^on[A-Z]/
const DOM_ONLY_PROP = /^(?:aria-|data-)/
const DOM_ONLY_PROPS = new Set([
  'className',
  'contenteditable',
  'contentEditable',
  'draggable',
  'hidden',
  'innerHTML',
  'role',
  'slot',
  'spellcheck',
  'tabindex',
  'tabIndex',
  'textContent',
  'translate',
])

/**
 * Copy an authored prop value into plain data: Vue proxies are unwrapped at
 * every depth and objects and arrays are copied, so the mounted tree can be
 * posted to a worker and later reactive writes cannot reach it. Byte buffers
 * and dates are kept as they are; both are cloneable. Anything else that a
 * structured clone rejects fails here, with the primitive and prop named.
 */
const notPlain = (element: PdfElementNode, key: string, reason: string): never => treeInvalid(
  `The "${key}" prop on <${pdfElementName(element)}> must be plain data: ${reason}.`,
)

const toPlainData = (
  element: PdfElementNode,
  key: string,
  value: unknown,
  // Created at the first object: most prop values are strings and numbers.
  seen?: Set<object>,
): unknown => {
  if (typeof value === 'function') return notPlain(element, key, 'it contains a function')
  if (typeof value === 'symbol') return notPlain(element, key, 'it contains a symbol')
  if (value === null || typeof value !== 'object') return value

  const raw: object = toRaw(value)
  if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer || raw instanceof Date) {
    return raw
  }
  const ancestors = seen ?? new Set<object>()
  if (ancestors.has(raw)) return notPlain(element, key, 'it contains a circular reference')

  ancestors.add(raw)
  let copy: unknown
  if (Array.isArray(raw)) {
    copy = raw.map(item => toPlainData(element, key, item, ancestors))
  }
  else {
    const prototype: unknown = Object.getPrototypeOf(raw)
    if (prototype !== Object.prototype && prototype !== null) {
      notPlain(element, key, 'it contains a class instance')
    }
    const record: Record<string, unknown> = {}
    for (const [entryKey, entry] of Object.entries(raw)) {
      record[entryKey] = toPlainData(element, key, entry, ancestors)
    }
    copy = record
  }
  ancestors.delete(raw)
  return copy
}

export const patchPdfProp: RendererOptions<
  PdfHostNode,
  PdfHostElement
>['patchProp'] = (element, key, _previousValue, nextValue) => {
  if (element.type === 'ROOT') {
    return treeInvalid(`Cannot set the "${key}" prop on the PDF root.`)
  }

  if (key === PDF_SOURCE_PROP) {
    if (typeof nextValue === 'string') element.source = nextValue
    else Reflect.deleteProperty(element, 'source')
    return
  }

  if (key === PDF_COMPONENT_PROP) {
    if (isPdfLibraryComponentName(nextValue)) element.component = nextValue
    else Reflect.deleteProperty(element, 'component')
    return
  }

  if (key === PDF_RICH_TEXT_WARNINGS_PROP) {
    if (isRichTextWarningEntries(nextValue)) element.richTextWarnings = nextValue
    else Reflect.deleteProperty(element, 'richTextWarnings')
    return
  }

  if (key === PDF_RICH_IMAGE_PROP) {
    const mark = pdfRichImageMark(nextValue)
    if (mark !== undefined) element.richImage = mark
    else Reflect.deleteProperty(element, 'richImage')
    return
  }

  if (EVENT_PROP.test(key)) {
    treeInvalid(
      `Vue event prop "${key}" is not supported on <${pdfElementName(element)}>: a PDF has no events.`,
    )
  }

  if (key === 'class') {
    treeInvalid(
      `Unsupported "class" on <${pdfElementName(element)}>. Classes come from the <style> block of a PDF component and only work through class or :class in its template; pass a style object otherwise.`,
    )
  }

  if (DOM_ONLY_PROP.test(key) || DOM_ONLY_PROPS.has(key)) {
    treeInvalid(
      `DOM-only attribute "${key}" is not supported on <${pdfElementName(element)}>. Use PDF props and styles instead.`,
    )
  }

  if (element.type === PDF_PRIMITIVES.Footnote && key === 'style') {
    treeInvalid(`<${pdfElementName(element)}> takes no style or class: it stands for the mark and the note at once. Style the note with "footnoteStyles.note" on <PdfDocument>, and the mark with "footnoteStyles.mark".`)
  }

  if (element.type === PDF_PRIMITIVES.Contents && key === 'style') {
    treeInvalid(`<${pdfElementName(element)}> takes no style or class: it is replaced by its entries. Style the entries with "styles", such as "styles.entry", or put the contents in a <PdfView> with the style.`)
  }

  // Closed runtime prop surface; TypeScript alone cannot reject Vue attrs.
  const rule = Object.hasOwn(PDF_ELEMENTS[element.type].props, key)
    ? PDF_ELEMENTS[element.type].props[key]
    : undefined
  if (!rule) {
    return treeInvalid(
      unsupportedPdfPropMessage(key, pdfElementName(element)),
    )
  }

  if (key === 'style') {
    element.style = toPlainData(element, key, nextValue || {}) as PdfStyleValue
    return
  }

  if (nextValue == null) {
    Reflect.deleteProperty(element.props, key)
    return
  }

  element.props[key] = (rule.check === 'boolean' || rule.check === 'break') && nextValue === ''
    ? true
    : toPlainData(element, key, nextValue)
}
