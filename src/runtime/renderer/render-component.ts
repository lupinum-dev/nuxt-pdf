import {
  createRenderer,
  createVNode,
  defineComponent,
  nextTick,
  reactive,
  shallowRef,
  type Component,
} from 'vue'
import { PDF_PAGE_NUMBERS_KEY } from '../composables/use-pdf-page-numbers'
import {
  PdfCircle,
  PdfClipPath,
  PdfDefs,
  PdfDocument,
  PdfEllipse,
  PdfG,
  PdfImage,
  PdfLine,
  PdfLinearGradient,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfPath,
  PdfPolygon,
  PdfPolyline,
  PdfRadialGradient,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
  PdfTspan,
  PdfView,
} from '../components'
import {
  createPdfNodeOps,
  createPdfRoot,
  type PdfRendererWarning,
} from './node-ops'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import {
  PDF_PRIMITIVES,
  type PdfDocumentNode,
  type PdfHostElement,
  type PdfHostNode,
  type PdfRoot,
} from './types'
import { validatePdfDocumentTree } from './validate-tree'

const PDF_COMPONENTS = {
  PdfCircle,
  PdfClipPath,
  PdfDefs,
  PdfDocument,
  PdfEllipse,
  PdfG,
  PdfImage,
  PdfLine,
  PdfLinearGradient,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfPath,
  PdfPolygon,
  PdfPolyline,
  PdfRadialGradient,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
  PdfTspan,
  PdfView,
}

export type PdfComponentProps = Record<string, unknown>

export type MountedPdfComponent = {
  readonly document: PdfDocumentNode
  readonly root: PdfRoot
  /** Whether `usePdfPageNumbers()` was called during mount (flags multi-pass). */
  readonly usesPageNumbers: boolean
  update(props: PdfComponentProps): Promise<PdfDocumentNode>
  /** Push a destination `id → page` map into the live tree for the next layout. */
  feedPageNumbers(pages: Record<string, number>): Promise<PdfDocumentNode>
  unmount(): void
}

const requireDocument = (root: PdfRoot): PdfDocumentNode => {
  if (root.document?.type !== PDF_PRIMITIVES.Document) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      'A PDF component must render exactly one PdfDocument at its root.',
    )
  }

  validatePdfDocumentTree(root.document)
  return root.document
}

export const mountPdfComponent = async (
  component: Component,
  initialProps: PdfComponentProps = {},
  warn?: PdfRendererWarning,
): Promise<MountedPdfComponent> => {
  const renderer = createRenderer<PdfHostNode, PdfHostElement>(
    createPdfNodeOps(warn),
  )
  const root = createPdfRoot()
  const currentProps = shallowRef(initialProps)
  const RootComponent = defineComponent({
    name: 'NuxtPdfRenderRoot',
    setup: () => () => createVNode(component, currentProps.value),
  })

  const app = renderer.createApp(RootComponent)

  for (const [name, primitive] of Object.entries(PDF_COMPONENTS)) {
    app.component(name, primitive)
  }

  // Back `usePdfPageNumbers()` with a reactive map the render loop feeds each
  // pass. Injecting it (during setup) flips `pageNumbersUsed`, which the render
  // path reads to decide between the single-pass and multi-pass pipelines.
  const pageNumbers = reactive<Record<string, number | undefined>>({})
  let pageNumbersUsed = false
  app.provide(PDF_PAGE_NUMBERS_KEY, {
    pages: pageNumbers,
    markUsed: () => {
      pageNumbersUsed = true
    },
  })

  let mounted = false
  try {
    app.mount(root)
    mounted = true
    await nextTick()
    requireDocument(root)
  }
  catch (error) {
    // Tree-wide validation runs after Vue has mounted. Tear that application
    // down before surfacing an invalid document so failed renders retain no
    // reactive effects or component state.
    if (mounted) app.unmount()
    throw error
  }

  return {
    get document() {
      return requireDocument(root)
    },
    root,
    get usesPageNumbers() {
      return pageNumbersUsed
    },
    async update(props) {
      currentProps.value = props
      await nextTick()
      return requireDocument(root)
    },
    async feedPageNumbers(pages) {
      for (const key of Object.keys(pageNumbers)) {
        if (!(key in pages)) Reflect.deleteProperty(pageNumbers, key)
      }
      Object.assign(pageNumbers, pages)
      await nextTick()
      return requireDocument(root)
    },
    unmount() {
      app.unmount()
    },
  }
}
