import type { Component } from 'vue'
import { PDF_ELEMENTS, PDF_PRIMITIVES } from '../primitives'
import { mountPdfComponent, type PdfDocumentNode, type PdfElementNode } from '../renderer'
import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../shared/errors'
import {
  PDF_COMPILE_ERROR_PROPERTY,
  pdfCompileErrorOf,
  pdfDefinitionSourceOf,
  type PdfCompileErrorInfo,
} from '../shared/compile-error'
import {
  PDF_DEFINITION_KEYS,
  PDF_DEFINITION_PROPERTY,
  type PdfComponent,
  type PdfDefinition,
  type PdfImageWarning,
  type PdfRenderResult,
  type PdfRichTextWarning,
  type PdfTemplate,
  type ResolvedPdfMetadata,
} from '../shared/template'
import type { PdfImageAssetMap } from './assets/local-image'
import { resolvePdfImageAssets } from './assets/resolve-images'
import type { RemoteAssetPolicy } from './assets/remote'
import { admitPdfAttachments } from './attachments'
import {
  createRenderLimits,
  enforceTreeLimits,
  type RenderLimits,
  type PdfRenderLimits,
  resolvePdfRenderLimits,
} from './render-limits'
import type { BundledPdfFontDescriptor } from '../fonts'
import { createPdfRenderResult } from './result'
import { collectRichTextWarnings } from './rich-text-warnings'
import { renderPlainTree } from './worker-render'
import type { PlainRenderOutput } from './engine/worker-protocol'

export type {
  PdfImageWarning,
  PdfLayoutWarning,
  PdfRenderDiagnostics,
} from '../shared/template'

const EMPTY_SCENARIOS: Readonly<Record<string, never>> = Object.freeze({})
const EMPTY_ASSETS = Object.freeze({})

export interface PdfTemplateRuntimeOptions {
  assets?: PdfImageAssetMap
  file?: string
  fonts?: readonly BundledPdfFontDescriptor[]
  remote?: RemoteAssetPolicy
  /**
   * Render limits (time budget + page cap). Absent means the generous built-in
   * defaults apply, so every render is bounded even with no `pdf.limits` config.
   */
  limits?: PdfRenderLimits
}

type PdfTemplateIdentity = Pick<PdfTemplate<object>, 'key' | 'render'>

export type PdfRegistryEntries = Readonly<
  Record<string, PdfTemplateIdentity>
>

export interface PdfRegistry<
  Entries extends PdfRegistryEntries = PdfRegistryEntries,
> {
  readonly pdf: Readonly<Entries>
  readonly pdfTemplateKeys: readonly string[]
  getPdfTemplate(key: string): Entries[keyof Entries] | undefined
  renderPdf(key: string, props: object): Promise<PdfRenderResult>
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface TemplateRef {
  readonly key: string
  readonly file?: string
}

const templateError = (
  ref: TemplateRef,
  message: string,
  cause?: unknown,
) => new NuxtPdfError(
  PDF_ERROR_CODES.TemplateInvalid,
  `Invalid ${templatePrefix(ref.key, ref.file)}: ${message}`,
  { cause, templateKey: ref.key, templateFile: ref.file },
)

const templatePrefix = (key: string, file?: string): string =>
  file === undefined
    ? `PDF template "${key}"`
    : `PDF template "${key}" (${file})`

// The single attribution boundary. Every failure surfaced from a template's
// render() passes through here and is stamped with the template key, the
// source file, and a prefixed message — unless templateError already
// attributed it, in which case it passes through untouched. The engine and
// renderer stay template-agnostic, so no other layer applies a prefix and
// nested re-wrapping cannot occur.
const enrichTemplateError = (
  error: unknown,
  key: string,
  file?: string,
): NuxtPdfError => {
  const prefix = templatePrefix(key, file)
  // A component that failed to compile in development (see compile-error.ts).
  const compileError = pdfCompileErrorOf(error)
  if (compileError) return compileFailure({ key, file }, compileError, error)

  if (error instanceof NuxtPdfError) {
    if (error.templateKey === key) return error

    return new NuxtPdfError(error.code, `${prefix}: ${error.message}`, {
      cause: error,
      templateKey: key,
      templateFile: file,
      source: error.source,
      issues: error.issues,
    })
  }

  return new NuxtPdfError(
    PDF_ERROR_CODES.RenderError,
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error, templateKey: key, templateFile: file },
  )
}

const compileFailure = (
  ref: TemplateRef,
  info: PdfCompileErrorInfo,
  cause: unknown,
): NuxtPdfError => new NuxtPdfError(
  PDF_ERROR_CODES.TemplateInvalid,
  `${templatePrefix(ref.key, ref.file)}: ${info.source.file}:${info.source.line}:${info.source.column} failed to compile: ${info.message}`,
  { cause, templateKey: ref.key, templateFile: ref.file, source: info.source },
)

// The development stub of a template that failed to compile: every call fails
// with the compiler message, and nothing is validated at registry load, so the
// other templates keep working.
const failedTemplate = <Props extends object>(
  ref: TemplateRef,
  info: PdfCompileErrorInfo,
): PdfTemplate<Props> => {
  // The cause carries the marker, so the preview shows the message and position.
  const cause = Object.assign(new Error(info.message), { [PDF_COMPILE_ERROR_PROPERTY]: info })
  const fail = (): never => {
    throw compileFailure(ref, info, cause)
  }
  const template: PdfTemplate<Props> = Object.freeze({
    key: ref.key,
    resolveMetadata: fail,
    render: async () => fail(),
  })
  return template
}

const MISSING_DEFINITION = 'definePdf metadata is missing. Add one top-level definePdf({...}) call.'
/** The `definePdf` keys that take a string or a function of the props. */
const FUNCTION_KEYS = Object.entries(PDF_DEFINITION_KEYS).filter(([, key]) => key.function).map(([name]) => name)

/** What is wrong with a `definePdf` definition, or `undefined` when it is valid. */
const definitionProblem = (definition: unknown): string | undefined => {
  if (!isObject(definition)) return MISSING_DEFINITION

  for (const field of FUNCTION_KEYS) {
    const value = definition[field]
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'function') {
      return `${field} must be a string or function.`
    }
  }

  if (definition.language !== undefined && typeof definition.language !== 'string') {
    return 'language must be a string.'
  }
  const maxPasses = definition.maxPasses
  if (
    maxPasses !== undefined
    && (typeof maxPasses !== 'number' || !Number.isInteger(maxPasses) || maxPasses < 1)
  ) {
    return 'maxPasses must be a positive integer.'
  }
  if (definition.sampleData !== undefined && !isObject(definition.sampleData)) {
    return 'sampleData must be an object.'
  }
  if (definition.scenarios !== undefined) {
    if (!isObject(definition.scenarios)) return 'scenarios must be an object.'

    for (const [name, props] of Object.entries(definition.scenarios)) {
      if (!name || !isObject(props)) return `scenario "${name}" must contain a props object.`
    }
  }

  return undefined
}

const validateDefinition = <Props extends object>(
  ref: TemplateRef,
  definition: PdfDefinition<Props> | undefined,
): PdfDefinition<Props> => {
  const problem = definitionProblem(definition)
  if (problem !== undefined || !definition) throw templateError(ref, problem ?? MISSING_DEFINITION)
  return definition
}

/**
 * Development: the stub of a template that failed to compile, or of one whose
 * `definePdf` metadata fails validation. A development build marks where
 * `definePdf` is (compile-error.ts), so the invalid value fails that one
 * template at its position instead of the whole registry. Production and
 * standalone builds carry no mark and fail at registry load.
 */
const developmentFailureOf = (component: Component): PdfCompileErrorInfo | undefined => {
  const compileError = pdfCompileErrorOf(component)
  if (compileError) return compileError
  const source = pdfDefinitionSourceOf(component)
  if (!source) return undefined
  const message = definitionProblem((component as PdfComponent<object>)[PDF_DEFINITION_PROPERTY])
  return message === undefined ? undefined : { message, source }
}

const resolveMetadataValue = <Props extends object>(
  ref: TemplateRef,
  field: 'filename' | 'title',
  value: PdfDefinition<Props>[typeof field],
  props: Props,
): string | undefined => {
  let resolved: unknown
  try {
    resolved = typeof value === 'function' ? value(props) : value
  }
  catch (error) {
    throw templateError(ref, `${field} metadata could not be evaluated.`, error)
  }

  if (resolved !== undefined && typeof resolved !== 'string') {
    throw templateError(ref, `${field} metadata must resolve to a string.`)
  }

  return resolved
}

const resolveMetadata = <Props extends object>(
  ref: TemplateRef,
  definition: PdfDefinition<Props>,
  props: Props,
): ResolvedPdfMetadata => ({
  title: resolveMetadataValue(ref, 'title', definition.title, props),
  filename: resolveMetadataValue(ref, 'filename', definition.filename, props),
  language: definition.language,
})

interface TemplateRenderOutput extends PlainRenderOutput {
  imageWarnings: PdfImageWarning[]
  richTextWarnings: PdfRichTextWarning[]
  metadata: ResolvedPdfMetadata
}

const completedMetadata = (
  document: PdfDocumentNode,
  definition: ResolvedPdfMetadata,
): ResolvedPdfMetadata => ({
  filename: definition.filename,
  language: typeof document.props.language === 'string'
    ? document.props.language
    : undefined,
  title: typeof document.props.title === 'string'
    ? document.props.title
    : undefined,
})

// Mount, take, admit and hand off. The main thread mounts the Vue template
// once and takes the tree: flushed, validated and with the Vue application
// stopped, so no later re-render (a timer in setup, say) can change it after
// the checks below. It then checks the tree limits and
// resolves images. The admitted tree is plain data; `renderPlainTree` lays it
// out and serializes it in a worker (or in-process, see worker-render.ts).
// Page references are resolved by the engine adapter's own loop, not by Vue.
// Preview "Layout boxes": switch on the engine's `debug` prop for every page
// flow node that accepts it. SVG content is not page flow, so the walk stops
// at `PdfSvg`.
const markLayoutBoxes = (node: PdfElementNode): void => {
  if (node.type === PDF_PRIMITIVES.Svg) return
  if (Object.hasOwn(PDF_ELEMENTS[node.type].props, 'debug')) node.props.debug = true
  for (const child of node.children) {
    if (child.type !== PDF_PRIMITIVES.TextInstance) markLayoutBoxes(child)
  }
}

const renderTemplate = async <Props extends object>(
  component: Component,
  props: Props,
  metadata: ResolvedPdfMetadata,
  options: PdfTemplateRuntimeOptions,
  maxPasses: number | undefined,
  limits: RenderLimits,
  layoutBoxes: boolean,
): Promise<TemplateRenderOutput> => {
  // The `definePdf` title and language are set on the document before each
  // validation, so the tagged checks see them.
  const mounted = await mountPdfComponent(
    component,
    props as Record<string, unknown>,
    { title: metadata.title, language: metadata.language },
  )
  try {
    // Synchronous, before the first await below.
    const document = mounted.take()
    enforceTreeLimits(document, limits)
    admitPdfAttachments(document, limits)
    if (layoutBoxes) markLayoutBoxes(document)
    const richTextWarnings = collectRichTextWarnings(document)
    const { warnings: imageWarnings } = await resolvePdfImageAssets(document, {
      assets: options.assets ?? EMPTY_ASSETS,
      limits,
      remote: options.remote,
    })
    const output = await renderPlainTree(document, {
      fonts: options.fonts,
      limits,
      maxPasses,
    })
    return { ...output, imageWarnings, richTextWarnings, metadata: completedMetadata(document, metadata) }
  }
  finally {
    mounted.unmount()
  }
}

// The layout-box render of each template handle. It is reachable only through
// `createPdfPreviewEntry`, which only the development registry calls, so the
// public handle and production renders never see the switch.
const layoutBoxRenders = new WeakMap<
  object,
  (props: object) => Promise<PdfRenderResult>
>()

export const createPdfTemplate = <Props extends object>(
  key: string,
  component: Component,
  options: PdfTemplateRuntimeOptions = {},
): PdfTemplate<Props> => {
  const ref: TemplateRef = { key, file: options.file }

  if (!key.trim()) {
    throw templateError(ref, 'template key must not be empty.')
  }

  const failure = developmentFailureOf(component)
  if (failure) return failedTemplate<Props>(ref, failure)

  const definition = validateDefinition(
    ref,
    (component as PdfComponent<Props>)[PDF_DEFINITION_PROPERTY],
  )

  const renderWithDiagnostics = async (
    props: Props,
    layoutBoxes: boolean,
  ): Promise<PdfRenderResult> => {
    if (!isObject(props)) {
      throw templateError(ref, 'render props must be an object.')
    }

    const start = performance.now()
    // The public render boundary owns the only deadline. It starts before
    // metadata evaluation so both timeoutMs and durationMs describe the same
    // completed operation.
    const limits = createRenderLimits(resolvePdfRenderLimits(options.limits))
    const definitionMetadata = resolveMetadata(ref, definition, props)
    const {
      bytes,
      imageWarnings,
      layoutWarnings,
      metadata,
      passes,
      pageCount,
      richTextWarnings,
    } = await renderTemplate(
      component,
      props,
      definitionMetadata,
      options,
      definition.maxPasses,
      limits,
      layoutBoxes,
    )
    const result = createPdfRenderResult(bytes, metadata, {
      durationMs: performance.now() - start,
      imageWarnings,
      layoutWarnings,
      pageCount,
      passes,
      richTextWarnings,
      registeredFontFaces: (options.fonts ?? []).map(font => ({
        family: font.family,
        fontStyle: font.fontStyle,
        fontWeight: font.fontWeight,
      })),
    })

    return result
  }

  const attributedRender = async (
    props: Props,
    layoutBoxes: boolean,
  ): Promise<PdfRenderResult> => {
    try {
      return await renderWithDiagnostics(props, layoutBoxes)
    }
    catch (error) {
      throw enrichTemplateError(error, key, options.file)
    }
  }

  const template: PdfTemplate<Props> = Object.freeze({
    key,
    resolveMetadata(props: Props) {
      if (!isObject(props)) {
        throw templateError(ref, 'metadata props must be an object.')
      }
      return resolveMetadata(ref, definition, props)
    },
    render: (props: Props) => attributedRender(props, false),
  })
  layoutBoxRenders.set(template, props => attributedRender(props as Props, true))
  return template
}

/**
 * Internal development-only information for the preview UI. It wraps the
 * production handle instead of extending it, so preview fixtures and source
 * paths cannot accidentally become part of the public template contract.
 */
export interface PdfPreviewEntry<
  Props extends object = Record<string, unknown>,
> {
  readonly template: PdfTemplate<Props>
  readonly file?: string
  /** Set when the template failed to compile in development. */
  readonly compileError?: PdfCompileErrorInfo
  readonly scenarioNames: readonly string[]
  /**
   * False when the component declares no props: the default preview then
   * needs no `sampleData`.
   */
  readonly declaresProps: boolean
  getPreviewProps(scenario?: string): Props | undefined
  /**
   * Render with the engine's debug box on every page flow node. A handle that
   * `createPdfTemplate` did not create renders normally.
   */
  renderWithLayoutBoxes(props: Props): Promise<PdfRenderResult>
}

export type PdfPreviewEntryOptions = Pick<PdfTemplateRuntimeOptions, 'file'>

export const createPdfPreviewEntry = <Props extends object>(
  template: PdfTemplate<Props>,
  component: Component,
  options: PdfPreviewEntryOptions = {},
): PdfPreviewEntry<Props> => {
  const ref: TemplateRef = { key: template.key, file: options.file }
  const compileError = developmentFailureOf(component)
  if (compileError) {
    // No preview data: the preview renders it with empty props to show the error.
    return Object.freeze({
      template,
      file: options.file,
      compileError,
      scenarioNames: Object.freeze([]),
      declaresProps: false,
      getPreviewProps: () => undefined,
      renderWithLayoutBoxes: (props: Props) => template.render(props),
    })
  }
  const definition = validateDefinition(
    ref,
    (component as PdfComponent<Props>)[PDF_DEFINITION_PROPERTY],
  )
  const scenarios: Readonly<Record<string, Props>>
    = definition.scenarios ?? EMPTY_SCENARIOS
  const scenarioNames = Object.freeze(Object.keys(scenarios).sort())
  // Vue keeps declared props as an array of names or an object of options.
  const declaredProps = typeof component === 'object' && 'props' in component
    ? component.props
    : undefined
  const declaresProps = declaredProps != null && Object.keys(declaredProps).length > 0

  return Object.freeze({
    template,
    file: options.file,
    scenarioNames,
    declaresProps,
    getPreviewProps(scenario?: string) {
      if (scenario === undefined) return definition.sampleData
      if (!Object.prototype.hasOwnProperty.call(scenarios, scenario)) {
        return undefined
      }
      return scenarios[scenario]
    },
    renderWithLayoutBoxes(props: Props) {
      const render = layoutBoxRenders.get(template)
      return render ? render(props) : template.render(props)
    },
  })
}

export const createPdfRegistry = <
  const Entries extends Record<string, PdfTemplateIdentity>,
>(entries: Entries): PdfRegistry<Entries> => {
  for (const [key, template] of Object.entries(entries)) {
    if (!template?.key) {
      throw new TypeError(`PDF registry entry "${key}" is invalid.`)
    }
    if (template.key !== key) {
      throw new TypeError(
        `PDF registry entry "${key}" must use the same key as createPdfTemplate ("${template.key}").`,
      )
    }
  }

  const pdf = Object.freeze(entries)
  const pdfTemplateKeys = Object.freeze(Object.keys(pdf))

  const getTemplate = (key: string): Entries[keyof Entries] | undefined =>
    Object.hasOwn(pdf, key) ? pdf[key as keyof Entries] : undefined

  return Object.freeze({
    pdf,
    pdfTemplateKeys,
    getPdfTemplate: getTemplate,
    async renderPdf(key: string, props: object) {
      const template = getTemplate(key)
      if (!template) {
        throw new NuxtPdfError(
          PDF_ERROR_CODES.TemplateNotFound,
          `PDF template "${key}" was not found.`,
          { templateKey: key },
        )
      }

      return template.render(props)
    },
  })
}
