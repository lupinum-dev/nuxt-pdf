import { NuxtPdfError, PDF_ERROR_CODES, withPdfSource } from '../shared/errors'
import { PDF_STYLE_VALUES, resolvedStyleValue, type PdfStyleValue } from '../authoring'
import { describePdfValue } from '../shared/describe-value'
import { pdfStyleValueProblem } from '../shared/style-values'
import {
  PDF_ATTACHMENT_RELATIONSHIPS,
  PDF_CONFORMANCE_LEVELS,
  PDF_ELEMENTS,
  PDF_FACTUR_X_PROFILES,
  PDF_FACTUR_X_RELATIONSHIPS,
  PDF_FIXED_PAGES,
  PDF_PAGE_SIZE_NAMES,
  PDF_PERMISSION_KEYS,
  PDF_PRIMITIVE_NAMES,
  PDF_PRINTING_PERMISSIONS,
  PDF_PRIMITIVES,
  PDF_TEXT_TAGS,
  PDF_A_LEVELS,
  PDF_VIEW_TAGS,
  claimsPdfA,
  claimsTaggedPdf,
  pdfConformanceLevels,
  pdfFacturXFileName,
  type PdfConformance,
  type PdfDocumentProps,
  type PdfElementType,
  type PdfPageProps,
  type PdfFacturXProfile,
  type PdfPropCheck,
  type PdfSvgPresentationProps,
} from '../primitives'
import { scanCiiXml } from './factur-x-xml'
import {
  pdfElementLabel,
  type PdfDocumentNode,
  type PdfElementNode,
} from './types'

const RESERVED_DESTINATION_IDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

const PDF_STYLE_KEYS: ReadonlySet<string> = new Set(Object.keys(PDF_STYLE_VALUES))

const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(%?)$/i
const SVG_TRANSFORM_NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`
const SVG_TRANSFORM_OPERATION = String.raw`(?:translate\(${SVG_TRANSFORM_NUMBER}(?:(?:,\s*|\s+)${SVG_TRANSFORM_NUMBER})?\)|rotate\(${SVG_TRANSFORM_NUMBER}\))`
const SVG_TRANSFORM = new RegExp(`^${SVG_TRANSFORM_OPERATION}(?:\\s+${SVG_TRANSFORM_OPERATION}){0,2}$`, 'i')
const SVG_DEFINITION_ID = /^[a-z_][\w.:-]*$/i
const SVG_REFERENCE = /^url\(['"]?#([^'")]+)['"]?\)$/
const PAGE_DIMENSION = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:pt|in|mm|cm|px)$/i
const PAGE_SIZE_NAMES = new Set<string>(PDF_PAGE_SIZE_NAMES)
// A path separator or control character in an embedded file name can mislead
// the viewer or the reader's file system when the file is saved.
// eslint-disable-next-line no-control-regex -- control characters are what it rejects
const ATTACHMENT_NAME_FORBIDDEN = /[/\\\u0000-\u001F\u007F]/
const MAX_ATTACHMENT_NAME_LENGTH = 255
// `type/subtype`, with the token characters of RFC 6838.
const MIME_TYPE = /^[a-z0-9][\w!$&^.+-]*\/[a-z0-9][\w!$&^.+-]*$/i
const ATTACHMENT_RELATIONSHIPS = new Set<unknown>(PDF_ATTACHMENT_RELATIONSHIPS)
const CONFORMANCE_LEVELS = new Set<unknown>(PDF_CONFORMANCE_LEVELS)
const TEXT_TAGS = new Set<unknown>(PDF_TEXT_TAGS)
const VIEW_TAGS = new Set<unknown>(PDF_VIEW_TAGS)
const FACTUR_X_PROFILES: ReadonlySet<unknown> = new Set(PDF_FACTUR_X_PROFILES)
const isFacturXProfile = (value: unknown): value is PdfFacturXProfile => FACTUR_X_PROFILES.has(value)
const FACTUR_X_RELATIONSHIPS = new Set<unknown>(PDF_FACTUR_X_RELATIONSHIPS)
const quotedList = (values: readonly string[]): string => {
  const quoted = values.map(item => `"${item}"`)
  return quoted.length < 2 ? quoted.join('') : `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`
}

const treeInvalid = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message)
}

/** The wrong value at the end of a message (see `describePdfValue` for what it must never get). */
const got = (value: unknown): string => ` Got ${describePdfValue(value)}.`

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

// The characters of WinAnsiEncoding beyond Latin-1 (the 0x80-0x9F range).
const WIN_ANSI_EXTRA: ReadonlySet<string> = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
// A field name part: no period (it separates the parts of a full name).
const FIELD_NAME = /^[^.\p{Cc}]+$/u
const FIELD_EXPORT_VALUE = /^[\w-]+$/
const FIELD_TYPES: ReadonlySet<PdfElementType> = new Set([PDF_PRIMITIVES.TextField, PDF_PRIMITIVES.Checkbox, PDF_PRIMITIVES.Select])

/**
 * The first character Helvetica with WinAnsiEncoding cannot draw, or
 * undefined. Field values are drawn by the reader in that font (F5a).
 */
const nonWinAnsiCharacter = (text: string, lineBreaks: boolean): string | undefined => {
  for (const character of text) {
    const code = character.codePointAt(0)!
    if ((code >= 0x20 && code <= 0x7E) || (code >= 0xA0 && code <= 0xFF) || WIN_ANSI_EXTRA.has(character)) continue
    if (lineBreaks && (character === '\n' || character === '\r')) continue
    return character
  }
  return undefined
}

const describeCharacter = (character: string): string =>
  `"${character}" (U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validateDestinationId = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    return treeInvalid(`<${label}> "id" must be a non-empty string.${got(value)}`)
  }
  if (RESERVED_DESTINATION_IDS.has(value)) {
    treeInvalid(`<${label}> uses a reserved identifier as its id; use another id.`)
  }
  return value
}

const hasProp = (node: PdfElementNode, key: string): boolean =>
  Object.hasOwn(node.props, key)

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

const pageSizeIsValid = (size: unknown): boolean => {
  if (typeof size === 'string') return PAGE_SIZE_NAMES.has(size)
  if (Array.isArray(size)) {
    return size.length === 2 && size.every(pageDimensionIsPositive)
  }
  if (typeof size === 'object' && size !== null) {
    const dimensions = size as Record<string, unknown>
    return pageDimensionIsPositive(dimensions.width)
      && pageDimensionIsPositive(dimensions.height)
  }
  return false
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

const FIXED_PAGES = new Set<unknown>(PDF_FIXED_PAGES)

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

// The PDF versions the engine writes (`%PDF-<version>`; 1.7ext3 writes 1.7).
const PDF_VERSIONS = allOf<NonNullable<PdfDocumentProps['pdfVersion']>>()(['1.3', '1.4', '1.5', '1.6', '1.7', '1.7ext3'])
const PAGE_LAYOUTS = allOf<NonNullable<PdfDocumentProps['pageLayout']>>()(['singlePage', 'oneColumn', 'twoColumnLeft', 'twoColumnRight', 'twoPageLeft', 'twoPageRight'])
const ORIENTATIONS = allOf<NonNullable<PdfPageProps['orientation']>>()(['portrait', 'landscape'])
const LINE_CAPS = allOf<NonNullable<PdfSvgPresentationProps['strokeLinecap']>>()(['butt', 'round', 'square'])
const LINE_JOINS = allOf<NonNullable<PdfSvgPresentationProps['strokeLinejoin']>>()(['miter', 'round', 'bevel'])
const BOOKMARK_KEYS: ReadonlySet<string> = new Set(['title', 'expanded'])

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
  attachmentRelationship: {
    validate(name, key, value) {
      if (!ATTACHMENT_RELATIONSHIPS.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_ATTACHMENT_RELATIONSHIPS)}.${got(value)}`)
      }
    },
  },
  bookmark: {
    // PdfBookmark: a title, or { title, expanded }.
    validate(name, key, value) {
      if (typeof value === 'string') return
      if (
        isPlainObject(value)
        && typeof value.title === 'string'
        && (value.expanded === undefined || typeof value.expanded === 'boolean')
        && Object.keys(value).every(entry => BOOKMARK_KEYS.has(entry))
      ) return
      treeInvalid(`<${name}> requires "${key}" to be a title string or { title: string, expanded?: boolean }.${got(value)}`)
    },
  },
  boolean: {
    validate(name, key, value) {
      if (typeof value !== 'boolean') {
        treeInvalid(`<${name}> requires a boolean "${key}" value.${got(value)}`)
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
  facturXProfile: {
    validate(name, key, value) {
      if (!FACTUR_X_PROFILES.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_FACTUR_X_PROFILES)}.${got(value)}`)
      }
    },
  },
  facturXRelationship: {
    validate(name, key, value) {
      if (!FACTUR_X_RELATIONSHIPS.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_FACTUR_X_RELATIONSHIPS)}.${got(value)}`)
      }
    },
  },
  fieldExportValue: {
    validate(name, key, value) {
      if (typeof value !== 'string' || !FIELD_EXPORT_VALUE.test(value) || value === 'Off') {
        treeInvalid(`<${name}> "${key}" must be letters, digits, "_" or "-", and not "Off" (the unchecked state).${got(value)}`)
      }
    },
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
          treeInvalid(`<${name}> "${key}" contains ${describeCharacter(character)}, which the field font Helvetica cannot draw; use WinAnsi (Western European) characters.`)
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
        treeInvalid(`<${name}> "${key}" contains ${describeCharacter(character)}, which the field font Helvetica cannot draw; use WinAnsi (Western European) characters.`)
      }
    },
  },
  fixedPages: {
    validate(name, key, value) {
      if (!FIXED_PAGES.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be "all", "first" or "continuation".${got(value)}`)
      }
    },
  },
  imageSource: {
    validate: () => {},
    missing: (name, key) => `<${name}> requires a "${key}" prop.`,
  },
  linkTarget: {
    validate(name, _key, value) {
      if (typeof value !== 'string' || value.trim() === '') {
        treeInvalid(`<${name}> targets must be non-empty strings.${got(value)}`)
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
      if (!pageSizeIsValid(value)) {
        treeInvalid(`<${name}> ${key} must be a known page name or positive width and height.${got(value)}`)
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
        if (!PROTECTION_KEYS.has(entry)) treeInvalid(`<${name}> "${key}" has the unknown key "${entry}"; use "openPassword", "ownerPassword" and "allow".`)
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
          treeInvalid(`<${name}> "${key}.allow" has the unknown permission "${entry}"; use ${quotedList(PDF_PERMISSION_KEYS)}.`)
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
  svgNonNegative: svgNumberCheck(requireNonNegative),
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
  textTag: {
    validate(name, key, value) {
      if (!TEXT_TAGS.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_TEXT_TAGS)}.${got(value)}`)
      }
    },
  },
  viewTag: {
    validate(name, key, value) {
      if (!VIEW_TAGS.has(value)) {
        treeInvalid(`<${name}> requires "${key}" to be ${quotedList(PDF_VIEW_TAGS)}.${got(value)}`)
      }
    },
  },
  viewBox: {
    validate(name, key, value) {
      if (!viewBoxIsValid(value)) {
        treeInvalid(`<${name}> ${key} must contain four finite numbers with positive width and height.${got(value)}`)
      }
    },
  },
}

/** Required props first, then each present prop's check, in table order. */
const validateProps = (node: PdfElementNode): void => {
  const { props } = PDF_ELEMENTS[node.type]
  const name = pdfElementLabel(node)
  const rules = Object.entries(props)

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

/** `label` names the element in the messages (`pdfElementLabel`). */
const validateStyle = (style: PdfStyleValue, label: string): void => {
  if (Array.isArray(style)) {
    for (const entry of style) {
      if (entry !== false && entry != null) validateStyle(entry as PdfStyleValue, label)
    }
    return
  }

  if (typeof style !== 'object' || style === null) {
    treeInvalid(`<${label}> :style must be an object or a nested array of style objects.${got(style)}`)
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

const validateContext = (
  node: PdfElementNode,
  insideSvg: boolean,
): void => {
  const { context, props } = PDF_ELEMENTS[node.type]
  const name = pdfElementLabel(node)

  if (context === 'svg' && !insideSvg) {
    treeInvalid(`<${name}> is only supported inside SVG text.`)
  }
  if (context === 'flow' && insideSvg) {
    treeInvalid(`<${name}> is not supported inside <PdfSvg>.`)
  }

  if (node.type !== PDF_PRIMITIVES.Text) return

  // PdfText has two forms; a prop of the other form fails.
  const usesContext = (form: 'flow' | 'svg') => Object.entries(props)
    .some(([key, rule]) => rule.context === form && hasProp(node, key))

  if (!insideSvg) {
    if (usesContext('svg')) {
      treeInvalid(`<${name}> takes "fill", "x" and "y" only inside <PdfSvg>.`)
    }
    return
  }

  if (!hasProp(node, 'x') || !hasProp(node, 'y')) {
    treeInvalid(`SVG <${name}> requires both "x" and "y" props.`)
  }
  if (usesContext('flow')) {
    treeInvalid(`SVG <${name}> does not accept page-flow text props.`)
  }
}

const validateDefinitionId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !SVG_DEFINITION_ID.test(value)) {
    return treeInvalid(`<${label}> "id" must be a safe identifier: a letter or "_", then letters, digits, "_", "-", "." or ":".${got(value)}`)
  }
  if (RESERVED_DESTINATION_IDS.has(value)) {
    treeInvalid(`<${label}> uses a reserved identifier as its id; use another id.`)
  }
  return value
}

const validateSvgDefinitions = (svg: PdfElementNode): void => {
  const defs = svg.children.filter(
    child => 'children' in child && child.type === PDF_PRIMITIVES.Defs,
  ) as PdfElementNode[]

  if (defs.length > 1) {
    treeInvalid('<PdfSvg> accepts at most one <PdfDefs> child.')
  }

  const definitions = new Map<string, PdfElementType>()
  for (const definition of defs[0]?.children ?? []) {
    if (!('children' in definition)) continue
    const label = pdfElementLabel(definition)
    const id = validateDefinitionId(definition.props.id, label)
    if (definitions.has(id)) treeInvalid(`<${label}> has the id of another definition; definition ids must be unique within one <PdfSvg>.`)
    definitions.set(id, definition.type)
  }

  const pending: PdfElementNode[] = [svg]
  while (pending.length > 0) {
    const node = pending.pop()!

    if (hasProp(node, 'fill') && typeof node.props.fill === 'string') {
      const fill = node.props.fill
      if (fill.startsWith('url(')) {
        const match = SVG_REFERENCE.exec(fill)
        const type = match ? definitions.get(match[1]!) : undefined
        if (
          type !== PDF_PRIMITIVES.LinearGradient
          && type !== PDF_PRIMITIVES.RadialGradient
        ) {
          treeInvalid(`<${pdfElementLabel(node)}> fill ${describePdfValue(fill)} references a missing or incompatible definition.`)
        }
      }
    }

    if (hasProp(node, 'clipPath')) {
      const clipPath = node.props.clipPath
      const match = typeof clipPath === 'string'
        ? SVG_REFERENCE.exec(clipPath)
        : null
      if (!match || definitions.get(match[1]!) !== PDF_PRIMITIVES.ClipPath) {
        treeInvalid(`<${pdfElementLabel(node)}> clipPath ${describePdfValue(clipPath)} references a missing or incompatible definition.`)
      }
    }

    for (const child of node.children) {
      if ('children' in child) pending.push(child)
    }
  }
}

// The engine lays a page-conditional node out per page without its asset, link
// and SVG stages (see engine/plain-tree.ts), so its content is limited.
const PAGE_CONDITIONAL_CONTENT = new Set<PdfElementType>([
  PDF_PRIMITIVES.View,
  PDF_PRIMITIVES.Text,
  PDF_PRIMITIVES.PageNumber,
  PDF_PRIMITIVES.PageCount,
  PDF_PRIMITIVES.PageRef,
])

/** True for a `fixed` node that appears only on some pages of its parent. */
const isPageConditional = (node: PdfElementNode): boolean =>
  hasProp(node, 'pages') && node.props.pages !== 'all'

/** `pages` needs `fixed`; a page-conditional node holds views, texts and tokens only. */
const validateFixedPages = (node: PdfElementNode, insidePages: boolean): void => {
  const name = pdfElementLabel(node)

  if (insidePages) {
    if (!PAGE_CONDITIONAL_CONTENT.has(node.type)) {
      treeInvalid(`A fixed node with "pages" may contain only <PdfView>, <PdfText> and page tokens; found <${name}>.`)
    }
    if (hasProp(node, 'pages')) {
      treeInvalid(`<${name}> with "pages" cannot be nested inside another node with "pages".`)
    }
    if (hasProp(node, 'bookmark')) {
      treeInvalid(`<${name}> inside a fixed node with "pages" cannot have a bookmark.`)
    }
  }

  if (hasProp(node, 'pages') && node.props.fixed !== true) {
    treeInvalid(`<${name}> "pages" requires "fixed".`)
  }
}

// The guideline (BT-24) URNs of the Factur-X 1.0 profiles. XRechnung names
// its own version after the colon, so it is matched by prefix.
const FACTUR_X_GUIDELINES: ReadonlyArray<readonly [PdfFacturXProfile, (id: string) => boolean]> = [
  ['MINIMUM', id => id === 'urn:factur-x.eu:1p0:minimum'],
  ['BASIC WL', id => id === 'urn:factur-x.eu:1p0:basicwl'],
  ['BASIC', id => id === 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic'],
  ['EN 16931', id => id === 'urn:cen.eu:en16931:2017'],
  ['EXTENDED', id => id === 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended'],
  ['XRECHNUNG', id => id.startsWith('urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_')],
]
/**
 * The XML must be a well-formed CII invoice, and the profile `PdfFacturX`
 * names must be the one the XML names (BT-24). See `scanCiiXml` for what the
 * scan does not check.
 */
const validateFacturXProfile = (node: PdfElementNode): void => {
  const { xml, invoice, profile, relationship } = node.props
  if (typeof profile !== 'string') return
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]
  if (xml !== undefined && invoice !== undefined) {
    treeInvalid(`<${name}> has both "xml" and "invoice". Give the invoice data with "invoice" or the finished XML with "xml", not both.`)
  }
  if (xml === undefined && invoice === undefined) {
    treeInvalid(`<${name}> requires "invoice" (the invoice data) or "xml" (the finished CII XML).`)
  }
  if (invoice !== undefined && profile === 'EXTENDED') {
    treeInvalid(`<${name}> cannot write the EXTENDED profile from "invoice". Give the EXTENDED XML with "xml" instead.`)
  }
  // Factur-X 1.07.2 (ZUGFeRD 2.3.2) section 6.2.2: when the visible invoice
  // holds more than the XML, as it always does for MINIMUM and BASIC WL, the
  // relationship must be Data.
  if ((profile === 'MINIMUM' || profile === 'BASIC WL') && relationship !== undefined && relationship !== 'Data') {
    treeInvalid(`<${name}> "relationship" is "${String(relationship)}", but a ${profile} invoice must use "Data": its XML holds less than the visible invoice (Factur-X 1.07.2, section 6.2.2). Remove "relationship" or set it to "Data".`)
  }
  let text: string
  if (typeof xml === 'string') {
    text = xml
  }
  else if (xml instanceof Uint8Array) {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(xml)
    }
    catch {
      treeInvalid(`<${name}> "xml" is not UTF-8 text; Factur-X requires a UTF-8 XML file.`)
      return
    }
  }
  else {
    return
  }
  const scan = scanCiiXml(text)
  if ('error' in scan) {
    treeInvalid(`<${name}> "xml" is not well-formed XML: ${scan.error}.`)
    return
  }
  if (scan.root.slice(scan.root.indexOf(':') + 1) !== 'CrossIndustryInvoice') {
    treeInvalid(`<${name}> "xml" has the root element <${scan.root}>; a Factur-X invoice is a CII file with the root element <rsm:CrossIndustryInvoice>.`)
  }
  const id = scan.guidelineId
  if (id === undefined || id === '') {
    treeInvalid(`<${name}> "xml" does not name a profile: it has no GuidelineSpecifiedDocumentContextParameter ID (BT-24).`)
    return
  }
  const named = FACTUR_X_GUIDELINES.find(([, matches]) => matches(id))?.[0]
  if (named !== profile) {
    treeInvalid(`<${name}> "profile" is "${profile}", but the XML names "${id}"${named === undefined ? ', which is not a Factur-X profile' : ` (${named})`}.`)
  }
}

/** The levels a document claims: its `conformance`, and PDF/A-3b with a `PdfFacturX`. */
const claimedLevels = (document: PdfDocumentNode): PdfConformance[] => {
  const levels = pdfConformanceLevels(document.props.conformance)
  if (!claimsPdfA(levels) && document.children.some(child => child.type === PDF_PRIMITIVES.FacturX)) {
    levels.unshift('PDF/A-3b')
  }
  return levels
}

const PDF_UA = 'PDF/UA-1'

// The syntax of a well-formed language tag (RFC 5646 section 2.1, "Language-Tag"):
// langtag, private use, and the irregular grandfathered tags. The regular
// grandfathered tags (such as "art-lojban") match the langtag syntax. It does
// not look the subtags up in the IANA registry.
const LANGUAGE_TAG = new RegExp(
  '^(?:'
  + String.raw`(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4,8})`
  + String.raw`(?:-[a-z]{4})?`
  + String.raw`(?:-(?:[a-z]{2}|\d{3}))?`
  + String.raw`(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*`
  + String.raw`(?:-[\da-wyz](?:-[a-z\d]{2,8})+)*`
  + String.raw`(?:-x(?:-[a-z\d]{1,8})+)?`
  + String.raw`|x(?:-[a-z\d]{1,8})+`
  + '|en-gb-oed|i-(?:ami|bnn|default|enochian|hak|klingon|lux|mingo|navajo|pwn|tao|tay|tsu)|sgn-(?:be-fr|be-nl|ch-de)'
  + ')$',
  'i',
)

const viewTag = (node: PdfElementNode | undefined): unknown =>
  node?.type === PDF_PRIMITIVES.View ? node.props.tag : undefined

/**
 * The rules of a tagged document (PDF/UA-1, PDF/A-3a) that need the whole
 * tree in reading order: the document metadata, alternative text on figures,
 * heading levels in sequence, the shape of lists, and links in the reading
 * order. Nodes inside a `fixed` or `decorative` node are artifacts, so their
 * figures need no text and their headings do not count; a table header is
 * `fixed` to repeat, but its first appearance is tagged, so it is no artifact.
 */
const validateTaggedDocument = (document: PdfDocumentNode): void => {
  const levels = claimedLevels(document)
  const standard = levels.filter(level => level === PDF_UA || level === 'PDF/A-3a').join(' and ')
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]
  if (levels.includes(PDF_UA) && (typeof document.props.title !== 'string' || document.props.title.trim() === '')) {
    treeInvalid(`<${name}> claims ${PDF_UA}, which requires a "title": viewers show it in place of the file name.`)
  }
  const { language } = document.props
  if (typeof language !== 'string' || language.trim() === '') {
    treeInvalid(`<${name}> claims ${standard}, which requires a "language", such as "en" or "de-CH".`)
    return
  }
  // veraPDF rejects a Lang entry that is not a language tag (PDF/A-3a 6.7.4,
  // PDF/UA-1 7.2). "de_DE" is the usual mistake: a POSIX or Java locale.
  if (!LANGUAGE_TAG.test(language)) {
    const fixed = language.trim().replaceAll('_', '-')
    treeInvalid(`<${name}> claims ${standard}, which requires "language" to be a language tag such as "en" or "de-CH"; ${JSON.stringify(language)} is not one.${LANGUAGE_TAG.test(fixed) ? ` Write ${JSON.stringify(fixed)}.` : ''}`)
  }

  let previousLevel: number | undefined
  // `insideFigure`: inside the content of a `PdfView tag="figure"`, not in its caption.
  // `insideLink`: inside a `PdfLink` around blocks (a link that is not in a text).
  const visit = (node: PdfElementNode, parent: PdfElementNode | undefined, artifact: boolean, insideSvg: boolean, insideFigure: boolean, insideLink: boolean): void => {
    const nodeName = pdfElementLabel(node)
    if (node.type === PDF_PRIMITIVES.Note) {
      treeInvalid(`<${nodeName}> is not supported in a ${standard} document: a note is a pop-up outside the page content, so readers who cannot open it miss its text, and the engine writes it without an appearance. Print the note as <PdfText> instead.`)
    }
    const isArtifact = artifact
      || node.props.decorative === true
      || (node.props.fixed === true && node.component !== 'PdfTableHeader')
    if (node.type === PDF_PRIMITIVES.Link && isArtifact) {
      treeInvalid(`<${nodeName}> inside a fixed or decorative node is not supported in a ${standard} document: every link must be in the reading order, and running content is an artifact. Move the link into the page flow.`)
    }
    const tag = viewTag(node)
    if (insideFigure && !isArtifact) {
      const figureContent = 'is not supported inside <PdfView tag="figure">: assistive technology reads the figure as its "alt", so the content inside it has no structure of its own.'
      if (node.type === PDF_PRIMITIVES.Link) treeInvalid(`<${nodeName}> ${figureContent} Move the link out of the figure or into its caption.`)
      if (node.component === 'PdfTable') treeInvalid(`<${nodeName}> ${figureContent} Move the table out of the figure.`)
      const contentTag = node.type === PDF_PRIMITIVES.Text || node.type === PDF_PRIMITIVES.View ? node.props.tag : undefined
      if (typeof contentTag === 'string' && contentTag !== 'caption') {
        treeInvalid(`<${nodeName} tag="${contentTag}"> ${figureContent} Move it out of the figure or into its caption.`)
      }
    }
    if (insideLink && !isArtifact) {
      // One link has one annotation and so one Link element, and Link is
      // inline-level: it holds text and figures, never block structure.
      const linkContent = `inside <PdfLink> is not supported in a ${standard} document: a link is inline content, so it cannot hold headings, sections, lists, quotes, captions, figures or tables, and their structure would be lost. Put the link inside the blocks instead, for example around the text of each list item.`
      if (node.component === 'PdfTable') treeInvalid(`<${nodeName}> ${linkContent}`)
      const blockTag = node.type === PDF_PRIMITIVES.Text || node.type === PDF_PRIMITIVES.View ? node.props.tag : undefined
      if (typeof blockTag === 'string') treeInvalid(`<${nodeName} tag="${blockTag}"> ${linkContent}`)
    }
    if (tag === 'figure' && !isArtifact && !hasProp(node, 'alt')) {
      treeInvalid(`<${nodeName} tag="figure"> needs "alt" (a short text that says what the figure shows) or "decorative" in a ${standard} document.`)
    }
    if (tag === 'list-item' && viewTag(parent) !== 'list') {
      treeInvalid(`<${nodeName} tag="list-item"> must be a direct child of <PdfView tag="list">.`)
    }
    if (viewTag(parent) === 'list' && !isArtifact && tag !== 'list-item' && tag !== 'caption') {
      treeInvalid(`<PdfView tag="list"> holds <PdfView tag="list-item"> and <PdfView tag="caption"> elements only; wrap this <${nodeName}> in a list item.`)
    }
    const isFigure = node.type === PDF_PRIMITIVES.Svg || (node.type === PDF_PRIMITIVES.Image && !insideSvg)
    if (isFigure && !isArtifact && !insideFigure && !hasProp(node, 'alt')) {
      treeInvalid(`<${nodeName}> needs "alt" (a short text that says what it shows) or "decorative" in a ${standard} document.`)
    }
    const textTag = node.props.tag
    if (node.type === PDF_PRIMITIVES.Text && !isArtifact && typeof textTag === 'string' && /^h[1-6]$/.test(textTag)) {
      const level = Number(textTag.slice(1))
      if (previousLevel === undefined && level !== 1) {
        treeInvalid(`<${nodeName} tag="${textTag}"> is the first heading of the document; a ${standard} document starts with tag="h1".`)
      }
      if (previousLevel !== undefined && level > previousLevel + 1) {
        treeInvalid(`<${nodeName} tag="${textTag}"> skips a heading level: the heading before it is h${previousLevel}. Use tag="h${previousLevel + 1}".`)
      }
      previousLevel = level
    }
    for (const child of node.children) {
      if (!('children' in child)) continue
      try {
        visit(
          child,
          node,
          isArtifact,
          insideSvg || node.type === PDF_PRIMITIVES.Svg,
          tag === 'figure' || (insideFigure && tag !== 'caption'),
          insideLink || (node.type === PDF_PRIMITIVES.Link && parent?.type !== PDF_PRIMITIVES.Text),
        )
      }
      catch (error) {
        throw withPdfSource(error, child.source)
      }
    }
  }
  try {
    visit(document, undefined, false, false, false, false)
  }
  catch (error) {
    throw withPdfSource(error, document.source)
  }
}

/**
 * A document that claims PDF/A (with `conformance` or `PdfFacturX`) is written
 * as PDF 1.7, and the Factur-X file name belongs to `PdfFacturX`.
 */
const validateConformance = (
  document: PdfDocumentNode,
  facturX: PdfElementNode | undefined,
  attachmentNames: ReadonlyMap<string, string | undefined>,
): void => {
  const levels = claimedLevels(document)
  if (levels.length === 0) return
  const { pdfVersion } = document.props
  if (pdfVersion !== undefined && pdfVersion !== '1.7') {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]}> claims ${levels.join(' and ')}, which is written as PDF 1.7; remove "pdfVersion" or set it to "1.7".`)
  }
  const profile = facturX?.props.profile
  if (!isFacturXProfile(profile)) return
  const fileName = pdfFacturXFileName(profile)
  if (attachmentNames.has(fileName)) {
    throw withPdfSource(new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Attachment]}> "${fileName}" is the file name of <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}>; choose another name.`,
    ), attachmentNames.get(fileName))
  }
}

/**
 * A form field is a leaf with a fixed box (it never splits and never
 * repeats) and a unique name; its value must fit its other props.
 */
const FIELD_RADIUS_KEYS = ['borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const
const FIELD_BORDER_STYLE_KEYS = ['borderStyle', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle'] as const

const validateField = (node: PdfElementNode, insideFixed: boolean, fieldNames: Map<string, string | undefined>): void => {
  const name = PDF_PRIMITIVE_NAMES[node.type]
  const fieldName = node.props.name
  if (insideFixed) {
    treeInvalid(`<${name}> "${String(fieldName)}" is inside fixed content, which repeats on every page, but a field exists once; move it out of the fixed node.`)
  }
  for (const key of ['width', 'height'] as const) {
    if (resolvedStyleValue(node.style, key) === undefined) {
      treeInvalid(`<${name}> "${String(fieldName)}" needs a "${key}" in its style: a field is a box of fixed size.`)
    }
  }
  // The appearance (server/engine/forms.ts) draws a square, solid frame and
  // a left, centred or right-aligned value; the style must not ask for more.
  for (const key of FIELD_RADIUS_KEYS) {
    const radius = resolvedStyleValue(node.style, key)
    if (radius !== undefined && Number.parseFloat(String(radius)) !== 0) {
      treeInvalid(`<${name}> "${String(fieldName)}" sets "${key}", but a field border is square; remove it.`)
    }
  }
  for (const key of FIELD_BORDER_STYLE_KEYS) {
    const borderStyle = resolvedStyleValue(node.style, key)
    if (borderStyle !== undefined && borderStyle !== 'solid') {
      treeInvalid(`<${name}> "${String(fieldName)}" sets "${key}: ${borderStyle}", but a field border is solid; remove it.`)
    }
  }
  if (resolvedStyleValue(node.style, 'textAlign') === 'justify') {
    treeInvalid(`<${name}> "${String(fieldName)}" sets "textAlign: justify", which a field cannot draw; use left, center or right.`)
  }
  if (typeof fieldName === 'string') {
    if (fieldNames.has(fieldName)) {
      treeInvalid(`<${name}> "${fieldName}" is the name of another form field too; give each field its own name.`)
    }
    fieldNames.set(fieldName, node.source)
  }
  const { value } = node.props
  if (node.type === PDF_PRIMITIVES.TextField && typeof value === 'string') {
    if (node.props.multiline !== true && /[\n\r]/.test(value)) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a line break in "value"; set "multiline" or remove the line break.`)
    }
    const { maxLength } = node.props
    if (typeof maxLength === 'number' && [...value].length > maxLength) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a "value" longer than "maxLength" (${maxLength}); shorten the value or raise "maxLength".`)
    }
  }
  if (node.type === PDF_PRIMITIVES.Select && typeof value === 'string' && node.props.editable !== true) {
    const { options } = node.props
    if (Array.isArray(options) && !options.includes(value)) {
      treeInvalid(`<${name}> "${String(fieldName)}" has a "value" that is not one of "options"; add it to "options", or set "editable" to accept any value.`)
    }
  }
}

/**
 * Form fields are written for untagged documents without PDF/A for now: PDF/A
 * needs every font embedded, and the field appearances use the standard font
 * Helvetica; a tagged document needs a Form element for each field, which
 * Nuxt PDF does not write yet (F5c).
 */
const validateFieldsConformance = (document: PdfDocumentNode, fieldNames: ReadonlyMap<string, string | undefined>): void => {
  const [first] = fieldNames
  if (first === undefined) return
  const levels = claimedLevels(document)
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]
  const problem = claimsPdfA(levels) && !claimsTaggedPdf(levels)
    ? `claims ${levels.filter(level => PDF_A_LEVELS.includes(level)).join('')}, which needs an embedded font in every form field; Nuxt PDF draws form fields in the standard font Helvetica for now`
    : claimsTaggedPdf(levels)
      ? `claims ${levels.join(' and ')}, which needs a structure element for every form field; Nuxt PDF does not tag form fields yet`
      : undefined
  if (problem === undefined) return
  throw withPdfSource(new NuxtPdfError(
    PDF_ERROR_CODES.TreeInvalid,
    `<${name}> ${problem}. Remove the form fields (such as "${first[0]}"), or remove the claim${document.children.some(child => child.type === PDF_PRIMITIVES.FacturX) ? ' (PdfFacturX implies PDF/A-3b)' : ' from "conformance"'}.`,
  ), first[1])
}

/**
 * A protected PDF is written as PDF 1.7 with AES-256, which PDF/A forbids
 * (ISO 19005-3, 6.1.3). PDF/UA-1 permits it if assistive technology may
 * still read the content (ISO 14289-1, 7.16).
 */
const validateProtection = (document: PdfDocumentNode, facturX: PdfElementNode | undefined): void => {
  const protection = document.props.protection
  if (protection === undefined) return
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]
  const levels = claimedLevels(document)
  if (facturX !== undefined) {
    throw withPdfSource(new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}> writes a PDF/A-3 file, which must not be encrypted; remove "protection" from <${name}>, or send the e-invoice unprotected.`,
    ), facturX.source)
  }
  if (claimsPdfA(levels)) {
    treeInvalid(`<${name}> claims ${levels.filter(level => PDF_A_LEVELS.includes(level)).join('')}, which must not be encrypted; remove "protection" or the PDF/A level from "conformance".`)
  }
  if (levels.includes(PDF_UA) && isPlainObject(protection) && isPlainObject(protection.allow) && protection.allow.extractingForAccessibility === false) {
    treeInvalid(`<${name}> claims PDF/UA-1, which requires that assistive technology can read the content; remove "protection.allow.extractingForAccessibility" or set it to true.`)
  }
  const { pdfVersion } = document.props
  if (pdfVersion !== undefined && pdfVersion !== '1.7') {
    treeInvalid(`<${name}> "protection" writes PDF 1.7 with AES-256; remove "pdfVersion" or set it to "1.7".`)
  }
}

/**
 * A PDF date (and the XMP date of a PDF/A document) has a four-digit year. A
 * later year is written in a form the two dates do not share, and an Invalid
 * Date cannot be written at all.
 */
const validateCreationDate = (value: unknown): void => {
  if (value === undefined) return
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    treeInvalid(`<${name}> requires "creationDate" to be a valid Date, such as new Date('2026-01-31'); got ${value instanceof Date ? 'an Invalid Date' : typeof value}.`)
    return
  }
  const year = value.getUTCFullYear()
  if (year < 0 || year > 9999) {
    treeInvalid(`<${name}> requires "creationDate" to have a year from 0 to 9999 (UTC), which a PDF date can hold; got the year ${year}.`)
  }
}

/** Validate invariants that require the complete mounted document tree. */
export const validatePdfDocumentTree = (document: PdfDocumentNode): void => {
  // Destination id → label of the element that has it.
  const destinationIds = new Map<string, string>()
  // Target id → source of the first node that references it.
  const internalLinkTargets = new Map<string, string | undefined>()
  const pageRefTargets = new Map<string, string | undefined>()
  // Attachment name → source, for the name check against PdfFacturX.
  const attachmentNames = new Map<string, string | undefined>()
  let facturX: PdfElementNode | undefined
  const pdfA = claimsPdfA(claimedLevels(document))
  let pageCount = 0
  // Field name → source, for unique names and the conformance check.
  const fieldNames = new Map<string, string | undefined>()
  type Pending = { node: PdfElementNode, insideSvg: boolean, insidePages: boolean, insideText: boolean, insideFixed: boolean }
  const pending: Pending[] = [{
    node: document,
    insideSvg: false,
    insidePages: false,
    insideText: false,
    insideFixed: false,
  }]

  const validateNode = ({ node, insideSvg, insidePages, insideText, insideFixed }: Pending): void => {
    const label = pdfElementLabel(node)
    // The engine lays a nested text out inside the lines of the outermost
    // text, so a per-page carrier cannot live anywhere below it.
    if (insideText && hasProp(node, 'pages')) {
      treeInvalid(`"pages" is not supported on a <${label}> nested inside another <PdfText>.`)
    }
    if (insideText && node.type === PDF_PRIMITIVES.Text && hasProp(node, 'tag')) {
      treeInvalid(`"tag" is not supported on a <${label}> nested inside another <PdfText>: the nested text is part of its parent.`)
    }
    validateProps(node)
    if (node.type === PDF_PRIMITIVES.View && hasProp(node, 'alt') && node.props.tag !== 'figure') {
      treeInvalid(`"alt" on <${label}> needs tag="figure": a plain view has no alternative text.`)
    }
    if (pdfA && node.type === PDF_PRIMITIVES.Note) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Note]}> is not supported in a PDF/A document: PDF/A requires a printable appearance for every note, which the engine does not write. Print the note as <PdfText> instead.`)
    }
    validateStyle(node.style, label)
    validateContext(node, insideSvg)
    validateFixedPages(node, insidePages)
    if (FIELD_TYPES.has(node.type)) validateField(node, insideFixed, fieldNames)

    if (node.type === PDF_PRIMITIVES.Svg) validateSvgDefinitions(node)
    if (node.type === PDF_PRIMITIVES.Page) pageCount += 1
    // validateProps above already checked that the name is a string.
    const attachmentName = node.type === PDF_PRIMITIVES.Attachment ? node.props.name : undefined
    if (typeof attachmentName === 'string') {
      if (attachmentNames.has(attachmentName)) {
        treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Attachment]}> "${attachmentName}" is declared twice.`)
      }
      attachmentNames.set(attachmentName, node.source)
    }
    if (node.type === PDF_PRIMITIVES.FacturX) {
      if (facturX !== undefined) {
        treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]}> may contain only one <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}>.`)
      }
      facturX = node
      validateFacturXProfile(node)
    }

    if (node.type === PDF_PRIMITIVES.Link) {
      const target = node.props.href
      if (typeof target === 'string' && target.startsWith('#')) {
        const id = target.slice(1)
        if (id.trim() === '') {
          treeInvalid('<PdfLink> internal destinations must name a non-empty id.')
        }
        if (!internalLinkTargets.has(id)) internalLinkTargets.set(id, node.source)
      }
    }

    if (node.type === PDF_PRIMITIVES.PageRef && typeof node.props.to === 'string') {
      if (!pageRefTargets.has(node.props.to)) pageRefTargets.set(node.props.to, node.source)
    }

    const id = PDF_ELEMENTS[node.type].destination
      ? validateDestinationId(node.props.id, label)
      : undefined

    if (id !== undefined) {
      const first = destinationIds.get(id)
      if (first !== undefined) {
        treeInvalid(`<${label}> and <${first}> have the same id; ids must be unique within a document.`)
      }
      destinationIds.set(id, label)
    }

    for (const child of node.children) {
      if ('children' in child) {
        pending.push({
          node: child,
          insideSvg: insideSvg || node.type === PDF_PRIMITIVES.Svg,
          insidePages: insidePages || isPageConditional(node),
          insideText: insideText || node.type === PDF_PRIMITIVES.Text,
          insideFixed: insideFixed || node.props.fixed === true,
        })
      }
    }
  }

  while (pending.length > 0) {
    const entry = pending.pop()!
    try {
      validateNode(entry)
    }
    catch (error) {
      throw withPdfSource(error, entry.node.source)
    }
  }

  if (pageCount === 0) {
    treeInvalid('<PdfDocument> requires at least one <PdfPage>.')
  }
  validateCreationDate(document.props.creationDate)

  validateProtection(document, facturX)
  validateFieldsConformance(document, fieldNames)
  validateConformance(document, facturX, attachmentNames)
  if (claimsTaggedPdf(claimedLevels(document))) validateTaggedDocument(document)

  for (const [target, source] of internalLinkTargets) {
    if (!destinationIds.has(target)) {
      throw withPdfSource(new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, '<PdfLink> internal destination does not match any id in the document.'), source)
    }
  }

  for (const [target, source] of pageRefTargets) {
    if (!destinationIds.has(target)) {
      throw withPdfSource(new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, `<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.PageRef]}> destination does not match any id in the document.`), source)
    }
  }
}
