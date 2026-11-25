import { describePdfValue } from '../shared/describe-value'
import { buildHtmlTree } from './html'
import { richTextInvalid } from './limits'
import { mapRichTextTree } from './map'
import type { PdfRichBlock } from './types'
import { createRichTextWarnings, type RichTextWarnings } from './warnings'

/**
 * Parse editor HTML (TipTap, Lexical, Quill, CKEditor) into the rich text
 * model. Tags on the allowlist become model nodes, `script`, `style` and
 * similar tags are dropped with their content, every other tag is dropped and
 * its text kept, and only `href` (`http:`, `https:`, `mailto:`, `tel:`) and
 * `start` are read. Malformed markup never throws. Fails with
 * `PDF_RICH_TEXT_INVALID` when the input is not a string or passes a limit
 * (1,000,000 characters, 50,000 nodes, nesting depth 32).
 */
export const parseRichTextHtml = (html: string): PdfRichBlock[] => mapRichTextHtml(html, createRichTextWarnings())

/** `parseRichTextHtml` that reports what the model does not keep as written to `warnings` (`PdfRichText`). */
export const mapRichTextHtml = (html: string, warnings: RichTextWarnings): PdfRichBlock[] => {
  // Runtime input from a CMS: the type does not guarantee a string.
  const value: unknown = html
  if (typeof value !== 'string') {
    throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: 'html', message: `expected a string, found ${describePdfValue(value)}` }])
  }
  return mapRichTextTree(buildHtmlTree(value), 'html', warnings)
}
