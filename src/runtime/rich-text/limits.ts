import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type { PdfRichTextIssue } from './types'

// Rich text comes from editors and is not trusted, so its size is bounded
// before it costs time or memory. Measured on the longest page of this
// repository's documentation (the styles page, 2026-11-18): 47,775 characters
// of HTML, 3,910 nodes, nesting depth 5. Each limit leaves more than ten times
// that room for real articles.

/** The longest HTML input, in characters (UTF-16 code units). Also the most text a model may hold. */
export const MAX_RICH_TEXT_LENGTH = 1_000_000

/**
 * The longest Markdown input, in characters: about a 100-page article. The
 * parse runs in a render worker with a time limit (D29); this bound keeps the
 * message to the worker small and the honest worst case, which the default
 * time limit is sized for, short.
 */
export const MAX_RICH_TEXT_MARKDOWN_LENGTH = 250_000

/** The most nodes: HTML elements and text runs, or model nodes (blocks and inline nodes). */
export const MAX_RICH_TEXT_NODES = 50_000

/** The deepest nesting: elements inside elements, or model nodes inside model nodes. */
export const MAX_RICH_TEXT_DEPTH = 32

/**
 * The most images in one rich text. Each local image is read and checked,
 * each remote one is a request (also capped by `pdf.limits.maxRemoteRequests`
 * per render); an article with more images than this is not an article.
 */
export const MAX_RICH_TEXT_IMAGES = 100

/** The longest `alt` text of an image, in characters: a description, not an article. */
export const MAX_RICH_TEXT_ALT_LENGTH = 1_000

/** The longest image `src`, in characters. */
export const MAX_RICH_TEXT_IMAGE_SRC_LENGTH = 4_096

/** The largest image `width` or `height`, in points: 3.5 m, larger than any PDF page. */
export const MAX_RICH_TEXT_IMAGE_SIZE = 10_000

/** The most issues one error lists; the rest are counted in the message. */
export const MAX_RICH_TEXT_ISSUES = 20

export const limitIssue = (path: string, message: string): PdfRichTextIssue =>
  ({ rule: 'PDF-RICH-LIMIT', path, message })

/** The typed error of rich text input: every issue, the first ones in the message. */
export const richTextInvalid = (issues: readonly PdfRichTextIssue[], cause?: unknown): NuxtPdfError => {
  const shown = issues.slice(0, 3).map(issue => `${issue.path}: ${issue.message}`)
  const more = issues.length > shown.length ? ` (and ${issues.length - shown.length} more)` : ''
  return new NuxtPdfError(
    PDF_ERROR_CODES.RichTextInvalid,
    `Rich text input is invalid: ${shown.join('; ')}${more}.`,
    { issues, cause },
  )
}
