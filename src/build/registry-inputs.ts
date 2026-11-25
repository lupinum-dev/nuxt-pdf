// The inputs of the PDF registry: templates, image assets, fonts, limits and
// the remote policy, assembled one way for the Nuxt module and the standalone build.

import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import type { PdfFontDeclaration } from '../runtime/fonts'
import { loadPdfImageAsset, pdfImageFormatFromKey } from '../runtime/server/assets/local-image'
import { normalizeRemoteAssetPolicy, type RemoteAssetOptions } from '../runtime/server/assets/remote'
import { DEFAULT_PDF_RENDER_LIMITS, normalizePdfLimits, type PdfLimitsOptions, type PdfRenderLimits } from '../runtime/server/render-limits'
import { discoverPdfImageFiles, discoverPdfTemplates, type PdfImageFile, type PdfTemplateLayer } from './discover-templates'
import { bundlePdfFonts } from './fonts'
import type { PdfRegistryAssetEntry } from './generate-registry'

export interface PdfRegistryInputOptions {
  fonts?: readonly PdfFontDeclaration[]
  limits?: PdfLimitsOptions
  remote?: RemoteAssetOptions
}

const PDF_MODULE_KEYS = ['fonts', 'limits', 'remote'] as const

/**
 * Fails module setup on a `pdf` key the module does not read, such as a typo
 * (`font`) or an option of another module, which would otherwise do nothing.
 */
export function checkPdfModuleKeys(options: object): void {
  const known: readonly string[] = PDF_MODULE_KEYS
  const unknownKey = Object.keys(options).find(key => !known.includes(key))
  if (unknownKey !== undefined) {
    throw new TypeError(`pdf.${unknownKey} is not supported. The pdf options are ${PDF_MODULE_KEYS.join(', ')}.`)
  }
}

/**
 * Development entries point at the source file so edits render without a
 * restart. Production embeds validated base64 bytes so every output stays
 * self-contained; validation here fails the build on a bad asset.
 */
async function preparePdfImageAssets(
  images: readonly PdfImageFile[],
  limits: PdfRenderLimits,
  development: boolean,
): Promise<PdfRegistryAssetEntry[]> {
  const entries: PdfRegistryAssetEntry[] = []
  for (const image of images) {
    const format = pdfImageFormatFromKey(image.key)
    if (development) {
      entries.push({ format, key: image.key, root: image.rootDir })
      continue
    }
    const loaded = await loadPdfImageAsset(image.key, {
      roots: [image.rootDir],
      maxBytes: limits.maxTotalImageBytes,
      maxPixels: limits.maxTotalImagePixels,
    })
    entries.push({ dataB64: Buffer.from(loaded.data).toString('base64'), format, key: image.key })
  }
  return entries
}

/** Discover the templates and admit the resources of every layer, earlier layers first. */
export async function preparePdfRegistryInputs(
  layers: readonly PdfTemplateLayer[],
  options: PdfRegistryInputOptions,
  { development, isIgnored }: { development: boolean, isIgnored?: (path: string) => boolean },
) {
  const templates = await discoverPdfTemplates(layers, isIgnored)
  const limits = normalizePdfLimits(options.limits)
  const assets = await preparePdfImageAssets(
    await discoverPdfImageFiles(layers, isIgnored),
    limits ?? DEFAULT_PDF_RENDER_LIMITS,
    development,
  )
  const remote = normalizeRemoteAssetPolicy(options.remote)
  const fonts = await bundlePdfFonts(options.fonts ?? [], {
    fontRoots: layers.map(layer => join(layer.rootDir, 'pdfs', 'fonts')),
  })
  return { templates, assets, fonts, limits, remote }
}
