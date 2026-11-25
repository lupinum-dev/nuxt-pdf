import { Buffer } from 'node:buffer'
import { MissingFontFaceError, type FontStore } from '../../fonts'
import { readImageHeader } from '../../image'
import { PDF_PRIMITIVE_NAMES, PDF_PRIMITIVES } from '../../../../primitives'
import { NuxtPdfError, parsePdfSourcePosition, PDF_ERROR_CODES } from '../../../../shared/errors'
import type { StyledDocument, StyledLayoutNode, StyledNode } from '../types'

const loadImage = (node: StyledNode): void => {
  const { src } = node.props
  // Admission resolved every image to bytes (`requireAdmittedImage` in
  // plain-tree.ts), and worker-entry.ts turns the transferred bytes back
  // into a Buffer.
  if (!Buffer.isBuffer(src)) {
    throw new NuxtPdfError(PDF_ERROR_CODES.AssetInvalid, '<PdfImage> reached the layout without admitted image bytes.')
  }
  // The header reader admission used (assets/local-image.ts), so the
  // layout measures the size admission checked. It fails with a typed error.
  const { format, width, height, orientation } = readImageHeader(src)
  // An EXIF orientation above 4 turns the image a quarter: it is as wide on
  // the page as it is stored high.
  const turned = orientation > 4
  node.image = { format, width: turned ? height : width, height: turned ? width : height, data: src }
}

/** A typed error that names the node whose style asks for a face its family lacks, and where it is. */
const missingFaceError = (node: StyledLayoutNode, error: MissingFontFaceError): NuxtPdfError => {
  // A string inherits its style from its text, whose load starts first and fails first.
  if (node.type === PDF_PRIMITIVES.TextInstance) return new NuxtPdfError(PDF_ERROR_CODES.LayoutError, `A text ${error.message}`, { cause: error })
  const source = parsePdfSourcePosition(node.source)
  const where = source ? ` at ${source.file}:${source.line}:${source.column}` : ''
  return new NuxtPdfError(PDF_ERROR_CODES.LayoutError, `<${PDF_PRIMITIVE_NAMES[node.type]}>${where} ${error.message}`, { cause: error, ...(source ? { source } : {}) })
}

/**
 * Loads what the layout must measure: the format and size of every image,
 * and every font face a style names. Writes `image` into the image nodes of its
 * input, the tree `resolveStyles` built for this pass. Emoji images are not
 * loaded: no code registers an emoji source with the font store, so text
 * shows the emoji glyphs of its fonts.
 */
export const resolveAssets = async <Document extends StyledDocument>(root: Document, fontStore: FontStore): Promise<Document> => {
  // Breadth first per top node, in the order upstream started its loads.
  const nodes: StyledLayoutNode[] = []
  for (const page of root.children) {
    for (const top of page.children ?? []) {
      const start = nodes.length
      nodes.push(top)
      for (let index = start; index < nodes.length; index++) {
        const node = nodes[index]!
        if ('children' in node && node.children) nodes.push(...node.children)
      }
    }
  }
  // Every image first, so a broken one fails before any font load starts.
  for (const node of nodes) {
    if (node.type === PDF_PRIMITIVES.Image) loadImage(node)
  }
  await Promise.all(nodes.flatMap(node =>
    [node.style?.fontFamily ?? []].flat().map(family =>
      fontStore.load({ fontFamily: family, fontStyle: node.style?.fontStyle, fontWeight: node.style?.fontWeight }).catch((error: unknown) => {
        throw error instanceof MissingFontFaceError ? missingFaceError(node, error) : error
      }))))
  return root
}
