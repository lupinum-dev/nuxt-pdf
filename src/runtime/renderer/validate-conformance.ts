// Checks of the whole document after the walk: the `PdfFacturX` profile and
// XML, the claimed PDF/A and PDF/UA levels, and the tagged-document rules.
import { treeInvalid, withPdfSource } from '../shared/errors'
import {
  PDF_FIELD_TYPES,
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  isFacturXProfile,
  pdfFacturXFileName,
  type PdfConformance,
  type PdfFacturXProfile,
} from '../primitives'
import { scanCiiXml } from './factur-x-xml'
import { pdfElementLabel, type PdfDocumentNode, type PdfElementNode } from './types'
import { hasProp } from './validate-shared'

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
export const validateFacturXProfile = (node: PdfElementNode): void => {
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

export const PDF_UA = 'PDF/UA-1'

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
export const validateTaggedDocument = (document: PdfDocumentNode, levels: readonly PdfConformance[]): void => {
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
    // A footnote's mark and note are structure elements in the reading order.
    if (node.type === PDF_PRIMITIVES.Footnote && isArtifact) {
      treeInvalid(`<${nodeName}> inside a decorative node is not supported in a ${standard} document: its mark and its note must be in the reading order. Move the footnote out of the decorative node.`)
    }
    if (node.type === PDF_PRIMITIVES.Footnote && insideFigure) {
      treeInvalid(`<${nodeName}> is not supported inside <PdfView tag="figure">: assistive technology reads the figure as its "alt", so the note could not be reached. Move the footnote into the figure's caption or out of the figure.`)
    }
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
    if (PDF_FIELD_TYPES.has(node.type)) {
      // Each widget is a Form element in the reading order (PDF/UA-1 7.18.4),
      // with its label as the accessible name (`TU`, 7.18.1). A radio option
      // is a widget of its own, so each option needs its own label.
      const field = `<${nodeName}> "${String(node.props.name)}"`
      if (isArtifact) treeInvalid(`${field} is inside a decorative node, but in a ${standard} document every form field must be in the reading order. Move the field out of the decorative node.`)
      if (insideFigure) treeInvalid(`${field} is not supported inside <PdfView tag="figure">: assistive technology reads the figure as its "alt", so a field inside it could not be reached. Move the field out of the figure.`)
      const label = node.props.label
      if (typeof label !== 'string' || label.trim() === '') {
        treeInvalid(`${field} needs a "label" in a ${standard} document: PDF/UA requires an accessible name for every form field, and assistive technology reads the label as that name.${node.type === PDF_PRIMITIVES.Radio ? ' Give each option of a radio group its own label.' : ''}`)
      }
    }
    // A rich text image or its figure: the alt text comes from the editor, so
    // the error names the image in the content, not a component prop.
    const richImage = node.richImage
    if (richImage !== undefined && richImage.role !== 'placeholder' && !isArtifact && !insideFigure && !hasProp(node, 'alt')) {
      treeInvalid(`<PdfRichText> image ${richImage.path} needs alternative text in a ${standard} document: a short text that says what it shows (the "alt" attribute of the img, or the text in ![...] in Markdown).`)
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
export const validateConformance = (
  document: PdfDocumentNode,
  facturX: PdfElementNode | undefined,
  attachmentNames: ReadonlyMap<string, string | undefined>,
  levels: readonly PdfConformance[],
): void => {
  if (levels.length === 0) return
  const { pdfVersion } = document.props
  if (pdfVersion !== undefined && pdfVersion !== '1.7') {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]}> claims ${levels.join(' and ')}, which is written as PDF 1.7; remove "pdfVersion" or set it to "1.7".`)
  }
  const profile = facturX?.props.profile
  if (!isFacturXProfile(profile)) return
  const fileName = pdfFacturXFileName(profile)
  if (attachmentNames.has(fileName)) {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Attachment]}> "${fileName}" is the file name of <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}>; choose another name.`, attachmentNames.get(fileName))
  }
}
