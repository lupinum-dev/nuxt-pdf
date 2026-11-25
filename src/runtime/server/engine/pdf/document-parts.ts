import { createHash } from 'node:crypto'
import type { PdfFile } from './file'
import { PdfBytes, PdfDate, PdfText, type PdfRef } from './objects'

// What a document holds besides its pages: the XMP
// metadata stream, the PDF/A output intent and the embedded files.

/** PDF/A's output intent: an ICC profile and the name of its output condition. */
export interface OutputIntent {
  profile: Uint8Array
  identifier: string
}

/** An embedded file as the writer gets it. */
export interface WriterAttachment {
  name: string
  data: Uint8Array
  /** The MIME type, written as `Subtype`. */
  type?: string
  description?: string
  /** `AFRelationship`: Alternative, Data, Source, Supplement or Unspecified. */
  relationship: string
  /** Written as both the creation and the modification date. */
  date: Date
}

/** The metadata stream: never compressed, so a tool finds the packet without decoding. */
export const writeMetadata = (file: PdfFile, xmp: string): PdfRef =>
  file.stream({ Type: 'Metadata', Subtype: 'XML' }, new TextEncoder().encode(xmp), undefined, { compress: false })

export const writeOutputIntent = (file: PdfFile, { profile, identifier }: OutputIntent): PdfRef => file.set({
  Type: 'OutputIntent',
  S: 'GTS_PDFA1',
  OutputConditionIdentifier: new PdfText(identifier),
  Info: new PdfText(identifier),
  DestOutputProfile: file.stream({ N: 3 }, profile),
})

/**
 * Each file as an embedded file stream and its file specification. Returns
 * the specifications in call order (the catalog's `AF`) and the
 * `EmbeddedFiles` entries by name; of two files with one name the last
 * stays in the name tree, as in pdfkit.
 */
export const writeAttachments = (file: PdfFile, attachments: readonly WriterAttachment[]): { specs: PdfRef[], names: Map<string, PdfRef> } => {
  const specs = attachments.map((attachment) => {
    const stream = file.stream({
      Type: 'EmbeddedFile',
      Subtype: attachment.type,
      Params: {
        CreationDate: new PdfDate(attachment.date),
        ModDate: new PdfDate(attachment.date),
        // The MD5 digest as a 16-byte string (ISO 32000-1, Table 46); pdfkit wrote its 32 hex digits as text.
        CheckSum: new PdfBytes(createHash('md5').update(attachment.data).digest()),
        Size: attachment.data.byteLength,
      },
    }, attachment.data)
    return file.set({
      Type: 'Filespec',
      AFRelationship: attachment.relationship,
      F: new PdfText(attachment.name),
      UF: new PdfText(attachment.name),
      EF: { F: stream },
      Desc: attachment.description === undefined ? undefined : new PdfText(attachment.description),
    })
  })
  return { specs, names: new Map(attachments.map((attachment, index) => [attachment.name, specs[index]!])) }
}
