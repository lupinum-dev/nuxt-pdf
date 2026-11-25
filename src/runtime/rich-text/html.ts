// Step 1 of the HTML adapter: one pass over the characters builds a plain tree
// of (tag, attributes, children). No regular expression reads the input, so
// the time stays linear for any string. The tree has the shape of a parsed
// comark document, `['tag', props, ...children]`, so both feed the one
// mapping to the model (`map.ts`). The builder never throws for malformed
// HTML; only the limits stop it.

import { decodeEntities } from './entities'
import {
  limitIssue,
  MAX_RICH_TEXT_DEPTH,
  MAX_RICH_TEXT_LENGTH,
  MAX_RICH_TEXT_NODES,
  richTextInvalid,
} from './limits'

/** A text, or an element `[tag, attributes, ...children]` (the comark document shape). */
export type PdfRichSourceNode = string | PdfRichSourceElement
export type PdfRichSourceElement = [tag: string, attributes: Record<string, unknown>, ...children: PdfRichSourceNode[]]

/** Elements without content: never on the open stack. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * Elements whose content is not markup. The adapter drops all of them with
 * their content, so the tokenizer keeps the element without content and skips
 * to the end tag without reading tags inside (`<script>` holding `<p>` makes
 * no paragraph).
 */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp'])

/** Starting one of these closes an open `p`, as in HTML. */
const CLOSES_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
])
/** The search for an open `p` or `li` to close stops at these. */
const SCOPE = new Set(['button', 'object', 'table', 'td', 'template', 'th'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** ASCII lower case only: `toLowerCase` can change the length of other letters (`İ`), which would shift every index. */
const asciiLower = (text: string): string => text.replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32))

/** HTML whitespace (space, tab, line feed, form feed, carriage return); not U+00A0. */
export const isWhitespace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 12 || code === 13
export const isAsciiLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
/** A character that ends a tag or attribute name. */
const endsName = (code: number): boolean => isWhitespace(code) || code === 47 /* / */ || code === 62 /* > */ || code === 61 /* = */

const tooLong = (length: number) => richTextInvalid([
  limitIssue('html', `the HTML has ${length} characters, over the limit of ${MAX_RICH_TEXT_LENGTH}`),
])

/**
 * Build the element tree of an HTML fragment. Malformed markup is repaired as
 * a browser does in the common cases: an end tag closes the nearest open
 * element of its name (an end tag with none is ignored), a new block closes an
 * open `p`, a new `li` closes the open `li` of its list, a heading closes a
 * heading it is in, and the end of the input closes everything. Comments,
 * `<!…>` and `<?…>` are skipped. Fails with `PDF_RICH_TEXT_INVALID` only when
 * the input passes a limit (length, nodes, depth).
 */
export const buildHtmlTree = (input: string): PdfRichSourceNode[] => {
  if (input.length > MAX_RICH_TEXT_LENGTH) throw tooLong(input.length)
  // HTML reads CR LF and CR as LF before anything else.
  const html = input.includes('\r') ? input.replace(/\r\n?/g, '\n') : input
  const root: PdfRichSourceElement = ['#root', {}]
  const stack: PdfRichSourceElement[] = [root]
  let nodes = 0

  const count = (): void => {
    nodes += 1
    if (nodes > MAX_RICH_TEXT_NODES) {
      throw richTextInvalid([limitIssue('html', `the HTML has more than ${MAX_RICH_TEXT_NODES} nodes (elements and texts), over the limit`)])
    }
  }
  const current = (): PdfRichSourceElement => stack[stack.length - 1]!
  const appendText = (text: string): void => {
    if (text === '') return
    const parent = current()
    const last = parent.length - 1
    const previous = parent[last]
    // Text after a skipped tag or comment joins the text before it.
    if (last >= 2 && typeof previous === 'string') parent[last] = previous + text
    else {
      count()
      parent.push(text)
    }
  }
  /** Pop up to and including the nearest open `tag`, unless a scope element comes first. */
  const closeInScope = (tag: string, boundaries: ReadonlySet<string>): void => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      const name = stack[index]![0]
      if (name === tag) {
        stack.length = index
        return
      }
      if (boundaries.has(name)) return
    }
  }
  const LIST_SCOPE = new Set([...SCOPE, 'ul', 'ol'])

  const openElement = (tag: string, attributes: Record<string, unknown>): void => {
    if (CLOSES_PARAGRAPH.has(tag)) closeInScope('p', SCOPE)
    if (tag === 'li') closeInScope('li', LIST_SCOPE)
    if (HEADINGS.has(tag) && HEADINGS.has(current()[0])) stack.pop()
    count()
    const element: PdfRichSourceElement = [tag, attributes]
    current().push(element)
    if (VOID.has(tag)) return
    if (stack.length > MAX_RICH_TEXT_DEPTH) {
      throw richTextInvalid([limitIssue('html', `the HTML nests elements ${stack.length} deep, over the limit of ${MAX_RICH_TEXT_DEPTH}`)])
    }
    stack.push(element)
  }

  const closeElement = (tag: string): void => {
    // `</br>` is a line break in HTML.
    if (tag === 'br') {
      openElement('br', {})
      return
    }
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index]![0] === tag) {
        stack.length = index
        return
      }
    }
  }

  /** Where `</tag` (any case, then the end of the name) starts from `from`, or -1. */
  const findEndTag = (tag: string, from: number): number => {
    let at = html.indexOf('</', from)
    while (at !== -1) {
      const after = at + 2 + tag.length
      if (asciiLower(html.slice(at + 2, after)) === tag && (after >= html.length || endsName(html.charCodeAt(after)))) return at
      at = html.indexOf('</', at + 2)
    }
    return -1
  }

  /** The index after the next `search` from `from`, or the end. */
  const skipPast = (search: string, from: number): number => {
    const end = html.indexOf(search, from)
    return end === -1 ? html.length : end + search.length
  }

  let index = 0
  let textStart = 0
  const flushText = (end: number): void => {
    if (end > textStart) appendText(decodeEntities(html, textStart, end))
  }

  while (index < html.length) {
    const lt = html.indexOf('<', index)
    if (lt === -1) break
    const next = html.charCodeAt(lt + 1)
    if (next === 33 /* ! */) {
      flushText(lt)
      index = html.startsWith('<!--', lt) ? skipPast('-->', lt + 4) : skipPast('>', lt + 2)
      textStart = index
      continue
    }
    if (next === 63 /* ? */) {
      flushText(lt)
      index = skipPast('>', lt + 2)
      textStart = index
      continue
    }
    const closing = next === 47 /* / */
    const nameStart = closing ? lt + 2 : lt + 1
    if (!isAsciiLetter(html.charCodeAt(nameStart))) {
      if (closing && nameStart < html.length) {
        // `</ …>` and `</>`: skipped, as HTML treats them as a bogus comment.
        flushText(lt)
        index = skipPast('>', nameStart)
        textStart = index
        continue
      }
      // A `<` that starts no tag is text.
      index = lt + 1
      continue
    }
    let cursor = nameStart
    while (cursor < html.length && !endsName(html.charCodeAt(cursor))) cursor += 1
    const tag = asciiLower(html.slice(nameStart, cursor))

    // Attributes, up to the `>`. The first of a repeated name wins.
    const attributes: Record<string, unknown> = {}
    let complete = false
    while (cursor < html.length) {
      const code = html.charCodeAt(cursor)
      if (code === 62 /* > */) {
        complete = true
        cursor += 1
        break
      }
      if (isWhitespace(code) || code === 47 /* / */) {
        cursor += 1
        continue
      }
      const attributeStart = cursor
      cursor += 1
      while (cursor < html.length && !endsName(html.charCodeAt(cursor))) cursor += 1
      const name = asciiLower(html.slice(attributeStart, cursor))
      while (cursor < html.length && isWhitespace(html.charCodeAt(cursor))) cursor += 1
      let value = ''
      if (html.charCodeAt(cursor) === 61 /* = */) {
        cursor += 1
        while (cursor < html.length && isWhitespace(html.charCodeAt(cursor))) cursor += 1
        const quote = html.charCodeAt(cursor)
        if (quote === 34 || quote === 39) {
          const end = html.indexOf(quote === 34 ? '"' : '\'', cursor + 1)
          // An unclosed quote runs to the end of the input: the tag never ends.
          if (end === -1) {
            cursor = html.length
            break
          }
          value = decodeEntities(html, cursor + 1, end)
          cursor = end + 1
        }
        else {
          const start = cursor
          while (cursor < html.length && !isWhitespace(html.charCodeAt(cursor)) && html.charCodeAt(cursor) !== 62) cursor += 1
          value = decodeEntities(html, start, cursor)
        }
      }
      if (!closing && !Object.hasOwn(attributes, name)) attributes[name] = value
    }
    flushText(lt)
    // The input ended inside the tag: HTML drops such a tag.
    if (!complete) {
      index = html.length
      textStart = index
      break
    }
    index = cursor
    textStart = index
    if (closing) {
      closeElement(tag)
      continue
    }
    if (RAW_TEXT.has(tag)) {
      // The element stays without its content, so the mapping drops it and
      // reports it; the content up to `</tag` is skipped.
      count()
      current().push([tag, attributes])
      const end = findEndTag(tag, index)
      index = end === -1 ? html.length : skipPast('>', end)
      textStart = index
      continue
    }
    openElement(tag, attributes)
  }
  flushText(html.length)
  const [, , ...children] = root
  return children
}
