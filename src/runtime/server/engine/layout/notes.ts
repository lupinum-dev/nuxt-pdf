import { PDF_PRIMITIVES } from '../../../primitives'
import { INHERITED } from './styles/inheritance'
import type { ElementNode, MeasuredDocument, MeasuredNode, SizedDocument, SizedPage, Style, WithNotes } from './types'

// Footnote bodies are laid out once per page, beside its flow: each
// page's `notes` go through the layout stages as the children of its note
// area, on a page of their own, which nothing paints, and come back as the
// page's measured `notes` and `noteArea` before pagination. So their fonts,
// images and links load as the flow's do, they inherit the area's text
// styles, and a body is never laid out again by a split.

/**
 * On the page that holds a page's notes during the layout stages: how many
 * of its area's children are the area's own (before the notes).
 */
const NOTE_PAGE_PROP = '__nuxtPdfNotePage'

const INHERITED_KEYS: readonly string[] = INHERITED

/**
 * The style of a note page: what its page passes down to text, its width
 * and its side paddings and borders (so the notes get the page's content
 * width), and no vertical room. The two vertical paddings come last, so they
 * win over a `padding` or `paddingVertical` shorthand (styles/expand.ts reads
 * the keys in order).
 */
const notePageStyle = (style: Style): Style => ({
  ...Object.fromEntries(Object.entries(style).filter(([key]) =>
    INHERITED_KEYS.includes(key) || key === 'width' || (/^(?:padding|border)/.test(key) && key !== 'paddingTop' && key !== 'paddingBottom'))),
  paddingTop: 0,
  paddingBottom: 0,
})

/** Each page with notes followed by the page of its notes, after the page sizes are in the styles. */
export const liftNotes = (root: SizedDocument): SizedDocument => {
  if (!root.children.some(page => page.notes?.length)) return root
  return {
    ...root,
    children: root.children.flatMap((page): SizedPage[] => {
      const { notes, noteArea, ...flow } = page
      if (!notes?.length) return [flow]
      // A page without an area: one with no style and no children of its own.
      const own = noteArea?.children ?? []
      const props = { [NOTE_PAGE_PROP]: own.length, ...(page.props.dpi === undefined ? {} : { dpi: page.props.dpi }) }
      const area: ElementNode = { ...(noteArea ?? { type: PDF_PRIMITIVES.View, props: {}, style: {}, box: {} }), children: [...own, ...notes] }
      return [flow, { type: PDF_PRIMITIVES.Page, props, style: notePageStyle(page.style), box: {}, children: [area] }]
    }),
  }
}

/**
 * Each note page's area and notes, measured, back on the page before it: the
 * area with its own children, the notes at the top left (a cut reads a
 * text's top).
 */
export const foldNotes = (root: MeasuredDocument): MeasuredDocument => {
  if (!root.children.some(page => typeof page.props[NOTE_PAGE_PROP] === 'number')) return root
  const pages: WithNotes<MeasuredNode>[] = []
  for (const page of root.children) {
    const own = page.props[NOTE_PAGE_PROP]
    if (typeof own !== 'number') {
      pages.push(page)
      continue
    }
    const area = page.children.find(child => child.type !== PDF_PRIMITIVES.TextInstance)!
    const children = area.children.filter(child => child.type !== PDF_PRIMITIVES.TextInstance)
    const notes = children.slice(own).map(note => ({ ...note, box: { ...note.box, top: 0, left: 0 } }))
    pages[pages.length - 1] = { ...pages.at(-1)!, noteArea: { ...area, children: children.slice(0, own) }, notes }
  }
  return { ...root, children: pages }
}
