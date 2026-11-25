import type { DocumentNode, SafeDocumentNode } from './layout/index'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../shared/errors'
import {
  pdfClaimedLevels,
  type PdfAttachmentRelationship,
  claimsPdfA,
  claimsTaggedPdf,
  type PdfConformance,
  type PdfDocumentProps,
  type PdfFacturXProfile,
} from '../../primitives'
import {
  assertEmbeddedFonts,
  buildConformanceXmp,
  CONFORMANCE_PDF_VERSION,
  type PdfDocumentInfo,
  type PdfFacturXMetadata,
} from './pdfa'
import { srgbOutputIntent } from './srgb-profile'
import { paintDocument } from './paint/document'
import { createPdfWriter } from './pdf/pdf-writer'
import { prepareForm } from './forms'
import { createEncryption } from './protection'
import { prepareTagging } from './tagged'
import { anchorDestinationsAtFirstPage } from './destinations'
import { documentPages, visitPageNodes } from './laid-out'
import type { RenderLimits } from '../render-limits'

// The write stage: one laid-out document to PDF bytes (`serializePdfLayout`).

/** A file to embed when the PDF is written; plain data from a `PdfAttachment`. */
export interface PdfEngineAttachment {
  name: string
  data: Uint8Array
  type?: string
  description?: string
  relationship: PdfAttachmentRelationship
  /** Set for the invoice XML of a `PdfFacturX`, in a document that claims a PDF/A-3 level. */
  facturXProfile?: PdfFacturXProfile
}

// The engine's document props, plus the Nuxt PDF props it does not know.
// Tree validation checked their shape (renderer/validate-props.ts).
type DocumentMetadata = DocumentNode['props'] & Pick<PdfDocumentProps, 'protection'>

const compact = (values: Record<string, unknown>) => Object.fromEntries(
  Object.entries(values).filter(([, value]) => value !== undefined && value !== null),
)

const documentInfo = (props: DocumentMetadata, creationDate: Date): PdfDocumentInfo => ({
  ...compact({
    Title: props.title,
    Author: props.author,
    Subject: props.subject,
    Keywords: props.keywords,
  }),
  Creator: props.creator ?? 'nuxt-pdf',
  Producer: props.producer ?? 'nuxt-pdf',
  CreationDate: creationDate,
})

/**
 * The header's version. A protected PDF is PDF 1.7 with Adobe extension
 * level 8 (protection.ts). The default is 1.3, and `1.7ext3` is written as
 * 1.7: the extension level belongs to an encryption Nuxt PDF never writes.
 */
const pdfVersionOf = (props: DocumentMetadata, levels: readonly PdfConformance[]): NonNullable<PdfDocumentProps['pdfVersion']> => {
  if (levels.length > 0) return CONFORMANCE_PDF_VERSION
  if (props.protection !== undefined) return '1.7'
  return props.pdfVersion === '1.7ext3' ? '1.7' : props.pdfVersion ?? '1.3'
}

/**
 * The standards a document claims: its `conformance` prop, and PDF/A-3b when
 * it holds a `PdfFacturX`, because a hybrid invoice is a PDF/A-3 file.
 */
const facturXMetadata = (attachments: readonly PdfEngineAttachment[]): PdfFacturXMetadata | undefined => {
  const invoice = attachments.find(item => item.facturXProfile !== undefined)
  return invoice?.facturXProfile === undefined
    ? undefined
    : { profile: invoice.facturXProfile, fileName: invoice.name }
}

// PDF/A-3 requires a MIME type on every embedded file (veraPDF rule 6.8-1).
const PDF_A_DEFAULT_ATTACHMENT_TYPE = 'application/octet-stream'

/**
 * Give every laid-out image a key named after its bytes, so the painter embeds
 * each distinct image once per document. The engine reuses an embedded image
 * only by `image.key`, and it sets no key for Buffer sources: a `fixed` image
 * on 50 pages would be embedded 50 times. Two nodes with the same admitted
 * source share one buffer (the worker rewraps the same memory per node), so
 * the key is the memory range. Keys are numbered per call and the painter's
 * key map lives for one paint, so nothing is carried to another render.
 */
const keyImagesByBytes = (layout: SafeDocumentNode): void => {
  const memoryIds = new Map<unknown, number>()
  const keyOf = (data: unknown): string => {
    const memory = data instanceof Uint8Array ? data.buffer : data
    let id = memoryIds.get(memory)
    if (id === undefined) {
      id = memoryIds.size
      memoryIds.set(memory, id)
    }
    return data instanceof Uint8Array
      ? `nuxt-pdf-image:${id}:${data.byteOffset}:${data.byteLength}`
      : `nuxt-pdf-image:${id}`
  }
  for (const page of documentPages(layout)) {
    visitPageNodes(page, (node) => {
      // Layout stores the decoded image on the node as `image`.
      if (!('image' in node)) return
      const image = node.image
      if (typeof image === 'object' && image !== null && 'data' in image && image.data != null) {
        Object.assign(image, { key: keyOf(image.data) })
      }
    })
  }
}

interface DocumentWrite {
  props: DocumentMetadata
  info: PdfDocumentInfo
  levels: PdfConformance[]
  creationDate: Date
  attachments: readonly PdfEngineAttachment[]
  limits: RenderLimits | undefined
}

/**
 * Paints the prepared layout through our writer. The deadline is checked
 * before each page, before the document ends and once the file is finished.
 */
const writeDocument = (
  { props, info, levels, creationDate, attachments, limits }: DocumentWrite,
  layout: SafeDocumentNode,
  compress: boolean,
): Uint8Array<ArrayBuffer> => {
  const pdfA = claimsPdfA(levels)
  const version = pdfVersionOf(props, levels)
  const conformance = levels.length > 0 ? levels.join(' and ') : undefined
  // Tagging and forms are planned on the layout; the writer gets what it
  // writes as options.
  const tagging = claimsTaggedPdf(levels) ? prepareTagging(layout) : undefined
  const form = prepareForm(layout, conformance)
  const writer = createPdfWriter({
    version,
    compress,
    info,
    language: props.language,
    pageLayout: props.pageLayout,
    // XMP from PDF 1.4 on; a standard's packet carries its identification.
    xmp: version === '1.3' ? undefined : buildConformanceXmp(info, props.language, levels, facturXMetadata(attachments)),
    outputIntent: pdfA ? srgbOutputIntent() : undefined,
    attachments: attachments.map(attachment => ({
      name: attachment.name,
      data: attachment.data,
      type: attachment.type ?? (pdfA ? PDF_A_DEFAULT_ATTACHMENT_TYPE : undefined),
      description: attachment.description,
      relationship: attachment.relationship ?? 'Unspecified',
      date: creationDate,
    })),
    encryption: props.protection === undefined ? undefined : createEncryption(props.protection),
    structure: tagging?.structure,
    form: form?.writer,
  })
  const checkDeadline = limits === undefined ? undefined : () => limits.deadline.check()
  paintDocument(writer, form?.layout ?? layout, { tags: tagging?.tags, paintField: form?.paintField, checkDeadline })
  checkDeadline?.()
  return writer.file()
}

// Serialization seam. Paints one already-laid-out document to PDF bytes.
export const serializePdfLayout = async (
  props: DocumentMetadata,
  layout: SafeDocumentNode,
  compress: boolean,
  limits?: RenderLimits,
  attachments: readonly PdfEngineAttachment[] = [],
): Promise<Uint8Array<ArrayBuffer>> => {
  // Checked before the paint (outside the try below) so an expired budget stays
  // PDF_LIMIT_EXCEEDED instead of being re-wrapped as a serialization failure.
  limits?.deadline.check()
  try {
    anchorDestinationsAtFirstPage(layout)
    keyImagesByBytes(layout)
    const creationDate = props.creationDate ?? new Date()
    const levels = pdfClaimedLevels((props as Record<string, unknown>).conformance)
    if (levels.length > 0) assertEmbeddedFonts(layout, levels)
    const info = documentInfo(props, creationDate)
    const write = { props, info, levels, creationDate, attachments, limits }
    return writeDocument(write, layout, compress)
  }
  catch (error) {
    if (error instanceof NuxtPdfError) throw error
    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      `PDF serialization failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}
