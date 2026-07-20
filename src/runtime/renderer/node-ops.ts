import type { RendererOptions } from 'vue'
import { patchPdfProp } from './patch-prop'
import {
  PDF_COMMENT,
  PDF_PRIMITIVES,
  isPdfCommentNode,
  isPdfElementNode,
  isPdfElementType,
  isPdfTextInstance,
  type PdfCommentNode,
  type PdfDocumentNode,
  type PdfElementNode,
  type PdfHostElement,
  type PdfHostNode,
  type PdfNode,
  type PdfRoot,
  type PdfTextInstance,
} from './types'

const TEXT_CONTAINERS = new Set<string>([
  PDF_PRIMITIVES.Text,
  PDF_PRIMITIVES.Link,
  PDF_PRIMITIVES.Tspan,
  PDF_PRIMITIVES.Note,
])

export type PdfRendererWarning = (message: string) => void

export const createPdfRoot = (): PdfRoot => ({
  type: 'ROOT',
  document: null,
})

export const createPdfNodeOps = (
  warn: PdfRendererWarning = message => console.warn(message),
): RendererOptions<PdfHostNode, PdfHostElement> => {
  const childOrder = new WeakMap<PdfHostElement, PdfHostNode[]>()
  const parents = new WeakMap<PdfHostNode, PdfHostElement>()
  const warnedOrphans = new WeakSet<PdfTextInstance>()

  const childrenOf = (parent: PdfHostElement): PdfHostNode[] => {
    let children = childOrder.get(parent)

    if (!children) {
      children = []
      childOrder.set(parent, children)
    }

    return children
  }

  const warnAboutOrphan = (node: PdfTextInstance) => {
    if (node.value === '' || warnedOrphans.has(node)) return

    warnedOrphans.add(node)
    warn(`Invalid '${node.value}' string child outside <PdfText>.`)
  }

  const syncRoot = (root: PdfRoot, children: PdfHostNode[]) => {
    const elements = children.filter(isPdfElementNode)

    for (const child of children) {
      if (isPdfTextInstance(child)) warnAboutOrphan(child)
    }

    if (elements.length === 0) {
      root.document = null
      return
    }

    if (
      elements.length !== 1
      || elements[0]?.type !== PDF_PRIMITIVES.Document
    ) {
      throw new TypeError(
        'A PDF component must render exactly one PdfDocument at its root.',
      )
    }

    root.document = elements[0] as PdfDocumentNode
  }

  const syncElement = (element: PdfElementNode, children: PdfHostNode[]) => {
    const acceptsText = TEXT_CONTAINERS.has(element.type)
    const pdfChildren: PdfNode[] = []

    for (const child of children) {
      if (isPdfCommentNode(child)) continue

      if (isPdfTextInstance(child)) {
        if (child.value === '') continue

        if (!acceptsText) {
          warnAboutOrphan(child)
          continue
        }
      }

      pdfChildren.push(child)
    }

    element.children.splice(0, element.children.length, ...pdfChildren)
  }

  const sync = (parent: PdfHostElement) => {
    const children = childrenOf(parent)

    if (parent.type === 'ROOT') syncRoot(parent, children)
    else syncElement(parent, children)
  }

  const detach = (child: PdfHostNode) => {
    const parent = parents.get(child)
    if (!parent) return

    const siblings = childrenOf(parent)
    const index = siblings.indexOf(child)

    if (index !== -1) siblings.splice(index, 1)

    parents.delete(child)
    sync(parent)
  }

  const insert = (
    child: PdfHostNode,
    parent: PdfHostElement,
    anchor: PdfHostNode | null = null,
  ) => {
    if (child === anchor) return

    detach(child)

    const siblings = childrenOf(parent)
    const index = anchor == null ? siblings.length : siblings.indexOf(anchor)

    if (index === -1) {
      throw new TypeError('Cannot insert a PDF node before an unknown anchor.')
    }

    siblings.splice(index, 0, child)
    parents.set(child, parent)

    try {
      sync(parent)
    }
    catch (error) {
      siblings.splice(index, 1)
      parents.delete(child)
      sync(parent)
      throw error
    }
  }

  const remove = (child: PdfHostNode) => {
    detach(child)
  }

  const createElement = (type: string): PdfElementNode => {
    if (!isPdfElementType(type)) {
      throw new TypeError(`Unknown PDF primitive "${type}".`)
    }

    const element: PdfElementNode = {
      type,
      box: {},
      style: {},
      props: {},
      children: [],
    }

    childOrder.set(element, [])
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
      throw new TypeError('Cannot set text directly on a PDF element node.')
    }

    node.value = text

    const parent = parents.get(node)
    if (parent) sync(parent)
  }

  const setElementText = (element: PdfHostElement, text: string) => {
    const children = childrenOf(element)

    if (
      children.length === 1
      && isPdfTextInstance(children[0]!)
      && text !== ''
    ) {
      children[0]!.value = text
      sync(element)
      return
    }

    for (const child of children) parents.delete(child)
    children.length = 0

    if (text !== '') {
      const textNode = createText(text)
      children.push(textNode)
      parents.set(textNode, element)
    }

    sync(element)
  }

  const parentNode = (node: PdfHostNode): PdfHostElement | null =>
    parents.get(node) ?? null

  const nextSibling = (node: PdfHostNode): PdfHostNode | null => {
    const parent = parents.get(node)
    if (!parent) return null

    const siblings = childrenOf(parent)
    const index = siblings.indexOf(node)
    return index === -1 ? null : siblings[index + 1] ?? null
  }

  return {
    patchProp: patchPdfProp,
    insert,
    remove,
    createElement,
    createText,
    createComment,
    setText,
    setElementText,
    parentNode,
    nextSibling,
  }
}
