import type { RendererOptions } from 'vue'
import {
  PDF_PRIMITIVES,
  type PdfDynamicPageProps,
  type PdfDynamicTextRender,
  type PdfHostElement,
  type PdfHostNode,
  type PdfStyleValue,
} from './types'

const BOOLEAN_PROPS = new Set(['break', 'debug', 'fixed', 'wrap'])
const EVENT_PROP = /^on[A-Z]/

const wrapDynamicText = (render: PdfDynamicTextRender) =>
  (props: PdfDynamicPageProps): string | null => {
    const result = render(props)

    if (result == null) return null

    if (typeof result !== 'string' && typeof result !== 'number') {
      throw new TypeError(
        'PdfText render callbacks must return a string, number, null, or undefined. Vue VNodes are not supported.',
      )
    }

    return String(result)
  }

export const patchPdfProp: RendererOptions<
  PdfHostNode,
  PdfHostElement
>['patchProp'] = (element, key, _previousValue, nextValue) => {
  if (element.type === 'ROOT') {
    throw new TypeError(`Cannot set the "${key}" prop on the PDF root.`)
  }

  if (key === 'style') {
    element.style = (nextValue || {}) as PdfStyleValue
    return
  }

  if (EVENT_PROP.test(key)) {
    throw new TypeError(
      `Vue event prop "${key}" is not supported on PDF primitives.`,
    )
  }

  if (nextValue == null) {
    Reflect.deleteProperty(element.props, key)
    return
  }

  if (key === 'render') {
    if (element.type !== PDF_PRIMITIVES.Text) {
      throw new TypeError('Dynamic render callbacks are only supported by PdfText.')
    }

    if (typeof nextValue !== 'function') {
      throw new TypeError('The PdfText render prop must be a function.')
    }

    element.props.render = wrapDynamicText(nextValue as PdfDynamicTextRender)
    return
  }

  element.props[key] = BOOLEAN_PROPS.has(key) && nextValue === ''
    ? true
    : nextValue
}
