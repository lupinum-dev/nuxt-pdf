import { defineComponent, h, type Component } from 'vue'
import { createPdfTemplate } from '../runtime/server/registry'
import type { PdfImageAssetMap } from '../runtime/server/assets/resolve-asset'
import type { RemoteAssetPolicy } from '../runtime/server/assets/remote'
import type { BundledPdfFontDescriptor } from '../runtime/server/fonts'
import {
  PDF_DEFINITION_PROPERTY,
  type PdfDefinition,
  type PdfRenderResult,
} from '../runtime/shared/template'
import { parsePdf, type ParsedPdf } from './pdf'

export interface RenderPdfTemplateOptions {
  /** Named image assets, exactly as the generated server registry passes them. */
  assets?: PdfImageAssetMap
  /** Embedded font descriptors registered for this render. */
  fonts?: readonly BundledPdfFontDescriptor[]
  /** Remote-asset allowlist policy; omitted means remote fetching is disabled. */
  remote?: RemoteAssetPolicy
  /** Template key used in error attribution (defaults to the component name). */
  key?: string
  /** Source file used in error attribution. */
  file?: string
}

export interface RenderedPdfTemplate {
  /** The rendered PDF bytes. */
  bytes: Uint8Array
  /** The parsed document, ready for `expectPdf`. */
  parsed: ParsedPdf
  /** The underlying render result (buffer/stream/`Response` accessors). */
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
  const template = createPdfTemplate<Props>(
    options.key ?? 'template',
    ensurePdfComponent(component),
    {
      assets: options.assets,
      fonts: options.fonts,
      remote: options.remote,
      file: options.file,
    },
  )

  const result = await template.render(props)
  const bytes = await result.toUint8Array()
  const parsed = await parsePdf(bytes)

  return { bytes, parsed, result }
}
