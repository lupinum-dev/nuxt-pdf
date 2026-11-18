import {
  createRenderer,
  createVNode,
  defineComponent,
  Fragment,
  getCurrentInstance,
  nextTick,
  type Component,
  type ConcreteComponent,
} from 'vue'
import { PDF_PRIMITIVES } from '../primitives'
import { PDF_COMPONENTS } from '../components'
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
import { resolvePdfClasses } from './classes'

export type PdfComponentProps = Record<string, unknown>

/**
 * Document values that win over the template's own `PdfDocument` props: the
 * resolved `definePdf` `title` and `language`. They are set before every
 * validation, so the tagged checks see the values the PDF will carry.
 */
export type PdfDocumentOverrides = {
  readonly title?: string
  readonly language?: string
}

export type MountedPdfComponent = {
  /** The current tree, flushed and validated. Vue may still change it. */
  readonly document: PdfDocumentNode
  readonly root: PdfRoot
  /**
   * Flush, validate and stop the application in one synchronous step. The
   * returned tree is final: no later Vue update can reach it, so checks and
   * admission done on it afterwards stay true.
   */
  take(): PdfDocumentNode
  unmount(): void
}

const ASYNC_AUTHORING_ERROR
  = 'Async setup and async components are not supported in PDF templates. Load request data before render(props) and pass it through typed props.'

/** The name an author knows a component by: its `name`, or the SFC file name. */
const componentName = (type: ConcreteComponent): string =>
  (typeof type === 'function' ? type.displayName ?? type.name : type.name ?? type.__name)
  || 'anonymous component'

const requireDocument = (root: PdfRoot, overrides: PdfDocumentOverrides): PdfDocumentNode => {
  if (root.document?.type !== PDF_PRIMITIVES.Document) {
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      'A PDF component must render exactly one PdfDocument at its root.',
    )
  }

  if (overrides.title !== undefined) root.document.props.title = overrides.title
  if (overrides.language !== undefined) root.document.props.language = overrides.language
  validatePdfDocumentTree(root.document)
  return root.document
}

export const mountPdfComponent = async (
  component: Component,
  initialProps: PdfComponentProps = {},
  overrides: PdfDocumentOverrides = {},
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
  const nodeOps = createPdfNodeOps(recordRenderError)
  const renderer = createRenderer<PdfHostNode, PdfHostElement>(nodeOps)
  const root = createPdfRoot()
  const RootComponent = defineComponent({
    name: 'NuxtPdfRenderRoot',
    setup: () => () => createVNode(component, initialProps),
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
  const recordWarning = (message: string) => recordRenderError(new NuxtPdfError(
    PDF_ERROR_CODES.TemplateInvalid,
    message.includes('async setup()')
      ? ASYNC_AUTHORING_ERROR
      : `Vue reported an invalid PDF authoring pattern: ${message}`,
  ))
  app.config.warnHandler = (message, instance) => {
    if (!instance || !('style' in instance.$attrs)) {
      recordWarning(message)
      return
    }
    // A compiled `class` reaches a component as a `style` attribute. With
    // several root elements Vue cannot choose one to pass it to, and the style
    // would be lost. Vue checks this before it stores the rendered root in
    // `subTree`, so look once the render has finished (before the mount's own
    // `nextTick` resolves).
    void nextTick(() => {
      if (instance.$.subTree.type === Fragment) {
        recordRenderError(new NuxtPdfError(
          PDF_ERROR_CODES.TreeInvalid,
          `A class on <${componentName(instance.$.type)}> needs a single root element in that component, or v-bind="$attrs" on one element.`,
        ))
      }
      else {
        recordWarning(message)
      }
    })
  }

  // Compiled `class` / `:class` bindings call this helper (see build/pdf-style.ts).
  app.config.globalProperties.$nuxtPdfClass = resolvePdfClasses

  for (const [name, primitive] of Object.entries(PDF_COMPONENTS)) {
    app.component(name, primitive)
  }

  let mounted = false
  const dispose = (surfaceCleanupError: boolean) => {
    if (!mounted) return
    resetRenderError()
    try {
      app.unmount()
      // Unmounting only removes host nodes; this flush clears `root.document`.
      nodeOps.flush()
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
    // After `take` or `unmount`, a flush would apply Vue's teardown to the
    // tree that was handed out.
    if (!mounted) throw new Error('This PDF component was already taken or unmounted.')
    throwRenderError()
    // Vue has finished this flush: derive every changed element's `children`
    // once, then validate the complete tree.
    nodeOps.flush()
    return requireDocument(root, overrides)
  }
  const take = (): PdfDocumentNode => {
    let document: PdfDocumentNode
    try {
      document = requireSuccessfulDocument()
    }
    catch (error) {
      return fail(error)
    }
    // Unmount without the flush `dispose` runs: Vue's teardown only unlinks
    // host nodes from the per-parent lists, and only a flush would copy that
    // into the `children` arrays. The taken tree keeps its last validated
    // shape, and with the effects stopped nothing patches its props again.
    resetRenderError()
    try {
      app.unmount()
      throwRenderError()
    }
    finally {
      mounted = false
    }
    return document
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
      return requireSuccessfulDocument()
    },
    root,
    take,
    unmount() {
      dispose(true)
    },
  }
}
