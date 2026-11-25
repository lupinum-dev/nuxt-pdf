import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES } from '../../../../primitives'
import { treeInvalid } from '../../../../shared/errors'
import type { StyledDocument, StyledNode } from '../types'
import { percentOf, resolvePercent } from './percent'

// Percentages against the page, resolved before yoga sees the tree: before
// pagination yoga lays each page out as one tall box, so it would take them
// from the wrong height.

/**
 * The height of the page a natural-height page stands for (`measureNaturalHeights` in
 * layout-diagnostics.ts): that layout leaves the page height automatic, but its percentages
 * keep the base they have in the render.
 */
export const NATURAL_PAGE_HEIGHT_PROP = '__nuxtPdfNaturalPageHeight'

/** The height percentages of a page take: its own, or that of the page a natural-height page stands for. */
const pageHeightOf = (page: StyledNode): unknown => {
  const natural: unknown = page.props?.[NATURAL_PAGE_HEIGHT_PROP]
  return page.style?.height ?? (typeof natural === 'number' ? natural : undefined)
}

const withPagePaddings = (page: StyledNode): StyledNode => {
  const style = { ...page.style }
  const { width } = style
  const height = pageHeightOf(page)
  if ('paddingTop' in style) style.paddingTop = resolvePercent(style.paddingTop, height)
  if ('paddingLeft' in style) style.paddingLeft = resolvePercent(style.paddingLeft, width)
  if ('paddingRight' in style) style.paddingRight = resolvePercent(style.paddingRight, width)
  if ('paddingBottom' in style) style.paddingBottom = resolvePercent(style.paddingBottom, height)
  return { ...page, style }
}

/** Page paddings in percent, against the page width (left, right) or height (top, bottom). */
export const resolvePagesPaddings = (root: StyledDocument): StyledDocument =>
  ({ ...root, children: root.children.map(withPagePaddings) })

const HEIGHT_KEYS = ['height', 'minHeight', 'maxHeight'] as const

/** The height inside a node's vertical paddings and borders; undefined unless all of them are in points. */
const contentHeightOf = (style: NonNullable<StyledNode['style']>, height: number): number | undefined => {
  const edges = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
  if (!edges.every(edge => edge === undefined || edge === null || typeof edge === 'number')) return undefined
  return height - edges.reduce<number>((total, edge) => total + Number(edge ?? 0), 0)
}

const percentHeightError = (node: StyledNode, key: typeof HEIGHT_KEYS[number], value: unknown, parent: StyledNode): never => treeInvalid(
  `<${PDF_PRIMITIVE_NAMES[node.type] ?? node.type}> has ${key} "${String(value)}", but its parent <${PDF_PRIMITIVE_NAMES[parent.type] ?? parent.type}> has no height known before layout: `
  + 'a percentage height is a share of the parent\'s height inside its paddings, which needs a height in points (or a percentage of a parent with one) and paddings and borders in points. '
  + `Give the parent a height, or give the ${key} in points.`,
  node.source,
)

/**
 * The percentage heights of `node`'s children against `base`, the height inside its paddings when known before
 * layout, then theirs. An absolute child keeps its own (yoga takes them from the padding box); a text holds
 * no boxes; an SVG sizes its children by its own attributes.
 */
const withPercentHeights = (node: StyledNode, base: number | undefined): StyledNode => {
  if (!node.children || node.type === PDF_PRIMITIVES.Text || node.type === PDF_PRIMITIVES.Svg) return node
  const children = node.children.map((child) => {
    if (child.type === PDF_PRIMITIVES.TextInstance) return child
    const style = { ...child.style }
    // An absolute child of a page keeps the height and minHeight against the page area it always had.
    const keys = style.position !== 'absolute' ? HEIGHT_KEYS : node.type === PDF_PRIMITIVES.Page ? HEIGHT_KEYS.slice(0, 2) : []
    for (const key of keys) {
      if (percentOf(style[key]) === undefined) continue
      if (base === undefined) percentHeightError(child, key, style[key], node)
      style[key] = resolvePercent(style[key], base)
    }
    const resolved = { ...child, style }
    return withPercentHeights(resolved, typeof style.height === 'number' ? contentHeightOf(style, style.height) : undefined)
  })
  return { ...node, children }
}

/**
 * Every percentage `height`, `minHeight` and `maxHeight` in points, resolved
 * against the parent's height inside its paddings: the page's for its own
 * children, else a parent's height in points (or resolved here). Left to
 * yoga, pagination measures a page as one tall box, so a percentage there
 * had no base or the wrong one, and a parent that splits has no one height.
 * A parent without a known height fails with `PDF_TREE_INVALID`.
 */
export const resolvePercentHeight = (root: StyledDocument): StyledDocument =>
  ({ ...root, children: root.children.map((page) => {
    const { paddingTop, paddingBottom } = page.style ?? {}
    const height = pageHeightOf(page)
    return withPercentHeights(page, height === undefined || height === null ? undefined : Number(height) - Number(paddingTop || 0) - Number(paddingBottom || 0))
  }) })
