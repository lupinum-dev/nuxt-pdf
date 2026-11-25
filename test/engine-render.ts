import type { DocumentNode, SafeDocumentNode } from '../src/runtime/server/engine/layout/index'
import { createPdfFontStore, type PdfFontStore } from '../src/runtime/server/engine/fonts'
import { layoutPdfTree } from '../src/runtime/server/engine/layout-pass'
import { serializePdfLayout } from '../src/runtime/server/engine/render-document'
import type { RenderLimits } from '../src/runtime/server/render-limits'

/**
 * One layout pass and the write, without the pass loop or the Vue renderer:
 * the entry of the engine tests, which build the engine tree by hand.
 */
export const renderDocument = async (
  document: DocumentNode,
  options: { compress?: boolean, fontStore?: PdfFontStore, limits?: RenderLimits } = {},
): Promise<{ bytes: Uint8Array, layout: SafeDocumentNode }> => {
  const fontStore = options.fontStore ?? createPdfFontStore()
  const layout = await layoutPdfTree(document, fontStore, options.limits)
  const bytes = await serializePdfLayout(document.props, layout, options.compress ?? true, options.limits)
  return { bytes, layout }
}
