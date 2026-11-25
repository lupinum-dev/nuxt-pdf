// Mount checks of column containers: a view or
// a page whose style sets a column count or width. The engine lays them out
// (engine/layout/columns); these checks fail what it would ignore or change
// without a word. A container in a column of another, and a container with a
// height its content passes, fail in the layout (PDF_LAYOUT_ERROR).
import { resolvedPosition, resolvedStyleValue } from '../authoring'
import { PDF_PRIMITIVES } from '../primitives'
import { PDF_COLUMN_RULE_KEYS, setsPdfColumns } from '../shared/columns'
import { treeInvalid } from '../shared/errors'
import { pdfElementLabel, type PdfElementNode, type PdfNode } from './types'

/** What the ancestors of a node say about columns. */
export type ColumnScope = {
  /** The node is in a column: below a container, not in a spanning, absolute or (page) fixed child of it. */
  inColumn: boolean
  /** The container the node is a direct child of. */
  container: 'view' | 'page' | undefined
  /** The label of the outermost fixed or absolute ancestor. */
  outOfFlow: string | undefined
}

export const ROOT_COLUMN_SCOPE: ColumnScope = { inColumn: false, container: undefined, outOfFlow: undefined }

const isOutOfFlow = (node: PdfElementNode): boolean =>
  node.props.fixed === true || resolvedPosition(node.style) === 'absolute'

// A percentage height on a direct child of a column container, in a column
// or spanning, takes the room the columns get on the page, not the
// container's height, so the child and the content after the columns land in
// the wrong place. An absolute child is placed against the container, and a
// fixed child of a page with columns is outside them; a child deeper down
// takes its parent's height. None of these needs the check.
const HEIGHT_KEYS = ['height', 'minHeight', 'maxHeight'] as const

const isContainer = (node: PdfElementNode): boolean =>
  (node.type === PDF_PRIMITIVES.View || node.type === PDF_PRIMITIVES.Page) && setsPdfColumns(node.style)

/** The column scope of a child of `node`. */
export const childColumnScope = (node: PdfElementNode, scope: ColumnScope, child: PdfNode): ColumnScope => {
  const outOfFlow = scope.outOfFlow ?? (isOutOfFlow(node) ? pdfElementLabel(node) : undefined)
  if (!isContainer(node) || child.type === PDF_PRIMITIVES.TextInstance) {
    return { inColumn: scope.inColumn, container: undefined, outOfFlow }
  }
  const page = node.type === PDF_PRIMITIVES.Page
  // A page keeps its fixed children outside the columns (engine/plain-tree.ts, `pageColumns`).
  const inColumn = resolvedStyleValue(child.style, 'columnSpan') !== 'all'
    && resolvedPosition(child.style) !== 'absolute'
    && !(page && child.props.fixed === true)
  return { inColumn, container: page ? 'page' : 'view', outOfFlow }
}

/** Fails a node whose columns, column span or column break the layout would ignore or change. */
export const validateColumns = (node: PdfElementNode, label: string, scope: ColumnScope): void => {
  if (node.props.break === 'column' && !scope.inColumn) {
    treeInvalid(`<${label}> has break="column" but is not in a column: it must be inside a <PdfView> or <PdfPage> with columnCount or columnWidth, and not in a child with columnSpan "all". Use break for a new page, or move the node into the columns.`)
  }

  if (resolvedStyleValue(node.style, 'columnSpan') === 'all') {
    if (scope.container === 'page' && node.props.fixed === true) {
      treeInvalid(`<${label}> is a fixed child of a <PdfPage> with columns, so it is full width already: the page keeps its fixed nodes outside the columns. Remove columnSpan.`)
    }
    // Without a container above it, the span has no effect, as in CSS: a
    // template may switch its columns off and keep its spans.
    if (scope.inColumn && scope.container === undefined) {
      treeInvalid(`<${label}> has columnSpan "all" inside a column, but it is not a direct child of the column container: only a direct child spans the columns. Move it up to the container, or remove columnSpan.`)
    }
  }

  const inFlowChild = scope.container !== undefined
    && resolvedPosition(node.style) !== 'absolute'
    && !(scope.container === 'page' && node.props.fixed === true)
  if (inFlowChild) {
    for (const key of HEIGHT_KEYS) {
      const value = resolvedStyleValue(node.style, key)
      if (typeof value === 'string' && value.trim().endsWith('%')) {
        treeInvalid(`<${label}> has ${key} "${value}" on a direct child of a column container: a percentage height there is a share of the room the columns get on the page, not of the container, so the child and the content after the columns would be placed wrong. Give the child a ${key} in points, such as 120, or remove it.`)
      }
    }
  }

  // Only a view or a page can be a column container. On one without columns
  // the rule has no effect, as in CSS and as columnSpan without a container:
  // a template may switch its columns off and keep the rule.
  const canHaveColumns = node.type === PDF_PRIMITIVES.View || node.type === PDF_PRIMITIVES.Page
  const ruleKey = PDF_COLUMN_RULE_KEYS.find(key => resolvedStyleValue(node.style, key) !== undefined)
  if (ruleKey !== undefined && !canHaveColumns) {
    treeInvalid(`<${label}> cannot have ${ruleKey}: only a <PdfView> or a <PdfPage> with columns draws a column rule. Put the rule on the column container, or use a border for a line beside this node.`)
  }

  if (!setsPdfColumns(node.style)) return
  if (!canHaveColumns) {
    treeInvalid(`<${label}> cannot have columnCount, columnWidth or columns: only a <PdfView> or a <PdfPage> lays its children out in columns. Put the content into a <PdfView> with the columns.`)
  }
  if (scope.outOfFlow !== undefined || isOutOfFlow(node)) {
    const place = scope.outOfFlow === undefined ? 'a fixed or absolute node' : `inside <${scope.outOfFlow}>, a fixed or absolute node`
    treeInvalid(`<${label}> with columns cannot be ${place}: columns fill over the page flow, and such a node is not split over columns or pages. Remove the columns, or move the view into the page flow.`)
  }
  const direction = resolvedStyleValue(node.style, 'flexDirection')
  if (direction !== undefined && direction !== 'column') {
    treeInvalid(`<${label}> with columns has flexDirection "${direction}": the layout fills each column from top to bottom, so a column container takes no other direction. Remove flexDirection, or remove the columns.`)
  }
}
