import { Buffer } from 'node:buffer'
import type { PdfImageFile } from './discover-templates'
import type { PdfRegistryAssetEntry } from './generate-registry'
import { loadPdfImageAsset, pdfImageFormatFromKey } from '../runtime/server/assets/resolve-asset'
import type { PdfRenderLimits } from '../runtime/server/render-limits'

/** Share the same resource admission between Nuxt and standalone builds. */
export async function preparePdfImageAssets(
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
      maxBytes: limits.maxImageBytes,
      maxPixels: limits.maxImagePixels,
    })
    entries.push({ dataB64: Buffer.from(loaded.data).toString('base64'), format, key: image.key })
  }
  return entries
}
