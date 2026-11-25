// File attachments and the Factur-X invoice.
import type { EInvoice, EInvoiceProfile } from '../einvoice/types'
import { primitive, required } from './spec'

/** How an attached file relates to the document (the PDF `AFRelationship` key). */
export const PDF_ATTACHMENT_RELATIONSHIPS = ['Alternative', 'Data', 'Source', 'Supplement', 'Unspecified'] as const
export type PdfAttachmentRelationship = typeof PDF_ATTACHMENT_RELATIONSHIPS[number]

/** Factur-X 1.0 profiles (the `fx:ConformanceLevel` values). */
export const PDF_FACTUR_X_PROFILES = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED', 'XRECHNUNG'] as const
export type PdfFacturXProfile = typeof PDF_FACTUR_X_PROFILES[number]
const FACTUR_X_PROFILES: ReadonlySet<unknown> = new Set(PDF_FACTUR_X_PROFILES)
export const isFacturXProfile = (value: unknown): value is PdfFacturXProfile => FACTUR_X_PROFILES.has(value)

/** The `AFRelationship` values Factur-X 1.0 allows for the invoice XML. */
export const PDF_FACTUR_X_RELATIONSHIPS = ['Data', 'Alternative', 'Source'] as const
export type PdfFacturXRelationship = typeof PDF_FACTUR_X_RELATIONSHIPS[number]

/** The file name Factur-X fixes for the embedded XML of a profile. */
export const pdfFacturXFileName = (profile: PdfFacturXProfile): string =>
  profile === 'XRECHNUNG' ? 'xrechnung.xml' : 'factur-x.xml'

/** A file embedded in the PDF. It paints nothing. */
export type PdfAttachmentProps = {
  /** File name shown by PDF viewers, unique within the document. No path separators. */
  name: string
  /** File content: a string (embedded as UTF-8) or bytes. Never a path or URL. */
  data: string | Uint8Array
  /** MIME type such as `text/xml`. */
  type?: string
  description?: string
  /** Default `'Unspecified'`. */
  relationship?: PdfAttachmentRelationship
}

/**
 * The machine-readable invoice of a Factur-X (ZUGFeRD 2) hybrid invoice. It
 * paints nothing, and its `PdfDocument` must claim `conformance="PDF/A-3b"`
 * (or `"PDF/A-3a"`). Give the invoice data
 * (`invoice`, written as XML during the render) or the finished XML (`xml`),
 * never both.
 */
export type PdfFacturXProps = {
  /** Default `'Data'` for MINIMUM and BASIC WL, else `'Alternative'`. */
  relationship?: PdfFacturXRelationship
} & (
  | {
    /** The CII XML content as a string (embedded as UTF-8) or bytes. Never a path or URL. */
    xml: string | Uint8Array
    invoice?: never
    /** The profile the XML follows; it must match the profile the XML names. */
    profile: PdfFacturXProfile
  }
  | {
    /**
     * The invoice data. The server writes the CII XML of `profile` from it
     * during the render; data that breaks a rule of the profile fails with
     * `PDF_INVOICE_INVALID` and its `issues`.
     */
    invoice: EInvoice
    xml?: never
    /** The profile to write. EXTENDED is not generated: give its XML with `xml`. */
    profile: EInvoiceProfile
  }
)

export const ATTACHMENT_PRIMITIVES = {
  // Not laid out: the engine adapter takes attachments out of the tree and
  // embeds them when the PDF is written (server/engine/plain-tree.ts).
  PdfAttachment: primitive<PdfAttachmentProps>()({
    tag: 'ATTACHMENT',
    props: {
      data: required({ check: 'attachmentData' }),
      description: { check: 'string' },
      name: required({ check: 'attachmentName' }),
      relationship: { check: 'attachmentRelationship' },
      type: { check: 'mimeType' },
    },
    children: [],
  }),
  // Not laid out either: embedded as `factur-x.xml` (server/engine/pdfa.ts).
  // Exactly one of `xml` and `invoice` (renderer/validate-conformance.ts); the
  // invoice becomes XML when the attachments are admitted
  // (server/attachments.ts).
  PdfFacturX: primitive<PdfFacturXProps>()({
    tag: 'FACTUR_X',
    props: {
      invoice: { check: 'facturXInvoice' },
      profile: required({ check: 'facturXProfile' }),
      relationship: { check: 'facturXRelationship' },
      xml: { check: 'attachmentData' },
    },
    children: [],
  }),
}
