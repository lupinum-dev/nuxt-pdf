import { toRaw, type RendererOptions } from 'vue'
import type { PdfStyleValue } from '../authoring'
import { isPdfTableComponentName, PDF_COMPONENT_PROP } from '../component-names'
import { PDF_ELEMENTS } from '../primitives'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
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

const treeInvalid = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message)
}

/**
 * Copy an authored prop value into plain data: Vue proxies are unwrapped at
 * every depth and objects and arrays are copied, so the mounted tree can be
 * posted to a worker and later reactive writes cannot reach it. Byte buffers
 * and dates are kept as they are; both are cloneable. Anything else that a
 * structured clone rejects fails here, with the primitive and prop named.
 */
const toPlainData = (
  element: PdfElementNode,
  key: string,
  value: unknown,
  ancestors: Set<object> = new Set(),
): unknown => {
  const notPlain = (reason: string): never => treeInvalid(
    `The "${key}" prop on <${pdfElementName(element)}> must be plain data: ${reason}.`,
  )

  if (typeof value === 'function') return notPlain('it contains a function')
  if (typeof value === 'symbol') return notPlain('it contains a symbol')
  if (value === null || typeof value !== 'object') return value

  const raw: object = toRaw(value)
  if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer || raw instanceof Date) {
    return raw
  }
  if (ancestors.has(raw)) return notPlain('it contains a circular reference')

  ancestors.add(raw)
  let copy: unknown
  if (Array.isArray(raw)) {
    copy = raw.map(item => toPlainData(element, key, item, ancestors))
  }
  else {
    const prototype: unknown = Object.getPrototypeOf(raw)
    if (prototype !== Object.prototype && prototype !== null) {
      notPlain('it contains a class instance')
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
    if (isPdfTableComponentName(nextValue)) element.component = nextValue
    else Reflect.deleteProperty(element, 'component')
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

  element.props[key] = rule.check === 'boolean' && nextValue === ''
    ? true
    : toPlainData(element, key, nextValue)
}
