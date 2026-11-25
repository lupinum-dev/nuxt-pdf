import type { PdfFile } from './file'
import { PdfText, type PdfRef } from './objects'

// The outline (bookmarks) of our writer.

/**
 * An entry with its place in page space: `x` from the left, `y` from the
 * bottom. `ref` numbers the bookmarks in source order; `parent` is the
 * number of the nearest bookmarked ancestor.
 */
export interface OutlinePlace {
  ref: number
  parent?: number
  title: string
  pageNumber: number
  x: number
  y: number
  expanded?: boolean
  fit?: boolean
}

interface OutlineEntry {
  /** Its position in the order of `add`. */
  readonly index: number
  readonly item: OutlinePlace
  children: OutlineEntry[]
}

/** The descendants of an entry a reader shows when the entry is open (ISO 32000-1, 12.3.3). */
const shownDescendants = (entry: { children: readonly OutlineEntry[] }): number =>
  entry.children.reduce((sum, child) => sum + 1 + (child.item.expanded ? shownDescendants(child) : 0), 0)

export interface Outline {
  /** Adds an entry, in any order: the page a float sits on can paint it before its section. */
  add(item: OutlinePlace): void
  /** The outline's entries, nested by `parent` and in source order among siblings; returns the root, or nothing without entries. */
  finish(pages: ReadonlyArray<{ readonly ref: PdfRef }>): PdfRef | undefined
}

export const createOutline = (file: PdfFile): Outline => {
  const root: { children: OutlineEntry[] } = { children: [] }
  const entries: OutlineEntry[] = []

  const add = (item: OutlinePlace): void => {
    entries.push({ index: entries.length, item, children: [] })
  }

  /** Each entry under its parent's (at the root without one), siblings by `ref`. */
  const nest = (): void => {
    const byRef = new Map<number, OutlineEntry>()
    for (const entry of entries) if (!byRef.has(entry.item.ref)) byRef.set(entry.item.ref, entry)
    for (const entry of entries) {
      const owner = entry.item.parent === undefined ? undefined : byRef.get(entry.item.parent)
      ;(owner ?? root).children.push(entry)
    }
    const order = (a: OutlineEntry, b: OutlineEntry) => a.item.ref - b.item.ref || a.index - b.index
    root.children.sort(order)
    for (const entry of entries) entry.children.sort(order)
  }

  const finish = (pages: ReadonlyArray<{ readonly ref: PdfRef }>): PdfRef | undefined => {
    if (entries.length === 0) return undefined
    nest()
    // The entries' objects in the order they were added, then the root.
    const refs = entries.map(() => file.reserve())
    const refOf = (entry: OutlineEntry | undefined): PdfRef | undefined => entry && refs[entry.index]
    const rootRef = file.reserve()
    const links = (parent: PdfRef, children: readonly OutlineEntry[]): void => {
      children.forEach(({ index: entry, item, children: grandchildren }, index) => {
        const page = pages[item.pageNumber]
        if (page === undefined) throw new Error(`Nuxt PDF has no page ${item.pageNumber} for the outline entry "${item.title}".`)
        const shown = shownDescendants({ children: grandchildren })
        file.set({
          Title: new PdfText(item.title),
          Parent: parent,
          Dest: item.fit ? [page.ref, 'Fit'] : [page.ref, 'XYZ', item.x, item.y, 0],
          Prev: refOf(children[index - 1]),
          Next: refOf(children[index + 1]),
          First: refOf(grandchildren[0]),
          Last: refOf(grandchildren.at(-1)),
          Count: shown === 0 ? undefined : item.expanded ? shown : -shown,
        }, refs[entry])
        links(refs[entry]!, grandchildren)
      })
    }
    links(rootRef, root.children)
    return file.set({ Type: 'Outlines', First: refOf(root.children[0]), Last: refOf(root.children.at(-1)), Count: shownDescendants(root) }, rootRef)
  }

  return { add, finish }
}
