// HTML character references, decoded in one pass. Numeric references and the
// named ones editors write: the five XML ones, the Latin-1 set and the
// typographic set of HTML 4. An unknown name, or a reference without its `;`,
// stays as written.

const NAMED: Readonly<Record<string, number>> = {
  // XML
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39,
  // Latin-1 (HTML 4, ISO 8859-1 160 to 255)
  nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167,
  uml: 168, copy: 169, ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175,
  deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183,
  cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191,
  Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199,
  Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207,
  ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215,
  Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221, THORN: 222, szlig: 223,
  agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231,
  egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239,
  eth: 240, ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247,
  oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254, yuml: 255,
  // Typographic and special (HTML 4)
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
  lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364, trade: 8482, minus: 8722,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596,
}

// HTML maps references in 128 to 159 to Windows-1252, as text pasted from
// word processors expects (`&#150;` is an en dash).
const WINDOWS_1252: Readonly<Record<number, number>> = {
  128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710,
  137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220,
  148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250,
  156: 339, 158: 382, 159: 376,
}

/** The longest name or number read after `&`; a longer one is not a reference. */
const MAX_REFERENCE_LENGTH = 32
const REPLACEMENT = 0xFFFD

const isAsciiAlphanumeric = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
const isDigit = (code: number): boolean => code >= 48 && code <= 57
const isHexDigit = (code: number): boolean => isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)

const fromNumber = (value: number): string => {
  if (value === 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return String.fromCodePoint(REPLACEMENT)
  return String.fromCodePoint(WINDOWS_1252[value] ?? value)
}

/**
 * `text[from, to)` with its character references decoded. Each character is
 * read once, and the scan after `&` stops after `MAX_REFERENCE_LENGTH`
 * characters, so the time is linear in the length.
 */
export const decodeEntities = (text: string, from = 0, to = text.length): string => {
  // `indexOf` would search past `to`, to the end of the whole input, for every
  // text of a document: quadratic. This scan stops at `to`.
  const ampersandFrom = (start: number): number => {
    for (let index = start; index < to; index += 1) {
      if (text.charCodeAt(index) === 38 /* & */) return index
    }
    return -1
  }
  let next = ampersandFrom(from)
  if (next === -1) return text.slice(from, to)
  const parts: string[] = []
  let copied = from
  while (next !== -1) {
    let cursor = next + 1
    let decoded: string | undefined
    if (text.charCodeAt(cursor) === 35 /* # */) {
      cursor += 1
      const hex = text.charCodeAt(cursor) === 120 || text.charCodeAt(cursor) === 88 // x X
      if (hex) cursor += 1
      const start = cursor
      while (cursor < to && cursor - start < MAX_REFERENCE_LENGTH && (hex ? isHexDigit : isDigit)(text.charCodeAt(cursor))) cursor += 1
      if (cursor > start && text.charCodeAt(cursor) === 59 /* ; */ && cursor < to) {
        decoded = fromNumber(Number.parseInt(text.slice(start, cursor), hex ? 16 : 10))
      }
    }
    else {
      const start = cursor
      while (cursor < to && cursor - start < MAX_REFERENCE_LENGTH && isAsciiAlphanumeric(text.charCodeAt(cursor))) cursor += 1
      if (cursor > start && cursor < to && text.charCodeAt(cursor) === 59) {
        const name = text.slice(start, cursor)
        const code = Object.hasOwn(NAMED, name) ? NAMED[name] : undefined
        if (code !== undefined) decoded = String.fromCodePoint(code)
      }
    }
    if (decoded === undefined) {
      next = ampersandFrom(next + 1)
      continue
    }
    parts.push(text.slice(copied, next), decoded)
    copied = cursor + 1
    next = ampersandFrom(copied)
  }
  parts.push(text.slice(copied, to))
  return parts.join('')
}
