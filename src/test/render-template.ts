import { defineComponent, h, type Component } from 'vue'
import type { ModuleOptions } from '../module'
import { normalizeRemoteAssetPolicy } from '../runtime/server/assets/remote'
import {
  createPdfTemplate,
  type PdfTemplateRuntimeOptions,
} from '../runtime/server/registry'
import { normalizePdfLimits } from '../runtime/server/render-limits'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
  type PdfRenderResult,
} from '../runtime/shared/template'
import { parsePdf, type ParsedPdf } from './pdf'

/** User-shaped render policy, matching the corresponding Nuxt module options. */
export type RenderPdfTemplateOptions = Pick<ModuleOptions, 'limits' | 'remote'>

const RENDER_PDF_TEMPLATE_OPTION_KEYS = ['limits', 'remote'] as const

type PreparedPdfTemplateOptions = PdfTemplateRuntimeOptions & {
  key?: string
}

export interface RenderedPdfTemplate {
  /** The rendered PDF bytes. */
  bytes: Uint8Array
  /** The parsed document, ready for `expectPdf`. */
  parsed: ParsedPdf
  /** The underlying completed result (diagnostics, bytes, buffer, and response). */
  result: PdfRenderResult
}

const hasDefinition = (component: Component): boolean =>
  typeof component === 'object' && component !== null
  && PDF_DEFINITION_PROPERTY in component

/**
 * `createPdfTemplate` requires `definePdf` metadata; a plain test component has
 * none. Wrap such a component in a forwarding host that carries an empty
 * definition, leaving the caller's component untouched. Props reach the target
 * through fall-through attributes.
 */
const ensurePdfComponent = (component: Component): Component => {
  if (hasDefinition(component)) return component

  const wrapper = defineComponent({
    name: 'RenderPdfTemplateHost',
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h(component, attrs)
    },
  })

  const definition: PdfDefinition = {}
  return Object.assign(wrapper, { [PDF_DEFINITION_PROPERTY]: definition })
}

const componentName = (component: Component): string => {
  const name = (component as { name?: unknown }).name
  return typeof name === 'string' && name !== '' ? name : 'template'
}

/** Package-internal guard for public helpers that accept user configuration. */
export function assertRenderOptionKeys(
  helper: string,
  options: object,
  allowedKeys: readonly string[],
): void {
  const unsupportedKey = Object.keys(options)
    .find(key => !allowedKeys.includes(key))
  if (unsupportedKey === undefined) return

  throw new TypeError(
    `${helper} received unsupported option ${JSON.stringify(unsupportedKey)}. `
    + `Supported options: ${allowedKeys.join(', ')}.`,
  )
}

/** Package-internal entry for tests that already own prepared registry inputs. */
export async function renderPreparedPdfTemplate<Props extends object>(
  component: Component,
  props: Props,
  options: PreparedPdfTemplateOptions = {},
): Promise<RenderedPdfTemplate> {
  const { key = componentName(component), ...runtimeOptions } = options
  const template = createPdfTemplate<Props>(
    key,
    ensurePdfComponent(component),
    runtimeOptions,
  )

  const result = await template.render(props)
  const bytes = await result.toUint8Array()
  const parsed = await parsePdf(bytes)

  return { bytes, parsed, result }
}

/**
 * Render a Vue PDF component through the real Nuxt PDF pipeline — mount, asset
 * resolution, font registration, single- or multi-pass layout — without booting
 * Nuxt, then parse the bytes so a test can assert against them immediately.
 */
export async function renderPdfTemplate<Props extends object>(
  component: Component,
  props: Props,
  options: RenderPdfTemplateOptions = {},
): Promise<RenderedPdfTemplate> {
  assertRenderOptionKeys(
    'renderPdfTemplate',
    options,
    RENDER_PDF_TEMPLATE_OPTION_KEYS,
  )

  return renderPreparedPdfTemplate(component, props, {
    limits: normalizePdfLimits(options.limits),
    remote: normalizeRemoteAssetPolicy(options.remote),
  })
}
