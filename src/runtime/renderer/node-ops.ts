import type { RendererOptions } from 'vue'
import {
  PDF_ELEMENTS,
  PDF_PAGE_TOKENS,
  PDF_PRIMITIVES,
  isPdfElementType,
  type PdfElementType,
} from '../primitives'
import { NuxtPdfError, PDF_ERROR_CODES, treeInvalid, withPdfSource } from '../shared/errors'
import { isPdfLibraryComponentName, PDF_COMPONENT_PROP, PDF_RICH_IMAGE_PROP, pdfRichImageMark } from '../component-names'
import { PDF_SOURCE_PROP } from '../shared/template'
import { patchPdfProp } from './patch-prop'
import {
  PDF_COMMENT,
  isPdfCommentNode,
  isPdfElementNode,
  isPdfTextInstance,
  pdfElementName,
  type PdfCommentNode,
  type PdfDocumentNode,
  type PdfElementNode,
  type PdfHostElement,
  type PdfHostNode,
  type PdfNode,
  type PdfRoot,
  type PdfTextInstance,
} from './types'

export const createPdfRoot = (): PdfRoot => ({
  type: 'ROOT',
  document: null,
})

export type PdfHostErrorHandler = (error: unknown) => void

export type PdfNodeOps = RendererOptions<PdfHostNode, PdfHostElement> & {
  /**
   * Rebuild `children` (and `root.document`) for every element whose host
   * children changed since the last call. Nesting is checked earlier, when a
   * node enters a parent, so this never throws.
   */
  flush(): void
}

const sourceOf = (element: PdfHostElement): string | undefined =>
  element.type === 'ROOT' ? undefined : element.source

const throwHostError: PdfHostErrorHandler = (error) => {
  throw error
}

type HostLink = {
  parent: PdfHostElement
  previous: PdfHostNode | null
  next: PdfHostNode | null
}

type HostEnds = {
  first: PdfHostNode | null
  last: PdfHostNode | null
}

// Host children (elements, text, and Vue's comment/fragment anchors) live in a
// doubly linked list per parent, so insert, remove, and nextSibling cost O(1).
// An element's `children` array — what layout reads — is derived from that list
// once per renderer flush instead of once per insert, which keeps mounting
// linear in the number of siblings.
export const createPdfNodeOps = (
  onError: PdfHostErrorHandler = throwHostError,
): PdfNodeOps => {
  const links = new WeakMap<PdfHostNode, HostLink>()
  const ends = new WeakMap<PdfHostElement, HostEnds>()
  const dirty = new Set<PdfHostElement>()

  const endsOf = (parent: PdfHostElement): HostEnds => {
    let parentEnds = ends.get(parent)

    if (!parentEnds) {
      parentEnds = { first: null, last: null }
      ends.set(parent, parentEnds)
    }

    return parentEnds
  }

  function* hostChildren(parent: PdfHostElement): Generator<PdfHostNode> {
    let child = endsOf(parent).first

    while (child) {
      yield child
      child = links.get(child)?.next ?? null
    }
  }

  const rejectOrphanText = (parent?: PdfElementNode): never => {
    // A leaf (an image, an SVG shape, a page token) holds nothing, so wrapping
    // the text would not help.
    const message = !parent
      ? 'A PDF component root cannot contain text outside <PdfDocument>.'
      : PDF_ELEMENTS[parent.type].children.size === 0
        ? `<${pdfElementName(parent)}> cannot contain text.`
        : `<${pdfElementName(parent)}> cannot contain text. Wrap it in <PdfText>.`

    return treeInvalid(message)
  }

  // Vue inserts a link's children before the link itself, so whether the link
  // sits in a PdfText is unknown here; the link hint covers both cases. A link
  // that holds a text cannot be inside another text.
  // The engine prints page tokens only directly inside a PdfText. A token in
  // a container gets a hint for the removed render-prop pattern; temporary,
  // listed in internals/migrations.md.
  const pageTokenHint = (parent: PdfElementNode, child: PdfElementNode): string => {
    if (!PDF_PAGE_TOKENS.has(child.type)) return ''
    if (parent.type === PDF_PRIMITIVES.Link) {
      return ` Wrap it in <PdfText>. Keep that <PdfLink> outside any other text: <PdfLink><PdfText>… <${pdfElementName(child)} /></PdfText></PdfLink>.`
    }
    return PDF_ELEMENTS[parent.type].children.has(PDF_PRIMITIVES.Text) ? ' Put it inside a <PdfText>.' : ''
  }

  // A footnote marks a place in the lines of a text; its own content is the note.
  const footnoteHint = (parent: PdfElementNode, child: PdfElementNode): string => {
    if (child.type !== PDF_PRIMITIVES.Footnote) return ''
    if (parent.type === PDF_PRIMITIVES.Footnote) return ' A footnote cannot hold another footnote: write the second note as its own <PdfFootnote> in the text.'
    if (parent.type === PDF_PRIMITIVES.Link) return ' Its mark is a link to the note, and a link cannot hold a link: put the footnote in the <PdfText> next to the <PdfLink>.'
    return ' A footnote marks a place in a text: put it inside a <PdfText>.'
  }

  const rejectInvalidChild = (
    parent: PdfElementNode,
    child: PdfElementNode,
  ): never => treeInvalid(
    `Invalid PDF nesting: <${pdfElementName(parent)}> cannot contain <${pdfElementName(child)}>.${pageTokenHint(parent, child)}${footnoteHint(parent, child)}`,
  )

  const rejectRootChildren = (): never => treeInvalid('A PDF component must render exactly one PdfDocument at its root.')

  const checkText = (parent: PdfHostElement, text: string) => {
    if (text.trim() === '') return
    if (parent.type === 'ROOT') rejectOrphanText()
    else if (!PDF_ELEMENTS[parent.type].text) rejectOrphanText(parent)
  }

  // Nesting is checked when a node enters a parent, in mount order, and a
  // rejected node is never linked. This keeps the first recorded error and the
  // tree state identical to a per-insert rebuild; only the `children` arrays
  // are derived later, in `flush`. Each check is O(1) except at the root, which
  // holds one element in a valid tree.
  const checkChild = (parent: PdfHostElement, child: PdfHostNode) => {
    if (isPdfCommentNode(child)) return

    if (parent.type === 'ROOT') {
      if (isPdfTextInstance(child)) {
        checkText(parent, child.value)
        return
      }
      if (child.type !== PDF_PRIMITIVES.Document) rejectRootChildren()
      for (const sibling of hostChildren(parent)) {
        if (sibling !== child && isPdfElementNode(sibling)) rejectRootChildren()
      }
      return
    }

    if (isPdfTextInstance(child)) {
      checkText(parent, child.value)
      return
    }
    if (!PDF_ELEMENTS[parent.type].children.has(child.type)) {
      rejectInvalidChild(parent, child)
    }
  }

  const syncRoot = (root: PdfRoot) => {
    let document: PdfDocumentNode | null = null

    for (const child of hostChildren(root)) {
      if (isPdfElementNode(child)) document = child as PdfDocumentNode
    }

    root.document = document
  }

  const syncElement = (element: PdfElementNode) => {
    const acceptsText = PDF_ELEMENTS[element.type].text
    const pdfChildren: PdfNode[] = []

    for (const child of hostChildren(element)) {
      if (isPdfCommentNode(child)) continue
      // Whitespace between elements of a container that holds no text.
      if (isPdfTextInstance(child) && !acceptsText) continue
      pdfChildren.push(child)
    }

    element.children = pdfChildren
  }

  const flush = () => {
    for (const parent of dirty) {
      if (parent.type === 'ROOT') syncRoot(parent)
      else syncElement(parent)
    }

    dirty.clear()
  }

  const detach = (child: PdfHostNode) => {
    const link = links.get(child)
    if (!link) return

    const parentEnds = endsOf(link.parent)

    if (link.previous) links.get(link.previous)!.next = link.next
    else parentEnds.first = link.next

    if (link.next) links.get(link.next)!.previous = link.previous
    else parentEnds.last = link.previous

    links.delete(child)
    dirty.add(link.parent)
  }

  const append = (child: PdfHostNode, parent: PdfHostElement) => {
    const parentEnds = endsOf(parent)
    const previous = parentEnds.last

    links.set(child, { parent, previous, next: null })
    if (previous) links.get(previous)!.next = child
    else parentEnds.first = child
    parentEnds.last = child
  }

  const insert = (
    child: PdfHostNode,
    parent: PdfHostElement,
    anchor: PdfHostNode | null = null,
  ) => {
    if (child === anchor) return

    detach(child)

    try {
      checkChild(parent, child)
    }
    catch (error) {
      // An element is wrong where it is; text is wrong in its parent.
      onError(withPdfSource(error, isPdfElementNode(child) ? child.source : sourceOf(parent)))
      return
    }

    if (anchor == null) {
      append(child, parent)
    }
    else {
      const anchorLink = links.get(anchor)

      if (anchorLink?.parent !== parent) {
        // Not reachable from templates: Vue's anchor is always a node it inserted into this parent.
        onError(new TypeError('Cannot insert a PDF node before an unknown anchor.'))
        return
      }

      const previous = anchorLink.previous
      links.set(child, { parent, previous, next: anchor })
      anchorLink.previous = child
      if (previous) links.get(previous)!.next = child
      else endsOf(parent).first = child
    }

    dirty.add(parent)
  }

  const remove = (child: PdfHostNode) => {
    detach(child)
  }

  // Vue mounts an element's children before it patches the element's props,
  // so the authored component name and the source position are read here: a
  // nesting or text error about a child can then name and locate the element.
  const createElement = (
    type: string,
    _namespace?: unknown,
    _is?: unknown,
    props?: Record<string, unknown> | null,
  ): PdfElementNode => {
    let elementType: PdfElementType
    if (!isPdfElementType(type)) {
      onError(new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, `Unknown PDF primitive "${type}".`))
      // Vue still needs a host element so it can finish mounting and dispose the
      // component scope. The recorded error prevents this placeholder from ever
      // reaching layout or becoming public output.
      elementType = PDF_PRIMITIVES.View
    }
    else elementType = type

    const element: PdfElementNode = {
      type: elementType,
      box: {},
      style: {},
      props: {},
      children: [],
    }
    const component = props?.[PDF_COMPONENT_PROP]
    if (isPdfLibraryComponentName(component)) element.component = component
    const richImage = pdfRichImageMark(props?.[PDF_RICH_IMAGE_PROP])
    if (richImage !== undefined) element.richImage = richImage
    const source = props?.[PDF_SOURCE_PROP]
    if (typeof source === 'string') element.source = source
    return element
  }

  const createText = (text: string): PdfTextInstance => ({
    type: PDF_PRIMITIVES.TextInstance,
    value: text,
  })

  const createComment = (text: string): PdfCommentNode => ({
    [PDF_COMMENT]: true,
    value: text,
  })

  const setText = (node: PdfHostNode, text: string) => {
    if (isPdfElementNode(node)) {
      // Not reachable from templates: Vue calls setText only on nodes from createText.
      onError(new TypeError('Cannot set text directly on a PDF element node.'))
      return
    }

    const parent = links.get(node)?.parent

    if (parent && isPdfTextInstance(node)) {
      try {
        checkText(parent, text)
      }
      catch (error) {
        onError(withPdfSource(error, sourceOf(parent)))
        return
      }
    }

    node.value = text
    if (parent) dirty.add(parent)
  }

  const setElementText = (element: PdfHostElement, text: string) => {
    try {
      checkText(element, text)
    }
    catch (error) {
      onError(withPdfSource(error, sourceOf(element)))
      return
    }

    const parentEnds = endsOf(element)
    const only = parentEnds.first

    if (
      only
      && only === parentEnds.last
      && isPdfTextInstance(only)
      && text !== ''
    ) {
      only.value = text
    }
    else {
      for (const child of [...hostChildren(element)]) links.delete(child)
      parentEnds.first = null
      parentEnds.last = null

      if (text !== '') append(createText(text), element)
    }

    dirty.add(element)
  }

  const parentNode = (node: PdfHostNode): PdfHostElement | null =>
    links.get(node)?.parent ?? null

  const nextSibling = (node: PdfHostNode): PdfHostNode | null =>
    links.get(node)?.next ?? null

  return {
    patchProp: (...args) => {
      try {
        patchPdfProp(...args)
      }
      catch (error) {
        onError(withPdfSource(error, sourceOf(args[0])))
      }
    },
    insert,
    remove,
    createElement,
    createText,
    createComment,
    setText,
    setElementText,
    parentNode,
    nextSibling,
    flush,
  }
}
