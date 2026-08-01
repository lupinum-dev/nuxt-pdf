import type { Component } from 'vue'
import { mountPdfComponent } from '../renderer'
import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../shared/errors'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfComponent,
  type PdfDefinition,
  type PdfRenderResult,
  type PdfTemplate,
  type ResolvedPdfMetadata,
} from '../shared/template'
import {
  createPdfImageResolutionState,
  resolvePdfImageAssets,
  type PdfImageAssetMap,
} from './assets/resolve-asset'
import type { RemoteAssetPolicy } from './assets/remote'
import { countPages, renderDocument } from './engine/render-document'
import { renderDocumentMultiPass } from './engine/layout-passes'
import {
  createRenderLimits,
  enforceTreeLimits,
  type RenderLimits,
  type PdfRenderLimits,
  resolvePdfRenderLimits,
} from './render-limits'
import type { BundledPdfFontDescriptor } from '../fonts'
import { createPdfFontStore } from './engine/fonts'
import { createPdfRenderResult } from './result'

export type { PdfRenderDiagnostics } from '../shared/template'

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

  if (error instanceof NuxtPdfError) {
    if (error.templateKey === key) return error

    return new NuxtPdfError(error.code, `${prefix}: ${error.message}`, {
      cause: error,
      templateKey: key,
      templateFile: file,
    })
  }

  return new NuxtPdfError(
    PDF_ERROR_CODES.RenderError,
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error, templateKey: key, templateFile: file },
  )
}

const validateDefinition = <Props extends object>(
  ref: TemplateRef,
  definition: PdfDefinition<Props> | undefined,
): PdfDefinition<Props> => {
  if (!isObject(definition)) {
    throw templateError(
      ref,
      'definePdf metadata is missing. Add one top-level definePdf({...}) call.',
    )
  }

  for (const field of ['title', 'filename'] as const) {
    const value = definition[field]
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'function') {
      throw templateError(ref, `${field} must be a string or function.`)
    }
  }

  if (definition.language !== undefined && typeof definition.language !== 'string') {
    throw templateError(ref, 'language must be a string.')
  }
  const maxPasses: unknown = definition.maxPasses
  if (
    maxPasses !== undefined
    && (typeof maxPasses !== 'number' || !Number.isInteger(maxPasses) || maxPasses < 1)
  ) {
    throw templateError(ref, 'maxPasses must be a positive integer.')
  }
  if (definition.sampleData !== undefined && !isObject(definition.sampleData)) {
    throw templateError(ref, 'sampleData must be an object.')
  }
  if (definition.scenarios !== undefined) {
    if (!isObject(definition.scenarios)) {
      throw templateError(ref, 'scenarios must be an object.')
    }

    for (const [name, props] of Object.entries(definition.scenarios)) {
      if (!name || !isObject(props)) {
        throw templateError(ref, `scenario "${name}" must contain a props object.`)
      }
    }
  }

  return definition
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

const applyDocumentMetadata = (
  document: Awaited<ReturnType<typeof mountPdfComponent>>['document'],
  metadata: ResolvedPdfMetadata,
) => {
  if (metadata.title !== undefined) document.props.title = metadata.title
  if (metadata.language !== undefined) document.props.language = metadata.language
}

interface TemplateRenderOutput {
  bytes: Uint8Array
  metadata: ResolvedPdfMetadata
  /** Layout passes actually run: 1 for the single-pass path, ≥ 2 for multi-pass. */
  passes: number
  pageCount: number
}

const completedMetadata = (
  document: Awaited<ReturnType<typeof mountPdfComponent>>['document'],
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

const renderTemplate = async <Props extends object>(
  component: Component,
  props: Props,
  metadata: ResolvedPdfMetadata,
  options: PdfTemplateRuntimeOptions,
  maxPasses: number | undefined,
  limits: RenderLimits,
): Promise<TemplateRenderOutput> => {
  let mounted: Awaited<ReturnType<typeof mountPdfComponent>> | undefined

  const imageState = createPdfImageResolutionState(limits)

  const admitDocument = async (
    document: Awaited<ReturnType<typeof mountPdfComponent>>['document'],
  ): Promise<void> => {
    enforceTreeLimits(document, limits)
    applyDocumentMetadata(document, metadata)
    await resolvePdfImageAssets(document, {
      assets: options.assets ?? EMPTY_ASSETS,
      limits,
      remote: options.remote,
      state: imageState,
    })
  }

  try {
    mounted = await mountPdfComponent(
      component,
      props as Record<string, unknown>,
    )
    const fontStore = createPdfFontStore(options.fonts)

    // Gate: only a template that reads `usePdfPageNumbers()` consumes resolved
    // page numbers, so only it runs the fixed-point layout loop. Internal `#id`
    // links resolve by NAME in a single pass (destinations are anchored at the
    // section's first page during serialization), so every other document —
    // links included — keeps exactly one layout pass.
    if (mounted.usesPageNumbers) {
      const live = mounted
      const result = await renderDocumentMultiPass(
        {
          get document() {
            return live.document as unknown as Parameters<typeof renderDocument>[0]
          },
          feed: async (pages) => {
            await live.feedPageNumbers(pages)
            // Page-number feedback can change the authored tree. Re-admit that
            // exact tree before every layout pass so conditional content cannot
            // bypass node, image, path, or remote-resource policy.
            await admitDocument(live.document)
          },
        },
        { fontStore, maxPasses, limits },
      )
      return {
        bytes: result.bytes,
        metadata: completedMetadata(live.document, metadata),
        passes: result.passes,
        pageCount: countPages(result.layout),
      }
    }

    await admitDocument(mounted.document)
    const document = mounted.document as unknown as Parameters<typeof renderDocument>[0]
    const result = await renderDocument(document, { fontStore, limits })
    return {
      bytes: result.bytes,
      metadata: completedMetadata(mounted.document, metadata),
      passes: 1,
      pageCount: countPages(result.layout),
    }
  }
  finally {
    mounted?.unmount()
  }
}

export const createPdfTemplate = <Props extends object>(
  key: string,
  component: Component,
  options: PdfTemplateRuntimeOptions = {},
): PdfTemplate<Props> => {
  const ref: TemplateRef = { key, file: options.file }

  if (!key.trim()) {
    throw templateError(ref, 'template key must not be empty.')
  }

  const definition = validateDefinition(
    ref,
    (component as PdfComponent<Props>)[PDF_DEFINITION_PROPERTY],
  )

  const renderWithDiagnostics = async (props: Props): Promise<PdfRenderResult> => {
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
      metadata,
      passes,
      pageCount,
    } = await renderTemplate(
      component,
      props,
      definitionMetadata,
      options,
      definition.maxPasses,
      limits,
    )
    const result = createPdfRenderResult(bytes, metadata, {
      durationMs: performance.now() - start,
      pageCount,
      passes,
      registeredFontFaces: (options.fonts ?? []).map(font => ({
        family: font.family,
        fontStyle: font.fontStyle,
        fontWeight: font.fontWeight,
      })),
    })

    return result
  }

  return Object.freeze({
    key,
    resolveMetadata(props: Props) {
      if (!isObject(props)) {
        throw templateError(ref, 'metadata props must be an object.')
      }
      return resolveMetadata(ref, definition, props)
    },
    async render(props: Props): Promise<PdfRenderResult> {
      try {
        return await renderWithDiagnostics(props)
      }
      catch (error) {
        throw enrichTemplateError(error, key, options.file)
      }
    },
  })
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
  readonly scenarioNames: readonly string[]
  getPreviewProps(scenario?: string): Props | undefined
}

export type PdfPreviewEntryOptions = Pick<PdfTemplateRuntimeOptions, 'file'>

export const createPdfPreviewEntry = <Props extends object>(
  template: PdfTemplate<Props>,
  component: Component,
  options: PdfPreviewEntryOptions = {},
): PdfPreviewEntry<Props> => {
  const ref: TemplateRef = { key: template.key, file: options.file }
  const definition = validateDefinition(
    ref,
    (component as PdfComponent<Props>)[PDF_DEFINITION_PROPERTY],
  )
  const scenarios: Readonly<Record<string, Props>>
    = definition.scenarios ?? EMPTY_SCENARIOS
  const scenarioNames = Object.freeze(Object.keys(scenarios).sort())

  return Object.freeze({
    template,
    file: options.file,
    scenarioNames,
    getPreviewProps(scenario?: string) {
      if (scenario === undefined) return definition.sampleData
      if (!Object.prototype.hasOwnProperty.call(scenarios, scenario)) {
        return undefined
      }
      return scenarios[scenario]
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
