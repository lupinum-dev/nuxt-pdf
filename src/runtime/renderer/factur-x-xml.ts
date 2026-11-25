/**
 * A small, linear scan of the Factur-X XML. It reads the guideline ID (BT-24)
 * from the element `GuidelineSpecifiedDocumentContextParameter/ID`, not from a
 * comment or a CDATA section, and fails on XML that is not well-formed in one
 * of these ways:
 *
 * - a character outside the XML `Char` production (C0 controls other than
 *   tab, LF and CR, lone surrogates, U+FFFE, U+FFFF), also as a character
 *   reference;
 * - an `&` in text or an attribute value that is not one of the five
 *   predefined entities or a character reference;
 * - `]]>` in text;
 * - unclosed, crossed or malformed tags, an attribute without whitespace
 *   before it, the same attribute twice on one tag;
 * - text other than XML whitespace (space, tab, CR, LF), a CDATA section or a
 *   second element outside the root, or no root element;
 * - an unterminated comment, CDATA section or processing instruction, and an
 *   XML declaration that is not at the very start (after an optional BOM);
 * - a DOCTYPE or any other `<!` declaration.
 *
 * It is not a validating parser: no DTD, no namespace checks (prefixes and
 * URIs are not resolved), no XML name-character rules (a name is any run of
 * characters other than XML whitespace and `/>=<"'`), no check of the XML
 * declaration's content, `--` inside comments or attribute normalization, and
 * no CII schema.
 */
export type CiiXmlScan
  = | { readonly error: string }
    | { readonly root: string, readonly guidelineId: string | undefined }

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: '\'',
  gt: '>',
  lt: '<',
  quot: '"',
}
const REFERENCE = /&(?:#x([\da-f]+)|#(\d+)|([a-z]+));/gi
// XML whitespace is these four characters only, not `\s` (which has U+00A0).
const NAME = /[^ \t\r\n/>=<"'!?][^ \t\r\n/>=<"']*/y
const ATTRIBUTE = /[ \t\r\n]+([^ \t\r\n/>=<"']+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y
const TAG_END = /[ \t\r\n]*(\/?)>/y
const CLOSING_TAG_END = /[ \t\r\n]*>/y
const NOT_WHITESPACE = /[^ \t\r\n]/
const XML_DECLARATION = /^<\?xml[ \t\r\n?]/i
// The complement of the XML 1.0 `Char` production.
const NOT_CHAR = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u

/** Whether a code point is in the XML 1.0 `Char` production. */
const isXmlChar = (code: number): boolean =>
  code === 0x9 || code === 0xA || code === 0xD
  || (code >= 0x20 && code <= 0xD7FF)
  || (code >= 0xE000 && code <= 0xFFFD)
  || (code >= 0x10000 && code <= 0x10FFFF)

const localName = (name: string): string => name.slice(name.indexOf(':') + 1)

/**
 * Decode the references in a text or attribute value; `undefined` for an
 * unknown or broken one, or a reference to a character XML does not allow.
 */
const decodeReferences = (text: string): string | undefined => {
  if (!text.includes('&')) return text
  let broken = false
  const decoded = text.replace(REFERENCE, (_match, hex: string | undefined, decimal: string | undefined, entity: string | undefined) => {
    if (entity !== undefined) {
      const value = PREDEFINED_ENTITIES[entity]
      if (value === undefined) broken = true
      return value ?? ''
    }
    const code = Number.parseInt(hex ?? decimal ?? '', hex === undefined ? 10 : 16)
    if (!isXmlChar(code)) {
      broken = true
      return ''
    }
    return String.fromCodePoint(code)
  })
  // An `&` that does not start a reference is not well-formed.
  if (broken || text.replace(REFERENCE, '').includes('&')) return undefined
  return decoded
}

const lineAt = (text: string, position: number): number => {
  let line = 1
  for (let index = text.indexOf('\n'); index !== -1 && index < position; index = text.indexOf('\n', index + 1)) line += 1
  return line
}

export const scanCiiXml = (input: string): CiiXmlScan => {
  const text = input.startsWith('\uFEFF') ? input.slice(1) : input
  const open: string[] = []
  let root: string | undefined
  let guidelineId: string | undefined
  // The text of the guideline ID while its element is open.
  let capture: string | undefined
  let position = 0
  const fail = (reason: string, at = position): CiiXmlScan => ({ error: `${reason} (line ${lineAt(text, at)})` })

  const invalid = NOT_CHAR.exec(text)
  if (invalid !== null) {
    const code = invalid[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    return fail(`it has the character U+${code}, which XML does not allow`, invalid.index)
  }

  while (position < text.length) {
    const next = text.indexOf('<', position)
    const end = next === -1 ? text.length : next
    if (end > position) {
      const segment = text.slice(position, end)
      if (open.length === 0) {
        if (NOT_WHITESPACE.test(segment)) return fail('it has text outside the root element')
      }
      else {
        if (segment.includes(']]>')) return fail('it has "]]>" in text, which must be written as "]]&gt;"')
        const decoded = decodeReferences(segment)
        if (decoded === undefined) return fail('it has an "&" that is not a known entity or a character reference to an allowed character')
        if (capture !== undefined) capture += decoded
      }
    }
    if (next === -1) break
    position = next

    if (text.startsWith('<?', position)) {
      if (position > 0 && XML_DECLARATION.test(text.slice(position, position + 6))) {
        return fail('it has an XML declaration that is not at the very start of the file')
      }
      const close = text.indexOf('?>', position + 2)
      if (close === -1) return fail('a processing instruction is not closed')
      position = close + 2
      continue
    }
    if (text.startsWith('<!--', position)) {
      const close = text.indexOf('-->', position + 4)
      if (close === -1) return fail('a comment is not closed')
      position = close + 3
      continue
    }
    if (text.startsWith('<![CDATA[', position)) {
      if (open.length === 0) return fail('it has a CDATA section outside the root element')
      const close = text.indexOf(']]>', position + 9)
      if (close === -1) return fail('a CDATA section is not closed')
      if (capture !== undefined) capture += text.slice(position + 9, close)
      position = close + 3
      continue
    }
    if (text.startsWith('<!', position)) {
      // A DOCTYPE can declare entities that change the text; a CII invoice has none.
      return fail('it has a DOCTYPE or another declaration, which a Factur-X invoice does not use')
    }

    const closing = text[position + 1] === '/'
    NAME.lastIndex = position + (closing ? 2 : 1)
    const name = NAME.exec(text)?.[0]
    if (name === undefined) return fail('it has a "<" that does not start a tag')
    let cursor = NAME.lastIndex

    if (closing) {
      CLOSING_TAG_END.lastIndex = cursor
      if (!CLOSING_TAG_END.test(text)) return fail(`the closing tag </${name}> is malformed`)
      const expected = open.pop()
      if (expected !== name) {
        return fail(expected === undefined ? `the closing tag </${name}> has no opening tag` : `the closing tag </${name}> does not match <${expected}>`)
      }
      if (capture !== undefined && localName(name) === 'ID') {
        guidelineId ??= capture
        capture = undefined
      }
      position = CLOSING_TAG_END.lastIndex
      continue
    }

    // Attribute names of this tag, created at the first attribute.
    let attributes: Set<string> | undefined
    for (;;) {
      ATTRIBUTE.lastIndex = cursor
      const attribute = ATTRIBUTE.exec(text)
      if (attribute === null) break
      const [, attributeName = '', double, single] = attribute
      attributes ??= new Set()
      if (attributes.has(attributeName)) return fail(`the tag <${name}> has the attribute "${attributeName}" twice`)
      attributes.add(attributeName)
      if (decodeReferences(double ?? single ?? '') === undefined) {
        return fail(`the attribute "${attributeName}" of <${name}> has an "&" that is not a known entity or a character reference to an allowed character`)
      }
      cursor = ATTRIBUTE.lastIndex
    }
    TAG_END.lastIndex = cursor
    const tagEnd = TAG_END.exec(text)
    if (tagEnd === null) return fail(`the tag <${name}> is malformed or not closed`)
    if (open.length === 0) {
      if (root !== undefined) return fail(`it has a second root element <${name}>`)
      root = name
    }
    const selfClosing = tagEnd[1] === '/'
    if (
      guidelineId === undefined
      && capture === undefined
      && localName(name) === 'ID'
      && localName(open.at(-1) ?? '') === 'GuidelineSpecifiedDocumentContextParameter'
    ) {
      if (selfClosing) guidelineId = ''
      else capture = ''
    }
    if (!selfClosing) open.push(name)
    position = TAG_END.lastIndex
  }

  if (open.length > 0) return fail(`the element <${open.at(-1)}> is not closed`, text.length)
  if (root === undefined) return { error: 'it has no root element' }
  return { root, guidelineId: guidelineId?.trim() }
}
