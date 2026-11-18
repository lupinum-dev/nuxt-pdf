// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./react-pdf-pdfkit.d.ts" />

// PDF/A-3b: what the render adds to a document that claims it (see
// "PDF/A-3b" in CONTRACTS.md). A document without a claim never reaches this
// file, so its bytes do not change.

import { Buffer } from 'node:buffer'
import type { SafeDocumentNode } from './layout/index'
import type PDFDocument from '@react-pdf/pdfkit'
import {
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  claimsPdfA,
  isPdfElementType,
  type PdfConformance,
  type PdfFacturXProfile,
} from '../../primitives'
import type { PdfElementNode, PdfNode } from '../../renderer'
import { NuxtPdfError, PDF_ERROR_CODES, withPdfSource } from '../../shared/errors'

/**
 * The PDF version a document with a conformance claim is written as: PDF/A-3
 * (ISO 19005-3) and PDF/UA-1 (ISO 14289-1) are both based on PDF 1.7.
 */
export const CONFORMANCE_PDF_VERSION = '1.7'

/** The Info dictionary values; the XMP packet repeats them. */
export interface PdfDocumentInfo {
  Title?: string
  Author?: string
  Subject?: string
  Keywords?: string
  Creator: string
  Producer: string
  CreationDate: Date
}

/** The Factur-X facts the XMP packet states. */
export interface PdfFacturXMetadata {
  profile: PdfFacturXProfile
  fileName: string
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const objectField = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

/**
 * The name of the standard PDF font a laid-out run is painted in, if any.
 * The painter uses the first font of `run.attributes.font`, and a standard
 * font carries `type: 'STANDARD'` (CONTRACTS.md, "PDF/A-3b").
 */
const standardFontOfRun = (run: unknown): string | undefined => {
  const glyphs = objectField(run, 'glyphs')
  if (!Array.isArray(glyphs) || glyphs.length === 0) return undefined
  const fonts = objectField(objectField(run, 'attributes'), 'font')
  const font: unknown = Array.isArray(fonts) ? fonts[0] : undefined
  if (objectField(font, 'type') !== 'STANDARD') return undefined
  const name = objectField(font, 'fullName')
  return typeof name === 'string' ? name : 'a standard font'
}

interface StandardFontUse {
  font: string
  /** The characters painted in it. */
  text: string
}

/** The standard font of the first such run, and the characters of every run in one. */
const standardFontOfLines = (lines: unknown): StandardFontUse | undefined => {
  if (!Array.isArray(lines)) return undefined
  let use: StandardFontUse | undefined
  for (const line of lines) {
    const runs = objectField(line, 'runs')
    if (!Array.isArray(runs)) continue
    for (const run of runs) {
      const font = standardFontOfRun(run)
      if (font === undefined) continue
      const string = objectField(line, 'string')
      const start = objectField(run, 'start')
      const end = objectField(run, 'end')
      const text = typeof string === 'string' && typeof start === 'number' && typeof end === 'number'
        ? string.slice(start, end)
        : ''
      use = { font: use?.font ?? font, text: (use?.text ?? '') + text }
    }
  }
  return use
}

// The families the engine resolves to a standard PDF font.
const STANDARD_FAMILIES = new Set(['Courier', 'Helvetica', 'Times-Roman', 'Symbol', 'ZapfDingbats'])
const MAX_LISTED_CHARACTERS = 5

/** The registered families a laid-out node asks for, or `[]`. */
const requestedFamilies = (element: PdfElementNode): string[] => {
  const family = objectField(objectField(element, 'style'), 'fontFamily')
  const families = (Array.isArray(family) ? family : [family]).filter((item): item is string => typeof item === 'string')
  return families.some(item => STANDARD_FAMILIES.has(item)) ? [] : families
}

/** `U+0009`, and the character itself when it is visible: `U+20AC "€"`. */
const describeCharacters = (text: string): string => {
  const characters = [...new Set(text)]
  const listed = characters.slice(0, MAX_LISTED_CHARACTERS).map((character) => {
    const code = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    return /[\p{C}\p{Z}]/u.test(character) ? code : `${code} "${character}"`
  })
  return listed.join(', ') + (characters.length > MAX_LISTED_CHARACTERS ? ', …' : '')
}

/**
 * PDF/A and PDF/UA require every painted glyph to come from an embedded font. The
 * standard PDF fonts (Helvetica, the default, Times, Courier, …) are not
 * embedded, so a text in one of them fails the render with its position. The
 * engine also paints a character that the registered font lacks (a tab, an
 * emoji) in Helvetica, so the message names those characters.
 */
export const assertEmbeddedFonts = (layout: SafeDocumentNode, levels: readonly PdfConformance[]): void => {
  const conformance = levels.join(' and ')
  // `svgText`: the SVG `PdfText` around a node. The engine lays its text out
  // in a span, but the author wrote the text, so the message names that.
  const pending: Array<{ node: PdfNode, insideSvg: boolean, svgText: PdfElementNode | undefined }> = [{ node: layout as unknown as PdfNode, insideSvg: false, svgText: undefined }]
  while (pending.length > 0) {
    const { node, insideSvg, svgText } = pending.pop()!
    if (!('props' in node)) continue
    const element = node as PdfElementNode
    const use = standardFontOfLines(objectField(element, 'lines'))
    if (use !== undefined) {
      const reported = svgText ?? element
      const name = isPdfElementType(reported.type) ? PDF_PRIMITIVE_NAMES[reported.type] : 'PdfText'
      const families = requestedFamilies(element)
      const problem = `${conformance} requires embedded fonts, but <${name}>${insideSvg ? ` inside <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Svg]}>` : ''}`
      const message = families.length > 0
        ? `${problem} has characters that font ${families.map(family => `"${family}"`).join(', ')} does not contain: ${describeCharacters(use.text)}. The engine paints them in the standard font "${use.font}", which is not embedded. Remove or replace these characters (a tab with spaces, for example), or register a font that contains them and add it to fontFamily.`
        : insideSvg
          ? `${problem} uses the standard font "${use.font}", which is not embedded. SVG text does not inherit fontFamily from the page: register a font in pdf.fonts (nuxt.config) and set fontFamily in the style of the SVG text.`
          : `${problem} uses the standard font "${use.font}", which is not embedded. Register a font in pdf.fonts (nuxt.config) and set fontFamily on the text, its page or a parent view.`
      throw withPdfSource(new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message), reported.source ?? element.source)
    }
    if (Array.isArray(element.children)) {
      const childrenInsideSvg = insideSvg || element.type === PDF_PRIMITIVES.Svg
      const childrenSvgText = svgText ?? (insideSvg && element.type === PDF_PRIMITIVES.Text ? element : undefined)
      for (const child of element.children) pending.push({ node: child, insideSvg: childrenInsideSvg, svgText: childrenSvgText })
    }
  }
}

// ---------------------------------------------------------------------------
// XMP
// ---------------------------------------------------------------------------

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&apos;',
}

// XML 1.0 cannot hold most control characters, even escaped.
// eslint-disable-next-line no-control-regex -- control characters are what it removes
const XML_FORBIDDEN = /[\u0000-\u0008\v\f\u000E-\u001F￾￿]/g

const escapeXml = (value: string): string =>
  value.replace(XML_FORBIDDEN, '').replace(/[&<>"']/g, char => XML_ESCAPES[char]!)

/** The same instant the engine writes into the Info dictionary (`D:…Z`, whole seconds). */
const xmpDate = (date: Date): string => `${date.toISOString().split('.')[0]}Z`

const FACTUR_X_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#'

type ExtensionProperty = readonly [name: string, valueType: string, category: 'external' | 'internal', description: string]

interface ExtensionSchema {
  schema: string
  namespaceURI: string
  prefix: string
  properties: readonly ExtensionProperty[]
}

const FACTUR_X_SCHEMA: ExtensionSchema = {
  schema: 'Factur-X PDFA Extension Schema',
  namespaceURI: FACTUR_X_NAMESPACE,
  prefix: 'fx',
  properties: [
    ['DocumentFileName', 'Text', 'external', 'The name of the embedded XML document'],
    ['DocumentType', 'Text', 'external', 'The type of the hybrid document in capital letters, e.g. INVOICE or ORDER'],
    ['Version', 'Text', 'external', 'The actual version of the standard applying to the embedded XML document'],
    ['ConformanceLevel', 'Text', 'external', 'The conformance level of the embedded XML document'],
  ],
}

const PDF_UA_NAMESPACE = 'http://www.aiim.org/pdfua/ns/id/'

// PDF/A-3 accepts only predefined XMP schemas without a description, and the
// PDF/UA identification schema is not one of them.
const PDF_UA_SCHEMA: ExtensionSchema = {
  schema: 'PDF/UA Universal Accessibility Schema',
  namespaceURI: PDF_UA_NAMESPACE,
  prefix: 'pdfuaid',
  properties: [
    ['part', 'Integer', 'internal', 'Indicates, which part of ISO 14289 standard is followed'],
  ],
}

const extensionSchemas = (schemas: readonly ExtensionSchema[]): string => schemas.length === 0
  ? ''
  : `
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>${schemas.map(({ schema, namespaceURI, prefix, properties }) => `
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>${escapeXml(schema)}</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>${namespaceURI}</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>${prefix}</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>${properties.map(([name, valueType, category, description]) => `
        <rdf:li rdf:parseType="Resource">
         <pdfaProperty:name>${name}</pdfaProperty:name>
         <pdfaProperty:valueType>${valueType}</pdfaProperty:valueType>
         <pdfaProperty:category>${category}</pdfaProperty:category>
         <pdfaProperty:description>${escapeXml(description)}</pdfaProperty:description>
        </rdf:li>`).join('')}
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>`).join('')}
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>`

const facturXDescription = ({ profile, fileName }: PdfFacturXMetadata): string => `
  <rdf:Description rdf:about="" xmlns:fx="${FACTUR_X_NAMESPACE}">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${escapeXml(fileName)}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${escapeXml(profile)}</fx:ConformanceLevel>
  </rdf:Description>`

const optionalElement = (value: string | undefined, render: (escaped: string) => string): string =>
  value === undefined ? '' : render(escapeXml(value))

/**
 * The XMP packet of a document that claims PDF/A-3b, PDF/UA-1 or both. Every
 * value is escaped, and every value repeats its Info dictionary entry, as
 * both standards require.
 */
export const buildConformanceXmp = (
  info: PdfDocumentInfo,
  language: string | undefined,
  levels: readonly PdfConformance[],
  facturX?: PdfFacturXMetadata,
): string => {
  const lang = escapeXml(language ?? 'x-default')
  const pdfA = claimsPdfA(levels)
  const pdfUA = levels.includes('PDF/UA-1')
  const schemas = pdfA
    ? [...(pdfUA ? [PDF_UA_SCHEMA] : []), ...(facturX === undefined ? [] : [FACTUR_X_SCHEMA])]
    : []
  const pdfAId = pdfA
    ? `
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>${levels.includes('PDF/A-3a') ? 'A' : 'B'}</pdfaid:conformance>
  </rdf:Description>`
    : ''
  const pdfUAId = pdfUA
    ? `
  <rdf:Description rdf:about="" xmlns:pdfuaid="${PDF_UA_NAMESPACE}">
   <pdfuaid:part>1</pdfuaid:part>
  </rdf:Description>`
    : ''
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${pdfAId}${pdfUAId}
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>${optionalElement(info.Title, value => `
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${value}</rdf:li>${lang === 'x-default' ? '' : `<rdf:li xml:lang="${lang}">${value}</rdf:li>`}</rdf:Alt></dc:title>`)}${optionalElement(info.Author, value => `
   <dc:creator><rdf:Seq><rdf:li>${value}</rdf:li></rdf:Seq></dc:creator>`)}${optionalElement(info.Subject, value => `
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${value}</rdf:li></rdf:Alt></dc:description>`)}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreateDate>${xmpDate(info.CreationDate)}</xmp:CreateDate>
   <xmp:CreatorTool>${escapeXml(info.Creator)}</xmp:CreatorTool>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${escapeXml(info.Producer)}</pdf:Producer>${optionalElement(info.Keywords, value => `
   <pdf:Keywords>${value}</pdf:Keywords>`)}
  </rdf:Description>${extensionSchemas(schemas)}${facturX === undefined ? '' : facturXDescription(facturX)}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

// ---------------------------------------------------------------------------
// sRGB ICC profile, built from the public constants of IEC 61966-2-1
// ---------------------------------------------------------------------------

type Vector = readonly [number, number, number]
type Matrix = readonly [Vector, Vector, Vector]

const xyToXyz = (x: number, y: number): Vector => [x / y, 1, (1 - x - y) / y]

const multiply = (m: Matrix, v: Vector): Vector => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
]

const invert = (m: Matrix): Matrix => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}

const columns = (a: Vector, b: Vector, c: Vector): Matrix => [
  [a[0], b[0], c[0]],
  [a[1], b[1], c[1]],
  [a[2], b[2], c[2]],
]

// sRGB primaries and white point (IEC 61966-2-1), the ICC PCS illuminant
// (D50, ICC.1) and the Bradford cone response matrix for the adaptation.
const SRGB_RED = xyToXyz(0.64, 0.33)
const SRGB_GREEN = xyToXyz(0.30, 0.60)
const SRGB_BLUE = xyToXyz(0.15, 0.06)
const D65 = xyToXyz(0.3127, 0.3290)
const D50: Vector = [0.9642, 1, 0.8249]
const BRADFORD: Matrix = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

/** The sRGB colorants (red, green, blue) adapted to D50, as an ICC profile states them. */
export const srgbColorantsD50 = (): Matrix => {
  const primaries = columns(SRGB_RED, SRGB_GREEN, SRGB_BLUE)
  const scale = multiply(invert(primaries), D65)
  const coneD65 = multiply(BRADFORD, D65)
  const coneD50 = multiply(BRADFORD, D50)
  const toD50 = (xyz: Vector): Vector => {
    const cone = multiply(BRADFORD, xyz)
    return multiply(invert(BRADFORD), [
      cone[0] * coneD50[0] / coneD65[0],
      cone[1] * coneD50[1] / coneD65[1],
      cone[2] * coneD50[2] / coneD65[2],
    ])
  }
  return [
    toD50([SRGB_RED[0] * scale[0], SRGB_RED[1] * scale[0], SRGB_RED[2] * scale[0]]),
    toD50([SRGB_GREEN[0] * scale[1], SRGB_GREEN[1] * scale[1], SRGB_GREEN[2] * scale[1]]),
    toD50([SRGB_BLUE[0] * scale[2], SRGB_BLUE[1] * scale[2], SRGB_BLUE[2] * scale[2]]),
  ]
}

/** The sRGB transfer function from encoded value to linear light (IEC 61966-2-1). */
const srgbToLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

const CURVE_POINTS = 1024
const ascii = (text: string): number[] => [...text].map(char => char.charCodeAt(0))

class IccWriter {
  readonly bytes: number[] = []
  u8(value: number) {
    this.bytes.push(value & 0xFF)
  }

  u16(value: number) {
    this.u8(value >>> 8)
    this.u8(value)
  }

  u32(value: number) {
    this.u16(value >>> 16)
    this.u16(value & 0xFFFF)
  }

  s15Fixed16(value: number) {
    this.u32(Math.round(value * 65536) >>> 0)
  }

  text(value: string) {
    for (const byte of ascii(value)) this.u8(byte)
  }

  pad() {
    while (this.bytes.length % 4 !== 0) this.u8(0)
  }
}

const xyzTag = (xyz: Vector): number[] => {
  const writer = new IccWriter()
  writer.text('XYZ ')
  writer.u32(0)
  for (const value of xyz) writer.s15Fixed16(value)
  return writer.bytes
}

const SRGB_DESCRIPTION = 'sRGB IEC61966-2.1'

/**
 * An ICC v2.1 display profile for sRGB: D50 colorants and white point, and
 * the sRGB transfer curve as a 1024-point table. Built in code, so there is
 * no profile file to ship or license.
 */
export const buildSrgbIccProfile = (): Uint8Array => {
  const description = new IccWriter()
  description.text('desc')
  description.u32(0)
  description.u32(SRGB_DESCRIPTION.length + 1)
  description.text(SRGB_DESCRIPTION)
  description.u8(0)
  description.u32(0) // Unicode language code
  description.u32(0) // Unicode count
  description.u16(0) // ScriptCode code
  description.u8(0) // ScriptCode count
  for (let index = 0; index < 67; index += 1) description.u8(0)

  const copyright = new IccWriter()
  copyright.text('text')
  copyright.u32(0)
  copyright.text('No copyright, use freely')
  copyright.u8(0)

  const curve = new IccWriter()
  curve.text('curv')
  curve.u32(0)
  curve.u32(CURVE_POINTS)
  for (let index = 0; index < CURVE_POINTS; index += 1) {
    curve.u16(Math.round(srgbToLinear(index / (CURVE_POINTS - 1)) * 0xFFFF))
  }

  const [red, green, blue] = srgbColorantsD50()
  const tags: ReadonlyArray<readonly [string, number[]]> = [
    ['desc', description.bytes],
    ['cprt', copyright.bytes],
    ['wtpt', xyzTag(D50)],
    ['rXYZ', xyzTag(red)],
    ['gXYZ', xyzTag(green)],
    ['bXYZ', xyzTag(blue)],
    ['rTRC', curve.bytes],
    ['gTRC', curve.bytes],
    ['bTRC', curve.bytes],
  ]

  // Header (128 bytes), tag table, then the tag data; one copy of the curve
  // serves all three channels.
  const tableSize = 4 + tags.length * 12
  const data = new IccWriter()
  const offsets = new Map<number[], number>()
  const entries = tags.map(([signature, bytes]) => {
    let offset = offsets.get(bytes)
    if (offset === undefined) {
      data.pad()
      offset = 128 + tableSize + data.bytes.length
      offsets.set(bytes, offset)
      for (const byte of bytes) data.u8(byte)
    }
    return { signature, offset, size: bytes.length }
  })
  data.pad()

  const size = 128 + tableSize + data.bytes.length
  const profile = new IccWriter()
  profile.u32(size)
  profile.u32(0) // preferred CMM
  profile.u32(0x02100000) // version 2.1
  profile.text('mntr')
  profile.text('RGB ')
  profile.text('XYZ ')
  for (const part of [2026, 1, 1, 0, 0, 0]) profile.u16(part) // fixed date: same bytes every render
  profile.text('acsp')
  for (let index = 0; index < 6; index += 1) profile.u32(0) // platform, flags, device, attributes
  profile.u32(0) // rendering intent: perceptual
  for (const value of D50) profile.s15Fixed16(value)
  while (profile.bytes.length < 128) profile.u8(0)
  profile.u32(tags.length)
  for (const { signature, offset, size: tagSize } of entries) {
    profile.text(signature)
    profile.u32(offset)
    profile.u32(tagSize)
  }
  for (const byte of data.bytes) profile.u8(byte)
  return Uint8Array.from(profile.bytes)
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Replace the engine's XMP packet with ours. Call it after `createContext`
 * and before `renderPDF`, which ends the document. The engine internal used
 * here (the `metadata` object) is listed in CONTRACTS.md.
 */
export const replaceXmp = (
  context: PDFDocument,
  xmp: string,
): void => {
  const packet = Buffer.from(xmp, 'utf8')
  // The engine appends its own, unescaped Info XML in `end()` and writes
  // whatever `getXML()` then returns; this object ignores the append.
  context.metadata = {
    append: () => {},
    end: () => {},
    getXML: () => xmp,
    getLength: () => packet.byteLength,
  }
}

/**
 * Add the sRGB output intent PDF/A requires. Call it before `renderPDF`
 * (engine internal `_root`, CONTRACTS.md).
 */
export const addSrgbOutputIntent = (context: PDFDocument): void => {
  const profile = context.ref({ N: 3 })
  profile.end(Buffer.from(buildSrgbIccProfile()))
  const intent = context.ref({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    // The engine writes a String object as a PDF string, a primitive as a name.
    OutputConditionIdentifier: new String(SRGB_DESCRIPTION),
    Info: new String(SRGB_DESCRIPTION),
    DestOutputProfile: profile,
  })
  intent.end()
  context._root.data.OutputIntents = [intent]
}
