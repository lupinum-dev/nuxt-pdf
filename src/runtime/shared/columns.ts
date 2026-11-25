import { resolvedStyleValue, type PdfStyle, type PdfStyleEntry } from '../authoring'

/*
 * A `PdfPage` with columns puts its flow children into one implicit view
 * (engine/plain-tree.ts, `pageColumns`), so that the page's flow lays out as
 * the children of a `PdfView` with the same style. The view takes from the
 * page's style, in the order they were written:
 * - the column keys and the column rule keys, which move: the page itself
 *   has no columns;
 * - the keys a column container hands to its columns (layout/columns,
 *   `galleyStyle`): `gap` spaces the children in each column, `alignItems`
 *   places them across it. They are copied: the page keeps them for its own
 *   children (a fixed header, the view, a fixed footer).
 * The view stretches to the page's content width whatever the page's
 * `alignItems`. Every other key stays on the page only: padding and borders
 * are the page's, text styles reach the flow by inheritance, and
 * `justifyContent` places the page's children (header, flow, footer), which
 * a view container does not do for its columns either.
 */

/** The column rule keys: a column container draws the rule (engine/paint/columns.ts). */
export const PDF_COLUMN_RULE_KEYS = [
  'columnRuleWidth',
  'columnRuleStyle',
  'columnRuleColor',
] as const satisfies (keyof PdfStyle)[]

/** The page keys that move to the implicit view. */
export const PDF_PAGE_COLUMN_KEYS: ReadonlySet<string> = new Set([
  ...([
    'columnCount',
    'columnWidth',
    'columnGap',
    'columnFill',
    'columns',
  ] satisfies (keyof PdfStyle)[]),
  ...PDF_COLUMN_RULE_KEYS,
])

/** The page keys that the implicit view gets as well, for its columns. */
export const PDF_PAGE_FLOW_KEYS: ReadonlySet<string> = new Set([
  'gap',
  'alignItems',
] satisfies (keyof PdfStyle)[])

/**
 * Whether a style makes a view or a page a column container: it sets a
 * column count or a column width, also through `columns`.
 */
export const setsPdfColumns = (style: PdfStyleEntry): boolean =>
  resolvedStyleValue(style, 'columnCount') !== undefined
  || resolvedStyleValue(style, 'columnWidth') !== undefined
  || resolvedStyleValue(style, 'columns') !== undefined
