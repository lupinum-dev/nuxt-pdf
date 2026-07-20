import {
  createRenderer,
  createVNode,
  defineComponent,
  nextTick,
  shallowRef,
  type Component,
} from 'vue'
import { createPdfNodeOps, createPdfRoot } from './node-ops'
import {
  PDF_PRIMITIVES,
  type PdfDocumentNode,
  type PdfHostElement,
  type PdfHostNode,
  type PdfRoot,
} from './types'

const renderer = createRenderer<PdfHostNode, PdfHostElement>(createPdfNodeOps())

export type PdfComponentProps = Record<string, unknown>

export type MountedPdfComponent = {
  readonly document: PdfDocumentNode
  readonly root: PdfRoot
  update(props: PdfComponentProps): Promise<PdfDocumentNode>
  unmount(): void
}

const requireDocument = (root: PdfRoot): PdfDocumentNode => {
  if (root.document?.type !== PDF_PRIMITIVES.Document) {
    throw new TypeError(
      'A PDF component must render exactly one PdfDocument at its root.',
    )
  }

  return root.document
}

export const mountPdfComponent = async (
  component: Component,
  initialProps: PdfComponentProps = {},
): Promise<MountedPdfComponent> => {
  const root = createPdfRoot()
  const currentProps = shallowRef(initialProps)
  const RootComponent = defineComponent({
    name: 'NuxtPdfRenderRoot',
    setup: () => () => createVNode(component, currentProps.value),
  })

  renderer.render(createVNode(RootComponent), root)
  await nextTick()
  requireDocument(root)

  return {
    get document() {
      return requireDocument(root)
    },
    root,
    async update(props) {
      currentProps.value = props
      await nextTick()
      return requireDocument(root)
    },
    unmount() {
      renderer.render(null, root)
    },
  }
}
