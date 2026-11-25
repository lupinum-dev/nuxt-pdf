// Vue's template tree: its node types, a walker, readers for attributes and bindings, and tag names.

import type { SFCTemplateBlock } from '@vue/compiler-sfc'
import { camelize, capitalize } from 'vue'
import { PDF_COMPONENT_NAMES } from '../../runtime/component-names'

// Vue's template tree, typed by compiler-core through compiler-sfc, so the
// build needs no dependency of its own. compiler-sfc does not export the
// `NodeTypes` and `ElementTypes` enums: the constants below hold Vue's values,
// each typed by the node it names, so a comparison narrows the node.

export type TemplateRoot = NonNullable<SFCTemplateBlock['ast']>
type TemplateChild = TemplateRoot['children'][number]
export type TemplateElement = Extract<TemplateChild, { tagType: unknown }>
type TemplateProp = TemplateElement['props'][number]
type TemplateAttribute = Extract<TemplateProp, { nameLoc: unknown }>
type TemplateDirective = Extract<TemplateProp, { modifiers: unknown }>
type TemplateExpression = NonNullable<TemplateDirective['exp']>

const ELEMENT_NODE: TemplateElement['type'] = 1
export const TEXT_NODE: NonNullable<TemplateAttribute['value']>['type'] = 2
const SIMPLE_EXPRESSION: Extract<TemplateExpression, { isStatic: boolean }>['type'] = 4
export const ATTRIBUTE_NODE: TemplateAttribute['type'] = 6
export const DIRECTIVE_NODE: TemplateDirective['type'] = 7
export const COMPONENT_TAG: TemplateElement['tagType'] = 1

/**
 * Visits every element under `parent`, parents first. `visit` returns the
 * context the element's children get. A parsed template holds elements,
 * text, comments and interpolations; only elements have children.
 */
export function walkElements<Context>(
  parent: TemplateRoot | TemplateElement,
  context: Context,
  visit: (element: TemplateElement, context: Context) => Context,
): void {
  for (const child of parent.children) {
    if (child.type === ELEMENT_NODE) walkElements(child, visit(child, context), visit)
  }
}

/** An expression as written. The parser creates only simple expressions. */
export const expressionText = (expression: TemplateExpression | undefined): string | undefined =>
  expression?.type === SIMPLE_EXPRESSION ? expression.content : undefined

/** The argument of a static `v-bind`: `class` for `:class` and `v-bind:class`. */
export const boundName = (prop: TemplateProp): string | undefined =>
  prop.type === DIRECTIVE_NODE && prop.name === 'bind' && prop.arg?.type === SIMPLE_EXPRESSION && prop.arg.isStatic
    ? prop.arg.content
    : undefined

/** The attribute `name` of an element (`class="a"`). */
export const attributeOf = (element: TemplateElement, name: string): TemplateAttribute | undefined => {
  for (const prop of element.props) {
    if (prop.type === ATTRIBUTE_NODE && prop.name === name) return prop
  }
  return undefined
}

/** The static `v-bind` of `name` on an element (`:class`). */
export const bindingOf = (element: TemplateElement, name: string): TemplateDirective | undefined => {
  for (const prop of element.props) {
    if (prop.type === DIRECTIVE_NODE && boundName(prop) === name) return prop
  }
  return undefined
}

// Vue resolves a component tag as written, camelized, then capitalized, with
// its own `camelize` and `capitalize`.

/** The component name of a tag: `pdf-text`, `pdfText` and `PdfText` are `PdfText`. */
export const pascalTag = (tag: string): string => capitalize(camelize(tag))

export const PDF_COMPONENT_TAGS: ReadonlySet<string> = new Set(PDF_COMPONENT_NAMES)
