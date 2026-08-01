import type { RendererOptions } from 'vue'
import {
  PDF_PRIMITIVES,
  type PdfDynamicPageProps,
  type PdfDynamicTextRender,
  type PdfStyleValue,
} from '../authoring'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type {
  PdfBaseProps,
  PdfCircleProps,
  PdfClipPathProps,
  PdfDefsProps,
  PdfDocumentProps,
  PdfEllipseProps,
  PdfGProps,
  PdfImageProps,
  PdfLinearGradientProps,
  PdfLineProps,
  PdfLinkProps,
  PdfNoteProps,
  PdfPageProps,
  PdfPathProps,
  PdfPolygonProps,
  PdfPolylineProps,
  PdfRadialGradientProps,
  PdfRectProps,
  PdfStopProps,
  PdfSvgPresentationProps,
  PdfSvgProps,
  PdfTextProps,
  PdfTspanProps,
  PdfViewProps,
} from '../components/_props'
import {
  PDF_PRIMITIVE_NAMES,
  type PdfElementType,
  type PdfHostElement,
  type PdfHostNode,
} from './types'

type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never
type StringKeys<Value> = Extract<KeysOfUnion<Value>, string>

const exactPropNames = <Props>() =>
  <const Names extends readonly StringKeys<Props>[]>(
    names: Names & (
      Exclude<StringKeys<Props>, Names[number]> extends never
        ? unknown
        : { readonly __missingProps: Exclude<StringKeys<Props>, Names[number]> }
    ),
  ): ReadonlySet<StringKeys<Props>> => new Set(names)

const BASE_PROP_NAMES = [
  'break',
  'debug',
  'fixed',
  'id',
  'minPresenceAhead',
  'style',
] as const satisfies readonly StringKeys<PdfBaseProps>[]
const BOOKMARK_PROP_NAMES = ['bookmark'] as const
const SVG_PRESENTATION_PROP_NAMES = [
  'clipPath',
  'fill',
  'fillOpacity',
  'stroke',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeOpacity',
  'strokeWidth',
  'transform',
] as const satisfies readonly StringKeys<PdfSvgPresentationProps>[]

/** Closed runtime prop surface; TypeScript alone cannot reject Vue attrs. */
const PDF_PROP_KEYS: Record<PdfElementType, ReadonlySet<string>> = {
  [PDF_PRIMITIVES.Document]: exactPropNames<PdfDocumentProps>()([
    'author',
    'creationDate',
    'creator',
    'keywords',
    'language',
    'pageLayout',
    'pdfVersion',
    'producer',
    'subject',
    'title',
  ]),
  [PDF_PRIMITIVES.Page]: exactPropNames<PdfPageProps>()([
    ...BASE_PROP_NAMES,
    ...BOOKMARK_PROP_NAMES,
    'dpi',
    'orientation',
    'size',
    'wrap',
  ]),
  [PDF_PRIMITIVES.View]: exactPropNames<PdfViewProps>()([
    ...BASE_PROP_NAMES,
    ...BOOKMARK_PROP_NAMES,
    'wrap',
  ]),
  [PDF_PRIMITIVES.Text]: exactPropNames<PdfTextProps>()([
    ...BASE_PROP_NAMES,
    ...BOOKMARK_PROP_NAMES,
    'fill',
    'hyphenationCallback',
    'orphans',
    'render',
    'widows',
    'wrap',
    'x',
    'y',
  ]),
  [PDF_PRIMITIVES.Image]: exactPropNames<PdfImageProps>()([
    ...BASE_PROP_NAMES,
    ...BOOKMARK_PROP_NAMES,
    'source',
    'src',
  ]),
  [PDF_PRIMITIVES.Link]: exactPropNames<PdfLinkProps>()([
    ...BASE_PROP_NAMES,
    'hitSlop',
    'href',
    'src',
    'wrap',
  ]),
  [PDF_PRIMITIVES.Note]: exactPropNames<PdfNoteProps>()(BASE_PROP_NAMES),
  [PDF_PRIMITIVES.Tspan]: exactPropNames<PdfTspanProps>()(['fill', 'x', 'y']),
  [PDF_PRIMITIVES.Svg]: exactPropNames<PdfSvgProps>()([
    'height',
    'style',
    'viewBox',
    'width',
  ]),
  [PDF_PRIMITIVES.G]: exactPropNames<PdfGProps>()(SVG_PRESENTATION_PROP_NAMES),
  [PDF_PRIMITIVES.Path]: exactPropNames<PdfPathProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'd',
  ]),
  [PDF_PRIMITIVES.Rect]: exactPropNames<PdfRectProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'height',
    'rx',
    'ry',
    'width',
    'x',
    'y',
  ]),
  [PDF_PRIMITIVES.Circle]: exactPropNames<PdfCircleProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'cx',
    'cy',
    'r',
  ]),
  [PDF_PRIMITIVES.Ellipse]: exactPropNames<PdfEllipseProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'cx',
    'cy',
    'rx',
    'ry',
  ]),
  [PDF_PRIMITIVES.Line]: exactPropNames<PdfLineProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'x1',
    'x2',
    'y1',
    'y2',
  ]),
  [PDF_PRIMITIVES.Polyline]: exactPropNames<PdfPolylineProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'points',
  ]),
  [PDF_PRIMITIVES.Polygon]: exactPropNames<PdfPolygonProps>()([
    ...SVG_PRESENTATION_PROP_NAMES,
    'points',
  ]),
  [PDF_PRIMITIVES.Defs]: exactPropNames<PdfDefsProps>()([]),
  [PDF_PRIMITIVES.ClipPath]: exactPropNames<PdfClipPathProps>()(['id']),
  [PDF_PRIMITIVES.LinearGradient]: exactPropNames<PdfLinearGradientProps>()([
    'id',
    'x1',
    'x2',
    'y1',
    'y2',
  ]),
  [PDF_PRIMITIVES.RadialGradient]: exactPropNames<PdfRadialGradientProps>()([
    'cx',
    'cy',
    'fx',
    'fy',
    'id',
    'r',
  ]),
  [PDF_PRIMITIVES.Stop]: exactPropNames<PdfStopProps>()([
    'offset',
    'stopColor',
    'stopOpacity',
  ]),
}

const BOOLEAN_PROPS = new Set(['break', 'debug', 'fixed', 'wrap'])
const EVENT_PROP = /^on[A-Z]/
const DOM_ONLY_PROP = /^(?:aria-|data-)/
const DOM_ONLY_PROPS = new Set([
  'class',
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
    return treeInvalid(`Cannot set the "${key}" prop on the PDF root.`)
  }

  if (EVENT_PROP.test(key)) {
    treeInvalid(
      `Vue event prop "${key}" is not supported on PDF primitives.`,
    )
  }

  if (DOM_ONLY_PROP.test(key) || DOM_ONLY_PROPS.has(key)) {
    treeInvalid(
      `DOM-only attribute "${key}" is not supported on <${PDF_PRIMITIVE_NAMES[element.type]}>. Use PDF props and styles instead.`,
    )
  }

  if (!PDF_PROP_KEYS[element.type].has(key)) {
    treeInvalid(
      `Unsupported prop "${key}" on <${PDF_PRIMITIVE_NAMES[element.type]}>.`,
    )
  }

  if (key === 'style') {
    element.style = (nextValue || {}) as PdfStyleValue
    return
  }

  if (nextValue == null) {
    Reflect.deleteProperty(element.props, key)
    return
  }

  if (key === 'render') {
    if (element.type !== PDF_PRIMITIVES.Text) {
      treeInvalid('Dynamic render callbacks are only supported by PdfText.')
    }

    if (typeof nextValue !== 'function') {
      treeInvalid('The PdfText render prop must be a function.')
    }

    element.props.render = wrapDynamicText(nextValue as PdfDynamicTextRender)
    return
  }

  element.props[key] = BOOLEAN_PROPS.has(key) && nextValue === ''
    ? true
    : nextValue
}
