import type { Component } from 'vue'
import { mountPdfComponent } from '../renderer/render-component'
import {
  NuxtPdfError,
  PDF_ERROR_CODES,
} from '../shared/errors'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfComponent,
  type PdfDefinition,
  type PdfPreviewRender,
  type PdfRenderResult,
  type PdfTemplate,
  type ResolvedPdfMetadata,
} from '../shared/template'
import {
  resolvePdfImageAssets,
  type PdfImageAssetMap,
} from './assets/resolve-asset'
import type { RemoteAssetPolicy } from './assets/remote'
import { countPages, renderDocument } from './engine/render-document'
import { renderDocumentMultiPass } from './engine/layout-passes'
import {
  createPdfFontStore,
  type BundledPdfFontDescriptor,
} from './fonts'
import { createPdfRenderResult } from './result'

export type { PdfPreviewDiagnostics, PdfPreviewRender } from '../shared/template'

const EMPTY_SCENARIOS = Object.freeze({})
const EMPTY_ASSETS = Object.freeze({})

export interface PdfTemplateRuntimeOptions {
  assets?: PdfImageAssetMap
  file?: string
  fonts?: readonly BundledPdfFontDescriptor[]
  remote?: RemoteAssetPolicy
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
  /** Layout passes actually run: 1 for the single-pass path, ≥ 2 for multi-pass. */
  passes: number
  pageCount: number
}

const renderTemplate = async <Props extends object>(
  key: string,
  component: Component,
  props: Props,
  metadata: ResolvedPdfMetadata,
  options: PdfTemplateRuntimeOptions,
  maxPasses: number | undefined,
  // The warning sink. Production passes `console.warn` (unchanged behavior); the
  // dev preview passes a collector so it can display the same prefixed messages.
  warnSink: (message: string) => void,
): Promise<TemplateRenderOutput> => {
  let mounted: Awaited<ReturnType<typeof mountPdfComponent>> | undefined
  const warn = (message: string): void =>
    warnSink(`${templatePrefix(key, options.file)}: ${message}`)

  try {
    mounted = await mountPdfComponent(
      component,
      props as Record<string, unknown>,
      warn,
    )
    applyDocumentMetadata(mounted.document, metadata)
    await resolvePdfImageAssets(mounted.document, {
      assets: options.assets ?? EMPTY_ASSETS,
      remote: options.remote,
    })

    const document = mounted.document as unknown as Parameters<typeof renderDocument>[0]
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
          },
        },
        { fontStore, maxPasses },
      )
      return {
        bytes: result.bytes,
        passes: result.passes,
        pageCount: countPages(result.layout),
      }
    }

    const result = await renderDocument(document, { fontStore })
    return { bytes: result.bytes, passes: 1, pageCount: countPages(result.layout) }
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

  return Object.freeze({
    key,
    // The source file, exposed for the dev preview's template attribution. Not
    // part of the public `PdfTemplate` type; consumed only by the dev preview.
    file: options.file,
    definition,
    get sampleData() {
      return definition.sampleData
    },
    get scenarios() {
      return definition.scenarios ?? EMPTY_SCENARIOS
    },
    get scenarioNames() {
      return Object.keys(definition.scenarios ?? EMPTY_SCENARIOS).sort()
    },
    getPreviewProps(scenario?: string) {
      if (scenario === undefined) return definition.sampleData
      const scenarios = definition.scenarios
      if (!scenarios || !Object.prototype.hasOwnProperty.call(scenarios, scenario)) {
        return undefined
      }
      return scenarios[scenario]
    },
    resolveMetadata(props: Props) {
      return resolveMetadata(ref, definition, props)
    },
    async render(props: Props): Promise<PdfRenderResult> {
      try {
        if (!isObject(props)) {
          throw templateError(ref, 'render props must be an object.')
        }

        const metadata = resolveMetadata(ref, definition, props)
        const { bytes } = await renderTemplate(
          key,
          component,
          props,
          metadata,
          options,
          definition.maxPasses,
          console.warn,
        )

        return createPdfRenderResult(bytes, metadata.filename)
      }
      catch (error) {
        throw enrichTemplateError(error, key, options.file)
      }
    },
    // Dev-preview render entry. Runs the SAME pipeline as `render()` but collects
    // the warnings (instead of `console.warn`), times the render, and returns the
    // page count and layout-pass count so the preview can show diagnostics. The
    // public `PdfRenderResult` type is untouched; this is a separate internal
    // entry, registered only on the dev preview route.
    async renderForPreview(props: Props): Promise<PdfPreviewRender> {
      try {
        if (!isObject(props)) {
          throw templateError(ref, 'render props must be an object.')
        }

        const metadata = resolveMetadata(ref, definition, props)
        const warnings: string[] = []
        const start = performance.now()
        const { bytes, passes, pageCount } = await renderTemplate(
          key,
          component,
          props,
          metadata,
          options,
          definition.maxPasses,
          message => warnings.push(message),
        )

        return {
          bytes,
          title: metadata.title,
          filename: metadata.filename,
          diagnostics: {
            durationMs: performance.now() - start,
            byteLength: bytes.byteLength,
            pageCount,
            passes,
            warnings,
          },
        }
      }
      catch (error) {
        throw enrichTemplateError(error, key, options.file)
      }
    },
  })
}

export const createPdfRegistry = <
  const Entries extends Record<string, PdfTemplateIdentity>,
>(entries: Entries): PdfRegistry<Entries> => {
  const canonicalKeys = new Set<string>()

  for (const [property, template] of Object.entries(entries)) {
    if (!template?.key) {
      throw new TypeError(`PDF registry entry "${property}" is invalid.`)
    }
    if (canonicalKeys.has(template.key)) {
      throw new TypeError(`Duplicate PDF template key "${template.key}".`)
    }
    canonicalKeys.add(template.key)
  }

  const pdf = Object.freeze(entries)
  const pdfTemplateKeys = Object.freeze(
    Object.values(pdf).map(template => template.key),
  )

  const getTemplate = (key: string): Entries[keyof Entries] | undefined => {
    const template = Object.values(pdf).find(entry => entry.key === key)
    return template as Entries[keyof Entries] | undefined
  }

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
