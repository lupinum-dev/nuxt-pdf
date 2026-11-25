import { h, type FunctionalComponent } from 'vue'
import {
  PDF_PRIMITIVE_COMPONENT_NAMES,
  PDF_PRIMITIVE_TABLE,
  type PdfPrimitiveName,
  type PdfPrimitiveProps,
} from '../primitives'
import { camelCase } from '../shared/case'
import { PDF_SOURCE_PROP } from '../shared/template'
import { PDF_COMPONENT_PROP } from '../component-names'
import { createRichTextComponents } from './rich-text'
import { createTableComponents } from './table'

export type PdfPrimitiveComponents = {
  readonly [Name in PdfPrimitiveName]: FunctionalComponent<PdfPrimitiveProps<Name>>
}

// data-*/aria-* stay kebab so patchPdfProp keeps rejecting them as DOM-only.
const normalizePropName = (key: string): string =>
  key.startsWith('data-') || key.startsWith('aria-')
    ? key
    : camelCase(key)

/**
 * Compact props for PDF and SVG primitives, coercing kebab-case attribute
 * names (`stroke-width`, `stop-color`, `min-presence-ahead`) to the exact
 * camelCase keys the engine reads. Without this, static kebab attributes from
 * Vue templates would silently no-op. Pure input coercion, not a second
 * source of truth. `data-`/`aria-` names stay kebab so `patchPdfProp` keeps
 * rejecting them as DOM-only.
 */
const compactProps = (props: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  // The source position and the authored component name are patched first,
  // so an error about any other prop of this element can name them.
  if (PDF_SOURCE_PROP in props) result[PDF_SOURCE_PROP] = undefined
  if (PDF_COMPONENT_PROP in props) result[PDF_COMPONENT_PROP] = undefined

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue

    result[normalizePropName(key)] = value
  }

  return result
}

const createPrimitiveComponent = <Name extends PdfPrimitiveName>(
  name: Name,
): FunctionalComponent<PdfPrimitiveProps<Name>> => {
  const { tag } = PDF_PRIMITIVE_TABLE[name]
  // Every primitive passes its slot content on, also one that holds none
  // (PdfImage, the SVG shapes, page tokens): the nesting rules then reject the
  // content instead of dropping it silently.
  const component: FunctionalComponent<PdfPrimitiveProps<Name>> = (props, { slots }) => h(
    tag,
    compactProps(props),
    slots.default?.(),
  )
  component.displayName = name
  component.inheritAttrs = false
  return component
}

// Object.fromEntries loses the key types; each entry is built from its own row.
const PDF_PRIMITIVE_COMPONENTS = Object.fromEntries(
  PDF_PRIMITIVE_COMPONENT_NAMES.map(name => [name, createPrimitiveComponent(name)]),
) as PdfPrimitiveComponents

const PDF_TABLE_COMPONENTS = createTableComponents(PDF_PRIMITIVE_COMPONENTS)

/** The `Pdf*` authoring components, registered in every PDF render app. */
export const PDF_COMPONENTS = {
  ...PDF_PRIMITIVE_COMPONENTS,
  ...PDF_TABLE_COMPONENTS,
  ...createRichTextComponents(PDF_PRIMITIVE_COMPONENTS, PDF_TABLE_COMPONENTS),
}
