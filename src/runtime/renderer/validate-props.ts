// Checks of one node on its own: each prop value against its `PdfPropCheck`
// (`PROP_CHECKS`) and the style object. No tree state; the walk in
// validate-tree.ts calls them.
import { treeInvalid } from '../shared/errors'
import { PDF_STYLE_VALUES } from '../authoring'
import { describePdfValue } from '../shared/describe-value'
import { isAllowedLinkUri, LINK_SCHEMES } from '../shared/link-target'
import { DECIMAL, PAGE_DIMENSION, pdfStyleValueProblem, svgColorProblem } from '../shared/style-values'
import { winAnsiCode } from '../shared/win-ansi'
import {
  isPdfTableColumnWidth,
  PDF_ATTACHMENT_RELATIONSHIPS,
  PDF_CONFORMANCE_LEVELS,
  PDF_CONTENTS_MAX_LEVELS,
  PDF_CONTENTS_TEXT_STYLE_KEYS,
  PDF_ELEMENTS,
  PDF_FACTUR_X_PROFILES,
  PDF_FACTUR_X_RELATIONSHIPS,
  PDF_FIXED_PAGES,
  PDF_RUNNING_AT,
  PDF_PAGE_SIZE_NAMES,
  PDF_PERMISSION_KEYS,
  PDF_PRINTING_PERMISSIONS,
  PDF_TEXT_TAGS,
  PDF_A_LEVELS,
  PDF_VIEW_TAGS,
  type PdfConformance,
  type PdfContentsProps,
  type PdfContentsStyles,
  type PdfDocumentProps,
  type PdfFootnoteStyles,
  type PdfLeaderStyle,
  type PdfPageProps,
  type PdfPropCheck,
  type PdfSvgPresentationProps,
} from '../primitives'
import { pdfElementLabel, type PdfElementNode } from './types'
import { got, hasProp, isPlainObject } from './validate-shared'

const PDF_STYLE_KEYS: ReadonlySet<string> = new Set(Object.keys(PDF_STYLE_VALUES))

const SVG_TRANSFORM_NUMBER = String.raw`[+-]?${DECIMAL}`
const SVG_NUMBER = new RegExp(`^${SVG_TRANSFORM_NUMBER}(%?)$`, 'i')
const SVG_TRANSFORM_OPERATION = String.raw`(?:translate\(${SVG_TRANSFORM_NUMBER}(?:(?:,\s*|\s+)${SVG_TRANSFORM_NUMBER})?\)|rotate\(${SVG_TRANSFORM_NUMBER}\))`
// Case-sensitive: the engine reads the operation names as written.
const SVG_TRANSFORM = new RegExp(`^${SVG_TRANSFORM_OPERATION}(?:\\s+${SVG_TRANSFORM_OPERATION}){0,2}$`)
const PAGE_SIZE_NAMES = new Set<string>(PDF_PAGE_SIZE_NAMES)
// A path separator or control character in an embedded file name can mislead
// the viewer or the reader's file system when the file is saved.
// eslint-disable-next-line no-control-regex -- control characters are what it rejects
const ATTACHMENT_NAME_FORBIDDEN = /[/\\\u0000-\u001F\u007F]/
const MAX_ATTACHMENT_NAME_LENGTH = 255
// `type/subtype`, with the token characters of RFC 6838.
const MIME_TYPE = /^[a-z0-9][\w!$&^.+-]*\/[a-z0-9][\w!$&^.+-]*$/i
const CONFORMANCE_LEVELS = new Set<unknown>(PDF_CONFORMANCE_LEVELS)
const quotedList = (values: readonly string[]): string => {
  const quoted = values.map(item => `"${item}"`)
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`
}

const PROTECTION_KEYS: ReadonlySet<string> = new Set(['openPassword', 'ownerPassword', 'allow'])
const PERMISSION_KEYS: ReadonlySet<string> = new Set(PDF_PERMISSION_KEYS)
const PRINTING_PERMISSIONS: ReadonlySet<unknown> = new Set(PDF_PRINTING_PERMISSIONS)
// The longest password an AES-256 (revision 6) PDF uses: longer ones are
// truncated by every reader (ISO 32000-2, 7.6.4.3.3).
const MAX_PASSWORD_BYTES = 127
// Characters SASLprep (RFC 4013) maps, removes or prohibits: controls,
// format and private-use characters, surrogates, unassigned code points,
// line and paragraph separators, spaces other than U+0020, and the
// "commonly mapped to nothing" characters (the default-ignorable code
// points, which include them, and U+1806).
// A password without them, and unchanged by NFKC, is its own SASLprep form,
// so a reader that applies SASLprep and one that does not derive the same key.
const NOT_SASLPREP_STABLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u1806]|(?! )\p{Zs}/u

/**
 * The problem with a password, or undefined. The text never contains the
 * password: it ends up in errors and logs.
 */
const passwordProblem = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return 'must be a string'
  if (value === '') return 'must not be empty'
  if (NOT_SASLPREP_STABLE.test(value)) return 'must not contain control, format or private-use characters, or spaces other than U+0020'
  if (value.normalize('NFKC') !== value) return 'must not change under Unicode NFKC normalization'
  if (new TextEncoder().encode(value).byteLength > MAX_PASSWORD_BYTES) return `must be at most ${MAX_PASSWORD_BYTES} bytes in UTF-8`
  return undefined
}

// A field name part: no period (it separates the parts of a full name).
const FIELD_NAME = /^[^.\p{Cc}]+$/u
const FIELD_EXPORT_VALUE = /^[\w-]+$/

/**
 * The first character outside WinAnsiEncoding, or undefined. A field's text
 * is written in that encoding, in Helvetica (D22) or in an embedded font in
 * PDF/A (D31).
 */
const nonWinAnsiCharacter = (text: string, lineBreaks: boolean): string | undefined => {
  for (const character of text) {
    if (winAnsiCode(character) !== undefined) continue
    if (lineBreaks && (character === '\n' || character === '\r')) continue
    return character
  }
  return undefined
}

const describeCharacter = (character: string): string =>
  `"${character}" (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`

const parseSvgNumber = (value: unknown): { value: number, percent: boolean } | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, percent: false } : undefined
  }
  if (typeof value !== 'string') return undefined

  const match = SVG_NUMBER.exec(value)
  if (!match) return undefined

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed)
    ? { value: parsed, percent: match[1] === '%' }
    : undefined
}

const pageDimensionIsPositive = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return typeof value === 'string'
    && PAGE_DIMENSION.test(value)
    && Number.parseFloat(value) > 0
}

/** The first of width and height that is not a positive dimension, as the `Got` part of the message. */
const dimensionProblem = (width: unknown, height: unknown): string | undefined => {
  if (!pageDimensionIsPositive(width)) return ` Got width ${describePdfValue(width)}.`
  if (!pageDimensionIsPositive(height)) return ` Got height ${describePdfValue(height)}.`
  return undefined
}

/** What is wrong with a page size, as the `Got` part of the message; undefined when it is valid. */
const pageSizeProblem = (size: unknown): string | undefined => {
  if (typeof size === 'string') return PAGE_SIZE_NAMES.has(size) ? undefined : got(size)
  if (Array.isArray(size)) {
    return size.length === 2 ? dimensionProblem(size[0], size[1]) : ` Got an array of ${size.length} values.`
  }
  if (typeof size === 'object' && size !== null) {
    return dimensionProblem(Reflect.get(size, 'width'), Reflect.get(size, 'height'))
  }
  return got(size)
}

const viewBoxIsValid = (value: unknown): boolean => {
  const parts = typeof value === 'string'
    ? value.trim().split(/[\s,]+/).map(Number)
    : []

  return parts.length === 4
    && parts.every(part => Number.isFinite(part))
    && parts[2]! > 0
    && parts[3]! > 0
}

type PropCheck = {
  /** Fails with a message when the present value is invalid. */
  readonly validate: (name: string, key: string, value: unknown) => void
  /** Message for a missing required prop, when it differs from the default. */
  readonly missing?: (name: string, key: string) => string
}

const svgNumberCheck = (
  extra?: (name: string, key: string, parsed: { value: number, percent: boolean }) => void,
): PropCheck => ({
  validate(name, key, value) {
    const parsed = parseSvgNumber(value)
    if (!parsed) return treeInvalid(`<${name}> has an invalid "${key}" value.${got(value)}`)
    extra?.(name, key, parsed)
  },
})

const requireNonNegative = (name: string, key: string, parsed: { value: number }) => {
  if (parsed.value < 0) {
    treeInvalid(`<${name}> requires a non-negative "${key}" value.${got(parsed.value)}`)
  }
}

/** The values of a prop type as a list; a missing or extra value fails to compile. */
const allOf = <Union extends string>() =>
  <const Values extends readonly Union[]>(
    values: Values & (Exclude<Union, Values[number]> extends never ? unknown : { readonly __missing: Exclude<Union, Values[number]> }),
  ): readonly Union[] => values

/** A prop that takes one of `values`. */
const oneOf = (values: readonly string[]): PropCheck => {
  const allowed = new Set<unknown>(values)
  return {
    validate(name, key, value) {
      if (!allowed.has(value)) treeInvalid(`<${name}> requires "${key}" to be ${quotedList(values)}.${got(value)}`)
    },
  }
}

/** SVG paint in the forms the engine reads (`svgColorProblem`). */
const svgColor = (allowNone: boolean): PropCheck => ({
  validate(name, key, value) {
    const expected = svgColorProblem(value, allowNone)
    if (expected !== undefined) treeInvalid(`<${name}> requires "${key}" to be ${expected}.${got(value)}`)
  },
})

const HIT_SLOP_SIDES: ReadonlySet<string> = new Set(['top', 'right', 'bottom', 'left'])

// The PDF versions the engine writes (`%PDF-<version>`; 1.7ext3 writes 1.7).
const PDF_VERSIONS = allOf<NonNullable<PdfDocumentProps['pdfVersion']>>()(['1.3', '1.4', '1.5', '1.6', '1.7', '1.7ext3'])
const PAGE_LAYOUTS = allOf<NonNullable<PdfDocumentProps['pageLayout']>>()(['singlePage', 'oneColumn', 'twoColumnLeft', 'twoColumnRight', 'twoPageLeft', 'twoPageRight'])
const FOOTNOTE_NUMBERING = allOf<NonNullable<PdfDocumentProps['footnotes']>>()(['document', 'page'])
const FOOTNOTE_STYLE_PARTS: ReadonlySet<string> = new Set(['mark', 'note', 'area', 'rule'] satisfies Array<keyof PdfFootnoteStyles>)
// Keys that would move a footnote part out of the place the layout gives it.
// The rule keeps its size: it is a line of its own width at the top of the area.
const PLACES_RULE = ['position', 'top', 'right', 'bottom', 'left']
const PLACES_NOTE = [...PLACES_RULE, 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf']
const FOOTNOTE_PLACEMENT_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  mark: new Set(PLACES_NOTE),
  note: new Set(PLACES_NOTE),
  rule: new Set(PLACES_RULE),
  // The layout sets the area's margins but its top one (engine/layout/paginate/notes.ts).
  area: new Set([...PLACES_NOTE, 'margin', 'marginHorizontal', 'marginVertical', 'marginRight', 'marginBottom', 'marginLeft']),
}
const ORIENTATIONS = allOf<NonNullable<PdfPageProps['orientation']>>()(['portrait', 'landscape'])
const LINE_CAPS = allOf<NonNullable<PdfSvgPresentationProps['strokeLinecap']>>()(['butt', 'round', 'square'])
const LINE_JOINS = allOf<NonNullable<PdfSvgPresentationProps['strokeLinejoin']>>()(['miter', 'round', 'bevel'])
const BOOKMARK_KEYS: ReadonlySet<string> = new Set(['title', 'expanded', 'contents'])
const CONTENTS_LEADERS = allOf<NonNullable<PdfContentsProps['leader']>>()(['dots', 'none'])
const CONTENTS_STYLE_PARTS = allOf<keyof PdfContentsStyles>()(['entry', 'title', 'leader', 'page', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6'])
const CONTENTS_STYLE_PART_SET: ReadonlySet<string> = new Set(CONTENTS_STYLE_PARTS)
const CONTENTS_TEXT_STYLE_KEY_SET: ReadonlySet<string> = new Set(PDF_CONTENTS_TEXT_STYLE_KEYS)

/** The name of a running value: a string with a character other than space. */
const isRunningName = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const PROP_CHECKS: Record<PdfPropCheck, PropCheck> = {
  altText: {
    validate(name, key, value) {
      if (typeof value !== 'string' || value.trim() === '') {
        treeInvalid(`<${name}> requires "${key}" to be a non-empty string.${got(value)}`)
      }
    },
  },
  attachmentData: {
    validate(name, key, value) {
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
        treeInvalid(`<${name}> "${key}" must be a string or a Uint8Array with the file content.`)
      }
    },
    missing: (name, key) => `<${name}> requires "${key}": a string or a Uint8Array with the file content.`,
  },
  attachmentName: {
    validate(name, key, value) {
      if (
        typeof value !== 'string'
        || value.trim() === ''
        || value.length > MAX_ATTACHMENT_NAME_LENGTH
        || ATTACHMENT_NAME_FORBIDDEN.test(value)
      ) {
        treeInvalid(`<${name}> requires "${key}": a file name of at most ${MAX_ATTACHMENT_NAME_LENGTH} characters without path separators or control characters.${got(value)}`)
      }
    },
    missing: (name, key) => `<${name}> requires "${key}": a file name without path separators.`,
  },
  attachmentRelationship: oneOf(PDF_ATTACHMENT_RELATIONSHIPS),
  bookmark: {
    // PdfBookmark: a title, or { title, expanded, contents }.
    validate(name, key, value) {
      if (typeof value === 'string') return
      if (
        isPlainObject(value)
        && typeof value.title === 'string'
        && (value.expanded === undefined || typeof value.expanded === 'boolean')
        && (value.contents === undefined || value.contents === false)
        && Object.keys(value).every(entry => BOOKMARK_KEYS.has(entry))
      ) return
      treeInvalid(`<${name}> requires "${key}" to be a title string or { title: string, expanded?: boolean, contents?: false }.${got(value)}`)
    },
  },
  contentsLeader: oneOf(CONTENTS_LEADERS),
  running: {
    // PdfRunning: a name, or { name, text }. An empty text sets an empty value.
    validate(name, key, value) {
      if (isRunningName(value)) return
      if (
        isPlainObject(value)
        && isRunningName(value.name)
        && typeof value.text === 'string'
        && Object.keys(value).every(entry => entry === 'name' || entry === 'text')
      ) return
      treeInvalid(`<${name}> requires "${key}" to be a name, such as "chapter", or { name: string, text: string }.${got(value)}`)
    },
  },
  runningAt: oneOf(PDF_RUNNING_AT),
  // `running` on a PdfTableRow, which PdfTableRow passes as an internal prop.
  runningRow: {
    validate(_name, _key, value) {
      if (
        isPlainObject(value)
        && isRunningName(value.name)
        && typeof value.text === 'string'
        && Object.keys(value).every(entry => entry === 'name' || entry === 'text')
      ) return
      treeInvalid(`<PdfTableRow> requires "running" to be { name: string, text: string }: a row has no text of its own to set. Give the text, such as { name: "subtotal", text: "1,200.00" }.${got(value)}`)
    },
  },
  runningName: {
    validate(name, key, value) {
      if (!isRunningName(value)) treeInvalid(`<${name}> requires "${key}" to name a running value, such as "chapter".${got(value)}`)
    },
    missing: (name, key) => `<${name}> requires "${key}": the running value it prints, such as "chapter".`,
  },
  contentsLevels: {
    validate(name, key, value) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > PDF_CONTENTS_MAX_LEVELS) {
        treeInvalid(`<${name}> requires "${key}" to be a whole number from 1 to ${PDF_CONTENTS_MAX_LEVELS}: the outline levels it lists.${got(value)}`)
      }
    },
  },
  contentsStyles: {
    validate(name, key, value) {
      if (!isPlainObject(value)) return treeInvalid(`<${name}> requires "${key}" to be an object of styles, such as { title: { color: '#333333' } }.${got(value)}`)
      for (const [part, style] of Object.entries(value)) {
        if (!CONTENTS_STYLE_PART_SET.has(part)) treeInvalid(`<${name}> "${key}" has no part ${describePdfValue(part)}. Use ${CONTENTS_STYLE_PARTS.join(', ')}.`)
        if (!isPlainObject(style)) treeInvalid(`<${name}> "${key}.${part}" must be a style object.${got(style)}`)
        validateStyle(style, `${name} ${key}.${part}`)
        if (part === 'leader') validateLeaderStyle(style, `${name} ${key}.leader`)
        if (isPlainObject(style) && (part === 'title' || part === 'page')) {
          for (const styleKey of Object.keys(style)) {
            if (!CONTENTS_TEXT_STYLE_KEY_SET.has(styleKey)) treeInvalid(`<${name}> "${key}.${part}" does not take the style "${styleKey}": the ${part === 'page' ? 'page number' : 'title'} is text inside the entry's line. It takes ${PDF_CONTENTS_TEXT_STYLE_KEYS.join(', ')}.`)
          }
        }
      }
    },
  },
  boolean: {
    validate(name, key, value) {
      if (typeof value !== 'boolean') {
        treeInvalid(`<${name}> requires a boolean "${key}" value.${got(value)}`)
      }
    },
  },
  break: {
    validate(name, key, value) {
      if (typeof value !== 'boolean' && value !== 'column') {
        treeInvalid(`<${name}> requires "${key}" to be true, false or "column".${got(value)}`)
      }
    },
  },
  conformance: {
    validate(name, key, value) {
      // `Array.from` turns holes into `undefined`, which `every` then sees.
      const levels: readonly unknown[] = Array.isArray(value) ? Array.from(value) : [value]
      if (
        levels.length === 0
        || new Set(levels).size !== levels.length
        || !levels.every(level => CONFORMANCE_LEVELS.has(level))
        || levels.filter(level => PDF_A_LEVELS.includes(level as PdfConformance)).length > 1
      ) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_CONFORMANCE_LEVELS)}, or a list of them with at most one PDF/A level.${got(value)}`)
      }
    },
  },
  facturXInvoice: {
    validate(name, key, value) {
      // The fields are checked when the XML is written (validateEInvoice).
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        treeInvalid(`<${name}> "${key}" must be the invoice data object.`)
      }
    },
  },
  facturXProfile: oneOf(PDF_FACTUR_X_PROFILES),
  facturXRelationship: oneOf(PDF_FACTUR_X_RELATIONSHIPS),
  fieldExportValue: {
    validate(name, key, value) {
      if (typeof value !== 'string' || !FIELD_EXPORT_VALUE.test(value) || value === 'Off') {
        treeInvalid(`<${name}> "${key}" must be letters, digits, "_" or "-", and not "Off" (the unchecked state).${got(value)}`)
      }
    },
    missing: (name, key) => `<${name}> requires "${key}": the value a reader exports when this option is on.`,
  },
  fieldName: {
    validate(name, key, value) {
      if (typeof value !== 'string' || !FIELD_NAME.test(value)) {
        treeInvalid(`<${name}> requires "${key}": a non-empty field name without a period or control characters.${got(value)}`)
      }
    },
    missing: (name, key) => `<${name}> requires "${key}": the field name a reader exports with the value.`,
  },
  fieldOptions: {
    validate(name, key, value) {
      if (!Array.isArray(value) || value.length === 0 || !value.every(option => typeof option === 'string' && option !== '')) {
        treeInvalid(`<${name}> requires "${key}": a non-empty list of non-empty strings.${got(value)}`)
        return
      }
      if (new Set(value).size !== value.length) {
        treeInvalid(`<${name}> "${key}" lists a choice twice; give each choice once.`)
      }
      for (const option of value as string[]) {
        const character = nonWinAnsiCharacter(option, false)
        if (character !== undefined) {
          treeInvalid(`<${name}> "${key}" contains ${describeCharacter(character)}, which a form field cannot draw: field text uses WinAnsi (Western European) characters.`)
        }
      }
    },
    missing: (name, key) => `<${name}> requires "${key}": the list of choices.`,
  },
  fieldText: {
    validate(name, key, value) {
      if (typeof value !== 'string') {
        treeInvalid(`<${name}> requires a string "${key}" value.${got(value)}`)
        return
      }
      const character = nonWinAnsiCharacter(value, true)
      if (character !== undefined) {
        treeInvalid(`<${name}> "${key}" contains ${describeCharacter(character)}, which a form field cannot draw: field text uses WinAnsi (Western European) characters.`)
      }
    },
  },
  fixedPages: oneOf(PDF_FIXED_PAGES),
  footnotes: oneOf(FOOTNOTE_NUMBERING),
  footnoteStyles: {
    validate(name, key, value) {
      if (!isPlainObject(value)) return treeInvalid(`<${name}> requires "${key}" to be an object with the styles "mark", "note", "area" and "rule".${got(value)}`)
      for (const [part, style] of Object.entries(value)) {
        if (!FOOTNOTE_STYLE_PARTS.has(part)) treeInvalid(`<${name}> "${key}" has no part ${describePdfValue(part)}. Use mark, note, area or rule.`)
        if (part === 'rule' && style === false) continue
        if (!isPlainObject(style)) return treeInvalid(`<${name}> "${key}.${part}" must be a style object${part === 'rule' ? ', or false for no rule' : ''}.${got(style)}`)
        validateStyle(style, `${name} ${key}.${part}`)
        const placing = Object.keys(style).find(property => FOOTNOTE_PLACEMENT_KEYS[part]?.has(property))
        if (placing?.startsWith('margin')) treeInvalid(`<${name}> "${key}.${part}" cannot set "${placing}": the layout places the area and keeps only its marginTop, the least space above the notes. Remove it.`)
        if (placing !== undefined) treeInvalid(`<${name}> "${key}.${part}" cannot set "${placing}": the layout places the notes at the bottom of the page. Remove it.`)
        const verticalAlign = style.verticalAlign
        if (part !== 'mark' && verticalAlign !== undefined && verticalAlign !== 'baseline') {
          treeInvalid(`<${name}> "${key}.${part}" cannot set verticalAlign ${describePdfValue(verticalAlign)}: only the mark is raised or lowered.`)
        }
      }
    },
  },
  hitSlop: {
    validate(name, key, value) {
      const valid = isPlainObject(value) && Object.entries(value).every(([side, amount]) =>
        HIT_SLOP_SIDES.has(side) && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)
      if (!valid) {
        treeInvalid(`<${name}> requires "${key}" to be an object with "top", "right", "bottom" or "left" set to numbers of 0 or more.${got(value)}`)
      }
    },
  },
  imageSource: {
    validate: () => {},
    missing: (name, key) => `<${name}> requires a "${key}" prop.`,
  },
  linkTarget: {
    validate(name, key, value) {
      if (typeof value !== 'string' || value.trim() === '') {
        treeInvalid(`<${name}> targets must be non-empty strings.${got(value)}`)
      }
      else if (!value.startsWith('#') && !isAllowedLinkUri(value)) {
        treeInvalid(`<${name}> "${key}" ${describePdfValue(value)} is not a link a PDF may open. Use an absolute URL with ${LINK_SCHEMES.slice(0, -1).join(', ')} or ${LINK_SCHEMES.at(-1)}, or "#id" for an element of the document.`)
      }
    },
    missing: (name, key) => `<${name}> requires an "${key}" prop.`,
  },
  mimeType: {
    validate(name, key, value) {
      if (typeof value !== 'string' || !MIME_TYPE.test(value)) {
        treeInvalid(`<${name}> requires "${key}" to be a MIME type such as "text/xml".${got(value)}`)
      }
    },
  },
  nonEmptyId: {
    validate(name, key, value) {
      if (typeof value !== 'string' || value.trim() === '') {
        treeInvalid(`<${name}> "${key}" must name a non-empty id.${got(value)}`)
      }
    },
  },
  nonNegativeNumber: {
    validate(name, key, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        treeInvalid(`<${name}> ${key} must be a non-negative finite number.${got(value)}`)
      }
    },
  },
  orientation: oneOf(ORIENTATIONS),
  pageLayout: oneOf(PAGE_LAYOUTS),
  pageSize: {
    validate(name, key, value) {
      const problem = pageSizeProblem(value)
      if (problem !== undefined) {
        treeInvalid(`<${name}> ${key} must be a known page name or positive width and height.${problem}`)
      }
    },
  },
  pdfVersion: oneOf(PDF_VERSIONS),
  positiveInteger: {
    validate(name, key, value) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        treeInvalid(`<${name}> ${key} must be a positive whole number.${got(value)}`)
      }
    },
  },
  positiveNumber: {
    validate(name, key, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        treeInvalid(`<${name}> ${key} must be a positive finite number.${got(value)}`)
      }
    },
  },
  protection: {
    validate(name, key, value) {
      if (!isPlainObject(value)) {
        treeInvalid(`<${name}> "${key}" must be an object with "openPassword", "ownerPassword" or both, and optional "allow".`)
        return
      }
      for (const entry of Object.keys(value)) {
        if (!PROTECTION_KEYS.has(entry)) treeInvalid(`<${name}> "${key}" has the unknown key ${describePdfValue(entry)}; use "openPassword", "ownerPassword" and "allow".`)
      }
      const { openPassword, ownerPassword, allow } = value
      if (openPassword === undefined && ownerPassword === undefined) {
        treeInvalid(`<${name}> "${key}" requires "openPassword", "ownerPassword" or both.`)
      }
      for (const [field, password] of [['openPassword', openPassword], ['ownerPassword', ownerPassword]] as const) {
        const problem = password === undefined ? undefined : passwordProblem(password)
        if (problem !== undefined) treeInvalid(`<${name}> "${key}.${field}" ${problem}.`)
      }
      if (openPassword !== undefined && openPassword === ownerPassword) {
        treeInvalid(`<${name}> "${key}.openPassword" and "${key}.ownerPassword" are the same, so whoever opens the PDF gets every permission; use different passwords, or give only "openPassword".`)
      }
      if (allow === undefined) return
      if (!isPlainObject(allow)) {
        treeInvalid(`<${name}> "${key}.allow" must be an object of permissions.`)
        return
      }
      for (const [entry, permission] of Object.entries(allow)) {
        if (!PERMISSION_KEYS.has(entry)) {
          treeInvalid(`<${name}> "${key}.allow" has the unknown permission ${describePdfValue(entry)}; use ${quotedList(PDF_PERMISSION_KEYS)}.`)
        }
        if (entry === 'printing' ? !PRINTING_PERMISSIONS.has(permission) : typeof permission !== 'boolean') {
          treeInvalid(entry === 'printing'
            ? `<${name}> "${key}.allow.printing" must be ${quotedList(PDF_PRINTING_PERMISSIONS)}.`
            : `<${name}> "${key}.allow.${entry}" must be true or false.`)
        }
      }
      // The PDF annotate permission also permits filling forms (ISO 32000-2,
      // Table 22, bit 6), so the reader would let the user fill them anyway.
      if (allow.fillingForms === false && allow.annotating !== false) {
        treeInvalid(`<${name}> "${key}.allow.fillingForms" is false, but "annotating" also permits filling forms; set "annotating" to false too.`)
      }
    },
  },
  string: {
    validate(name, key, value) {
      if (typeof value !== 'string') {
        treeInvalid(`<${name}> requires a string "${key}" value.${got(value)}`)
      }
    },
  },
  strokeLinecap: oneOf(LINE_CAPS),
  strokeLinejoin: oneOf(LINE_JOINS),
  svgColor: svgColor(false),
  // A url() fill is checked against the definitions (validateSvgDefinitions).
  svgFill: {
    validate(name, key, value) {
      if (typeof value === 'string' && value.startsWith('url(')) return
      svgColor(true).validate(name, key, value)
    },
  },
  svgNonNegative: svgNumberCheck(requireNonNegative),
  svgStroke: svgColor(true),
  svgNumber: svgNumberCheck(),
  svgStrokeWidth: svgNumberCheck((name, key, parsed) => {
    requireNonNegative(name, key, parsed)
    if (parsed.percent) {
      treeInvalid(`<${name}> does not support a percentage stroke width.`)
    }
  }),
  svgTransform: {
    validate(name, _key, value) {
      if (typeof value !== 'string' || !SVG_TRANSFORM.test(value)) {
        treeInvalid(`<${name}> has an unsupported SVG transform.${got(value)}`)
      }
    },
  },
  svgUnitInterval: svgNumberCheck((name, key, parsed) => {
    if (parsed.value < 0 || parsed.value > (parsed.percent ? 100 : 1)) {
      treeInvalid(`<${name}> requires "${key}" between 0 and 1 (or 0% and 100%).${got(parsed.percent ? `${parsed.value}%` : parsed.value)}`)
    }
  }),
  // Internal props of the table components (primitives.ts); an author who
  // writes one gets the same checks.
  tableCellColumns: {
    validate(name, key, value) {
      const first: unknown = Array.isArray(value) ? value[0] : undefined
      const valid = Array.isArray(value) && typeof first === 'number' && Number.isInteger(first) && first >= 0
        && value.every((index: unknown, offset: number) => index === first + offset)
      if (!valid) treeInvalid(`<${name}> requires "${key}" to be a list of consecutive column indices.${got(value)}`)
    },
  },
  tableColumns: {
    validate(name, key, value) {
      if (!Array.isArray(value) || value.length === 0 || !value.every(isPdfTableColumnWidth)) {
        treeInvalid(`<${name}> requires "${key}" to be a non-empty list of table columns.${got(value)}`)
      }
    },
  },
  textTag: oneOf(PDF_TEXT_TAGS),
  viewTag: oneOf(PDF_VIEW_TAGS),
  viewBox: {
    validate(name, key, value) {
      if (!viewBoxIsValid(value)) {
        treeInvalid(`<${name}> ${key} must contain four finite numbers with positive width and height.${got(value)}`)
      }
    },
  },
}

/** Required props first, then each present prop's check, in table order. */
export const validateProps = (node: PdfElementNode): void => {
  const rules = PDF_ELEMENTS[node.type].propRules
  const name = pdfElementLabel(node)

  for (const [key, rule] of rules) {
    if (rule.required && !hasProp(node, key)) {
      const missing = rule.check && PROP_CHECKS[rule.check].missing
      treeInvalid(missing
        ? missing(name, key)
        : `<${name}> requires the "${key}" prop.`)
    }
  }

  for (const [key, rule] of rules) {
    if (rule.check && hasProp(node, key)) {
      PROP_CHECKS[rule.check].validate(name, key, node.props[key])
    }
  }
}

/** The style keys of a `PdfLeader` (`PdfLeaderStyle`): its line and its gaps. */
const LEADER_STYLE_KEYS = allOf<keyof PdfLeaderStyle>()(['borderBottomStyle', 'borderBottomWidth', 'borderBottomColor', 'marginLeft', 'marginRight'])
const LEADER_STYLE_KEY_SET: ReadonlySet<string> = new Set(LEADER_STYLE_KEYS)

/**
 * A leader takes only the keys of its line and gaps, after `validateStyle`
 * checked the values. Its line sits on the baseline, so a raise
 * (`marginBottom`) or a box key has no meaning on it.
 */
export const validateLeaderStyle = (style: unknown, label: string): void => {
  if (Array.isArray(style)) {
    for (const entry of style) validateLeaderStyle(entry, label)
    return
  }
  if (!isPlainObject(style)) return
  for (const [key, value] of Object.entries(style)) {
    if (!LEADER_STYLE_KEY_SET.has(key)) treeInvalid(`<${label}> does not take the style "${key}". A leader takes ${LEADER_STYLE_KEYS.join(', ')}; its line sits on the baseline.`)
    // A gap inside a line has no box for a percentage or auto to refer to.
    if (typeof value === 'string' && (value.trim().endsWith('%') || value.trim() === 'auto')) treeInvalid(`<${label}> takes a length for "${key}", not "${value}".`)
  }
}

/** `label` names the element in the messages (`pdfElementLabel`). */
export const validateStyle = (style: unknown, label: string): void => {
  if (Array.isArray(style)) {
    for (const entry of style) {
      if (entry !== false && entry != null) validateStyle(entry, label)
    }
    return
  }

  if (typeof style !== 'object' || style === null) {
    return treeInvalid(`<${label}> :style must be an object or a nested array of style objects.${got(style)}`)
  }

  for (const [key, value] of Object.entries(style)) {
    if (!PDF_STYLE_KEYS.has(key)) {
      treeInvalid(`Unsupported PDF style "${key}" on <${label}>.`)
    }
    // A missing value leaves the key out, as Vue drops it from :style.
    if (value === undefined || value === null) continue
    const problem = pdfStyleValueProblem(key, value)
    if (problem !== undefined) {
      treeInvalid(`<${label}> :style value ${describePdfValue(value)} for "${key}" is invalid: expected ${problem}.`)
    }
  }
}
