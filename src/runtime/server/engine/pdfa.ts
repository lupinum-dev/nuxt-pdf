// PDF/A-3b: what the render adds to a document that claims it (see
// "PDF/A-3b" in CONTRACTS.md). A document without a claim never reaches this
// file, so its bytes do not change.

import type { SafeDocumentNode } from './layout/index'
import type { LaidOutNode } from './layout/types'
import {
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  claimsPdfA,
  isPdfElementType,
  type PdfConformance,
  type PdfFacturXProfile,
} from '../../primitives'
import { treeInvalid } from '../../shared/errors'
import { missingCodePoints } from './text/itemize'

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

/** The standard font of the first run painted in one. */
const standardFontOfLines = (lines: unknown): string | undefined => {
  if (!Array.isArray(lines)) return undefined
  for (const line of lines) {
    const runs = objectField(line, 'runs')
    if (!Array.isArray(runs)) continue
    for (const run of runs) {
      const font = standardFontOfRun(run)
      if (font !== undefined) return font
    }
  }
  return undefined
}

const MAX_LISTED_CHARACTERS = 5

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
 * embedded, so a text in one of them fails the render with its position. A
 * text uses only the families it names, so a standard font in a line is one
 * the text named. Both also forbid the `.notdef` glyph (PDF/A-2 and -3 6.2.11.8, PDF/UA-1
 * 7.21.8), which shows a character that no font of its text has (D40): such
 * a character fails the render too, named in the message.
 */
export const assertEmbeddedFonts = (layout: SafeDocumentNode, levels: readonly PdfConformance[]): void => {
  const conformance = levels.join(' and ')
  // `svgText`: the SVG `PdfText` around a node. The engine lays its text out
  // in a span, but the author wrote the text, so the message names that.
  const pending: Array<{ element: LaidOutNode, insideSvg: boolean, svgText: LaidOutNode | undefined }> = layout.children.map(page => ({ element: page, insideSvg: false, svgText: undefined }))
  while (pending.length > 0) {
    const { element, insideSvg, svgText } = pending.pop()!
    const font = standardFontOfLines(element.lines)
    if (font !== undefined) {
      const reported = svgText ?? element
      const name = isPdfElementType(reported.type) ? PDF_PRIMITIVE_NAMES[reported.type] : 'PdfText'
      const problem = `${conformance} requires embedded fonts, but <${name}>${insideSvg ? ` inside <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Svg]}>` : ''}`
      const message = insideSvg
        ? `${problem} uses the standard font "${font}", which is not embedded. SVG text does not inherit fontFamily from the page: register a font in pdf.fonts (nuxt.config) and set fontFamily in the style of the SVG text.`
        : `${problem} uses the standard font "${font}", which is not embedded. Register a font in pdf.fonts (nuxt.config) and set fontFamily on the text, its page or a parent view.`
      treeInvalid(message, reported.source ?? element.source)
    }
    const missing = (element.lines ?? []).flatMap(missingCodePoints)
    if (missing.length > 0) {
      const reported = svgText ?? element
      const name = isPdfElementType(reported.type) ? PDF_PRIMITIVE_NAMES[reported.type] : 'PdfText'
      const family = objectField(element.style, 'fontFamily')
      treeInvalid(
        `${conformance} forbids the .notdef glyph, but <${name}> has characters that font "${typeof family === 'string' ? family : 'Helvetica'}" does not contain: ${describeCharacters(String.fromCodePoint(...missing))}. They would show as that glyph. Remove or replace these characters, or register a font that contains them and use it in fontFamily.`,
        reported.source ?? element.source,
      )
    }
    if (Array.isArray(element.children)) {
      const childrenInsideSvg = insideSvg || element.type === PDF_PRIMITIVES.Svg
      const childrenSvgText = svgText ?? (insideSvg && element.type === PDF_PRIMITIVES.Text ? element : undefined)
      for (const child of element.children) {
        if (child.type !== PDF_PRIMITIVES.TextInstance) pending.push({ element: child, insideSvg: childrenInsideSvg, svgText: childrenSvgText })
      }
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
