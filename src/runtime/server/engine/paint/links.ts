import { PDF_PRIMITIVES } from '../../../primitives'
import type { PdfWriter } from '../pdf/writer'
import type { MeasuredNode } from '../layout/types'
import type { PaintScope } from './node'

// Link boxes, named destinations, notes and the outline, ported from
// `@react-pdf/render` 4.5.1.

/** `#name` links to a destination in the document; anything else is a URI. */
const DESTINATION = /^#.+/

/**
 * A link's `hitSlop` on each side: the clickable box grows by it, and the
 * debug overlay shows it. The prop passes through the layout unchecked by
 * type (`NodeProps`); admission allowed a number or an object of numbers.
 */
export const hitSlopOf = (value: unknown): { top: number, bottom: number, left: number, right: number } => {
  if (typeof value === 'number') return { top: value, bottom: value, left: value, right: value }
  if (typeof value !== 'object' || value === null) return { top: 0, bottom: 0, left: 0, right: 0 }
  const length = (side: unknown): number => typeof side === 'number' ? side : 0
  return {
    top: length('top' in value ? value.top : 0),
    bottom: length('bottom' in value ? value.bottom : 0),
    left: length('left' in value ? value.left : 0),
    right: length('right' in value ? value.right : 0),
  }
}

/** A `PdfLink` node: a link annotation over its box. */
export const renderLink = (writer: PdfWriter, node: MeasuredNode, scope: PaintScope): void => {
  const { props } = node
  const target = typeof props.src === 'string' ? props.src : typeof props.href === 'string' ? props.href : undefined
  if (!target) return
  const { top, left, width, height } = node.box
  const slop = hitSlopOf(props.hitSlop)
  const x = left - slop.left
  const y = top - slop.top
  const w = width + slop.left + slop.right
  const h = height + slop.top + slop.bottom
  const element = scope.tags?.element(node)
  if (DESTINATION.test(target)) writer.linkToDestination(x, y, w, h, target.slice(1), element)
  else writer.linkToUri(x, y, w, h, target, element)
}

/** A run of text with a link: `#name` or a URI. */
export const isDestination = (target: string): boolean => DESTINATION.test(target)

/**
 * The places a node marks at its box: a destination for a string `id`, and
 * an outline entry for a `bookmark`, which the outline puts under the entry
 * whose `ref` is its `parent` when it ends (a float can paint before its
 * section). Runs in the node's paint, where the current matrix places its
 * box on the page. A text's inline children have no box of their own on the
 * page, so their entries point at the text.
 */
export const markPlaces = (writer: PdfWriter, node: MeasuredNode, pageNumber: number): void => {
  const { left, top } = node.box
  if (typeof node.props.id === 'string') writer.destination(node.props.id, left, top)
  const addEntry = ({ props }: MeasuredNode): void => {
    // `resolveBookmarks` made every bookmark an object with a number; a split node's later parts have null.
    const { bookmark } = props
    if (typeof bookmark !== 'object' || bookmark === null || bookmark.ref === undefined) return
    writer.outline({ ref: bookmark.ref, parent: bookmark.parent, title: bookmark.title, pageNumber, expanded: bookmark.expanded, top, left, fit: bookmark.fit })
  }
  const visitInline = (inline: MeasuredNode): void => {
    addEntry(inline)
    for (const child of inline.children) {
      if (child.type !== PDF_PRIMITIVES.TextInstance) visitInline(child)
    }
  }
  if (node.type === 'TEXT') visitInline(node)
  else addEntry(node)
}

export const renderNote = (writer: PdfWriter, node: MeasuredNode): void => {
  const [first] = node.children
  const text = first?.type === PDF_PRIMITIVES.TextInstance ? first.value : ''
  writer.note(node.box.left, node.box.top, text, node.style.backgroundColor)
}
