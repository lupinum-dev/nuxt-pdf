// Step 2 of the HTML adapter, and the one mapping for every tree input: a
// tree of (tag, attributes, children) becomes the model. This is the
// allowlist: the tags it names map to model nodes, a dropped tag loses its
// content, any other tag is transparent (its content stays), and only `href`,
// `start`, a code language and an image's `src`, `alt`, `width` and `height`
// are read. comark documents (the `comark` prop
// and Markdown) have the same shape and use this mapping too; only they make
// component blocks, from tags that are not HTML element names. What the
// model does not keep as written goes to the render's rich text warnings.

import { isWhitespace, type PdfRichSourceNode } from './html'
import {
  limitIssue,
  MAX_RICH_TEXT_ALT_LENGTH,
  MAX_RICH_TEXT_DEPTH,
  MAX_RICH_TEXT_IMAGE_SIZE,
  MAX_RICH_TEXT_IMAGE_SRC_LENGTH,
  MAX_RICH_TEXT_IMAGES,
  MAX_RICH_TEXT_NODES,
  richTextInvalid,
} from './limits'
import { MAX_RICH_TABLE_COLUMNS, richTableLayout } from './table'
import type {
  PdfRichBlock,
  PdfRichComponent,
  PdfRichFootnote,
  PdfRichImage,
  PdfRichInline,
  PdfRichJsonValue,
  PdfRichLink,
  PdfRichParagraph,
  PdfRichTable,
  PdfRichTableCell,
  PdfRichTextRun,
} from './types'
import { isAllowedLinkUri } from '../shared/link-target'
import { isPlainObject, isRichTextPropName, RICH_TEXT_MARKS } from './validate'
import { attributeSnippet, createRichTextWarnings, tagSnippet, type RichTextWarnings } from './warnings'

/** Dropped with their content: code, embedded objects and document metadata are not article text. */
export const RICH_TEXT_DROPPED_TAGS: ReadonlySet<string> = new Set([
  'script', 'style', 'iframe', 'object', 'template',
  'head', 'title', 'noscript', 'noembed', 'noframes', 'textarea', 'xmp', 'svg', 'math',
])

type Mark = typeof RICH_TEXT_MARKS[number]
/**
 * Maps, not object literals: a tag name comes from the input, and a lookup in
 * an object would find `constructor` and the other names of its prototype.
 */
const MARK_OF: ReadonlyMap<string, Mark> = new Map<string, Mark>([
  ['strong', 'bold'], ['b', 'bold'],
  ['em', 'italic'], ['i', 'italic'],
  ['u', 'underline'],
  ['s', 'strike'], ['del', 'strike'], ['strike', 'strike'],
  ['code', 'code'],
])
type VerticalAlign = NonNullable<PdfRichTextRun['verticalAlign']>
const VERTICAL_ALIGN_OF: ReadonlyMap<string, VerticalAlign> = new Map<string, VerticalAlign>([['sup', 'super'], ['sub', 'sub']])
const HEADING_LEVEL: ReadonlyMap<string, 1 | 2 | 3 | 4 | 5 | 6> = new Map<string, 1 | 2 | 3 | 4 | 5 | 6>([['h1', 1], ['h2', 2], ['h3', 3], ['h4', 4], ['h5', 5], ['h6', 6]])
/**
 * Tags that hold blocks: their loose inline content becomes paragraphs. Next
 * to `p` and `div`, the block elements of HTML that have no model node of
 * their own, so the text of two table cells or two sections does not run
 * together into one word.
 */
const CONTAINERS = new Set([
  'p', 'div',
  'address', 'article', 'aside', 'caption', 'center', 'dd', 'details', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'header', 'hgroup', 'legend', 'main', 'nav', 'section', 'summary',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
])

/**
 * The element names of HTML (WHATWG, with the obsolete ones editors still
 * write). In comark input a tag on this list is HTML; any other tag is a
 * component (`::alert` is `['alert', ...]`).
 */
const HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'a', 'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'big',
  'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt', 'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label',
  'legend', 'li', 'link', 'main', 'map', 'mark', 'marquee', 'math', 'menu', 'meta', 'meter', 'nav', 'nobr',
  'noembed', 'noframes', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param', 'picture',
  'plaintext', 'pre', 'progress', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup',
  'svg', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr', 'xmp',
])

/** Whether a comark tag names a component: it is not an HTML element name. */
export const isRichTextComponentTag = (tag: string): boolean => !HTML_ELEMENTS.has(tag.toLowerCase())

/** Attributes of a comark component that are HTML presentation, not props. */
const NOT_PROPS: ReadonlySet<string> = new Set(['class', 'id', 'style'])

/**
 * The tags whose meaning the mapping keeps: marks, places, headings,
 * containers, lists, quotes, code, rules, images, tables, links and `span`,
 * which means nothing itself. Any other tag that is not dropped keeps its
 * content without its formatting.
 */
const KNOWN_TAGS: ReadonlySet<string> = new Set([
  ...MARK_OF.keys(), ...VERTICAL_ALIGN_OF.keys(), ...HEADING_LEVEL.keys(), ...CONTAINERS,
  'a', 'blockquote', 'br', 'col', 'colgroup', 'hr', 'img', 'li', 'ol', 'pre', 'span', 'table', 'ul',
])

/** The attributes the mapping reads, by tag. An `id` prints nothing and is never reported. */
const READ_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['a', new Set(['href'])],
  ['ol', new Set(['start'])],
  ['img', new Set(['src', 'alt', 'width', 'height'])],
  ['td', new Set(['colspan', 'rowspan', 'align'])],
  ['th', new Set(['colspan', 'rowspan', 'align'])],
  ['col', new Set(['span', 'width'])],
  ['colgroup', new Set(['span', 'width'])],
  ['pre', new Set(['language'])],
])

/** The declarations of a `style` attribute the mapping reads, by tag. */
const READ_DECLARATIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['td', new Set(['text-align'])],
  ['th', new Set(['text-align'])],
  ['col', new Set(['width'])],
  ['colgroup', new Set(['width'])],
])

/** Whether the mapping reads every name of a `class`: footnote markup, and a code block's language. */
const isReadClass = (tag: string, value: unknown): boolean => typeof value === 'string'
  && value.split(/\s+/).every(name => name === '' || name.startsWith('footnote') || (tag === 'code' && name.startsWith('language-')))

/** The message of an attribute the PDF does not read; `owner` is the tag or component that has it. */
const attributeMessage = (name: string, owner: string): string => {
  if (name === 'style') return 'Inline styles do not reach the PDF. Style the elements with the "styles" prop of PdfRichText.'
  if (name === 'class') return 'Classes do not reach the PDF. Style the elements with the "styles" prop of PdfRichText.'
  if (name === 'data-*') return 'data-* attributes hold nothing the PDF prints.'
  if (name === 'aria-*') return 'aria-* attributes are not read: a tagged PDF takes its structure from the tags.'
  return `The ${name} attribute of ${owner} is not read.`
}

/** The longest URI scheme the link kind names; a longer one is a relative link with a colon. */
const MAX_SCHEME_LENGTH = 32

/** What a link target is, for a dropped link: its scheme with the colon, `#` for a place in the page, or `relative`. */
const linkKind = (href: string): string => {
  const target = href.trim()
  if (target.startsWith('#')) return '#'
  const colon = target.indexOf(':')
  const scheme = colon > 0 && colon <= MAX_SCHEME_LENGTH ? target.slice(0, colon) : ''
  return /^[a-z][a-z\d+.-]*$/i.test(scheme) ? `${scheme.toLowerCase()}:` : 'relative'
}

const linkMessage = (kind: string): string => {
  const kept = 'only absolute http:, https:, mailto: and tel: links are kept'
  if (kind === '#') return `A link to a place in the page prints as plain text: ${kept}.`
  if (kind === 'relative') return `A relative link prints as plain text: ${kept}.`
  return `A link to a ${kind} target prints as plain text: ${kept}.`
}

/** Where a tree comes from: names the path of a limit issue, and only comark input makes components. */
export type PdfRichTreeSource = 'html' | 'comark' | 'markdown'

/** A link while it is open: one per `<a>` element, so two links in a row stay two. */
type OpenLink = { readonly href: string }

type Context = {
  readonly marks: ReadonlySet<Mark>
  readonly link: OpenLink | undefined
  readonly verticalAlign: VerticalAlign | undefined
}

/** Inline content before whitespace handling: flat, each item with its marks and link. */
type Item
  = | { kind: 'text', text: string, marks: ReadonlySet<Mark>, link: OpenLink | undefined, verticalAlign: VerticalAlign | undefined }
    | { kind: 'break', link: OpenLink | undefined }
    | { kind: 'footnote', node: PdfRichFootnote, link: undefined }

const ROOT_CONTEXT: Context = { marks: new Set(), link: undefined, verticalAlign: undefined }

const isElement = (node: PdfRichSourceNode): node is Exclude<PdfRichSourceNode, string> => typeof node !== 'string'
const tagOf = (node: Exclude<PdfRichSourceNode, string>): string => node[0].toLowerCase()
const childrenOf = (node: Exclude<PdfRichSourceNode, string>): PdfRichSourceNode[] => {
  const [, , ...children] = node
  return children
}

// What a note cannot hold: a note prints as one paragraph at the page bottom.
const NOTE_BLOCKS: ReadonlySet<string> = new Set([
  ...CONTAINERS, 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'img', ...HEADING_LEVEL.keys(),
])

/** The first block tag in `nodes`, at any depth. */
const blockIn = (nodes: readonly PdfRichSourceNode[]): string | undefined => {
  for (const node of nodes) {
    if (!isElement(node)) continue
    const tag = tagOf(node)
    if (NOTE_BLOCKS.has(tag)) return tag
    const inner = blockIn(childrenOf(node))
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * The inline content of a note: its text, or the text of the one paragraph
 * that Markdown renderers wrap it in. Any other block fails: joining two
 * paragraphs or a list into one line would change the note without a word.
 */
const noteLine = (content: readonly PdfRichSourceNode[], id: string, source: string): readonly PdfRichSourceNode[] => {
  const [paragraph, ...rest] = content.filter(node => isElement(node) || node.trim() !== '')
  const line = paragraph !== undefined && rest.length === 0 && isElement(paragraph) && tagOf(paragraph) === 'p' ? childrenOf(paragraph) : content
  const block = blockIn(line)
  if (block !== undefined) {
    throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: source, message: `the footnote "${id}" holds <${block}>, but a note is one paragraph of text. Write the note as one paragraph` }])
  }
  return line
}

const hasClass = (attributes: Record<string, unknown>, name: string): boolean =>
  typeof attributes.class === 'string' && attributes.class.split(/\s+/).includes(name)

/**
 * The notes of the footnote markup Markdown renderers and comark's footnotes
 * plugin write: a top-level `section` (or `div`) with class `footnotes`
 * whose list items carry the note ids. The back links (`↩`) are left out.
 */
const notesOf = (tree: readonly PdfRichSourceNode[]): { lists: ReadonlySet<PdfRichSourceNode>, notes: ReadonlyMap<string, PdfRichSourceNode[]> } => {
  const withoutBackLinks = (nodes: readonly PdfRichSourceNode[]): PdfRichSourceNode[] => nodes.flatMap((node): PdfRichSourceNode[] => {
    if (!isElement(node)) return [node]
    const href = node[1].href
    if (tagOf(node) === 'a' && (hasClass(node[1], 'footnote-backref') || (typeof href === 'string' && href.startsWith('#fnref')))) return []
    return [[node[0], node[1], ...withoutBackLinks(childrenOf(node))]]
  })
  const lists = new Set<PdfRichSourceNode>()
  const notes = new Map<string, PdfRichSourceNode[]>()
  for (const node of tree) {
    if (!isElement(node) || (tagOf(node) !== 'section' && tagOf(node) !== 'div') || !hasClass(node[1], 'footnotes')) continue
    lists.add(node)
    for (const list of childrenOf(node)) {
      if (!isElement(list) || (tagOf(list) !== 'ol' && tagOf(list) !== 'ul')) continue
      for (const item of childrenOf(list)) {
        const id = isElement(item) && tagOf(item) === 'li' ? item[1].id : undefined
        if (isElement(item) && typeof id === 'string' && id !== '' && !notes.has(id)) notes.set(id, withoutBackLinks(childrenOf(item)))
      }
    }
  }
  return { lists, notes }
}

/** Each run of HTML whitespace as one space, in one pass. */
const collapse = (text: string): string => {
  const parts: string[] = []
  let start = 0
  let index = 0
  while (index < text.length) {
    if (!isWhitespace(text.charCodeAt(index))) {
      index += 1
      continue
    }
    let end = index + 1
    while (end < text.length && isWhitespace(text.charCodeAt(end))) end += 1
    // A single space stays as it is; any other run becomes one space.
    if (end - index > 1 || text.charCodeAt(index) !== 32) {
      parts.push(text.slice(start, index), ' ')
      start = end
    }
    index = end
  }
  if (start === 0) return text
  parts.push(text.slice(start))
  return parts.join('')
}

/** An `ol` start number: a whole number from 0 written in digits (or a number from a comark tree). */
const startOf = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  if (typeof value !== 'string') return undefined
  const digits = value.trim()
  if (digits === '' || digits.length > 9) return undefined
  for (let index = 0; index < digits.length; index += 1) {
    const code = digits.charCodeAt(index)
    if (code < 48 || code > 57) return undefined
  }
  return Number(digits)
}

/**
 * An image `width` or `height` attribute: CSS pixels written as a number
 * (`120`, `120.5`), above 0 and at most `MAX_RICH_TEXT_IMAGE_SIZE`. A unit,
 * a percentage or CSS is not read: the image keeps its own size.
 */
const imageSizeOf = (value: unknown): number | undefined => {
  let size: number
  if (typeof value === 'number') size = value
  else if (typeof value === 'string') {
    const digits = value.trim()
    if (digits === '' || digits.length > 12) return undefined
    let dots = 0
    for (let index = 0; index < digits.length; index += 1) {
      const code = digits.charCodeAt(index)
      if (code === 46) dots += 1
      else if (code < 48 || code > 57) return undefined
    }
    if (dots > 1 || digits === '.') return undefined
    size = Number(digits)
  }
  else return undefined
  return Number.isFinite(size) && size > 0 && size <= MAX_RICH_TEXT_IMAGE_SIZE ? size : undefined
}

/**
 * The image of an `img` element, or undefined without a usable `src`. The
 * source is kept as written: whether it may load is decided where every
 * `PdfImage` source is decided, when the PDF renders. `alt` is collapsed
 * like text and cut at `MAX_RICH_TEXT_ALT_LENGTH`; an empty `alt` is no alt.
 */
const imageOf = (attributes: Record<string, unknown>, caption: PdfRichInline[], warnings: RichTextWarnings): PdfRichImage | undefined => {
  const src = typeof attributes.src === 'string' ? attributes.src.trim() : ''
  if (src === '') {
    warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', 'src', tagSnippet('img', attributes), () => 'An img without a src prints nothing.')
    return undefined
  }
  if (src.length > MAX_RICH_TEXT_IMAGE_SRC_LENGTH) {
    warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', 'src', attributeSnippet('src', src), () => `An img whose src is longer than ${MAX_RICH_TEXT_IMAGE_SRC_LENGTH} characters prints nothing.`)
    return undefined
  }
  const image: PdfRichImage = { type: 'image', src }
  const fullAlt = typeof attributes.alt === 'string' ? collapse(attributes.alt).trim() : ''
  if (fullAlt.length > MAX_RICH_TEXT_ALT_LENGTH) {
    warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', 'alt', attributeSnippet('alt', fullAlt), () => `An img alt longer than ${MAX_RICH_TEXT_ALT_LENGTH} characters is cut at that length.`)
  }
  const alt = fullAlt.slice(0, MAX_RICH_TEXT_ALT_LENGTH)
  if (alt !== '') image.alt = alt
  for (const name of ['width', 'height'] as const) {
    const size = imageSizeOf(attributes[name])
    if (size !== undefined) image[name] = size
    else if (attributes[name] !== undefined) {
      warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', name, attributeSnippet(name, attributes[name]), () => `An img ${name} that is not a number of CSS pixels above 0 and at most ${MAX_RICH_TEXT_IMAGE_SIZE} is left out: the image keeps its own ${name}.`)
    }
  }
  if (caption.length > 0) image.caption = caption
  return image
}

/** A JSON copy of a comark prop value, or undefined when it is not plain JSON. */
const jsonOf = (value: unknown, depth: number): PdfRichJsonValue | undefined => {
  if (depth > MAX_RICH_TEXT_DEPTH) return undefined
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    const items = value.map(item => jsonOf(item, depth + 1))
    return items.every(item => item !== undefined) ? items.filter(item => item !== undefined) : undefined
  }
  if (!isPlainObject(value)) return undefined
  const entries: Array<[string, PdfRichJsonValue]> = []
  for (const [key, item] of Object.entries(value)) {
    const copy = jsonOf(item, depth + 1)
    if (!isRichTextPropName(key) || copy === undefined) return undefined
    entries.push([key, copy])
  }
  return Object.fromEntries(entries)
}

/**
 * The props of a comark component. comark marks a bound prop with `:`
 * (`:count="3"`, `:items='[1,2]'`): the name loses the colon and a string
 * value is read as JSON when it is JSON (`3`, `true`, `[1,2]`), as comark's
 * own renderers do. `$` (comark's metadata), `class`, `id`, `style`, names a
 * component cannot take and values that are not plain JSON are left out.
 * `Object.fromEntries` writes each name as an own property, so a name never
 * reaches the prototype.
 */
const propsOf = (component: string, attributes: Record<string, unknown>, warnings: RichTextWarnings): { [key: string]: PdfRichJsonValue } => {
  const entries: Array<[string, PdfRichJsonValue]> = []
  const dropped = (name: string, raw: unknown, why: string): void =>
    warnings.add('PDF_RICH_TEXT_PROP_DROPPED', `${component}.${name}`, attributeSnippet(name, raw), () => `The prop "${name}" of the component ${component} ${why}, so the component does not get it.`)
  for (const [key, raw] of Object.entries(attributes)) {
    const bound = key.startsWith(':')
    const name = bound ? key.slice(1) : key
    // comark's metadata, and an id, which prints nothing: neither is content.
    if (name.startsWith('$') || name === 'id') continue
    if (NOT_PROPS.has(name)) {
      warnings.add('PDF_RICH_TEXT_ATTRIBUTE_DROPPED', name, attributeSnippet(key, raw), () => attributeMessage(name, component))
      continue
    }
    if (!isRichTextPropName(name)) {
      dropped(name, raw, 'is not a prop name')
      continue
    }
    let value: unknown = raw
    if (bound && typeof raw === 'string') {
      try {
        value = JSON.parse(raw)
      }
      catch {
        value = raw
      }
    }
    const copy = jsonOf(value, 1)
    if (copy !== undefined) entries.push([name, copy])
    else dropped(name, raw, 'is not plain JSON')
  }
  return Object.fromEntries(entries)
}

/** The language of a code block: `language` on `pre` (comark), else a `language-*` class on its `code` (editor HTML). */
const languageOf = (attributes: Record<string, unknown>, children: readonly PdfRichSourceNode[]): string | undefined => {
  const named = attributes.language
  if (typeof named === 'string' && named.trim() !== '') return named.trim().slice(0, 64)
  const code = children.find(child => isElement(child) && tagOf(child) === 'code')
  const classes = code !== undefined && isElement(code) ? code[1].class : undefined
  if (typeof classes !== 'string') return undefined
  // Editor HTML, not a PDF class list (`classNames`): the first match is enough.
  const language = classes.split(/\s+/).find(name => name.startsWith('language-') && name.length > 9)
  return language?.slice(9, 73)
}

/** Whether a run carries exactly these marks and this place. */
const hasMarks = (node: PdfRichTextRun, marks: ReadonlySet<Mark>, verticalAlign: VerticalAlign | undefined): boolean =>
  RICH_TEXT_MARKS.every(mark => (node[mark] === true) === marks.has(mark)) && node.verticalAlign === verticalAlign

const run = (text: string, marks: ReadonlySet<Mark>, verticalAlign: VerticalAlign | undefined): PdfRichTextRun => {
  const node: PdfRichTextRun = { type: 'text', text }
  for (const mark of RICH_TEXT_MARKS) {
    if (marks.has(mark)) node[mark] = true
  }
  if (verticalAlign !== undefined) node.verticalAlign = verticalAlign
  return node
}

/**
 * Inline items as model nodes, with whitespace as a browser shows it: each
 * run of HTML whitespace is one space, no space at the start or end of the
 * block or next to a line break, and a last line break after other content
 * is dropped (it adds no line). Adjacent texts with the same marks and link
 * join; items of one link become one link node.
 */
const toInlines = (items: readonly Item[]): PdfRichInline[] => {
  const cleaned: Item[] = []
  let spaceBefore = true
  for (const item of items) {
    if (item.kind === 'footnote') {
      cleaned.push(item)
      spaceBefore = false
      continue
    }
    if (item.kind === 'break') {
      const last = cleaned.at(-1)
      if (last?.kind === 'text' && last.text.endsWith(' ')) last.text = last.text.slice(0, -1)
      cleaned.push({ ...item })
      spaceBefore = true
      continue
    }
    let text = collapse(item.text)
    if (spaceBefore && text.startsWith(' ')) text = text.slice(1)
    if (text === '') continue
    spaceBefore = text.endsWith(' ')
    cleaned.push({ ...item, text })
  }
  const last = cleaned.at(-1)
  if (last?.kind === 'text' && last.text.endsWith(' ')) last.text = last.text.slice(0, -1)
  const kept = cleaned.filter(item => item.kind !== 'text' || item.text !== '')
  if (kept.length > 1 && kept.at(-1)!.kind === 'break') kept.pop()

  const result: PdfRichInline[] = []
  let openLink: OpenLink | undefined
  let linkNode: PdfRichLink | undefined
  for (const item of kept) {
    let target = result
    if (item.link === undefined) {
      openLink = undefined
      linkNode = undefined
    }
    else {
      if (item.link !== openLink || linkNode === undefined) {
        linkNode = { type: 'link', href: item.link.href, children: [] }
        result.push(linkNode)
        openLink = item.link
      }
      target = linkNode.children
    }
    if (item.kind === 'break') {
      target.push({ type: 'break' })
      continue
    }
    if (item.kind === 'footnote') {
      target.push(item.node)
      continue
    }
    const previous = target.at(-1)
    if (previous?.type === 'text' && hasMarks(previous, item.marks, item.verticalAlign)) {
      previous.text += item.text
      continue
    }
    target.push(run(item.text, item.marks, item.verticalAlign))
  }
  return result
}

/** The declarations of a `style` attribute, by lowercase name. No regular expression reads the input. */
const declarationsOf = (style: unknown): ReadonlyMap<string, string> => {
  const declarations = new Map<string, string>()
  if (typeof style !== 'string') return declarations
  for (const part of style.split(';')) {
    const colon = part.indexOf(':')
    if (colon > 0) declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim().toLowerCase())
  }
  return declarations
}

/**
 * A `colspan` or `rowspan` as a browser reads it: the digits at the start; a
 * value that is not a whole number from 2 counts as 1, so it is left out.
 */
const spanAttribute = (value: unknown): number | undefined => {
  const span = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.trim(), 10) : Number.NaN
  return Number.isSafeInteger(span) && span > 1 ? span : undefined
}

/** Whether a `colspan` or `rowspan` reads as a whole number from 1, as a browser reads it. */
const isSpan = (value: unknown): boolean => {
  const span = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value.trim(), 10) : Number.NaN
  return Number.isSafeInteger(span) && span >= 1
}

type CellAlign = NonNullable<PdfRichTableCell['align']>
const CELL_ALIGNS: ReadonlySet<string> = new Set<CellAlign>(['left', 'center', 'right'])
const isCellAlign = (value: string | undefined): value is CellAlign => value !== undefined && CELL_ALIGNS.has(value)

/** The alignment of a cell: its `text-align` style (comark writes it for Markdown), else its `align` attribute. */
const cellAlignOf = (attributes: Record<string, unknown>): CellAlign | undefined => {
  const styled = declarationsOf(attributes.style).get('text-align')
  if (isCellAlign(styled)) return styled
  const attribute = typeof attributes.align === 'string' ? attributes.align.trim().toLowerCase() : undefined
  return isCellAlign(attribute) ? attribute : undefined
}

/**
 * The width of a `col`: its `width` style, else its `width` attribute, in px,
 * pt or %, as a number and whether it is a percentage. Editors write widths
 * for a screen, so the table takes them as the proportions of its columns.
 */
const columnWidthOf = (attributes: Record<string, unknown>): { readonly share: number, readonly percent: boolean } | undefined => {
  const raw = declarationsOf(attributes.style).get('width') ?? (typeof attributes.width === 'string' ? attributes.width.trim() : undefined)
  if (raw === undefined) return undefined
  const percent = raw.endsWith('%')
  const digits = raw.slice(0, raw.length - (percent ? 1 : raw.endsWith('px') || raw.endsWith('pt') ? 2 : 0))
  const share = Number(digits)
  if (digits === '' || !Number.isFinite(share) || share <= 0) return undefined
  return { share, percent }
}

const isParagraph = (block: PdfRichBlock): block is PdfRichParagraph => block.type === 'paragraph'

/** What a cell cannot hold, as the error names it. */
const BLOCK_NAMES: Readonly<Record<PdfRichBlock['type'], string>> = {
  paragraph: 'a paragraph',
  heading: 'a heading',
  list: 'a list',
  quote: 'a quote',
  code: 'a code block',
  rule: 'a rule',
  image: 'an image',
  table: 'a table',
  component: 'a component',
}

/**
 * Map a tree of (tag, attributes, children) to the model. Unclosed and wrongly
 * nested markup is already repaired by the tree; this step decides what each
 * tag means. It never throws for content; a tree deeper or larger than the
 * limits fails with `PDF_RICH_TEXT_INVALID`.
 */
export const mapRichTextTree = (tree: readonly PdfRichSourceNode[], source: PdfRichTreeSource = 'html', warnings: RichTextWarnings = createRichTextWarnings()): PdfRichBlock[] => {
  const components = source !== 'html'
  const { lists: noteLists, notes } = notesOf(tree)
  const mappedNotes = new Set<string>()
  // While a note's own content is mapped, a link to a note is a plain link.
  let inNote = false
  let nodes = 0
  let images = 0
  const addImage = (blocks: PdfRichBlock[], attributes: Record<string, unknown>, caption: PdfRichInline[] = []): void => {
    const image = imageOf(attributes, caption, warnings)
    if (image === undefined) return
    images += 1
    if (images > MAX_RICH_TEXT_IMAGES) throw richTextInvalid([limitIssue(source, `more than ${MAX_RICH_TEXT_IMAGES} images, over the limit`)])
    blocks.push(image)
  }
  const visit = (depth: number): void => {
    nodes += 1
    if (nodes > MAX_RICH_TEXT_NODES) throw richTextInvalid([limitIssue(source, `more than ${MAX_RICH_TEXT_NODES} nodes, over the limit`)])
    if (depth > MAX_RICH_TEXT_DEPTH) throw richTextInvalid([limitIssue(source, `nesting depth ${depth} is over the limit of ${MAX_RICH_TEXT_DEPTH}`)])
  }

  /** The text of a code block: every text inside, a `br` as a line break, tags ignored. */
  const plainText = (children: readonly PdfRichSourceNode[], depth: number): string => {
    let text = ''
    for (const child of children) {
      visit(depth)
      if (!isElement(child)) text += child
      else if (tagOf(child) === 'br') text += '\n'
      else if (!RICH_TEXT_DROPPED_TAGS.has(tagOf(child))) text += plainText(childrenOf(child), depth + 1)
    }
    return text
  }

  /**
   * A footnote reference: an `a` whose target is a note of the list, as
   * `[^1]` in Markdown writes it. The first one carries the note, a later
   * one marks it again. Its own text (`[1]`) is not kept: the mark prints
   * the number. A reference to no note fails: from Markdown, comark writes
   * it as a plain `span` with `^label`; in HTML it is a `sup` with class
   * `footnote-ref`. Without a note the text would print as a stray `^1`.
   */
  const footnoteItem = (element: Exclude<PdfRichSourceNode, string>, tag: string, depth: number): Item | undefined => {
    if (inNote) return undefined
    const href = element[1].href
    const id = tag === 'a' && typeof href === 'string' && href.startsWith('#') ? href.slice(1) : undefined
    if (id !== undefined && notes.has(id)) {
      if (mappedNotes.has(id)) return { kind: 'footnote', node: { type: 'footnote', key: id }, link: undefined }
      mappedNotes.add(id)
      const content: Item[] = []
      inNote = true
      lineItems(noteLine(notes.get(id)!, id, source), ROOT_CONTEXT, depth + 1, content)
      inNote = false
      const children = toInlines(content)
      // A note that keeps no text, such as one that is only a component
      // (`[^1]: :alert`), would be a footnote with an empty note.
      if (children.length === 0) throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: source, message: `the footnote "${id}" has no text in its note. Write the note as text, such as "[^1]: The note."` }])
      return { kind: 'footnote', node: { type: 'footnote', key: id, children }, link: undefined }
    }
    const children = childrenOf(element)
    const toNoNote = (child: PdfRichSourceNode): boolean => {
      const target = isElement(child) && tagOf(child) === 'a' ? child[1].href : undefined
      return typeof target === 'string' && target.startsWith('#') && !notes.has(target.slice(1))
    }
    const missing = tag === 'sup' && hasClass(element[1], 'footnote-ref')
      ? children.some(toNoNote)
      : source === 'markdown' && tag === 'span' && Object.keys(element[1]).length === 0 && children.length === 1 && typeof children[0] === 'string' && children[0].startsWith('^')
    if (missing) throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: source, message: 'a footnote reference has no note: write its definition, such as "[^1]: The note."' }])
    return undefined
  }

  /** Inline content of a heading or a caption: blocks inside it join the line, as their text. */
  const lineItems = (children: readonly PdfRichSourceNode[], context: Context, depth: number, items: Item[]): void => {
    for (const child of children) {
      visit(depth)
      if (!isElement(child)) {
        items.push({ kind: 'text', text: child, marks: context.marks, link: context.link, verticalAlign: context.verticalAlign })
        continue
      }
      const tag = tagOf(child)
      if (RICH_TEXT_DROPPED_TAGS.has(tag)) continue
      const footnote = footnoteItem(child, tag, depth)
      if (footnote !== undefined) {
        items.push(footnote)
        continue
      }
      if (tag === 'br') items.push({ kind: 'break', link: context.link })
      else if (components && isRichTextComponentTag(tag)) {
        inlineComponent(child)
        lineItems(inlineComponentContent(child), context, depth + 1, items)
      }
      else lineItems(childrenOf(child), inlineContext(child, tag, context), depth + 1, items)
    }
  }

  const inlineContext = (element: Exclude<PdfRichSourceNode, string>, tag: string, context: Context): Context => {
    const mark = MARK_OF.get(tag)
    if (mark !== undefined) return context.marks.has(mark) ? context : { ...context, marks: new Set([...context.marks, mark]) }
    // A `sup` or `sub` inside another keeps the outer place, as a link inside a link joins the outer link.
    const verticalAlign = VERTICAL_ALIGN_OF.get(tag)
    if (verticalAlign !== undefined) return context.verticalAlign === undefined ? { ...context, verticalAlign } : context
    const href = element[1].href
    if (tag === 'a' && typeof href === 'string') {
      // A link inside a link joins the outer link; a target off the list keeps its text without a link.
      if (context.link !== undefined) {
        warnings.add('PDF_RICH_TEXT_LINK_DROPPED', 'nested', attributeSnippet('href', href), () => 'A link inside another link joins the outer link.')
      }
      else if (isAllowedLinkUri(href)) return { ...context, link: { href: href.trim() } }
      else {
        const kind = linkKind(href)
        warnings.add('PDF_RICH_TEXT_LINK_DROPPED', kind, attributeSnippet('href', href), () => linkMessage(kind))
      }
    }
    return context
  }

  /** A comark component where a component is not a block: its text stays. */
  const inlineComponent = (element: Exclude<PdfRichSourceNode, string>): void => {
    const name = element[0]
    warnings.add('PDF_RICH_TEXT_COMPONENT_DROPPED', name, tagSnippet(name, element[1]), () => `The component ${name} inside a paragraph, a list item, a heading or a caption prints its text only: a component is a block. Put it on a line of its own.`)
  }

  /** A link around an image: the image prints without it. */
  const imageInLink = (context: Context): void => {
    if (context.link === undefined) return
    warnings.add('PDF_RICH_TEXT_LINK_DROPPED', 'image', attributeSnippet('href', context.link.href), () => 'A link around an image is not kept: the image prints without it.')
  }

  /**
   * The slots of a comark component. A `template` child with a `name` is a
   * named slot, as comark writes `#title`; `#default`, a `template` without a
   * name and loose content fill the default slot.
   */
  const slotsOf = (element: Exclude<PdfRichSourceNode, string>): { named: Array<[string, readonly PdfRichSourceNode[]]>, loose: PdfRichSourceNode[] } => {
    const loose: PdfRichSourceNode[] = []
    const named: Array<[string, readonly PdfRichSourceNode[]]> = []
    for (const child of childrenOf(element)) {
      if (!isElement(child) || tagOf(child) !== 'template') {
        loose.push(child)
        continue
      }
      const slotName = child[1].name
      if (typeof slotName !== 'string' || slotName === 'default' || !isRichTextPropName(slotName)) loose.push(...childrenOf(child))
      else named.push([slotName, childrenOf(child)])
    }
    return { named, loose }
  }

  /**
   * The content of a comark component that is not a block (inside a
   * paragraph, a list item or a heading): its text, first its named slots,
   * then its default content, as a component without a mapping prints.
   */
  const inlineComponentContent = (element: Exclude<PdfRichSourceNode, string>): PdfRichSourceNode[] => {
    const { named, loose } = slotsOf(element)
    return [...named.flatMap(([, children]) => children), ...loose]
  }

  /** A component block, with its named slots and its default content. */
  const componentOf = (element: Exclude<PdfRichSourceNode, string>, context: Context, depth: number): PdfRichComponent => {
    const { named, loose } = slotsOf(element)
    const slots = named.map(([name, children]): [string, PdfRichBlock[]] => {
      visit(depth)
      return [name, container(children, context, depth + 1, true)]
    })
    const block: PdfRichComponent = { type: 'component', name: element[0], props: propsOf(element[0], element[1], warnings), children: container(loose, context, depth, true) }
    if (slots.length > 0) block.slots = Object.fromEntries(slots)
    return block
  }

  /**
   * Blocks from the children of a container (the root, `div`, `p`, `li`,
   * `blockquote`, a component). Loose inline content between blocks becomes a
   * paragraph. A block inside an inline tag ends the paragraph before it, and
   * the marks and link of that inline tag apply to the text of the block.
   * `componentsHere`: a comark component here is a block (the root, a quote,
   * another component). Elsewhere (a paragraph, a list item, a heading) it is
   * inline, and its content stays as text, as an unknown tag's does.
   */
  const container = (children: readonly PdfRichSourceNode[], context: Context, depth: number, componentsHere = false): PdfRichBlock[] => {
    const blocks: PdfRichBlock[] = []
    let items: Item[] = []
    const flush = (): void => {
      const inlines = toInlines(items)
      items = []
      if (inlines.length > 0) blocks.push({ type: 'paragraph', children: inlines })
    }

    const walk = (nodes: readonly PdfRichSourceNode[], context: Context, depth: number, blockLevel: boolean): void => {
      for (const node of nodes) {
        visit(depth)
        if (!isElement(node)) {
          items.push({ kind: 'text', text: node, marks: context.marks, link: context.link, verticalAlign: context.verticalAlign })
          continue
        }
        const tag = tagOf(node)
        if (RICH_TEXT_DROPPED_TAGS.has(tag) || noteLists.has(node)) continue
        const footnote = footnoteItem(node, tag, depth)
        if (footnote !== undefined) {
          items.push(footnote)
          continue
        }
        const children = childrenOf(node)
        if (tag === 'br') {
          items.push({ kind: 'break', link: context.link })
          continue
        }
        const level = HEADING_LEVEL.get(tag)
        if (level !== undefined) {
          flush()
          const headingContent: Item[] = []
          lineItems(children, context, depth + 1, headingContent)
          const inlines = toInlines(headingContent)
          if (inlines.length > 0) blocks.push({ type: 'heading', level, children: inlines })
          continue
        }
        if (tag === 'img') {
          // An image is a block: inside a paragraph it ends the paragraph, as
          // a block inside an inline tag does. A link around it is not kept.
          flush()
          imageInLink(context)
          addImage(blocks, node[1])
          continue
        }
        if (tag === 'figure') {
          // A figure with one image and at most a caption is that image with
          // its caption; any other figure keeps its content as a container.
          const parts = children.filter(child => isElement(child) || collapse(child).trim() !== '')
          const imageNode = parts.find(child => isElement(child) && tagOf(child) === 'img')
          const captionNode = parts.find(child => isElement(child) && tagOf(child) === 'figcaption')
          const others = parts.filter(child => child !== imageNode && child !== captionNode)
          if (imageNode !== undefined && isElement(imageNode) && others.length === 0) {
            flush()
            imageInLink(context)
            const captionItems: Item[] = []
            if (captionNode !== undefined && isElement(captionNode)) lineItems(childrenOf(captionNode), context, depth + 2, captionItems)
            addImage(blocks, imageNode[1], toInlines(captionItems))
            continue
          }
        }
        if (components && blockLevel && isRichTextComponentTag(tag)) {
          flush()
          blocks.push(componentOf(node, context, depth + 1))
          continue
        }
        if (tag === 'table') {
          flush()
          blocks.push(...tableOf(children, context, depth + 1))
          continue
        }
        if (CONTAINERS.has(tag)) {
          flush()
          blocks.push(...container(children, context, depth + 1))
          continue
        }
        if (tag === 'ul' || tag === 'ol') {
          flush()
          const list = listOf(tag === 'ol', node[1].start, children, context, depth + 1)
          if (list !== undefined) blocks.push(list)
          continue
        }
        if (tag === 'li') {
          // An item outside a list: its content stays, without a marker.
          flush()
          blocks.push(...container(children, context, depth + 1))
          continue
        }
        if (tag === 'blockquote') {
          flush()
          const quoted = container(children, context, depth + 1, true)
          if (quoted.length > 0) blocks.push({ type: 'quote', children: quoted })
          continue
        }
        if (tag === 'pre') {
          flush()
          let text = plainText(children, depth + 1)
          // HTML drops a line break right after `<pre>`; one before `</pre>` adds no line.
          if (text.startsWith('\n')) text = text.slice(1)
          if (text.endsWith('\n')) text = text.slice(0, -1)
          const language = languageOf(node[1], children)
          if (text !== '') blocks.push(language === undefined ? { type: 'code', text } : { type: 'code', text, language })
          continue
        }
        if (tag === 'hr') {
          flush()
          blocks.push({ type: 'rule' })
          continue
        }
        // A comark component that is not a block keeps the text of its slots.
        if (components && isRichTextComponentTag(tag)) {
          inlineComponent(node)
          walk(inlineComponentContent(node), context, depth + 1, false)
          continue
        }
        // An inline mark, a link, `span` or an unknown tag: its content stays.
        walk(children, inlineContext(node, tag, context), depth + 1, false)
      }
    }

    walk(children, context, depth, componentsHere)
    flush()
    return blocks
  }

  /**
   * A list from the children of `ul` or `ol`. Each `li` is an item. Content
   * of another child joins the item before it (a browser shows it there,
   * without a marker), or starts the first item. A list with no item is
   * dropped.
   */
  const listOf = (
    ordered: boolean,
    start: unknown,
    children: readonly PdfRichSourceNode[],
    context: Context,
    depth: number,
  ): PdfRichBlock | undefined => {
    const items: PdfRichBlock[][] = []
    for (const child of children) {
      visit(depth)
      if (isElement(child) && tagOf(child) === 'li') {
        items.push(container(childrenOf(child), context, depth + 1))
        continue
      }
      if (!isElement(child) && collapse(child).trim() === '') continue
      const blocks = container([child], context, depth)
      if (blocks.length === 0) continue
      if (items.length === 0) items.push(blocks)
      else items.at(-1)!.push(...blocks)
    }
    if (items.length === 0) return undefined
    const first = ordered ? startOf(start) : undefined
    if (ordered && start !== undefined && first === undefined) {
      warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', 'start', attributeSnippet('start', start), () => 'An ol start that is not a whole number from 0 is left out: the list starts at 1.')
    }
    return first === undefined || first === 1
      ? { type: 'list', ordered, items }
      : { type: 'list', ordered, start: first, items }
  }

  /**
   * A table from the children of `table`, and before it the content a browser
   * moves out of a table (text or elements outside a cell). The header is the
   * one `thead` row, or a first row of `th` cells only when there is no
   * `thead`. `tfoot` rows print last, once. A cell holds paragraphs only; a
   * header of more rows, a header cell over rows, a footnote in the header
   * and other blocks in a cell fail, so nothing changes without a word.
   */
  const tableOf = (children: readonly PdfRichSourceNode[], context: Context, depth: number): PdfRichBlock[] => {
    const before: PdfRichBlock[] = []
    type Element = Exclude<PdfRichSourceNode, string>
    const head: Element[] = []
    const body: Element[] = []
    const foot: Element[] = []
    const widths: Array<ReturnType<typeof columnWidthOf>> = []
    // The first col that writes a width, for the warning when the widths do not apply.
    let widthColumn: Element | undefined
    let captionNode: Element | undefined
    const fail = (message: string): never => {
      throw richTextInvalid([{ rule: 'PDF-RICH-NODE', path: source, message }])
    }
    const outside = (node: PdfRichSourceNode, at: number): void => {
      if (!isElement(node) && collapse(node).trim() === '') return
      before.push(...container([node], context, at))
    }
    const column = (node: Element): void => {
      const span = spanAttribute(node[1].span) ?? 1
      const width = columnWidthOf(node[1])
      if (node[1].width !== undefined || declarationsOf(node[1].style).has('width')) widthColumn ??= node
      for (let index = 0; index < Math.min(span, MAX_RICH_TABLE_COLUMNS + 1); index += 1) widths.push(width)
    }
    const rowsOf = (nodes: readonly PdfRichSourceNode[], into: Element[], at: number): void => {
      for (const node of nodes) {
        visit(at)
        if (isElement(node) && tagOf(node) === 'tr') into.push(node)
        else outside(node, at)
      }
    }
    for (const child of children) {
      visit(depth)
      const tag = isElement(child) ? tagOf(child) : undefined
      if (!isElement(child) || tag === undefined) outside(child, depth)
      else if (RICH_TEXT_DROPPED_TAGS.has(tag)) continue
      else if (tag === 'caption') captionNode ??= child
      else if (tag === 'colgroup') {
        const cols = childrenOf(child).filter(isElement).filter(node => tagOf(node) === 'col')
        if (cols.length > 0) cols.forEach(column)
        else column(child)
      }
      else if (tag === 'col') column(child)
      else if (tag === 'thead') rowsOf(childrenOf(child), head, depth + 1)
      else if (tag === 'tbody') rowsOf(childrenOf(child), body, depth + 1)
      else if (tag === 'tfoot') rowsOf(childrenOf(child), foot, depth + 1)
      else if (tag === 'tr') body.push(child)
      else outside(child, depth)
    }

    // In print order, so the notes of footnotes number in that order too.
    const captionItems: Item[] = []
    if (captionNode !== undefined) lineItems(childrenOf(captionNode), context, depth + 1, captionItems)
    const caption = toInlines(captionItems)
    const cellsOf = (row: Element, inHead: boolean): PdfRichTableCell[] => {
      const cells: PdfRichTableCell[] = []
      for (const node of childrenOf(row)) {
        visit(depth + 1)
        const tag = isElement(node) ? tagOf(node) : undefined
        if (!isElement(node) || (tag !== 'td' && tag !== 'th')) {
          outside(node, depth + 1)
          continue
        }
        const blocks = container(childrenOf(node), context, depth + 2)
        const other = blocks.find(block => !isParagraph(block))
        if (other !== undefined) fail(`a table cell holds ${BLOCK_NAMES[other.type]}, but a cell holds text and paragraphs only. Move it out of the table`)
        const cell: PdfRichTableCell = { children: blocks.filter(isParagraph) }
        const colspan = spanAttribute(node[1].colspan)
        const rowspan = spanAttribute(node[1].rowspan)
        for (const name of ['colspan', 'rowspan'] as const) {
          const value = node[1][name]
          if (value !== undefined && !isSpan(value)) {
            warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', name, attributeSnippet(name, value), () => `A ${name} that is not a whole number from 1 counts as 1.`)
          }
        }
        const align = cellAlignOf(node[1])
        if (colspan !== undefined) cell.colspan = colspan
        if (rowspan !== undefined) cell.rowspan = rowspan
        if (align !== undefined) cell.align = align
        if (tag === 'th' && !inHead) cell.header = true
        cells.push(cell)
      }
      return cells
    }
    if (head.length > 1) fail(`a table has ${head.length} header rows, but its header is one row that repeats on every page. Put the other rows in the body (tbody)`)
    let header = head.length === 1 ? cellsOf(head[0]!, true) : undefined
    if (header?.length === 0) header = undefined
    const rows = [...body, ...foot].map(row => cellsOf(row, false))
    // Without thead, a first row of th cells only is the header, as HTML reads it.
    const first = rows[0]
    if (header === undefined && first !== undefined && first.length > 0 && first.every(cell => cell.header === true && cell.rowspan === undefined)) {
      header = first.map(({ header: _header, ...cell }) => cell)
      rows.shift()
    }
    if (header?.some(cell => cell.rowspan !== undefined)) fail('a table header cell spans rows, but the header is one row that repeats on every page')
    if (header?.some(cell => cell.children.some(paragraph => paragraph.children.some(inline => inline.type === 'footnote')))) {
      fail('a table header cell holds a footnote, but the header repeats on every page, and so would its note. Move the footnote into a body row or the text')
    }

    const layout = richTableLayout(header ?? [], rows)
    if (layout.columns > MAX_RICH_TABLE_COLUMNS) {
      throw richTextInvalid([limitIssue(source, `a table has ${layout.columns} columns, over the limit of ${MAX_RICH_TABLE_COLUMNS}`)])
    }
    // A span that runs into a row span from above or past the last row is cut to what fits, as a browser draws it.
    for (const problem of layout.problems) {
      const cell = rows[problem.row]![problem.cell]!
      warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', problem.span, attributeSnippet(problem.span, cell[problem.span]), () => `A ${problem.span} that runs into a row span from above or past the last row is cut to what fits, as a browser draws it.`)
      if (problem.fits > 1) cell[problem.span] = problem.fits
      else if (problem.span === 'colspan') delete cell.colspan
      else delete cell.rowspan
    }
    if (layout.columns === 0) return before
    const table: PdfRichTable = { type: 'table', rows }
    // The proportions of the columns from col elements, as shares: only when
    // each column has a width, all in px or pt or all in percent. The table
    // then fills its room, so screen widths never make it wider than the page.
    const shares = widths.flatMap(width => width === undefined ? [] : [width.share])
    const kinds = new Set(widths.map(width => width?.percent))
    if (widths.length === layout.columns && shares.length === widths.length && kinds.size === 1) table.columns = shares
    else if (widthColumn !== undefined) {
      warnings.add('PDF_RICH_TEXT_VALUE_CHANGED', 'width', tagSnippet(widthColumn[0], widthColumn[1]), () => 'Column widths apply only when every column has one, all in px or pt or all in %: the columns share the width equally.')
    }
    if (header !== undefined) table.header = header
    if (caption.length > 0) table.caption = caption
    return [...before, table]
  }

  /**
   * Tags and attributes the model does not keep. It runs after the mapping,
   * which already checked the depth and size limits of the tree. A dropped
   * tag is reported once, not its content; the attributes of a comark
   * component are its props (`propsOf`), and a `template` directly inside it
   * is a slot.
   */
  const reportMarkup = (nodes: readonly PdfRichSourceNode[]): void => {
    for (const node of nodes) {
      if (!isElement(node)) continue
      const tag = tagOf(node)
      if (components && isRichTextComponentTag(tag)) {
        for (const child of childrenOf(node)) reportMarkup(isElement(child) && tagOf(child) === 'template' ? childrenOf(child) : [child])
        continue
      }
      if (RICH_TEXT_DROPPED_TAGS.has(tag)) {
        warnings.add('PDF_RICH_TEXT_TAG_DROPPED', tag, tagSnippet(node[0], node[1]), () => `<${tag}> is dropped with its content: code, embedded objects and page metadata are not article text.`)
        continue
      }
      if (!KNOWN_TAGS.has(tag)) {
        warnings.add('PDF_RICH_TEXT_TAG_UNKNOWN', tag, tagSnippet(node[0], node[1]), () => `<${tag}> is not on the allowlist: its content prints without its formatting.`)
      }
      for (const [key, value] of Object.entries(node[1])) {
        const name = key.toLowerCase()
        if (name === 'id' || name.startsWith('data-footnote') || READ_ATTRIBUTES.get(tag)?.has(name)) continue
        if (name === 'class' && isReadClass(tag, value)) continue
        if (name === 'style' && [...declarationsOf(value).keys()].every(declaration => READ_DECLARATIONS.get(tag)?.has(declaration))) continue
        const grouped = name.startsWith('data-') ? 'data-*' : name.startsWith('aria-') ? 'aria-*' : name
        warnings.add('PDF_RICH_TEXT_ATTRIBUTE_DROPPED', grouped, attributeSnippet(key, value), () => attributeMessage(grouped, `<${tag}>`))
      }
      reportMarkup(childrenOf(node))
    }
  }

  const blocks = container(tree, ROOT_CONTEXT, 1, true)
  reportMarkup(tree)
  return blocks
}
