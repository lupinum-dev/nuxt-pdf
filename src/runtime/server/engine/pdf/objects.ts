// PDF values and their syntax (ISO 32000-1, 7.3), for our writer
// (D37). One number
// formatter serves content streams, appearances and dictionaries.
//
// A JS string is a name, as in a dictionary key; a text string, a byte
// string and a reference have their own class, so a value says what it is.

/** A number with at most 6 decimals, without an exponent and without `-0`. */
export const formatNumber = (value: number): string => {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) throw new RangeError(`Nuxt PDF cannot write the number ${value}.`)
  const fixed = value.toFixed(6)
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
  return trimmed === '-0' ? '0' : trimmed
}

/** A text string (`(…)` in PDFDocEncoding when it fits, else UTF-16BE). */
export class PdfText {
  readonly value: string
  constructor(value: string) {
    this.value = value
  }
}

/** A byte string, written in hex. */
export class PdfBytes {
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
}

/** An indirect reference: object `id`, generation 0. */
export class PdfRef {
  readonly id: number
  constructor(id: number) {
    this.id = id
  }
}

/** A date, written as a text string `D:YYYYMMDDHHmmSSZ` in UTC. */
export class PdfDate {
  readonly date: Date
  constructor(date: Date) {
    this.date = date
  }
}

export type PdfValue
  = | number
    | boolean
    | null
    | string
    | PdfText
    | PdfBytes
    | PdfRef
    | PdfDate
    | readonly PdfValue[]
    | { readonly [key: string]: PdfValue | undefined }

/** Characters a name writes as `#XX` (delimiters, whitespace, `#`, outside `!`…`~`). */
const NAME_ESCAPE = /[^\x21-\x7E]|[#%()/<>[\]{}]/g

/** Escapes in capital hex digits, as the standard's examples and pdfkit write them (`/text#2Fxml`). */
const name = (value: string): string =>
  `/${value.replace(NAME_ESCAPE, character => `#${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}`

const hex = (bytes: Uint8Array): string => {
  let out = '<'
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return `${out}>`
}

/** Printable ASCII only: anything else goes to UTF-16BE, so no PDFDocEncoding table is needed. */
const PLAIN_TEXT = /^[\x20-\x7E]*$/

/** A text string's bytes: printable ASCII as it is, anything else UTF-16BE with its byte order mark. */
const textBytes = (value: string): Uint8Array => {
  if (PLAIN_TEXT.test(value)) return Uint8Array.from(value, character => character.charCodeAt(0))
  const bytes = new Uint8Array(2 + value.length * 2)
  bytes[0] = 0xFE
  bytes[1] = 0xFF
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    bytes[2 + index * 2] = code >> 8
    bytes[3 + index * 2] = code & 0xFF
  }
  return bytes
}

/** Encrypts the bytes of one string or stream (`encryption.ts`). */
export type Encrypt = (data: Uint8Array) => Uint8Array

const textString = (value: string, encrypt: Encrypt | undefined): string => {
  if (encrypt !== undefined) return hex(encrypt(textBytes(value)))
  if (PLAIN_TEXT.test(value)) return `(${value.replace(/[\\()]/g, character => `\\${character}`)})`
  return hex(textBytes(value))
}

const two = (value: number): string => String(value).padStart(2, '0')

const date = (value: Date): string =>
  `D:${value.getUTCFullYear()}${two(value.getUTCMonth() + 1)}${two(value.getUTCDate())}${two(value.getUTCHours())}${two(value.getUTCMinutes())}${two(value.getUTCSeconds())}Z`

/**
 * The syntax of a value; dictionary entries whose value is `undefined` are
 * left out. With `encrypt`, every string is encrypted and written in hex.
 */
export const serialize = (value: PdfValue, encrypt?: Encrypt): string => {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  if (typeof value === 'string') return name(value)
  if (value instanceof PdfRef) return `${value.id} 0 R`
  if (value instanceof PdfText) return textString(value.value, encrypt)
  if (value instanceof PdfBytes) return hex(encrypt === undefined ? value.bytes : encrypt(value.bytes))
  if (value instanceof PdfDate) return textString(date(value.date), encrypt)
  if (Array.isArray(value)) return `[${value.map(item => serialize(item, encrypt)).join(' ')}]`
  const entries = Object.entries(value as { readonly [key: string]: PdfValue | undefined })
    .flatMap(([key, item]) => item === undefined ? [] : [`${name(key)} ${serialize(item, encrypt)}`])
  return `<<\n${entries.join('\n')}\n>>`
}
