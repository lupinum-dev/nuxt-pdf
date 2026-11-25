import { renderEInvoiceXml } from '../einvoice/cii'
import type { EInvoice, EInvoiceProfile } from '../einvoice/types'
import { withPdfSource } from '../shared/errors'
import { PDF_PRIMITIVES } from '../primitives'
import type { PdfDocumentNode, PdfElementNode } from '../renderer'
import { limitExceeded, type RenderLimits } from './render-limits'

const utf8 = new TextEncoder()

/**
 * Write the CII XML of a `PdfFacturX` that has `invoice` (tree validation
 * has checked the profile and that `xml` is absent). It runs on the main
 * thread, before the attachment total is checked, so the XML counts toward
 * `maxTotalAttachmentBytes` and the worker sees only bytes. Invalid data fails
 * with `PDF_INVOICE_INVALID` and its issues.
 */
const writeFacturXInvoice = (node: PdfElementNode): void => {
  const { invoice, profile } = node.props
  try {
    // validateFacturXProfile rejects EXTENDED with an invoice, and the
    // facturXInvoice check an invoice that is not an object.
    node.props.xml = renderEInvoiceXml(invoice as EInvoice, { profile: profile as EInvoiceProfile })
  }
  catch (error) {
    throw withPdfSource(error, node.source)
  }
  delete node.props.invoice
}

/**
 * Admit the attachments (`PdfAttachment`, `PdfFacturX`) of a mounted document: string content becomes its
 * UTF-8 bytes, so the engine (and the worker it may run in) sees only bytes,
 * and the total is checked before the tree leaves the main thread.
 */
export const admitPdfAttachments = (
  document: PdfDocumentNode,
  limits: RenderLimits,
): void => {
  let total = 0
  for (const child of document.children) {
    // The Factur-X invoice XML is an attachment too.
    if (child.type !== PDF_PRIMITIVES.Attachment && child.type !== PDF_PRIMITIVES.FacturX) continue
    if (child.type === PDF_PRIMITIVES.FacturX && child.props.invoice !== undefined) writeFacturXInvoice(child)
    const key = child.type === PDF_PRIMITIVES.FacturX ? 'xml' : 'data'
    const data = child.props[key]
    if (typeof data === 'string') child.props[key] = utf8.encode(data)
    const bytes = child.props[key]
    if (bytes instanceof Uint8Array) total += bytes.byteLength
    if (total > limits.maxTotalAttachmentBytes) {
      limitExceeded(
        `PDF attachments of this render exceed pdf.limits.maxTotalAttachmentBytes (${limits.maxTotalAttachmentBytes} bytes in total).`,
      )
    }
  }
}
