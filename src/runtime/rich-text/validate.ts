import { isAllowedLinkUri } from '../shared/link-target'
import { isPdfTableColumnWidth } from '../primitives'
import { describePdfValue } from '../shared/describe-value'
import { isAsciiLetter } from './html'
import {
  limitIssue,
  MAX_RICH_TEXT_ALT_LENGTH,
  MAX_RICH_TEXT_DEPTH,
  MAX_RICH_TEXT_IMAGE_SIZE,
  MAX_RICH_TEXT_IMAGE_SRC_LENGTH,
  MAX_RICH_TEXT_IMAGES,
  MAX_RICH_TEXT_ISSUES,
  MAX_RICH_TEXT_LENGTH,
  MAX_RICH_TEXT_NODES,
  richTextInvalid,
} from './limits'
import { MAX_RICH_TABLE_COLUMNS, richTableLayout } from './table'
import type { PdfRichBlock, PdfRichTableCell, PdfRichTextIssue } from './types'

/** The marks a text run can carry, in the order the model writes them. */
export const RICH_TEXT_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const
const FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  text: new Set(['type', 'text', ...RICH_TEXT_MARKS, 'verticalAlign']),
  link: new Set(['type', 'href', 'children']),
  break: new Set(['type']),
  footnote: new Set(['type', 'key', 'children']),
  paragraph: new Set(['type', 'children']),
  heading: new Set(['type', 'level', 'children']),
  list: new Set(['type', 'ordered', 'start', 'items']),
  quote: new Set(['type', 'children']),
  code: new Set(['type', 'text', 'language']),
  rule: new Set(['type']),
  image: new Set(['type', 'src', 'alt', 'width', 'height', 'caption']),
  table: new Set(['type', 'columns', 'header', 'rows', 'caption']),
  cell: new Set(['children', 'colspan', 'rowspan', 'align', 'header']),
  component: new Set(['type', 'name', 'props', 'children', 'slots']),
}
const INLINE_TYPES = ['text', 'link', 'break', 'footnote']
const BLOCK_TYPES = ['paragraph', 'heading', 'list', 'quote', 'code', 'rule', 'image', 'table', 'component']
const ALIGNS: readonly unknown[] = ['left', 'center', 'right']

/** The unit of a column width for adding widths up: `'%'`, `'pt'`, `'mm'` …, or `'auto'` and `'share'`. */
const widthKind = (width: unknown): string =>
  typeof width === 'number' ? 'share' : width === 'auto' ? 'auto' : String(width).replace(/^[\d.+-]+/, '')

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An object literal or `JSON.parse` result: not a class instance, a Map or a Date. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * A prop or slot name a Vue component can take: a letter or `_`, then
 * letters, digits, `_` and `-`, at most 64 characters, and never
 * `__proto__`, which would change the prototype of the props object.
 */
export const isRichTextPropName = (name: string): boolean => {
  if (name === '' || name.length > 64 || name === '__proto__') return false
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    const allowed = isAsciiLetter(code) || code === 95 || (index > 0 && ((code >= 48 && code <= 57) || code === 45))
    if (!allowed) return false
  }
  return true
}

/** Stops a walk over input: the issue list is full, or a limit was passed. */
export class StopWalk extends Error {}

/**
 * Check a rich text model, as a project's CMS mapping builds it, against the
 * model types and the limits. Returns every problem found (at most
 * `MAX_RICH_TEXT_ISSUES`), each with the path of the node or field
 * (`content[2].items[0][1].children[3].href`); an empty list means
 * `PdfRichText` renders it. It never throws for the content, so a form or a
 * CMS hook can show the issues. A message names the field and the wrong value
 * (cut at 40 characters), never the text of the article.
 */
export const validateRichText = (content: unknown, path = 'content'): PdfRichTextIssue[] => {
  const issues: PdfRichTextIssue[] = []
  let nodes = 0
  let characters = 0
  let images = 0

  const add = (issue: PdfRichTextIssue): void => {
    issues.push(issue)
    if (issues.length >= MAX_RICH_TEXT_ISSUES) throw new StopWalk()
  }
  const wrong = (at: string, message: string): void => add({ rule: 'PDF-RICH-NODE', path: at, message })
  const stopAtLimit = (at: string, message: string): never => {
    issues.push(limitIssue(at, message))
    throw new StopWalk()
  }

  /** Counts a node, a JSON value included, and checks its depth. */
  const count = (at: string, depth: number): void => {
    if (depth > MAX_RICH_TEXT_DEPTH) stopAtLimit(at, `nesting depth ${depth} is over the limit of ${MAX_RICH_TEXT_DEPTH}`)
    nodes += 1
    if (nodes > MAX_RICH_TEXT_NODES) stopAtLimit(at, `${nodes} nodes are over the limit of ${MAX_RICH_TEXT_NODES}`)
  }

  /** Counts a node; false when the value is not a node object. */
  const enter = (value: unknown, at: string, depth: number): value is Record<string, unknown> => {
    count(at, depth)
    if (isRecord(value)) return true
    wrong(at, `expected a node object, found ${describePdfValue(value)}`)
    return false
  }

  const checkFields = (node: Record<string, unknown>, type: string, at: string): void => {
    const allowed = FIELDS[type]!
    for (const key of Object.keys(node)) {
      if (!allowed.has(key)) wrong(`${at}.${key}`, `a ${type} node has no field "${key.slice(0, 40)}"`)
    }
  }

  const text = (value: unknown, at: string): void => {
    if (typeof value !== 'string') {
      wrong(at, `expected a string, found ${describePdfValue(value)}`)
      return
    }
    characters += value.length
    if (characters > MAX_RICH_TEXT_LENGTH) stopAtLimit(at, `the text is longer than the limit of ${MAX_RICH_TEXT_LENGTH} characters`)
  }

  const list = (value: unknown, at: string, each: (item: unknown, itemPath: string) => void): void => {
    if (!Array.isArray(value)) {
      wrong(at, `expected an array, found ${describePdfValue(value)}`)
      return
    }
    value.forEach((item, index) => each(item, `${at}[${index}]`))
  }

  // Footnote keys in model order: a repeat must name an earlier note.
  const noteKeys = new Set<string>()
  const inline = (value: unknown, at: string, depth: number, inLink: boolean, inNote = false): void => {
    if (!enter(value, at, depth)) return
    const type = value.type
    if (typeof type !== 'string' || !INLINE_TYPES.includes(type)) {
      wrong(`${at}.type`, `expected "text", "link", "break" or "footnote" inline, found ${describePdfValue(type)}`)
      return
    }
    checkFields(value, type, at)
    if (type === 'text') {
      text(value.text, `${at}.text`)
      for (const mark of RICH_TEXT_MARKS) {
        if (value[mark] !== undefined && typeof value[mark] !== 'boolean') {
          wrong(`${at}.${mark}`, `expected true or false, found ${describePdfValue(value[mark])}`)
        }
      }
      if (value.verticalAlign !== undefined && value.verticalAlign !== 'super' && value.verticalAlign !== 'sub') {
        wrong(`${at}.verticalAlign`, `expected "super" or "sub", found ${describePdfValue(value.verticalAlign)}`)
      }
    }
    else if (type === 'link') {
      if (inLink) wrong(at, 'a link cannot be inside a link')
      if (typeof value.href !== 'string' || !isAllowedLinkUri(value.href)) {
        wrong(`${at}.href`, `expected an absolute http:, https:, mailto: or tel: URL, found ${describePdfValue(value.href)}`)
      }
      list(value.children, `${at}.children`, (child, childPath) => inline(child, childPath, depth + 1, true, inNote))
    }
    else if (type === 'footnote') footnote(value, at, depth, inLink, inNote)
  }

  const footnote = (value: Record<string, unknown>, at: string, depth: number, inLink: boolean, inNote: boolean): void => {
    if (inLink) wrong(at, 'a footnote cannot be inside a link: its mark is a link to the note')
    if (inNote) wrong(at, 'a footnote cannot be inside the note of another footnote')
    const key = value.key
    if (key !== undefined && (typeof key !== 'string' || key === '' || key.length > 64)) {
      wrong(`${at}.key`, `expected a key of 1 to 64 characters, found ${describePdfValue(key)}`)
    }
    if (value.children === undefined) {
      if (typeof key !== 'string') wrong(at, 'expected "children" (the note), or the "key" of an earlier footnote to mark it again')
      else if (!noteKeys.has(key)) wrong(`${at}.key`, `no earlier footnote has the key ${describePdfValue(key)}`)
      return
    }
    if (typeof key === 'string') {
      if (noteKeys.has(key)) wrong(`${at}.key`, `an earlier footnote has the key ${describePdfValue(key)}; leave out "children" to mark that note again`)
      noteKeys.add(key)
    }
    if (Array.isArray(value.children) && value.children.length === 0) wrong(`${at}.children`, 'expected the note, found an empty array')
    list(value.children, `${at}.children`, (child, childPath) => inline(child, childPath, depth + 1, false, true))
  }

  const blocks = (value: unknown, at: string, depth: number): void =>
    list(value, at, (child, childPath) => block(child, childPath, depth))

  const block = (value: unknown, at: string, depth: number): void => {
    if (!enter(value, at, depth)) return
    const type = value.type
    if (typeof type !== 'string' || !BLOCK_TYPES.includes(type)) {
      wrong(`${at}.type`, `expected a block type (${BLOCK_TYPES.join(', ')}), found ${describePdfValue(type)}`)
      return
    }
    checkFields(value, type, at)
    const children = (): void => list(value.children, `${at}.children`, (child, childPath) => inline(child, childPath, depth + 1, false))
    switch (type) {
      case 'paragraph':
        children()
        break
      case 'heading':
        if (typeof value.level !== 'number' || !Number.isInteger(value.level) || value.level < 1 || value.level > 6) {
          wrong(`${at}.level`, `expected a whole number from 1 to 6, found ${describePdfValue(value.level)}`)
        }
        children()
        break
      case 'list':
        if (typeof value.ordered !== 'boolean') wrong(`${at}.ordered`, `expected true or false, found ${describePdfValue(value.ordered)}`)
        if (value.start !== undefined && !(typeof value.start === 'number' && Number.isSafeInteger(value.start) && value.start >= 0)) {
          wrong(`${at}.start`, `expected a whole number from 0, found ${describePdfValue(value.start)}`)
        }
        list(value.items, `${at}.items`, (item, itemPath) => blocks(item, itemPath, depth + 1))
        break
      case 'quote':
        blocks(value.children, `${at}.children`, depth + 1)
        break
      case 'code':
        text(value.text, `${at}.text`)
        if (value.language !== undefined) text(value.language, `${at}.language`)
        break
      case 'image': {
        images += 1
        if (images > MAX_RICH_TEXT_IMAGES) stopAtLimit(at, `more than ${MAX_RICH_TEXT_IMAGES} images, over the limit`)
        // Only the shape is checked here: whether the source may load is
        // decided when the PDF renders, by the rules of every PdfImage.
        if (typeof value.src !== 'string' || value.src.trim() === '' || value.src.length > MAX_RICH_TEXT_IMAGE_SRC_LENGTH) {
          wrong(`${at}.src`, `expected a path or URL of 1 to ${MAX_RICH_TEXT_IMAGE_SRC_LENGTH} characters, found ${describePdfValue(value.src)}`)
        }
        if (value.alt !== undefined) {
          if (typeof value.alt !== 'string' || value.alt.trim() === '') wrong(`${at}.alt`, `expected a non-empty string, found ${describePdfValue(value.alt)}`)
          else if (value.alt.length > MAX_RICH_TEXT_ALT_LENGTH) add(limitIssue(`${at}.alt`, `the alt text is longer than the limit of ${MAX_RICH_TEXT_ALT_LENGTH} characters`))
          else text(value.alt, `${at}.alt`)
        }
        for (const side of ['width', 'height'] as const) {
          const size = value[side]
          if (size !== undefined && !(typeof size === 'number' && Number.isFinite(size) && size > 0 && size <= MAX_RICH_TEXT_IMAGE_SIZE)) {
            wrong(`${at}.${side}`, `expected a number of points above 0 and at most ${MAX_RICH_TEXT_IMAGE_SIZE}, found ${describePdfValue(size)}`)
          }
        }
        if (value.caption !== undefined) list(value.caption, `${at}.caption`, (child, childPath) => inline(child, childPath, depth + 1, false))
        break
      }
      case 'table':
        table(value, at, depth)
        break
      case 'component':
        if (typeof value.name !== 'string' || value.name === '' || value.name.length > 64) {
          wrong(`${at}.name`, `expected a name of 1 to 64 characters, found ${describePdfValue(value.name)}`)
        }
        props(value.props, `${at}.props`, depth + 1)
        blocks(value.children, `${at}.children`, depth + 1)
        if (value.slots !== undefined) slots(value.slots, `${at}.slots`, depth + 1)
        break
    }
  }

  /** A cell; false when it is not a cell object. */
  const cell = (value: unknown, at: string, depth: number, inHeader: boolean): value is PdfRichTableCell => {
    if (!enter(value, at, depth)) return false
    checkFields(value, 'cell', at)
    list(value.children, `${at}.children`, (child, childPath) => {
      if (isRecord(child) && child.type !== 'paragraph') {
        count(childPath, depth + 1)
        wrong(`${childPath}.type`, `expected "paragraph": a table cell holds paragraphs only, found ${describePdfValue(child.type)}`)
        return
      }
      block(child, childPath, depth + 1)
      if (inHeader && isRecord(child) && Array.isArray(child.children) && child.children.some(inline => isRecord(inline) && inline.type === 'footnote')) {
        wrong(childPath, 'a header cell cannot hold a footnote: the header repeats on every page, and so would its note')
      }
    })
    for (const key of ['colspan', 'rowspan'] as const) {
      const span = value[key]
      if (span !== undefined && !(typeof span === 'number' && Number.isSafeInteger(span) && span >= 1)) {
        wrong(`${at}.${key}`, `expected a whole number from 1, found ${describePdfValue(span)}`)
      }
    }
    if (inHeader && typeof value.rowspan === 'number' && value.rowspan > 1) wrong(`${at}.rowspan`, 'a header cell cannot span rows: the header repeats as one row')
    if (value.align !== undefined && !ALIGNS.includes(value.align)) wrong(`${at}.align`, `expected "left", "center" or "right", found ${describePdfValue(value.align)}`)
    if (value.header !== undefined && typeof value.header !== 'boolean') wrong(`${at}.header`, `expected true or false, found ${describePdfValue(value.header)}`)
    return true
  }

  /** A table: its cells, then whether the spans and the column widths fit together, as PdfTable places them. */
  const table = (value: Record<string, unknown>, at: string, depth: number): void => {
    const before = issues.length
    const header: PdfRichTableCell[] = []
    const rows: PdfRichTableCell[][] = []
    if (value.header !== undefined) {
      list(value.header, `${at}.header`, (item, itemPath) => {
        if (cell(item, itemPath, depth + 1, true)) header.push(item)
      })
    }
    list(value.rows, `${at}.rows`, (row, rowPath) => {
      const cells: PdfRichTableCell[] = []
      rows.push(cells)
      list(row, rowPath, (item, itemPath) => {
        if (cell(item, itemPath, depth + 1, false)) cells.push(item)
      })
    })
    if (value.caption !== undefined) list(value.caption, `${at}.caption`, (child, childPath) => inline(child, childPath, depth + 1, false))
    // The placement needs well-formed cells.
    if (issues.length > before) return
    const layout = richTableLayout(header, rows)
    if (layout.columns === 0) {
      wrong(`${at}.rows`, 'expected at least one cell')
      return
    }
    if (layout.columns > MAX_RICH_TABLE_COLUMNS) add(limitIssue(at, `${layout.columns} columns are over the limit of ${MAX_RICH_TABLE_COLUMNS}`))
    for (const problem of layout.problems) {
      const cellPath = `${at}.rows[${problem.row}][${problem.cell}]`
      const start = layout.starts[problem.row]![problem.cell]!
      const span = rows[problem.row]![problem.cell]![problem.span]
      wrong(`${cellPath}.${problem.span}`, problem.span === 'colspan'
        ? `the cell spans ${span} columns, but a rowspan from a row above takes column ${start + problem.fits + 1}`
        : `the cell spans ${span} rows, but the table has only ${problem.fits} rows from its row to the end`)
    }
    if (value.columns === undefined) return
    if (!Array.isArray(value.columns) || value.columns.length !== layout.columns) {
      wrong(`${at}.columns`, `expected ${layout.columns} column widths, one per column, found ${describePdfValue(value.columns)}`)
      return
    }
    const widths: readonly unknown[] = value.columns
    widths.forEach((width, index) => {
      if (!isPdfTableColumnWidth(width)) wrong(`${at}.columns[${index}]`, `expected a share above 0, 'auto', or a width such as '30%' or '80pt', found ${describePdfValue(width)}`)
    })
    // The two span rules of PdfTable that depend on the widths: units that add up, and no percentage beside a measured width.
    const measured = widths.includes('auto')
    const spanned = [header.map((item, index) => ({ item, start: header.slice(0, index).reduce((sum, previous) => sum + (previous.colspan ?? 1), 0), at: `${at}.header[${index}]` })),
      ...rows.map((cells, row) => cells.map((item, index) => ({ item, start: layout.starts[row]![index]!, at: `${at}.rows[${row}][${index}]` })))].flat()
    for (const { item, start, at: cellPath } of spanned) {
      const kinds = new Set(widths.slice(start, start + (item.colspan ?? 1)).map(widthKind))
      const lengths = [...kinds].filter(kind => kind !== 'auto' && kind !== 'share' && kind !== '%')
      if (lengths.length > 1) wrong(`${cellPath}.colspan`, `the cell spans columns in ${lengths.map(kind => `"${kind}"`).join(' and ')}, whose widths cannot be added`)
      else if (measured && kinds.has('%') && (kinds.has('auto') || kinds.has('share'))) {
        wrong(`${cellPath}.colspan`, 'the cell spans a percentage column and an \'auto\' or share column of a table with \'auto\' columns')
      }
    }
  }

  const named = (value: unknown, at: string, each: (item: unknown, itemPath: string) => void): void => {
    if (!isPlainObject(value)) {
      wrong(at, `expected a plain object, found ${describePdfValue(value)}`)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      const keyPath = `${at}.${key.slice(0, 40)}`
      if (!isRichTextPropName(key)) wrong(keyPath, `expected a name of letters, digits, "_" and "-", found ${describePdfValue(key)}`)
      else each(item, keyPath)
    }
  }

  const props = (value: unknown, at: string, depth: number): void => named(value, at, (item, itemPath) => json(item, itemPath, depth))
  const slots = (value: unknown, at: string, depth: number): void => named(value, at, (item, itemPath) => blocks(item, itemPath, depth))

  /** A plain JSON value, counted like a node; its strings count toward the text limit. */
  const json = (value: unknown, at: string, depth: number): void => {
    count(at, depth)
    if (typeof value === 'string') text(value, at)
    else if (typeof value === 'number') {
      if (!Number.isFinite(value)) wrong(at, `expected a finite number, found ${describePdfValue(value)}`)
    }
    else if (typeof value === 'boolean' || value === null) return
    else if (Array.isArray(value)) value.forEach((item, index) => json(item, `${at}[${index}]`, depth + 1))
    else if (isPlainObject(value)) named(value, at, (item, itemPath) => json(item, itemPath, depth + 1))
    else wrong(at, `expected a JSON value (string, number, boolean, null, array or object), found ${describePdfValue(value)}`)
  }

  try {
    blocks(content, path, 1)
  }
  catch (error) {
    if (!(error instanceof StopWalk)) throw error
  }
  return issues
}

/** Fails with the typed `PDF_RICH_TEXT_INVALID` error and every issue unless the model is valid. */
export function assertRichText(content: unknown, path = 'content'): asserts content is PdfRichBlock[] {
  const issues = validateRichText(content, path)
  if (issues.length > 0) throw richTextInvalid(issues)
}
