// Markdown input through comark, an optional peer dependency. comark parses
// asynchronously only, and a PDF template cannot await (async setup is
// rejected), so Markdown is parsed before the render: the route awaits
// `parseRichTextMarkdown` and passes the model to `content`.
//
// comark can take seconds on hostile input (deeply nested quotes, unclosed
// comments), so the parse runs in a render worker with a time limit
// (internals/decisions.md, D29). The main thread only checks the input and
// waits; its event loop is never blocked by the parse.

import { describePdfValue } from '../shared/describe-value'
import { checkLimitValue, MAX_TIME_LIMIT_MS } from '../shared/limit-range'
import { limitIssue, MAX_RICH_TEXT_MARKDOWN_LENGTH, richTextInvalid } from './limits'
import type { PdfRichBlock } from './types'

/** Options of one `parseRichTextMarkdown` call. */
export interface ParseRichTextMarkdownOptions {
  /**
   * Time for the parse in milliseconds, the wait for a render worker
   * included. In a Nuxt app the default is `pdf.limits.markdownTimeoutMs`
   * (5,000 unless configured).
   */
  timeoutMs?: number
}

/**
 * Parse Markdown with comark into the rich text model, for `PdfRichText`'s
 * `content` prop. Await it in the route or server code that loads the data;
 * a template cannot await. The parse runs in a render worker: it never
 * blocks the server, and it ends at the time limit. The same allowlist and
 * limits apply as for HTML; comark components (`::alert{type="info"}`)
 * become component blocks.
 *
 * Fails with `PDF_RICH_TEXT_INVALID` when the input is not a string, is longer
 * than 250,000 characters (checked before the parse), or the parsed document
 * passes a limit; with `PDF_LIMIT_EXCEEDED` when the parse takes longer than
 * the time limit; with `PDF_RENDER_ERROR` when `comark` is not installed or
 * the build has no render worker.
 */
export const parseRichTextMarkdown = async (
  markdown: string,
  options: ParseRichTextMarkdownOptions = {},
): Promise<PdfRichBlock[]> => {
  // Runtime input from a CMS: the type does not guarantee a string.
  const value: unknown = markdown
  if (typeof value !== 'string') {
    throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: 'markdown', message: `expected a string, found ${describePdfValue(value)}` }])
  }
  if (value.length > MAX_RICH_TEXT_MARKDOWN_LENGTH) {
    throw richTextInvalid([limitIssue('markdown', `the Markdown is ${value.length} characters long, over the limit of ${MAX_RICH_TEXT_MARKDOWN_LENGTH}`)])
  }
  const timeoutMs = options.timeoutMs === undefined
    ? undefined
    : checkLimitValue(options.timeoutMs, 'parseRichTextMarkdown: "timeoutMs"', MAX_TIME_LIMIT_MS, ' ms')
  // Loaded on first use: the worker pool is Node server code, and this module
  // is also imported where templates are compiled.
  const { DEFAULT_PDF_RENDER_LIMITS } = await import('../server/render-limits')
  const { parseMarkdownInWorker } = await import('../server/worker-render')
  return parseMarkdownInWorker(value, timeoutMs ?? DEFAULT_PDF_RENDER_LIMITS.markdownTimeoutMs)
}
