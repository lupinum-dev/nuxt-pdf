// The tree walk of tree validation (`validatePdfDocumentTree`): it holds the
// traversal state (destination ids, link targets, field names) and calls the
// per-node checks in validate-props.ts, validate-svg.ts and validate-fields.ts,
// then the document checks in validate-conformance.ts.
import { treeInvalid, withPdfSource } from '../shared/errors'
import { resolvedStyleValue } from '../authoring'
import { describePdfValue } from '../shared/describe-value'
import {
  PDF_ELEMENTS,
  PDF_PAGE_TOKENS,
  PDF_PER_PAGE_TOKENS,
  PDF_FIELD_TYPES,
  PDF_PRIMITIVE_NAMES,
  PDF_PRIMITIVES,
  PDF_RUNNING_ROW_PROP,
  PDF_A_LEVELS,
  PDF_FOOTNOTE_REPEAT_PROP,
  claimsPdfA,
  claimsTaggedPdf,
  pdfClaimedLevels,
  pdfContentsTitle,
  pdfRunningName,
  type PdfConformance,
  type PdfElementType,
} from '../primitives'
import { pdfElementLabel, type PdfDocumentNode, type PdfElementNode } from './types'
import { ROOT_COLUMN_SCOPE, childColumnScope, validateColumns, type ColumnScope } from './validate-columns'
import { ROOT_FLOAT_SCOPE, childFloatScope, floatOf, validateFloat, type FloatScope } from './validate-floats'
import { validateLeaderStyle, validateProps, validateStyle } from './validate-props'
import { hasProp, isPlainObject, validateDestinationId } from './validate-shared'
import { validateSvgDefinitions } from './validate-svg'
import {
  PDF_UA,
  validateConformance,
  validateFacturXProfile,
  validateTaggedDocument,
} from './validate-conformance'
import {
  type FieldRecord,
  validateField,
  validateFieldsConformance,
} from './validate-fields'

const validateContext = (
  node: PdfElementNode,
  insideSvg: boolean,
): void => {
  const { context, propRules } = PDF_ELEMENTS[node.type]
  const name = pdfElementLabel(node)

  if (context === 'svg' && !insideSvg) {
    treeInvalid(`<${name}> is only supported inside SVG text.`)
  }
  if (context === 'flow' && insideSvg) {
    treeInvalid(`<${name}> is not supported inside <PdfSvg>.`)
  }

  if (node.type !== PDF_PRIMITIVES.Text) return

  // PdfText has two forms; a prop of the other form fails.
  const propOf = (form: 'flow' | 'svg') => propRules
    .find(([key, rule]) => rule.context === form && hasProp(node, key))?.[0]

  if (!insideSvg) {
    if (propOf('svg') !== undefined) {
      treeInvalid(`<${name}> takes "fill", "x" and "y" only inside <PdfSvg>.`)
    }
    return
  }

  if (!hasProp(node, 'x') || !hasProp(node, 'y')) {
    treeInvalid(`SVG <${name}> requires both "x" and "y" props.`)
  }
  const flowProp = propOf('flow')
  if (flowProp !== undefined) {
    treeInvalid(`SVG <${name}> does not accept the page-flow text prop "${flowProp}".`)
  }
}

// The engine lays a page-conditional node out per page without its asset, link
// and SVG stages (see engine/plain-tree.ts), so its content is limited.
const PAGE_CONDITIONAL_CONTENT = new Set<PdfElementType>([PDF_PRIMITIVES.View, PDF_PRIMITIVES.Text, ...PDF_PAGE_TOKENS])

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

/**
 * A protected PDF is written as PDF 1.7 with AES-256, which PDF/A forbids
 * (ISO 19005-3, 6.1.3). PDF/UA-1 permits it if assistive technology may
 * still read the content (ISO 14289-1, 7.16).
 */
const validateProtection = (document: PdfDocumentNode, facturX: PdfElementNode | undefined, levels: readonly PdfConformance[]): void => {
  const protection = document.props.protection
  if (protection === undefined) return
  const name = PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]
  if (facturX !== undefined) {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}> writes a PDF/A-3 file, which must not be encrypted; remove "protection" from <${name}>, or send the e-invoice unprotected.`, facturX.source)
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

/**
 * The outermost ancestor that keeps a `break` below it from starting a page
 * (D26): the layout keeps a `fixed` node to repeat it, keeps a `wrap={false}`
 * node whole and lays the children of a row out side by side, so a break
 * there would do nothing. The outermost one, because removing an inner one
 * would not let the break work.
 */
type BreakBlocker = { kind: 'fixed' | 'table-row' | 'unbreakable', ancestor: string }
  | { kind: 'row', ancestor: string, direction: string, page: boolean }

const breakBlockerOf = (node: PdfElementNode): BreakBlocker | undefined => {
  const ancestor = pdfElementLabel(node)
  if (node.props.fixed === true) return { kind: 'fixed', ancestor }
  if (node.component === 'PdfTableRow') return { kind: 'table-row', ancestor }
  if (node.props.wrap === false) return { kind: 'unbreakable', ancestor }
  const direction = resolvedStyleValue(node.style, 'flexDirection')
  if (direction === 'row' || direction === 'row-reverse') {
    return { kind: 'row', ancestor, direction, page: node.type === PDF_PRIMITIVES.Page }
  }
  return undefined
}

const breakProblem = (label: string, blocker: BreakBlocker): string => {
  const start = `<${label}> cannot have "break" inside <${blocker.ancestor}>`
  switch (blocker.kind) {
    case 'fixed':
      return `${start}, a fixed node that repeats on every page. Remove "break".`
    case 'table-row':
      return `${start}: the cells of a table row move to the next page together. Put "break" on <${blocker.ancestor}> instead.`
    case 'unbreakable':
      return `${start}, which has wrap={false} and stays whole on one page. Remove wrap={false} or remove "break".`
    case 'row':
      return `${start}, whose flexDirection is "${blocker.direction}": its children sit side by side, so a break cannot end the page for one of them. ${blocker.page ? 'Remove "break".' : `Put "break" on <${blocker.ancestor}> instead.`}`
  }
}

/**
 * Where `keepWithNext` has no next sibling to start with (Feature 3): the
 * layout repeats a fixed node, starts every page anew, lays a nested text out
 * inside its parent's lines and the children of a row side by side, draws the
 * next node of a column-reverse container above it, and moves the cells of a
 * table row together.
 */
const keepWithNextProblem = (node: PdfElementNode, label: string, parent: PdfElementNode | undefined, insideText: boolean, insideCell: boolean): string | undefined => {
  const start = `<${label}> cannot have "keepWithNext"`
  if (node.type === PDF_PRIMITIVES.Page) return `${start}: every page starts a new page. Remove "keepWithNext".`
  if (node.props.fixed === true) return `${start}: it is a fixed node that repeats on every page. Remove "keepWithNext".`
  if (insideText) return `${start} inside another <PdfText>: the nested text is part of its parent's lines. Put "keepWithNext" on the outer <PdfText>.`
  if (insideCell) return `${start} inside <PdfTableCell>: the cells of a table row move to the next page together. Put "keepWithNext" on the <PdfTableRow>.`
  const direction = parent === undefined ? undefined : resolvedStyleValue(parent.style, 'flexDirection')
  if (parent !== undefined && (direction === 'row' || direction === 'row-reverse')) {
    return `${start} inside <${pdfElementLabel(parent)}>, whose flexDirection is "${direction}": its children sit side by side, so none of them starts before the next. Put "keepWithNext" on <${pdfElementLabel(parent)}> instead.`
  }
  if (parent !== undefined && direction === 'column-reverse') {
    return `${start} inside <${pdfElementLabel(parent)}>, whose flexDirection is "column-reverse": the next node in the tree is drawn above it, not after it. Use flexDirection "column", or remove "keepWithNext".`
  }
  return undefined
}

// Page-flow props that a note cannot honour: it is laid out once, in the note area of its page.
const NOTE_FLOW_PROPS = ['fixed', 'break', 'wrap', 'minPresenceAhead', 'bookmark'] as const

/** What the walk knows about a node's ancestors. */
interface Scope {
  insideSvg: boolean
  insidePages: boolean
  insideText: boolean
  insideFixed: boolean
  insideCell: boolean
  insideLink: boolean
  insideFootnote: boolean
  insideSetter: boolean
  columns: ColumnScope
  floats: FloatScope
  insideFloat: boolean
}

/**
 * Where a footnote cannot go. The nesting rules already keep it
 * inside a `PdfText` and out of a direct `PdfLink` or `PdfFootnote` parent;
 * these are the places further up.
 */
const validateFootnote = (node: PdfElementNode, label: string, { insideFixed, insideLink, insideFootnote }: Scope): void => {
  if (insideFixed) {
    treeInvalid(`<${label}> cannot be inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and so would its note. Move the footnote into the page flow.`)
  }
  if (insideFootnote) {
    treeInvalid(`<${label}> cannot be inside the note of another <PdfFootnote>: a note has no notes. Write it as its own footnote in the text.`)
  }
  if (insideLink) {
    treeInvalid(`<${label}> cannot be inside <PdfLink>: its mark is a link to the note, and a link cannot hold a link. Put the footnote next to the link.`)
  }
  const hasContent = node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance || child.value.trim() !== '')
  if (!hasContent && !hasProp(node, PDF_FOOTNOTE_REPEAT_PROP)) {
    treeInvalid(`<${label}> has no note: its content is the text that prints at the bottom of the page. Write the note inside it.`)
  }
}

/**
 * Where a contents cannot go. The nesting rules keep it out of texts, links
 * and footnotes, which do not hold blocks; these are the places a view can
 * reach.
 */
const validateContentsPlace = (label: string, { insideFixed, insidePages, insideCell, insideLink }: Scope): void => {
  if (insideFixed || insidePages) {
    treeInvalid(`<${label}> cannot be inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and so would the contents. Move it into the page flow.`)
  }
  if (insideLink) {
    treeInvalid(`<${label}> cannot be inside <PdfLink>: each entry is a link to its place, and a link cannot hold a link. Move it out of the link.`)
  }
  if (insideCell) {
    treeInvalid(`<${label}> cannot be inside <PdfTableCell>: a table row does not split between its entries. Put the contents before or after the table.`)
  }
}

/**
 * A text with a page number, a page count or a running value is laid out
 * again on each page, as one string per page (engine/plain-tree.ts,
 * `dynamicText`). A nested text is part of its parent's lines, which are
 * fixed before the pages, and the string keeps no element but page tokens.
 */
const validatePerPageText = (node: PdfElementNode, insideText: boolean): void => {
  if (!node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance && PDF_PER_PAGE_TOKENS.has(child.type))) return
  const running = node.children.some(child => child.type === PDF_PRIMITIVES.RunningText)
  if (insideText) {
    treeInvalid(running
      ? '<PdfRunningText> is not supported in a <PdfText> nested inside another <PdfText>. Put it in the outer text.'
      : '<PdfPageNumber> and <PdfPageCount> are not supported in a <PdfText> nested inside another <PdfText>.')
  }
  if (node.children.some(child => child.type !== PDF_PRIMITIVES.TextInstance && !PDF_PAGE_TOKENS.has(child.type))) {
    treeInvalid(running
      ? 'A <PdfText> that contains <PdfRunningText> cannot contain other elements. Style the whole text, or put the other elements in a text of their own.'
      : 'A <PdfText> that contains <PdfPageNumber> or <PdfPageCount> cannot contain other elements.')
  }
}

/** The name a node sets as a running value: a `PdfText` with `running`, or a `PdfTableRow` with it. */
const runningNameOf = (node: PdfElementNode): string | undefined =>
  node.type === PDF_PRIMITIVES.Text ? pdfRunningName(node.props.running) : pdfRunningName(node.props[PDF_RUNNING_ROW_PROP])

/**
 * Where a setter (a `PdfText` or a `PdfTableRow` with `running`) cannot be,
 * and what it cannot hold. Pagination reads the setters of the page flow; a
 * fixed node repeats on every page and a note is laid out outside the flow.
 * The values before and at the end of a page are page values, and the fixed
 * rows of a table in a column repeat in every column.
 */
const validateRunning = (node: PdfElementNode, label: string, { insideFixed, insidePages, insideFootnote, insideSetter, insideText, columns }: Scope): void => {
  // No page token's value is known when a running value is set.
  if (insideSetter && (PDF_PAGE_TOKENS.has(node.type) || node.type === PDF_PRIMITIVES.Footnote)) {
    treeInvalid(node.type === PDF_PRIMITIVES.Footnote
      ? `<${label}> cannot be inside a <PdfText> with "running": the running value is the plain text of that text, and a note is not part of it. Put the footnote in another text.`
      : `<${label}> cannot be inside a <PdfText> with "running": the running value is the plain text of that text, and a page token has no text when the value is set. Put the token in another text.`)
  }
  // A value can be long: in the flow, a text sized with one value and
  // painted with another could grow after its page is split.
  if (node.type === PDF_PRIMITIVES.RunningText && !insideFixed && !insidePages && !insideFootnote) {
    treeInvalid(`<${label}> must be inside a fixed node, such as a header or a footer: in the flow, a running value could change the size of the text after the page is split. Put it in a fixed header or footer.`)
  }
  if (node.type === PDF_PRIMITIVES.RunningText && columns.inColumn && (node.props.at === 'before' || node.props.at === 'end')) {
    treeInvalid(`<${label}> with at="${node.props.at}" cannot be in a column: the value ${node.props.at === 'end' ? 'at the end of' : 'before'} a page is a value of the whole page, and a fixed node in a column repeats in every column. Use the default at="top", or move the table out of the column container.`)
  }
  if (!hasProp(node, node.type === PDF_PRIMITIVES.Text ? 'running' : PDF_RUNNING_ROW_PROP)) return
  if (insideFixed || insidePages || node.props.fixed === true) {
    treeInvalid(`<${label}> with "running" cannot be fixed or inside a fixed node (a <PdfTableHeader> is one): a fixed node repeats on every page, and would set the value on every page. Put the text that sets the value in the page flow, and <PdfRunningText> in the fixed node.`)
  }
  if (insideFootnote) {
    treeInvalid(`<${label}> with "running" cannot be inside <PdfFootnote>: a note is laid out at the bottom of its page, outside the flow that sets the values. Put the text that sets the value in the page flow.`)
  }
  if (insideText) {
    treeInvalid(`<${label}> with "running" cannot be nested inside another <PdfText>: pagination sees a nested text only as part of the lines of its parent. Put "running" on the outer text.`)
  }
}

/** Validate invariants that require the complete mounted document tree. */
export const validatePdfDocumentTree = (document: PdfDocumentNode): void => {
  // Destination id → label of the element that has it.
  const destinationIds = new Map<string, string>()
  // Target id → label and source of the first node that references it.
  const internalLinkTargets = new Map<string, { label: string, source: string | undefined }>()
  const pageRefTargets = new Map<string, { label: string, source: string | undefined }>()
  // The names that a PdfText sets with "running", and the first PdfRunningText of each name it prints.
  const runningNames = new Set<string>()
  const runningTexts = new Map<string, { label: string, source: string | undefined }>()
  // Attachment name → source, for the name check against PdfFacturX.
  const attachmentNames = new Map<string, string | undefined>()
  let facturX: PdfElementNode | undefined
  // The claimed levels depend on props the walk does not change.
  const levels = pdfClaimedLevels(document.props.conformance)
  const pdfA = claimsPdfA(levels)
  let pageCount = 0
  // The first PdfContents and its source, and whether any node gives it an entry.
  let contents: { label: string, source: string | undefined } | undefined
  let contentsEntries = false
  // Field name → source, for unique names and the conformance check.
  const fieldNames = new Map<string, FieldRecord>()
  type Pending = Scope & {
    node: PdfElementNode
    parent: PdfElementNode | undefined
    breakBlocker: BreakBlocker | undefined
  }
  const pending: Pending[] = [{
    node: document,
    insideSvg: false,
    insidePages: false,
    insideText: false,
    insideFixed: false,
    insideCell: false,
    insideLink: false,
    insideFootnote: false,
    insideSetter: false,
    parent: undefined,
    breakBlocker: undefined,
    columns: ROOT_COLUMN_SCOPE,
    floats: ROOT_FLOAT_SCOPE,
    insideFloat: false,
  }]

  const validateNode = (scope: Pending): void => {
    const { node, insideSvg, insidePages, insideText, insideFixed, insideCell, insideLink, insideFootnote, insideSetter, parent, breakBlocker, columns } = scope
    const label = pdfElementLabel(node)
    if ((node.props.break === true || node.props.break === 'column') && breakBlocker !== undefined) treeInvalid(breakProblem(label, breakBlocker))
    if (node.props.keepWithNext === true) {
      const problem = keepWithNextProblem(node, label, parent, insideText, insideCell)
      if (problem !== undefined) treeInvalid(problem)
    }
    // The engine lays a nested text out inside the lines of the outermost
    // text, so a per-page carrier cannot live anywhere below it.
    if (insideText && hasProp(node, 'pages')) {
      treeInvalid(`"pages" is not supported on a <${label}> nested inside another <PdfText>.`)
    }
    // A raised or lowered baseline is relative to the lines of the text
    // around it; an outer text, a view or SVG text has none.
    const verticalAlign = resolvedStyleValue(node.style, 'verticalAlign')
    if (verticalAlign !== undefined && verticalAlign !== 'baseline' && !(insideText && !insideSvg && (node.type === PDF_PRIMITIVES.Text || node.type === PDF_PRIMITIVES.Link))) {
      treeInvalid(`verticalAlign "${verticalAlign}" on <${label}> needs a <PdfText> or <PdfLink> inside another <PdfText>: it raises or lowers them within the lines of that text. Wrap the characters in a nested <PdfText>.`)
    }
    // A percentage font size is a share of the inherited one: a page
    // inherits nothing (its font size is the `rem` base), and SVG text
    // resolves its own inheritance.
    const fontSize = resolvedStyleValue(node.style, 'fontSize')
    if (typeof fontSize === 'string' && fontSize.trim().endsWith('%') && (node.type === PDF_PRIMITIVES.Page || insideSvg)) {
      treeInvalid(node.type === PDF_PRIMITIVES.Page
        ? `fontSize "${fontSize}" on <${label}> is a percentage, but a page inherits no font size to take it of. Give the page a length, such as 10, or set the percentage on the content.`
        : `fontSize "${fontSize}" on SVG <${label}> is a percentage, which SVG text does not take. Give it a length, such as 10.`)
    }
    // A page that breaks puts what passes its end on the next page; a wrapping
    // column page would put it in a second column first, and lose lines doing
    // so. A row page that wraps lays out a grid.
    const flexWrap = resolvedStyleValue(node.style, 'flexWrap')
    const pageDirection = resolvedStyleValue(node.style, 'flexDirection')
    if (node.type === PDF_PRIMITIVES.Page && node.props.wrap !== false && (flexWrap === 'wrap' || flexWrap === 'wrap-reverse') && !(pageDirection === 'row' || pageDirection === 'row-reverse')) {
      treeInvalid(`flexWrap "${flexWrap}" on <${label}> is not supported: a page puts the content that passes its end on the next page, not in another column. Remove flexWrap, or give the content a <PdfView> with columnCount for text in columns, or a <PdfView> with flexDirection "row" and flexWrap for a grid.`)
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
    if (node.type === PDF_PRIMITIVES.Leader) validateLeaderStyle(node.style, label)
    validateContext(node, insideSvg)
    validateFixedPages(node, insidePages)
    validateColumns(node, label, columns)
    validateFloat(node, label, scope.floats, scope.insideFloat)
    if (node.type === PDF_PRIMITIVES.Footnote) validateFootnote(node, label, scope)
    if (node.type === PDF_PRIMITIVES.Contents) {
      validateContentsPlace(label, scope)
      contents ??= { label, source: node.source }
    }
    if (pdfContentsTitle(node.props.bookmark) !== undefined) contentsEntries = true
    validateRunning(node, label, scope)
    // In a note, the token's own check below names the footnote.
    if (node.type === PDF_PRIMITIVES.Text && !insideFootnote) validatePerPageText(node, insideText)
    const runningName = runningNameOf(node)
    if (runningName !== undefined) runningNames.add(runningName)
    if (node.type === PDF_PRIMITIVES.RunningText && typeof node.props.name === 'string' && !runningTexts.has(node.props.name)) {
      runningTexts.set(node.props.name, { label, source: node.source })
    }
    if (insideFootnote && node.type === PDF_PRIMITIVES.RunningText) {
      treeInvalid(`<${label}> cannot be inside <PdfFootnote>: the notes are laid out before the pages are known. Write the value in the note.`)
    }
    if (insideFootnote && (node.type === PDF_PRIMITIVES.PageNumber || node.type === PDF_PRIMITIVES.PageCount)) {
      treeInvalid(`<${label}> cannot be inside <PdfFootnote>: the notes are laid out before the pages are known. Write the number in the text next to the footnote, or use <PdfPageRef>.`)
    }
    const flowProp = insideFootnote ? NOTE_FLOW_PROPS.find(key => hasProp(node, key)) : undefined
    if (flowProp !== undefined) {
      treeInvalid(`<${label}> cannot have "${flowProp}" inside <PdfFootnote>: the note is laid out once, at the bottom of the page of its mark. Remove "${flowProp}".`)
    }
    if (PDF_FIELD_TYPES.has(node.type)) validateField(node, insideFixed, fieldNames)

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
        if (!internalLinkTargets.has(id)) internalLinkTargets.set(id, { label, source: node.source })
      }
    }

    if (node.type === PDF_PRIMITIVES.PageRef && typeof node.props.to === 'string') {
      if (!pageRefTargets.has(node.props.to)) pageRefTargets.set(node.props.to, { label, source: node.source })
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
          insideCell: insideCell || node.component === 'PdfTableCell',
          insideLink: insideLink || node.type === PDF_PRIMITIVES.Link,
          insideFootnote: insideFootnote || node.type === PDF_PRIMITIVES.Footnote,
          insideSetter: insideSetter || (node.type === PDF_PRIMITIVES.Text && hasProp(node, 'running')),
          parent: node,
          breakBlocker: breakBlocker ?? breakBlockerOf(node),
          columns: childColumnScope(node, columns, child),
          floats: childFloatScope(node, scope.floats, child),
          insideFloat: scope.insideFloat || floatOf(node) !== undefined,
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
  // A contents lists the outline: without a bookmark it would print nothing.
  if (contents !== undefined && !contentsEntries) {
    treeInvalid(`<${contents.label}> has no entries: it lists the outline, and no node in the document has a "bookmark". Give the headings a bookmark, such as <PdfText tag="h1" bookmark="Introduction">, or set "bookmarks" on <PdfRichText>.`, contents.source)
  }
  validateCreationDate(document.props.creationDate)

  validateProtection(document, facturX, levels)
  if (facturX !== undefined && !pdfA) {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.FacturX]}> writes a Factur-X invoice, which must be a PDF/A-3 file: add conformance="PDF/A-3b" to <${PDF_PRIMITIVE_NAMES[PDF_PRIMITIVES.Document]}>, or "PDF/A-3a" for a tagged invoice.`, facturX.source)
  }
  validateFieldsConformance(document, fieldNames)
  validateConformance(document, facturX, attachmentNames, levels)
  if (claimsTaggedPdf(levels)) validateTaggedDocument(document, levels)

  // D23: the message names the element, the prop and the missing id, because
  // without a source position (production) it is the only way to find the node.
  const missingTarget = (label: string, kind: string, prop: string, value: string, target: string): string =>
    `<${label}> ${kind} does not match any id in the document: ${prop} ${describePdfValue(value)}. `
    + `Give the target element id=${describePdfValue(target)} or correct "${prop}".`
  for (const [target, { label, source }] of internalLinkTargets) {
    if (!destinationIds.has(target)) {
      treeInvalid(missingTarget(label, 'internal destination', 'href', `#${target}`, target), source)
    }
  }

  for (const [target, { label, source }] of pageRefTargets) {
    if (!destinationIds.has(target)) {
      treeInvalid(missingTarget(label, 'destination', 'to', target, target), source)
    }
  }

  // A misspelt name would print nothing on every page.
  for (const [name, { label, source }] of runningTexts) {
    if (!runningNames.has(name)) {
      treeInvalid(`<${label}> prints the running value ${describePdfValue(name)}, which no <PdfText> in the document sets. Correct the name, or set it with running=${describePdfValue(name)} on a heading. When the texts that set it are optional, put the same v-if on <PdfRunningText>.`, source)
    }
  }
}
