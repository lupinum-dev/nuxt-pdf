// Named destinations and bookmarks on the laid-out pages: the first page of
// every id (`extractDestinationPages`, the source of a table of contents),
// views left with only their repeated header (`findOrphanedViews`), and one
// destination and outline entry per node, at its first page with content
// (`anchorDestinationsAtFirstPage`, before the write).

import type { SafeDocumentNode } from './layout/index'
import type { LaidOutNode } from './layout/types'
import { PDF_PRIMITIVES } from '../../primitives'
import { documentPages, finiteNumber, LAYOUT_KEY_PROP, visitPageNodes } from './laid-out'

/** id (named destination) → 1-based page number the destination resolves to. */
export type DestinationPageMap = Record<string, number>

const nodeId = (node: LaidOutNode): string | undefined => {
  const id = node.props?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * A fragment that pagination left on a page with nothing in it: the part of a
 * text above the page end that got no line, or a view part with no child and
 * no height. It still carries `props.id`, but the content starts on a later page.
 */
const isEmptyFragment = (node: LaidOutNode): boolean => {
  if (node.type === PDF_PRIMITIVES.Text) {
    const { lines } = node
    return Array.isArray(lines) && lines.length === 0
  }
  return node.type === PDF_PRIMITIVES.View
    && node.children.length === 0
    && finiteNumber(node.box.height) === 0
}

/**
 * Whether an appearance of a node (named by `keyOf`: its id, or its bookmark)
 * can name where its content starts. An empty fragment cannot, unless the node
 * has no other appearance: an empty `<PdfView id>` placed as an anchor stays a
 * destination.
 */
const contentAnchor = <K>(
  layout: SafeDocumentNode,
  keyOf: (node: LaidOutNode) => K | undefined,
): (node: LaidOutNode, key: K) => boolean => {
  const withContent = new Set<K>()
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      const key = keyOf(node)
      if (key !== undefined && !isEmptyFragment(node)) withContent.add(key)
    })
  }
  return (node, key) => !withContent.has(key) || !isEmptyFragment(node)
}

const destinationAnchor = (layout: SafeDocumentNode) => contentAnchor(layout, nodeId)

/**
 * The ids of the nested texts that start in a text part. Every part of a
 * split text keeps all of its nested texts as children, so their nodes
 * cannot say where they start; the runs of the part's lines can
 * (`run.attributes.anchors`, from which the painter writes their
 * destinations, paint/text.ts).
 */
const nestedIdsOf = (node: LaidOutNode): string[] => {
  if (node.type !== PDF_PRIMITIVES.Text || !Array.isArray(node.lines)) return []
  return node.lines.flatMap(line => line.runs.flatMap(run => (run.attributes.anchors ?? []).flatMap(anchor => anchor.id === undefined ? [] : [anchor.id])))
}

/**
 * The bookmark of a node, by the `ref` layout gives each bookmarked source
 * node. Every page part of a split node keeps the same bookmark object.
 */
const bookmarkRef = (node: LaidOutNode): unknown => {
  const bookmark: unknown = node.props?.bookmark
  return typeof bookmark === 'object' && bookmark !== null && 'ref' in bookmark ? bookmark.ref : undefined
}

/**
 * Map every `id` (named destination) to the **first** 1-based page it appears
 * on, not counting empty fragments (`isEmptyFragment`). `id` is the key `render/src/operations/setDestination.ts` emits and that a
 * Link `src="#id"` jumps to (`setLink.ts`), so this map is the table-of-contents'
 * source of truth. Pagination splits a node that spans a page boundary into a
 * fragment on every page it touches, each keeping `props.id`; a destination names
 * where a section STARTS, so the first page wins (`first-writer-wins`).
 * `layout.children` is the final ordered page list produced by `resolvePagination`.
 * A nested text counts on the page of the first run that names it
 * (`nestedIdsOf`), not where its node first appears.
 */
export const extractDestinationPages = (
  layout: SafeDocumentNode,
): DestinationPageMap => {
  const pages = Object.create(null) as DestinationPageMap
  const anchors = destinationAnchor(layout)
  const nested = new Set<string>()
  for (const page of documentPages(layout)) visitPageNodes(page, node => nestedIdsOf(node).forEach(id => nested.add(id)))

  documentPages(layout).forEach((page, index) => {
    const pageNumber = index + 1
    visitPageNodes(page, (node) => {
      const id = nodeId(node)
      if (id !== undefined && !nested.has(id) && !Object.hasOwn(pages, id) && anchors(node, id)) pages[id] = pageNumber
      for (const runId of nestedIdsOf(node)) {
        if (!Object.hasOwn(pages, runId)) pages[runId] = pageNumber
      }
    })
  })

  return pages
}

/**
 * Find views that ended a page with only their repeated header. `orphanWatch`
 * names views that hold both `fixed` and flow children in the source: if such
 * a view's first fragment holds only its `fixed` children (a header with no
 * row under it), its key is reported, so the next pass can start it on a new
 * page.
 */
export const findOrphanedViews = (
  layout: SafeDocumentNode,
  orphanWatch: ReadonlySet<string>,
): string[] => {
  const seen = new Set<string>()
  const orphans: string[] = []

  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      const key = node.props[LAYOUT_KEY_PROP]
      if (typeof key !== 'string' || seen.has(key)) return
      seen.add(key)
      const children = node.children
      if (
        orphanWatch.has(key)
        && Array.isArray(children)
        && children.length > 0
        && children.every(child => child.type !== PDF_PRIMITIVES.TextInstance && child.props.fixed === true)
      ) {
        orphans.push(key)
      }
    })
  }

  return orphans
}

/**
 * Before serialization, drop `props.id` from every appearance of an id except
 * the first one that `extractDestinationPages` counts (empty fragments do not
 * count). The writer's named destinations (`destination`, called per node)
 * are last-writer-wins, so without this a page-spanning section's destination
 * would point at its LAST page. After the drop, the single surviving
 * `setDestination` call anchors the destination at the section's first page —
 * matching `extractDestinationPages` and the printed TOC number.
 *
 * The drop is copy-on-write, never an in-place delete: pagination REUSES node
 * objects across pages — a `fixed` node is the SAME object (and props object) on
 * every page it repeats on, and only split fragments get fresh props — so an
 * in-place delete on a later page would erase the first page's destination too.
 * Later appearances are replaced with shallow copies (props without `id`), and
 * the copy propagates up through the ancestor path so shared subtrees on earlier
 * pages stay untouched. The layout is derived and disposable (see CONTRACTS.md),
 * so replacing nodes inside it is legitimate.
 */
export const anchorDestinationsAtFirstPage = (layout: SafeDocumentNode): void => {
  const seen = new Set<string>()
  const anchors = destinationAnchor(layout)
  // The same holds for bookmarks: upstream adds an outline entry for every
  // node with `props.bookmark`, so a node split over three pages had three.
  const seenBookmarks = new Set<unknown>()
  const bookmarkAnchors = contentAnchor(layout, bookmarkRef)

  const strip = (element: LaidOutNode): LaidOutNode => {
    let next = element

    const id = nodeId(element)
    if (id !== undefined) {
      if (!seen.has(id) && anchors(element, id)) {
        seen.add(id)
      }
      else {
        const { id: _dropped, ...rest } = element.props
        next = { ...element, props: rest }
      }
    }

    const ref = bookmarkRef(element)
    if (ref !== undefined) {
      if (!seenBookmarks.has(ref) && bookmarkAnchors(element, ref)) {
        seenBookmarks.add(ref)
      }
      else {
        const { bookmark: _dropped, ...rest } = next.props
        next = { ...next, props: rest }
      }
    }

    const children = next.children
    if (Array.isArray(children)) {
      let changed = false
      const stripped = children.map((child) => {
        if (child.type === PDF_PRIMITIVES.TextInstance) return child
        const result = strip(child)
        if (result !== child) changed = true
        return result
      })
      if (changed) next = { ...next, children: stripped }
    }

    return next
  }

  layout.children = documentPages(layout).map(strip)
}
