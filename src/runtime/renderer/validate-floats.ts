import { resolvedPosition, resolvedStyleValue } from '../authoring'
import type { PdfRichImageMark } from '../component-names'
import { PDF_PRIMITIVES } from '../primitives'
import { setsPdfColumns } from '../shared/columns'
import { treeInvalid } from '../shared/errors'
import { pdfElementLabel, type PdfElementNode, type PdfNode } from './types'

// Mount checks of floats (D49): a node with `float: 'top' | 'bottom'`. The
// page builder places a float at the top or the bottom of its column, of its
// column container's part on a page (a float with `columnSpan: 'all'`, or one
// inside a child with it), or of the page without columns. It reaches that
// place through plain views, which it splits at the float
// (paginate/floats.ts); every other ancestor, and every prop the float cannot
// honour, fails here. `columnSpan` itself is checked with the columns.

/** Why a float could not leave its place: where it stands, and the reason with its fix. */
type Blocker = { readonly at: string, readonly why: string }

/** What the ancestors of a node say about floats. */
export type FloatScope = {
  /** The first ancestor that a float inside it could not leave. */
  blocked: Blocker | undefined
}

export const ROOT_FLOAT_SCOPE: FloatScope = { blocked: undefined }

/** The float of a node, `undefined` for none. */
export const floatOf = (node: PdfElementNode): 'top' | 'bottom' | undefined => {
  const value = resolvedStyleValue(node.style, 'float')
  return value === 'top' || value === 'bottom' ? value : undefined
}

const FLOAT_TYPES: ReadonlySet<string> = new Set([PDF_PRIMITIVES.View, PDF_PRIMITIVES.Image, PDF_PRIMITIVES.Svg])

// A view the builder splits at a float as at a page break: these keys would
// give its parts other sizes or places than the view had.
const SIZE_KEYS = ['height', 'minHeight', 'maxHeight'] as const

const PLAIN = 'a float reaches the top or the bottom of its column or page only through plain views: column direction, no height, minHeight, maxHeight, flexGrow or justifyContent, not fixed or absolute, not a link, a table or wrap={false}. Move the float out, or make the views around it plain.'

/** Why a float inside `node` could not leave it, or `undefined` when `node` is a plain view or a page it can float on. */
const blockerOf = (node: PdfElementNode, label: string): Blocker | undefined => {
  const plain = (at: string): Blocker => ({ at, why: PLAIN })
  if (floatOf(node) !== undefined) return { at: `inside <${label}>, which floats itself`, why: 'a float is placed whole, so a float inside it has no column or page to go to. Remove one of the two floats.' }
  if (node.type === PDF_PRIMITIVES.Page) {
    if (node.props.wrap === false) return { at: `on <${label}> with wrap={false}`, why: 'that page does not break into pages, so it has no page top or bottom to float to. Remove float, or remove wrap={false} from the page.' }
    const justify = resolvedStyleValue(node.style, 'justifyContent')
    if (justify !== undefined && justify !== 'flex-start') return { at: `on <${label}> with justifyContent "${justify}"`, why: 'the page would move its floats away from its top and bottom. Remove float, or remove justifyContent from the page.' }
    return undefined
  }
  if (node.props.fixed === true || resolvedPosition(node.style) === 'absolute') return plain(`inside <${label}>, a fixed or absolute node`)
  if (node.type === PDF_PRIMITIVES.Link) return plain(`inside <${label}>`)
  if (node.component === 'PdfTable' || node.component === 'PdfTableRow' || node.component === 'PdfTableHeader' || node.component === 'PdfTableCell') return plain(`inside <${label}>`)
  if (node.type !== PDF_PRIMITIVES.View) return plain(`inside <${label}>`)
  if (node.props.wrap === false) return plain(`inside <${label}> with wrap={false}`)
  // A column container is a float's reference: its columns are where its floats go.
  if (setsPdfColumns(node.style)) return undefined
  const direction = resolvedStyleValue(node.style, 'flexDirection')
  if (direction !== undefined && direction !== 'column') return plain(`inside <${label}> with flexDirection "${direction}"`)
  const size = SIZE_KEYS.find(key => resolvedStyleValue(node.style, key) !== undefined)
  if (size !== undefined) return plain(`inside <${label}> with ${size}`)
  if (resolvedStyleValue(node.style, 'flexGrow') !== undefined) return plain(`inside <${label}> with flexGrow`)
  const justify = resolvedStyleValue(node.style, 'justifyContent')
  if (justify !== undefined && justify !== 'flex-start') return plain(`inside <${label}> with justifyContent "${justify}"`)
  return undefined
}

/** The float scope of a child of `node`. */
export const childFloatScope = (node: PdfElementNode, scope: FloatScope, child: PdfNode): FloatScope => {
  if (child.type === PDF_PRIMITIVES.TextInstance) return scope
  if (node.type === PDF_PRIMITIVES.Document) return ROOT_FLOAT_SCOPE
  return { blocked: scope.blocked ?? blockerOf(node, pdfElementLabel(node)) }
}

/** The rich text image a view is: a captioned figure carries the mark, an image's view holds the marked image. */
const richImageOf = (node: PdfElementNode): PdfRichImageMark | undefined =>
  node.richImage ?? node.children.map(child => child.type === PDF_PRIMITIVES.TextInstance ? undefined : child.richImage).find(mark => mark?.role === 'image')

/** Fails a float the page builder could not place, and a column container inside a float. */
export const validateFloat = (node: PdfElementNode, label: string, scope: FloatScope, insideFloat: boolean): void => {
  if (insideFloat && setsPdfColumns(node.style)) {
    treeInvalid(`<${label}> with columns cannot be inside a float: a float does not split, so its columns would never fill over pages. Remove the columns, or remove float from the node around it.`)
  }
  const float = floatOf(node)
  if (float === undefined) return
  // A rich text image floats by `styles.image`: the message names its block in the model.
  const rich = richImageOf(node)
  const start = rich === undefined ? `<${label}> cannot have float "${float}"` : `<PdfRichText> cannot float the image at ${rich.path} (float "${float}" from styles.image)`
  if (!FLOAT_TYPES.has(node.type)) {
    treeInvalid(`${start}: only a <PdfView>, <PdfImage>, <PdfSvg> or <PdfTable> floats. Put the content into a <PdfView> with float.`)
  }
  if (node.props.fixed === true || resolvedPosition(node.style) === 'absolute') {
    treeInvalid(`${start}: it is a fixed or absolute node, which is not in the flow. Remove float, or remove fixed and position.`)
  }
  for (const prop of ['break', 'keepWithNext', 'minPresenceAhead'] as const) {
    const value = node.props[prop]
    if (value !== undefined && value !== false && value !== 0) {
      treeInvalid(`${start} together with "${prop}": a float leaves the flow, so the flow's page breaks and keeps do not apply to it. Remove "${prop}", or put it on the node next to the float.`)
    }
  }
  if (setsPdfColumns(node.style)) {
    treeInvalid(`${start}: it has columns, and a float does not split, so its columns would never fill over pages. Remove the columns, or remove float.`)
  }
  if (scope.blocked !== undefined) {
    // A list item sets its content beside its marker: say so in the terms of the content.
    if (rich?.path.includes('.items[') === true) treeInvalid(`${start}: the image is in a list item, whose content stands beside the item's marker, so it cannot float out of it. Remove float from styles.image, or move the image out of the list.`)
    treeInvalid(`${start} ${scope.blocked.at}: ${scope.blocked.why}`)
  }
}
