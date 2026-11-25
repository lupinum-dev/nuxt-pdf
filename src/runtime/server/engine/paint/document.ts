import { PDF_PRIMITIVES, PDF_ROW_SPAN_PROP } from '../../../primitives'
import type { SafeDocumentNode } from '../layout/index'
import type { PdfWriter } from '../pdf/writer'
import type { PaintTags } from '../tagged'
import { applyTransformations, renderBackground, renderBorders, translate } from './box'
import { renderColumnRules } from './columns'
import { renderDebug } from './debug'
import { renderImage } from './image'
import { markPlaces, renderLink, renderNote } from './links'
import type { MeasuredNode } from '../layout/types'
import type { FieldPainter, PaintChild, PaintScope } from './node'
import { renderSvg } from './svg'
import { renderText } from './text'

// Paints a laid-out document on a writer: each page, depth first, then the
// end of the document. The walk is ported from `@react-pdf/render` 4.5.1.

/** The paint of a node's own content, after its background and borders. */
const PAINTERS: Readonly<Record<string, (writer: PdfWriter, node: MeasuredNode, scope: PaintScope) => void>> = {
  TEXT: renderText,
  IMAGE: renderImage,
  SVG: renderSvg,
  NOTE: renderNote,
  LINK: renderLink,
  // forms.ts turns every field into a TEXT_INPUT named by its key.
  TEXT_INPUT: (writer, node, scope) => {
    if (scope.paintField === undefined) return
    scope.paintField(writer, String(node.props.name ?? ''), node.box.left, node.box.top, node.box.width, node.box.height, scope.tags?.element(node))
  },
}

/** A text paints its children as part of its lines. */
const paintsChildren = (node: MeasuredNode): boolean => node.type !== 'TEXT' && node.type !== 'SVG'

/** The view of a cell over several rows, in its first row (`PDF_ROW_SPAN_PROP`). */
const spansRows = (node: PaintChild): node is MeasuredNode =>
  node.type !== PDF_PRIMITIVES.TextInstance && node.props[PDF_ROW_SPAN_PROP] !== undefined

/**
 * The cells over several rows in the rows of `node`, with their row. They
 * reach down over the rows after their own, whose backgrounds would paint
 * over them in tree order, so they paint after all rows (D39).
 */
const rowSpanCells = (node: MeasuredNode): [row: MeasuredNode, cell: MeasuredNode][] => node.children.flatMap(row =>
  row.type === PDF_PRIMITIVES.TextInstance ? [] : row.children.filter(spansRows).map((cell): [MeasuredNode, MeasuredNode] => [row, cell]))

const renderNode = (writer: PdfWriter, node: PaintChild, scope: PaintScope, page: number): void => {
  if (node.type === PDF_PRIMITIVES.TextInstance) {
    // A string (the text of a note) paints nothing but two empty state
    // pairs, as the ported walk did (removing them changes the bytes).
    writer.save()
    writer.save()
    writer.restore()
    writer.restore()
    return
  }
  if (node.type === 'PAGE') {
    writer.addPage(node.box.width, node.box.height)
  }
  // A leaf's marked content spans its whole paint, from its `q` to its `Q`.
  const leaf = scope.tags?.leaf(node, page)
  if (leaf?.pagination) writer.beginArtifact(true)
  else if (leaf !== undefined) writer.beginMarked(leaf.spec, leaf.order, leaf.actualText)
  const inner = leaf === undefined ? scope : { ...scope, leaf: leaf.pagination || leaf.spec.role === 'Figure' ? undefined : leaf }
  writer.save()
  applyTransformations(writer, node)
  markPlaces(writer, node, page)
  renderBackground(writer, node)
  renderBorders(writer, node)
  PAINTERS[node.type]?.(writer, node, inner)
  if (paintsChildren(node)) {
    writer.save()
    // Children are laid out relative to their parent's box.
    translate(writer, node.box.left, node.box.top)
    // Above the background and borders, below the content, as in CSS.
    renderColumnRules(writer, node)
    for (const child of node.children) {
      if (!spansRows(child)) renderNode(writer, child, inner, page)
    }
    for (const [row, cell] of rowSpanCells(node)) {
      writer.save()
      applyTransformations(writer, row)
      translate(writer, row.box.left, row.box.top)
      renderNode(writer, cell, inner, page)
      writer.restore()
    }
    writer.restore()
  }
  // The debug overlay of a leaf, with the leaf's closing `Q`, is an artifact.
  const overlay = leaf !== undefined && !leaf.pagination && Boolean(node.props.debug)
  if (overlay) writer.beginArtifact()
  renderDebug(writer, node)
  writer.restore()
  if (overlay) writer.endMarked()
  if (leaf !== undefined) writer.endMarked()
}

export interface PaintOptions {
  /** A tagged document: the answers of `prepareTagging`. */
  tags?: PaintTags
  /** A document with form fields: `prepareForm`'s field painter. */
  paintField?: FieldPainter
  /** The render deadline: throws once the time budget is spent. Called before each page and before the document ends. */
  checkDeadline?: () => void
}

export const paintDocument = (writer: PdfWriter, layout: SafeDocumentNode, { tags, paintField, checkDeadline }: PaintOptions = {}): void => {
  const scope: PaintScope = { tags, paintField, leaf: undefined, nestedIds: new Set() }
  layout.children.forEach((page, index) => {
    checkDeadline?.()
    renderNode(writer, page, scope, index)
  })
  checkDeadline?.()
  writer.end()
}
