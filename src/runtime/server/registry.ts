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
  type PdfRenderResult,
  type PdfTemplate,
  type ResolvedPdfMetadata,
} from '../shared/template'
import { renderDocument } from './engine/render-document'
import { createPdfRenderResult } from './result'

const EMPTY_SCENARIOS = Object.freeze({})

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

const templateError = (
  key: string,
  message: string,
  cause?: unknown,
) => new NuxtPdfError(
  PDF_ERROR_CODES.TemplateInvalid,
  `Invalid PDF template "${key}": ${message}`,
  { cause, templateKey: key },
)

const validateDefinition = <Props extends object>(
  key: string,
  definition: PdfDefinition<Props> | undefined,
): PdfDefinition<Props> => {
  if (!isObject(definition)) {
    throw templateError(
      key,
      'definePdf metadata is missing. Add one top-level definePdf({...}) call.',
    )
  }

  for (const field of ['title', 'filename'] as const) {
    const value = definition[field]
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'function') {
      throw templateError(key, `${field} must be a string or function.`)
    }
  }

  if (definition.language !== undefined && typeof definition.language !== 'string') {
    throw templateError(key, 'language must be a string.')
  }
  if (definition.sampleData !== undefined && !isObject(definition.sampleData)) {
    throw templateError(key, 'sampleData must be an object.')
  }
  if (definition.scenarios !== undefined) {
    if (!isObject(definition.scenarios)) {
      throw templateError(key, 'scenarios must be an object.')
    }

    for (const [name, props] of Object.entries(definition.scenarios)) {
      if (!name || !isObject(props)) {
        throw templateError(key, `scenario "${name}" must contain a props object.`)
      }
    }
  }

  return definition
}

const resolveMetadataValue = <Props extends object>(
  key: string,
  field: 'filename' | 'title',
  value: PdfDefinition<Props>[typeof field],
  props: Props,
): string | undefined => {
  let resolved: unknown
  try {
    resolved = typeof value === 'function' ? value(props) : value
  }
  catch (error) {
    throw templateError(key, `${field} metadata could not be evaluated.`, error)
  }

  if (resolved !== undefined && typeof resolved !== 'string') {
    throw templateError(key, `${field} metadata must resolve to a string.`)
  }

  return resolved
}

const resolveMetadata = <Props extends object>(
  key: string,
  definition: PdfDefinition<Props>,
  props: Props,
): ResolvedPdfMetadata => ({
  title: resolveMetadataValue(key, 'title', definition.title, props),
  filename: resolveMetadataValue(key, 'filename', definition.filename, props),
  language: definition.language,
})

const applyDocumentMetadata = (
  document: Awaited<ReturnType<typeof mountPdfComponent>>['document'],
  metadata: ResolvedPdfMetadata,
) => {
  if (metadata.title !== undefined) document.props.title = metadata.title
  if (metadata.language !== undefined) document.props.language = metadata.language
}

const renderTemplate = async <Props extends object>(
  key: string,
  component: Component,
  props: Props,
  metadata: ResolvedPdfMetadata,
): Promise<Uint8Array> => {
  let mounted: Awaited<ReturnType<typeof mountPdfComponent>> | undefined

  try {
    mounted = await mountPdfComponent(
      component,
      props as Record<string, unknown>,
    )
    applyDocumentMetadata(mounted.document, metadata)

    const result = await renderDocument(
      mounted.document as unknown as Parameters<typeof renderDocument>[0],
    )
    return result.bytes
  }
  catch (error) {
    if (error instanceof NuxtPdfError) throw error

    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      `Failed to render PDF template "${key}".`,
      { cause: error, templateKey: key },
    )
  }
  finally {
    mounted?.unmount()
  }
}

export const createPdfTemplate = <Props extends object>(
  key: string,
  component: Component,
): PdfTemplate<Props> => {
  if (!key.trim()) {
    throw templateError(key, 'template key must not be empty.')
  }

  const definition = validateDefinition(
    key,
    (component as PdfComponent<Props>)[PDF_DEFINITION_PROPERTY],
  )

  return Object.freeze({
    key,
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
      return resolveMetadata(key, definition, props)
    },
    async render(props: Props): Promise<PdfRenderResult> {
      if (!isObject(props)) {
        throw templateError(key, 'render props must be an object.')
      }

      const metadata = resolveMetadata(key, definition, props)
      const bytesPromise = renderTemplate(key, component, props, metadata)
      await bytesPromise

      return createPdfRenderResult(bytesPromise, metadata.filename)
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
