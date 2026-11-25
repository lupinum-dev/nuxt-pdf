// The comark side of `parseRichTextMarkdown`. It runs in a render worker
// (engine/worker-entry.ts): comark can take seconds on hostile Markdown, and a
// worker that passes its time limit is ended without blocking the server.
// comark is an optional peer dependency, loaded here on first use.

import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import { mapComark } from './comark'
import { richTextInvalid } from './limits'
import type { PdfRichBlock } from './types'

/** The one comark function used: parse Markdown to `{ nodes }`. */
export type ComarkParse = (markdown: string) => Promise<{ nodes: unknown }>

const MODULE_NOT_FOUND: ReadonlySet<string> = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

// comark's footnotes plugin writes `[^1]` and its definition as the footnote
// markup of Markdown renderers, which the mapping turns into footnotes.
const importComark = async (): Promise<ComarkParse> => {
  const [{ parseMarkdown }, { default: footnotes }] = await Promise.all([import('comark'), import('comark/plugins/footnotes')])
  const plugins = [footnotes({ label: '', hr: false })] as const
  return markdown => parseMarkdown(markdown, { plugins })
}

let parser: Promise<ComarkParse> | undefined

/**
 * Load comark's parser once per worker. A missing package fails with a
 * `NuxtPdfError` that names it and the install command; any other load error
 * stays as it is. `load` exists for tests.
 */
export const loadComarkParser = (load: () => Promise<ComarkParse> = importComark): Promise<ComarkParse> => {
  if (load !== importComark) return loadOnce(load)
  parser ??= loadOnce(load).catch((error: unknown) => {
    parser = undefined
    throw error
  })
  return parser
}

const loadOnce = async (load: () => Promise<ComarkParse>): Promise<ComarkParse> => {
  try {
    return await load()
  }
  catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (typeof code !== 'string' || !MODULE_NOT_FOUND.has(code)) throw error
    throw new NuxtPdfError(
      PDF_ERROR_CODES.RenderError,
      'parseRichTextMarkdown needs the optional peer dependency "comark", which is not installed. Install it: pnpm add comark',
      { cause: error },
    )
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const DEFINITION = /^ {0,3}\[\^[^\]\s]+\]:/

/**
 * Fails on a line inside a fenced code block that starts like a footnote
 * definition (`[^1]: …`): comark's footnotes plugin takes such a line out of
 * the code and makes it a note, so the code would print without it.
 */
const checkFencedDefinitions = (markdown: string): void => {
  let fence: string | undefined
  markdown.split('\n').forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1]
    if (fence === undefined) fence = marker
    else if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined
    else if (DEFINITION.test(line)) {
      throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: 'markdown', message: `line ${index + 1} starts like a footnote definition inside a fenced code block, and comark would take it out of the code. Indent the code by four spaces instead of fencing it` }])
    }
  })
}

const parseOrFail = async (parse: ComarkParse, markdown: string): Promise<unknown> => {
  try {
    return (await parse(markdown)).nodes
  }
  catch (error) {
    // comark's message may quote the input; the issue does not.
    throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: 'markdown', message: 'comark could not parse the Markdown' }], error)
  }
}

/**
 * The footnotes plugin keeps each note as its Markdown source. Each note is
 * parsed again, so a bold word or a link in it works, and the children of
 * its paragraph replace the source. A note is one line (a definition does
 * not continue on the next line).
 */
const parseNotes = async (parse: ComarkParse, nodes: unknown): Promise<void> => {
  if (!Array.isArray(nodes)) return
  for (const section of nodes) {
    if (!Array.isArray(section) || section[0] !== 'section') continue
    for (const list of section.slice(2)) {
      if (!Array.isArray(list)) continue
      for (const item of list.slice(2)) {
        if (!Array.isArray(item) || item[0] !== 'li' || typeof item[2] !== 'string') continue
        const parsed = await parseOrFail(parse, item[2])
        if (!Array.isArray(parsed)) continue
        // One paragraph gives the note its children; anything else (a list,
        // a heading) stays a block, which the mapping rejects.
        const paragraph = parsed.length === 1 ? parsed[0] : undefined
        item.splice(2, 1, ...(Array.isArray(paragraph) && paragraph[0] === 'p' ? paragraph.slice(2) : parsed))
      }
    }
  }
}

/**
 * Parse checked Markdown (a string within the length limit) with comark and
 * map it to the rich text model. The caller checks type and length first.
 */
export const parseMarkdownText = async (markdown: string): Promise<PdfRichBlock[]> => {
  checkFencedDefinitions(markdown)
  const parse = await loadComarkParser()
  const nodes = await parseOrFail(parse, markdown)
  await parseNotes(parse, nodes)
  return mapComark(nodes, 'markdown')
}
