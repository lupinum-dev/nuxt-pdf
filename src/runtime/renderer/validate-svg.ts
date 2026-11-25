// Checks of one `PdfSvg` subtree: definition ids in its `PdfDefs`, and the
// `fill` and `clipPath` references to them.
import { describePdfValue } from '../shared/describe-value'
import { PDF_PRIMITIVES, type PdfElementType } from '../primitives'
import { pdfElementLabel, type PdfElementNode } from './types'
import { treeInvalid } from '../shared/errors'
import { got, hasProp, RESERVED_DESTINATION_IDS } from './validate-shared'

const SVG_DEFINITION_ID = /^[a-z_][\w.:-]*$/i
const SVG_REFERENCE = /^url\(['"]?#([^'")]+)['"]?\)$/

const validateDefinitionId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SVG_DEFINITION_ID.test(value)) {
    return treeInvalid(`<${label}> "id" must be a safe identifier: a letter or "_", then letters, digits, "_", "-", "." or ":".${got(value)}`)
  }
  if (RESERVED_DESTINATION_IDS.has(value)) {
    treeInvalid(`<${label}> uses a reserved identifier as its id; use another id.`)
  }
  return value
}

export const validateSvgDefinitions = (svg: PdfElementNode): void => {
  const defs = svg.children.filter(
    child => 'children' in child && child.type === PDF_PRIMITIVES.Defs,
  ) as PdfElementNode[]

  if (defs.length > 1) {
    treeInvalid('<PdfSvg> accepts at most one <PdfDefs> child.')
  }

  const definitions = new Map<string, PdfElementType>()
  for (const definition of defs[0]?.children ?? []) {
    if (!('children' in definition)) continue
    const label = pdfElementLabel(definition)
    const id = validateDefinitionId(definition.props.id, label)
    if (definitions.has(id)) treeInvalid(`<${label}> has the id of another definition; definition ids must be unique within one <PdfSvg>.`)
    definitions.set(id, definition.type)
  }

  const pending: PdfElementNode[] = [svg]
  while (pending.length > 0) {
    const node = pending.pop()!

    if (hasProp(node, 'fill') && typeof node.props.fill === 'string') {
      const fill = node.props.fill
      if (fill.startsWith('url(')) {
        const match = SVG_REFERENCE.exec(fill)
        const type = match ? definitions.get(match[1]!) : undefined
        if (
          type !== PDF_PRIMITIVES.LinearGradient
          && type !== PDF_PRIMITIVES.RadialGradient
        ) {
          treeInvalid(`<${pdfElementLabel(node)}> fill ${describePdfValue(fill)} references a missing or incompatible definition.`)
        }
      }
    }

    if (hasProp(node, 'clipPath')) {
      const clipPath = node.props.clipPath
      const match = typeof clipPath === 'string'
        ? SVG_REFERENCE.exec(clipPath)
        : null
      if (!match || definitions.get(match[1]!) !== PDF_PRIMITIVES.ClipPath) {
        treeInvalid(`<${pdfElementLabel(node)}> clipPath ${describePdfValue(clipPath)} references a missing or incompatible definition.`)
      }
    }

    for (const child of node.children) {
      if ('children' in child) pending.push(child)
    }
  }
}
