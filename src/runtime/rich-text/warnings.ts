// Rich text input that the model does not keep as written. HTML stays
// forgiving: nothing here fails a render. Each drop or change is counted, one
// entry per code and name, so CMS content never loses something without a
// word and a page of `data-*` attributes is one entry, not thousands.

import { describePdfValue } from '../shared/describe-value'
import type { PdfRichTextWarningCode } from '../shared/template'

/** The longest snippet: enough to find the markup in the CMS, never a paragraph of the article. */
const MAX_SNIPPET_LENGTH = 80

const cut = (text: string): string => text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : text

/** An attribute as the parser read it: `name="value"`, or the bare name of an empty one. */
export const attributeSnippet = (name: string, value: unknown): string => {
  if (value === '' || value === true) return cut(name)
  return cut(`${name}="${typeof value === 'string' ? value : describePdfValue(value)}"`)
}

/** A start tag as the parser read it, with its attributes. */
export const tagSnippet = (tag: string, attributes: Readonly<Record<string, unknown>>): string =>
  cut(`<${[tag, ...Object.entries(attributes).map(([name, value]) => attributeSnippet(name, value))].join(' ')}>`)

/** An entry while the render collects; the snippet is always kept here, the result drops it in production. */
export interface RichTextWarningEntry {
  readonly code: PdfRichTextWarningCode
  readonly name: string
  readonly message: string
  readonly snippet: string
  count: number
}

/**
 * The warnings of one `PdfRichText` render. `entries` is one array for the
 * whole render: the component puts it on its view before its slots render the
 * blocks, which add to it later.
 */
export interface RichTextWarnings {
  /** Counts one occurrence; the first gives the message and the snippet. */
  add: (code: PdfRichTextWarningCode, name: string, snippet: string, message: () => string) => void
  readonly entries: RichTextWarningEntry[]
}

const CODES: ReadonlySet<string> = new Set([
  'PDF_RICH_TEXT_LINK_DROPPED',
  'PDF_RICH_TEXT_ATTRIBUTE_DROPPED',
  'PDF_RICH_TEXT_TAG_DROPPED',
  'PDF_RICH_TEXT_TAG_UNKNOWN',
  'PDF_RICH_TEXT_VALUE_CHANGED',
  'PDF_RICH_TEXT_COMPONENT_DROPPED',
  'PDF_RICH_TEXT_PROP_DROPPED',
] satisfies PdfRichTextWarningCode[])

const isEntry = (value: unknown): value is RichTextWarningEntry =>
  typeof value === 'object' && value !== null
  && 'code' in value && typeof value.code === 'string' && CODES.has(value.code)
  && 'name' in value && typeof value.name === 'string'
  && 'message' in value && typeof value.message === 'string'
  && 'snippet' in value && typeof value.snippet === 'string'
  && 'count' in value && typeof value.count === 'number'

/** Whether a prop value is the `entries` of a collector (the renderer stores only that). */
export const isRichTextWarningEntries = (value: unknown): value is RichTextWarningEntry[] =>
  Array.isArray(value) && value.every(isEntry)

export const createRichTextWarnings = (): RichTextWarnings => {
  const entries: RichTextWarningEntry[] = []
  const byKey = new Map<string, RichTextWarningEntry>()
  return {
    entries,
    add(code, name, snippet, message) {
      const key = `${code} ${name}`
      const entry = byKey.get(key)
      if (entry !== undefined) {
        entry.count += 1
        return
      }
      const created: RichTextWarningEntry = { code, name, message: message(), snippet, count: 1 }
      byKey.set(key, created)
      entries.push(created)
    },
  }
}
