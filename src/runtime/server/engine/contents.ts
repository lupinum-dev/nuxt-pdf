// `PdfContents` (the contents component): the engine adapter writes its
// entries in its place before the layout passes. Its one source is the
// outline: every node with a `bookmark` (`pdfContentsTitle`), nested as the
// outline nests it, under the nearest listed ancestor
// (layout/prepare/bookmarks.ts). The later headings do not exist yet when Vue
// renders the contents, so the entries are written here, from the mounted
// tree. The page numbers are `PdfPageRef`s, which the fixed-point loop of
// plain-tree.ts fills in.
import { resolvedStyleValue, type PdfStyle, type PdfStyleValue } from '../../authoring'
import {
  PDF_CONTENTS_ID_PREFIX,
  PDF_CONTENTS_PART_PROP,
  PDF_PRIMITIVES,
  pdfContentsTitle,
  type PdfContentsStyles,
} from '../../primitives'
import type { PdfElementNode, PdfNode } from '../../renderer'

const DEFAULT_LEVELS = 3

/** The structure element of each written view in a tagged document (tagged.ts). */
export type PdfContentsPart = 'list' | 'item' | 'reference'

interface Entry {
  readonly id: string
  readonly title: string
  readonly children: Entry[]
}

/**
 * The defaults that `styles` is merged over, in em of the text size, so they
 * follow the body size as rich text does. An entry is one link around one
 * text: the title, a `PdfLeader` and the page number, so the leader runs
 * from the end of the title's last line and the number ends at the right
 * edge (text/break.ts, text/justify.ts). The leader's own defaults are a
 * dotted line with a gap of 0.3em on each side (layout/text/fragments.ts);
 * `leader: 'none'` makes its line 0 wide, so only the gap stays. A link
 * starts blue and underlined (layout/styles/resolve-styles.ts): the entry
 * takes the text color it inherits at the place of the contents.
 */
const LINK: PdfStyle = { textDecoration: 'none' }
const DEFAULT_COLOR = 'black'
const DEFAULTS = {
  entry: { marginTop: '0.25em' },
  noLeader: { borderBottomWidth: 0 },
  level1: { marginTop: '0.6em', fontWeight: 'bold' },
} as const satisfies Record<string, PdfStyle>

/** The indent of an entry of `level` (from 1): 1.5 em per level below the first, outside the link's area. */
const indentOf = (level: number): PdfStyle => level === 1 ? {} : { marginLeft: `${(level - 1) * 1.5}em` }

/** The `styles` key of each level, from 1. */
const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6'] as const satisfies ReadonlyArray<keyof PdfContentsStyles>

const isElement = (node: PdfNode): node is PdfElementNode => node.type !== PDF_PRIMITIVES.TextInstance

const holdsContents = (node: PdfElementNode): boolean =>
  node.type === PDF_PRIMITIVES.Contents || node.children.some(child => isElement(child) && holdsContents(child))

/** A plain object's own `PdfStyle` entry; the mount check validated `styles`. */
const ownStyles = (value: unknown): PdfContentsStyles =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}

const element = (type: PdfElementNode['type'], style: PdfStyleValue, props: Record<string, unknown>, children: PdfNode[], source: string | undefined): PdfElementNode => ({
  type,
  box: {},
  style,
  props,
  children,
  ...(source === undefined ? {} : { source }),
})

/**
 * The views of one contents: a list (`TOC`) of items (`TOCI`). An item holds
 * its entry, a view that never splits (`Reference`) with one link to the
 * entry's place: a text of the title, the leader and the page number.
 * The items of the next level follow in a list of their own, inside the item.
 */
const contentsView = (node: PdfElementNode, entries: readonly Entry[], color: string): PdfElementNode => {
  const levels = typeof node.props.levels === 'number' ? node.props.levels : DEFAULT_LEVELS
  const styles = ownStyles(node.props.styles)
  const none = node.props.leader === 'none'
  const { source } = node
  const list = (items: readonly Entry[], level: number): PdfElementNode =>
    element(PDF_PRIMITIVES.View, {}, { [PDF_CONTENTS_PART_PROP]: 'list' }, items.map(entry => item(entry, level)), source)
  const item = (entry: Entry, level: number): PdfElementNode => {
    const key = LEVEL_KEYS[level - 1]
    const own = key === undefined ? undefined : styles[key]
    const title = element(PDF_PRIMITIVES.Text, [styles.title], {}, [{ type: PDF_PRIMITIVES.TextInstance, value: entry.title }], source)
    const leader = element(PDF_PRIMITIVES.Leader, [none && DEFAULTS.noLeader, styles.leader], {}, [], source)
    const page = element(PDF_PRIMITIVES.Text, [styles.page], {}, [element(PDF_PRIMITIVES.PageRef, {}, { to: entry.id }, [], source)], source)
    const text = element(PDF_PRIMITIVES.Text, {}, {}, [title, leader, page], source)
    const link = element(
      PDF_PRIMITIVES.Link,
      [LINK, { color }, DEFAULTS.entry, indentOf(level), level === 1 && DEFAULTS.level1, styles.entry, own],
      { href: `#${entry.id}` },
      [text],
      source,
    )
    const row = element(PDF_PRIMITIVES.View, {}, { [PDF_CONTENTS_PART_PROP]: 'reference', wrap: false }, [link], source)
    const deeper = level < levels && entry.children.length > 0 ? [list(entry.children, level + 1)] : []
    return element(PDF_PRIMITIVES.View, {}, { [PDF_CONTENTS_PART_PROP]: 'item' }, [row, ...deeper], source)
  }
  return list(entries, 1)
}

/**
 * The document with each `PdfContents` replaced by its entries, or the
 * document itself when it has none. A listed node without an `id` gets
 * `__nuxtPdfContents-<n>`, the n-th entry of the document in tree order,
 * once, whatever the number of contents. The nodes on the way are copied;
 * the input is not changed.
 */
export const expandPdfContents = (document: PdfElementNode): PdfElementNode => {
  if (!holdsContents(document)) return document
  const roots: Entry[] = []
  // Each contents and the text color it inherits.
  const markers: { marker: PdfElementNode, color: string }[] = []
  let count = 0

  const copy = (node: PdfElementNode, siblings: Entry[], inherited: string): PdfElementNode => {
    const own = resolvedStyleValue(node.style, 'color')
    const color = typeof own === 'string' ? own : inherited
    if (node.type === PDF_PRIMITIVES.Contents) {
      const marker = { ...node, children: [] }
      markers.push({ marker, color })
      return marker
    }
    const title = pdfContentsTitle(node.props.bookmark)
    let props = node.props
    let children = siblings
    if (title !== undefined) {
      count += 1
      const id = typeof node.props.id === 'string' ? node.props.id : `${PDF_CONTENTS_ID_PREFIX}${count}`
      if (id !== node.props.id) props = { ...props, id }
      const entry: Entry = { id, title, children: [] }
      siblings.push(entry)
      children = entry.children
    }
    return { ...node, props, children: node.children.map(child => isElement(child) ? copy(child, children, color) : child) }
  }

  const expanded = copy(document, roots, DEFAULT_COLOR)
  // Every entry is known now: each marker becomes its list.
  for (const { marker, color } of markers) Object.assign(marker, contentsView(marker, roots, color))
  return expanded
}
