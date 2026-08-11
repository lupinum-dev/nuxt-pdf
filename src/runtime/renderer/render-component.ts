import {
  createRenderer,
  createVNode,
  defineComponent,
  getCurrentInstance,
  nextTick,
  reactive,
  shallowRef,
  type Component,
} from 'vue'
import { PDF_PAGE_NUMBERS_KEY } from '../composables/use-pdf-page-numbers'
import { PDF_PRIMITIVES } from '../authoring'
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
} from './node-ops'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type {
  PdfDocumentNode,
  PdfHostElement,
  PdfHostNode,
  PdfRoot,
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

const ASYNC_AUTHORING_ERROR
  = 'Async setup and async components are not supported in PDF templates. Load request data before render(props) and pass it through typed props.'

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
): Promise<MountedPdfComponent> => {
  let hasRenderError = false
  let renderError: unknown
  const recordRenderError = (error: unknown) => {
    if (hasRenderError) return
    hasRenderError = true
    renderError = error
  }
  const resetRenderError = () => {
    hasRenderError = false
    renderError = undefined
  }
  const throwRenderError = () => {
    if (!hasRenderError) return
    const error = renderError
    resetRenderError()
    throw error
  }
  const renderer = createRenderer<PdfHostNode, PdfHostElement>(
    createPdfNodeOps(recordRenderError),
  )
  const root = createPdfRoot()
  const currentProps = shallowRef(initialProps)
  const RootComponent = defineComponent({
    name: 'NuxtPdfRenderRoot',
    setup: () => () => createVNode(component, currentProps.value),
  })

  const app = renderer.createApp(RootComponent)
  app.mixin({
    beforeCreate() {
      const type = getCurrentInstance()?.type
      if (typeof type !== 'object' || type === null) return

      const candidate = type as Record<string, unknown>
      const setup = candidate.setup
      if (
        '__asyncLoader' in candidate
        || (typeof setup === 'function' && setup.constructor.name === 'AsyncFunction')
      ) {
        recordRenderError(new NuxtPdfError(
          PDF_ERROR_CODES.TemplateInvalid,
          ASYNC_AUTHORING_ERROR,
        ))
      }
    },
  })
  // A PDF is an all-or-nothing artifact. Vue's default production behavior logs
  // component errors and continues rendering, which can otherwise return a
  // successful document with missing content.
  app.config.errorHandler = recordRenderError
  app.config.throwUnhandledErrorInProduction = true
  app.config.warnHandler = message => recordRenderError(new NuxtPdfError(
    PDF_ERROR_CODES.TemplateInvalid,
    message.includes('async setup()')
      ? ASYNC_AUTHORING_ERROR
      : `Vue reported an invalid PDF authoring pattern: ${message}`,
  ))

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
  const dispose = (surfaceCleanupError: boolean) => {
    if (!mounted) return
    resetRenderError()
    try {
      app.unmount()
      if (surfaceCleanupError) throwRenderError()
    }
    finally {
      mounted = false
    }
  }
  const fail = (error: unknown): never => {
    try {
      dispose(false)
    }
    catch {
      // Preserve the render failure. Cleanup errors must not replace the cause
      // that made the document invalid.
    }
    throw error
  }
  const requireSuccessfulDocument = (): PdfDocumentNode => {
    throwRenderError()
    return requireDocument(root)
  }
  const updateDocument = async (
    mutate: () => void,
  ): Promise<PdfDocumentNode> => {
    resetRenderError()
    try {
      mutate()
      await nextTick()
      return requireSuccessfulDocument()
    }
    catch (error) {
      return fail(error)
    }
  }

  try {
    app.mount(root)
    mounted = true
    await nextTick()
    requireSuccessfulDocument()
  }
  catch (error) {
    // Tree-wide validation runs after Vue has mounted. Tear that application
    // down before surfacing an invalid document so failed renders retain no
    // reactive effects or component state.
    return fail(error)
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
      return updateDocument(() => {
        currentProps.value = props
      })
    },
    async feedPageNumbers(pages) {
      return updateDocument(() => {
        for (const key of Object.keys(pageNumbers)) {
          if (!(key in pages)) Reflect.deleteProperty(pageNumbers, key)
        }
        Object.assign(pageNumbers, pages)
      })
    },
    unmount() {
      dispose(true)
    },
  }
}
