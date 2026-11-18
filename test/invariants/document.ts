// Spec → Vue template of public components → PDF → tokens per page.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, type Component, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import type { BundledPdfFontDescriptor, PdfFontDataUrl } from '../../src/runtime/fonts'
import type { PdfImageAssetMap } from '../../src/runtime/server/assets/resolve-asset'
import { createPdfTemplate } from '../../src/runtime/server/registry'
import { DEFAULT_PDF_RENDER_LIMITS, type PdfRenderLimits } from '../../src/runtime/server/render-limits'
import { pdfRenderPlacement } from '../../src/runtime/server/worker-render'
import { PDF_DEFINITION_PROPERTY, type PdfDefinition } from '../../src/runtime/shared/template'
import { installPdfCanvasGlobals, parsePdf, type ParsedPdf } from '../../src/test/pdf'
import {
  BODY_FONT, boxColor, CELL_PAD_X, CELL_PAD_Y, FONT_FACES, IMAGES, SCRIPT_FONTS,
  type BoxSpec, type CellSpec, type DocumentSpec, type FieldSpec, type FixedSpec, type InlineLink, type NodePatch, type NodeSpec, type PageSpec, type RowSpec, type TableSpec, type TextSpec,
} from './generator'

// Lengths are written in any unit (I13) and props come from data, which the
// typed component props cannot describe; the components are plain Vue
// components here, as in faults.ts.
const COMPONENTS: Readonly<Record<keyof typeof PDF_COMPONENTS, Component>> = PDF_COMPONENTS
const {
  PdfCheckbox, PdfDocument, PdfImage, PdfLink, PdfPage, PdfPageCount, PdfPageNumber, PdfPageRef, PdfPath, PdfRect, PdfSelect, PdfSvg,
  PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfTextField, PdfView,
} = COMPONENTS

export const CREATION_DATE = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
export const RENDER_TIMEOUT_MS = 10_000
/**
 * The limit of the one rerun that separates a slow render from one that does
 * not end. Generated documents render in under 2 s on an idle machine; a load
 * that slows a render down 30 times still ends inside this limit.
 */
export const RETRY_TIMEOUT_MS = 6 * RENDER_TIMEOUT_MS
export const RENDER_LIMITS: PdfRenderLimits = { ...DEFAULT_PDF_RENDER_LIMITS, timeoutMs: RENDER_TIMEOUT_MS, maxPages: 1000 }

/** The length unit a document is written in (I13): every style length, table length column and page padding. */
export type Unit = 'pt' | 'mm' | 'cm' | 'in'
const POINTS_PER_UNIT: Readonly<Record<Unit, number>> = { pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72 }
type Length = (points: number) => number | string

/**
 * How a document writes its lengths: in one unit, or (`pointsOf`) as the pt
 * numbers the engine computes from that unit's strings, `(points / factor) *
 * factor` (`@react-pdf/stylesheet` transformUnit and `components/table.ts`
 * multiply by the same factors). The second is the reference of an I13 unit
 * pair, so both documents give the engine the same numbers: compared with
 * plain pt, six decimals moved a page break in inches (an exact fit), and a
 * 1e-14 pt difference in a content width chose other line breaks in a
 * justified paragraph (a tie in the line breaker). Full precision: the
 * engine's number syntax has no exponent, and no length here is below 1e-6.
 */
export type Lengths = Unit | { pointsOf: Exclude<Unit, 'pt'> }
const lengthIn = (lengths: Lengths): Length => {
  if (lengths === 'pt') return points => points
  if (typeof lengths === 'string') return points => `${points / POINTS_PER_UNIT[lengths]}${lengths}`
  const factor = POINTS_PER_UNIT[lengths.pointsOf]
  return points => (points / factor) * factor
}

const boxStyle = (L: Length, name: 'margin' | 'padding', [top, right, bottom, left]: readonly number[]) => ({
  [`${name}Top`]: L(top!),
  [`${name}Right`]: L(right!),
  [`${name}Bottom`]: L(bottom!),
  [`${name}Left`]: L(left!),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The props of a node with its patch: patch props win, patch style merges into the style. */
const patched = (patch: NodePatch | undefined, props: Record<string, unknown>): Record<string, unknown> => {
  if (!patch) return props
  const style = patch.style ? { ...(isRecord(props.style) ? props.style : {}), ...patch.style } : props.style
  return { ...props, ...patch.props, ...(style === undefined ? {} : { style }) }
}

/** The children of a node with its patch. */
const withAppended = <T>(patch: NodePatch | undefined, children: T[]): Array<T | VNode | string> =>
  !patch?.append ? children : patch.replaceChildren ? patch.append() : [...children, ...patch.append()]

/** Tokens as text, with an inline link around `link.tokens`. */
const inline = (tokens: readonly string[], link: InlineLink | undefined): Array<string | VNode> => {
  if (!link) return [tokens.join(' ')]
  const end = link.start + link.link.tokens.length
  return [
    tokens.slice(0, link.start).map(token => `${token} `).join(''),
    h(PdfLink, { href: link.link.href }, () => link.link.tokens.join(' ')),
    tokens.slice(end).map(token => ` ${token}`).join(''),
  ].filter(part => part !== '')
}

/** The style of a text's face: a FONT_FACES entry or a script font; none for the document's font. */
const faceStyle = (text: TextSpec): Record<string, unknown> => {
  if (text.script) return { fontFamily: SCRIPT_FONTS[text.script.kind].family }
  const face = text.face === undefined ? undefined : FONT_FACES[text.face]
  if (!face) return {}
  return { fontFamily: face.family, ...('fontWeight' in face ? { fontWeight: face.fontWeight } : {}), ...('fontStyle' in face ? { fontStyle: face.fontStyle } : {}) }
}

const SVG_SHAPE_COLOR = '#336699'
/** The alt text of an image or SVG: unique, so I19 can find each figure. */
export const figureAlt = (boxId: number): string => `figure ${boxId}`

/** The template of one spec, with every length in `unit`. */
const writer = (L: Length) => {
  const textNode = (text: TextSpec): VNode => {
    const content: Array<string | VNode> = text.script?.kind === 'rtl' ? [`${text.script.word} ${text.tokens[0]}`] : inline(text.tokens, text.link)
    if (text.suffix) {
      content.push(` ${text.suffix.prefix}`)
      content.push(text.suffix.kind === 'pageNumber' ? h(PdfPageNumber) : h(PdfPageRef, { to: text.suffix.to }))
    }
    return h(PdfText, patched(text.patch, {
      ...(text.id === undefined ? {} : { id: text.id }),
      ...(text.wrap ? {} : { wrap: false }),
      ...(text.brk ? { break: true } : {}),
      // number-word-hyphenated; script tokens are never split either.
      ...(text.suffix || text.script ? { hyphenate: false } : {}),
      ...(text.bookmark === undefined ? {} : { bookmark: text.bookmark }),
      ...(text.heading === undefined ? {} : { tag: `h${text.heading}` }),
      style: {
        ...faceStyle(text),
        fontSize: L(text.fontSize),
        ...(text.lineHeight === undefined ? {} : { lineHeight: text.lineHeight }),
        textAlign: text.align,
        marginTop: L(text.marginTop),
        marginBottom: L(text.marginBottom),
      },
    }), () => withAppended(text.patch, content))
  }

  /** A cell with a link holds a PdfText: the cell then renders a view, which passes the font size on. */
  const cellNode = (cell: CellSpec, fontSize: number): VNode => h(PdfTableCell, patched(cell.patch, {
    align: cell.align,
    ...(cell.span > 1 ? { colspan: cell.span } : {}),
    style: { fontSize: L(fontSize), paddingLeft: L(CELL_PAD_X), paddingRight: L(CELL_PAD_X), paddingTop: L(CELL_PAD_Y), paddingBottom: L(CELL_PAD_Y) },
  }), () => withAppended<VNode | string>(cell.patch, cell.link ? [h(PdfText, () => inline(cell.tokens, cell.link))] : [cell.tokens.join(' ')]))

  const rowNode = (row: RowSpec, fontSize: number): VNode =>
    h(PdfTableRow, patched(row.patch, row.wrap ? { wrap: true } : {}), () => withAppended(row.patch, row.cells.map(cell => cellNode(cell, fontSize))))

  /** A pt length column in the document's unit; shares and percentages as they are. */
  const column = (value: TableSpec['columns'][number]) => {
    if (typeof value !== 'string' || !value.endsWith('pt')) return value
    const length = L(Number(value.slice(0, -2)))
    return typeof length === 'number' ? `${length}pt` : length
  }

  const tableNode = (table: TableSpec): VNode => h(PdfTable, {
    columns: table.columns.map(column),
    ...patched(table.patch, { style: { marginTop: L(table.marginTop), marginBottom: L(table.marginBottom) } }),
  }, () => withAppended(table.patch, [
    ...(table.header ? [h(PdfTableHeader, () => table.header!.map(cell => cellNode(cell, table.fontSize)))] : []),
    ...table.rows.map(row => rowNode(row, table.fontSize)),
  ]))

  const place = (box: BoxSpec) => ({ marginTop: L(box.marginTop), marginLeft: L(box.marginLeft) })
  const size = (box: BoxSpec) => ({ width: L(box.width), height: L(box.height) })
  /** The view whose background shows the laid-out box (field-places): unbreakable, the box's size, no padding. */
  const boxed = (box: BoxSpec, child: VNode): VNode =>
    h(PdfView, { wrap: false, style: { ...size(box), ...place(box), backgroundColor: boxColor(box.boxId) } }, () => [child])

  const fieldNode = (field: FieldSpec, style: Record<string, unknown>): VNode => {
    const props: Record<string, unknown> = { name: field.name, style }
    if (field.field === 'text') return h(PdfTextField, patched(field.patch, { ...props, value: field.value, ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }) }))
    if (field.field === 'checkbox') return h(PdfCheckbox, patched(field.patch, { ...props, ...(field.checked ? { checked: true } : {}), ...(field.exportValue === undefined ? {} : { exportValue: field.exportValue }) }))
    return h(PdfSelect, patched(field.patch, { ...props, options: field.options, value: field.value }))
  }

  const boxNode = (box: BoxSpec): VNode => {
    if (box.kind === 'image') {
      return boxed(box, h(PdfImage, patched(box.patch, { src: IMAGES[box.format].src, alt: figureAlt(box.boxId), style: size(box) })))
    }
    if (box.kind === 'svg') {
      const { width, height, text } = box
      return h(PdfSvg, patched(box.patch, { width, height, viewBox: `0 0 ${width} ${height}`, alt: figureAlt(box.boxId), style: place(box) }), () => withAppended(box.patch, [
        h(PdfRect, { x: 0, y: 0, width, height, fill: boxColor(box.boxId) }),
        h(PdfPath, { d: `M 2 ${height - 2} L ${Math.min(width - 2, 22)} 2 L ${Math.min(width - 2, 42)} ${height - 2} Z`, fill: SVG_SHAPE_COLOR }),
        // tagged-embedded-fonts: SVG text does not inherit the page's font.
        h(PdfText, { x: text.x, y: text.y, fill: '#000000', style: { fontFamily: BODY_FONT.family, fontSize: text.fontSize } }, () => text.tokens.join(' ')),
      ]))
    }
    return box.boxed ? boxed(box, fieldNode(box, size(box))) : fieldNode(box, { ...size(box), ...place(box) })
  }

  const flowNode = (node: NodeSpec): VNode => {
    if (node.kind === 'text') return textNode(node)
    if (node.kind === 'table') return tableNode(node)
    if (node.kind === 'image' || node.kind === 'svg' || node.kind === 'field') return boxNode(node)
    if (node.kind === 'link') return h(PdfLink, { href: node.link.href, ...patched(node.patch, {}) }, () => withAppended(node.patch, node.children.map(textNode)))
    return h(PdfView, patched(node.patch, {
      ...(node.bookmark === undefined ? {} : { bookmark: node.bookmark }),
      ...(node.wrap ? {} : { wrap: false }),
      ...(node.brk ? { break: true } : {}),
      style: {
        ...boxStyle(L, 'margin', node.margin),
        ...boxStyle(L, 'padding', node.padding),
        ...(node.border > 0 ? { borderWidth: L(node.border), borderColor: '#888888', borderStyle: 'solid' } : {}),
        ...(node.minHeight > 0 ? { minHeight: L(node.minHeight) } : {}),
      },
    }), () => withAppended(node.patch, node.children.map(flowNode)))
  }

  const fixedNode = (fixed: FixedSpec): VNode => {
    const content: Array<string | VNode> = inline(fixed.tokens, fixed.link && { start: 0, link: fixed.link })
    for (const number of fixed.numbers) {
      content.push(` ${number.prefix}`)
      content.push(h(number.kind === 'pageNumber' ? PdfPageNumber : PdfPageCount))
    }
    const at = fixed.absolute
    const placement = at
      ? { position: 'absolute', ...(at.top === undefined ? {} : { top: L(at.top) }), ...(at.bottom === undefined ? {} : { bottom: L(at.bottom) }), left: L(at.left), right: L(at.right) }
      : {}
    const text = (style: Record<string, unknown>, own: Record<string, unknown>) =>
      h(PdfText, { ...own, ...(fixed.numbers.length > 0 ? { hyphenate: false } : {}), style: { fontSize: L(fixed.fontSize), ...style } }, () => content)
    const fixedProps = patched(fixed.patch, { fixed: true, ...(fixed.pages === 'all' ? {} : { pages: fixed.pages }) })
    return fixed.container === 'text'
      ? text({ ...placement, marginBottom: L(fixed.marginBottom) }, fixedProps)
      : h(PdfView, { ...fixedProps, style: { ...placement, marginBottom: L(fixed.marginBottom) } }, () => withAppended(fixed.patch, [text({}, {})]))
  }

  const pageNode = (page: PageSpec, tagged: boolean): VNode => h(PdfPage, patched(page.patch, {
    size: page.size.name === undefined ? [page.size.width, page.size.height] : page.size.name,
    ...(page.landscape ? { orientation: 'landscape' } : {}),
    ...(page.bookmark === undefined ? {} : { bookmark: page.bookmark }),
    style: { ...boxStyle(L, 'padding', page.padding), ...(tagged ? { fontFamily: BODY_FONT.family } : {}) },
  }), () => withAppended(page.patch, [...page.fixed.map(fixedNode), ...page.children.map(flowNode)]))

  return (spec: DocumentSpec): VNode => h(PdfDocument, patched(spec.patch, {
    creationDate: CREATION_DATE,
    ...(spec.tagged ? { conformance: 'PDF/UA-1', title: TAGGED_TITLE, language: TAGGED_LANGUAGE } : {}),
  }), () => withAppended(spec.patch, spec.pages.map(page => pageNode(page, spec.tagged === true))))
}

export const TAGGED_TITLE = 'Invariant document'
export const TAGGED_LANGUAGE = 'en'

/** The spec as a template: a plain render function of public components. */
export const specComponent = (spec: DocumentSpec, { lengths = 'pt' }: { lengths?: Lengths } = {}): Component => {
  const definition: PdfDefinition = {}
  const write = writer(lengthIn(lengths))
  return Object.assign(
    defineComponent({
      name: 'InvariantDocument',
      setup: () => () => write(spec),
    }),
    { [PDF_DEFINITION_PROPERTY]: definition },
  )
}

/** The fonts and images of the mixed profile, read once from the fixtures. */
let mixedResources: { fonts: BundledPdfFontDescriptor[], assets: PdfImageAssetMap } | undefined
const resources = () => {
  if (mixedResources) return mixedResources
  const dataUrl = (file: string) => `data:font/ttf;base64,${readFileSync(resolve(file)).toString('base64')}` as PdfFontDataUrl
  const fonts: BundledPdfFontDescriptor[] = [
    ...FONT_FACES.map(face => ({
      family: face.family,
      src: dataUrl(`playground/pdfs/fonts/${face.file}`),
      ...('fontWeight' in face ? { fontWeight: face.fontWeight } : {}),
      ...('fontStyle' in face ? { fontStyle: face.fontStyle } : {}),
    })),
    { family: BODY_FONT.family, src: dataUrl(`playground/pdfs/fonts/${BODY_FONT.file}`) },
    ...Object.values(SCRIPT_FONTS).map(font => ({ family: font.family, src: dataUrl(`test/fixtures/fonts/international/${font.file}`) })),
  ]
  const assets: PdfImageAssetMap = Object.fromEntries(Object.values(IMAGES).map(image => [
    image.src,
    { dataB64: readFileSync(resolve(image.file)).toString('base64'), format: image.src.endsWith('.png') ? 'png' : 'jpg' },
  ]))
  mixedResources = { fonts, assets }
  return mixedResources
}

/** The production path: mount, admit, lay out in a pool worker (or in-process). */
export const renderPublic = async (
  spec: DocumentSpec,
  { inProcess, timeoutMs = RENDER_TIMEOUT_MS, limits = {}, lengths }: { inProcess: boolean, timeoutMs?: number, limits?: Partial<PdfRenderLimits>, lengths?: Lengths },
): Promise<Uint8Array> => {
  const previous = pdfRenderPlacement.inProcess
  pdfRenderPlacement.inProcess = inProcess
  try {
    const template = createPdfTemplate('invariant', specComponent(spec, lengths === undefined ? {} : { lengths }), {
      limits: { ...RENDER_LIMITS, timeoutMs, ...limits },
      ...(spec.profile === 'mixed' ? resources() : {}),
    })
    return await (await template.render({})).toUint8Array()
  }
  finally {
    pdfRenderPlacement.inProcess = previous
  }
}

// ---------------------------------------------------------------------------
// Reading the PDF

export interface Word {
  text: string
  page: number
  /** Left edge, from the run's x and the advance widths of the text before the word. */
  x: number
  width: number
  /** Baseline, PDF coordinates (origin bottom left). */
  y: number
  fontSize: number
  run: number
}

export interface Run {
  page: number
  x: number
  y: number
  width: number
  fontSize: number
  words: string[]
  /** The run's text as pdf.js returns it. */
  text: string
  /** pdf.js: 'ltr' or 'rtl'. */
  direction: string
  /** PostScript name of the run's font, subset prefix removed (mixed documents only). */
  font?: string
}

/** A link annotation: PDF coordinates [x1, y1, x2, y2], origin bottom left. */
export interface LinkRect {
  page: number
  rect: [number, number, number, number]
  url?: string
  destination?: string
}

export interface OutlineEntry {
  title: string
  page: number | undefined
  children: OutlineEntry[]
}

/** A rectangle in PDF coordinates [x1, y1, x2, y2] (origin bottom left) on a page. */
export interface Paint {
  page: number
  rect: [number, number, number, number]
}

export interface FieldWidget extends Paint {
  name: string
  value: unknown
}

/** What only the mixed profile reads: paint, widgets, metadata, structure. */
export interface Details {
  /** Filled paths with their fill colour (pdf.js hex), as bounding boxes. */
  fills: Array<Paint & { color: string }>
  images: Paint[]
  widgets: FieldWidget[]
  /** Widgets per field name, from pdf.js `getFieldObjects`. */
  fieldCounts: Map<string, number>
  acroForm: boolean
  title: string | undefined
  language: string | undefined
  marked: boolean
  /** Per page: structure roles in tree order, and the alt texts of figures; undefined without a structure tree. */
  structure: Array<{ roles: string[], alts: string[] } | undefined>
}

export interface ReadPdf {
  parsed: ParsedPdf
  words: Word[]
  runs: Run[]
  links: LinkRect[]
  /** Page of each named destination that was asked for. */
  destinations: Map<string, number | undefined>
  outline: OutlineEntry[]
  details?: Details
}

const WORD = /\S+/g

interface Metrics {
  /** Advance widths in 1/1000 em of the letters the generator writes, and the width of any other. */
  widths: Readonly<Record<string, number>>
  other: number
  /** Kerning of letter pairs, in 1/1000 em. */
  kerning: Readonly<Record<string, number>>
}
/** Helvetica: digits are 556; the engine writes no kerning for the standard font. */
const HELVETICA: Metrics = { widths: { ' ': 278, 'c': 500, 'h': 556, 'k': 500, 'n': 556, 'p': 556, 'r': 333, 'w': 722, '-': 333 }, other: 556, kerning: {} }
/**
 * Roboto Regular (tagged documents), measured with fontkit: 2048 units per em,
 * digits 1150 units. The engine kerns; these five pairs are all the kerning
 * among the letters the generator writes (mixed-fonts-without-links).
 */
const ROBOTO: Metrics = {
  widths: { ' ': 247.55859375, 'c': 523.4375, 'h': 550.78125, 'k': 506.8359375, 'n': 551.7578125, 'p': 561.03515625, 'r': 338.37890625, 'w': 751.46484375, 'x': 495.60546875, '-': 275.87890625 },
  other: 561.5234375,
  kerning: { kc: -9.765625, rw: 8.30078125, rc: -9.27734375, px: -7.32421875, xc: -9.765625 },
}
const metricsOf = (font: string | undefined): Metrics => font === BODY_FONT.postscript ? ROBOTO : HELVETICA
const advance = (text: string, metrics: Metrics): number => {
  const letters = [...text]
  return letters.reduce((sum, letter, index) => sum + (metrics.widths[letter] ?? metrics.other) + (index > 0 ? metrics.kerning[`${letters[index - 1]}${letter}`] ?? 0 : 0), 0)
}

/**
 * A justified line with one word spreads its letters ("w 1 0 0 0"); pdf.js
 * returns each letter as its own run. Join consecutive one-letter words on
 * one baseline back into one word, so the token rules see the word the
 * generator wrote.
 */
const joinSpacedLetters = (words: Word[]): Word[] => {
  const joined: Word[] = []
  for (const word of words) {
    const last = joined.at(-1)
    const previous = words[words.indexOf(word) - 1]
    if (word.text.length === 1 && last && previous?.text.length === 1 && last.page === word.page
      && Math.abs(last.y - word.y) < 0.1 && word.x > last.x) {
      last.text += word.text
      last.width = word.x + word.width - last.x
      continue
    }
    joined.push({ ...word })
  }
  return joined
}

/**
 * Words of one pdf.js run with their positions. The run's width beyond the
 * natural advance of its text is space: justification, or a gap pdf.js joined
 * into the run as one space. It goes to the spaces, so each word keeps its
 * own width.
 */
const runWords = (text: string, x: number, width: number, fontSize: number, metrics: Metrics): Array<{ text: string, x: number, width: number }> => {
  const measure = (part: string) => advance(part, metrics)
  const found = [...text.matchAll(WORD)].map(match => ({ text: match[0], index: match.index }))
  const natural = measure(text) * fontSize / 1000
  const spaces = text.split(' ').length - 1
  const extraPerSpace = spaces > 0 ? (width - natural) / spaces : 0
  const scale = spaces > 0 || natural === 0 ? 1 : width / natural
  return found.map(({ text: word, index }) => {
    const before = text.slice(0, index)
    return {
      text: word,
      x: x + (measure(before) * fontSize / 1000) * scale + (before.split(' ').length - 1) * extraPerSpace,
      width: measure(word) * fontSize / 1000 * scale,
    }
  })
}

interface PdfJsOutline { title: string, dest: unknown, items: PdfJsOutline[] }

const isReference = (value: unknown): value is { num: number, gen: number } =>
  typeof value === 'object' && value !== null && 'num' in value && 'gen' in value

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** `outer` after `inner`: a point goes through `inner` first, as a `cm` operator concatenates. */
const multiply = (m: Matrix, n: readonly number[]): Matrix => {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = n
  return [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]
}
/** The bounding box of a user-space rectangle under a matrix. */
const boundsOf = (m: Matrix, [x1, y1, x2, y2]: readonly number[]): [number, number, number, number] => {
  const points = [[x1!, y1!], [x2!, y1!], [x1!, y2!], [x2!, y2!]].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]] as const)
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfJsPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>
interface StructNode { role?: string, alt?: string, children?: StructNode[] }

/** Filled paths and painted images of one page, from its operator list (CTM tracked through save, restore, cm and form XObjects). */
const paintOf = async (pdfjs: PdfJs, page: PdfJsPage, number: number): Promise<Pick<Details, 'fills' | 'images'>> => {
  const { OPS } = pdfjs
  const list = await page.getOperatorList()
  const fills: Details['fills'] = []
  const images: Paint[] = []
  const stack: Array<{ matrix: Matrix, color: string }> = []
  let matrix = IDENTITY
  let color = '#000000'
  const FILLS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke])
  list.fnArray.forEach((fn, index) => {
    const args: unknown = list.argsArray[index]
    const values = Array.isArray(args) ? args : []
    if (fn === OPS.save) stack.push({ matrix, color })
    else if (fn === OPS.restore) ({ matrix, color } = stack.pop() ?? { matrix, color })
    else if (fn === OPS.transform) matrix = multiply(matrix, values as number[])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ matrix, color })
      if (Array.isArray(values[0])) matrix = multiply(matrix, values[0] as number[])
    }
    else if (fn === OPS.paintFormXObjectEnd) ({ matrix, color } = stack.pop() ?? { matrix, color })
    else if (fn === OPS.setFillRGBColor && typeof values[0] === 'string') color = values[0]
    else if (fn === OPS.constructPath && FILLS.has(values[0] as number)) {
      const box: unknown = values[2]
      if (box && typeof box === 'object' && 'length' in box && (box as ArrayLike<number>).length === 4) fills.push({ page: number, color, rect: boundsOf(matrix, Array.from(box as ArrayLike<number>)) })
    }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      images.push({ page: number, rect: boundsOf(matrix, [0, 0, 1, 1]) })
    }
  })
  return { fills, images }
}

const structureOf = (tree: StructNode | null): { roles: string[], alts: string[] } | undefined => {
  if (!tree) return undefined
  const roles: string[] = []
  const alts: string[] = []
  const visit = (node: StructNode) => {
    if (node.role) roles.push(node.role)
    if (node.role === 'Figure' && typeof node.alt === 'string') alts.push(node.alt)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return { roles, alts }
}

/**
 * What parsePdf does not keep, read with pdf.js: named destinations and the
 * outline with pages; for a mixed document also the font of each text item
 * (`fonts[page - 1][item]`, in parsePdf's order of text runs: pdf.js numbers
 * its font ids per opened document, so ids cannot be matched) and the Details.
 */
const readExtra = async (
  bytes: Uint8Array,
  { ids, outline, details, password }: { ids: readonly string[], outline: boolean, details: boolean, password?: string },
): Promise<Pick<ReadPdf, 'destinations' | 'outline' | 'details'> & { fonts: Array<Array<string | undefined>> }> => {
  const fonts: Array<Array<string | undefined>> = []
  if (ids.length === 0 && !outline && !details) return { destinations: new Map(), outline: [], fonts }
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0, ...(password === undefined ? {} : { password }) })
  const document = await task.promise
  try {
    const pageOf = async (destination: unknown): Promise<number | undefined> => {
      const explicit: unknown = typeof destination === 'string' ? await document.getDestination(destination) : destination
      if (!Array.isArray(explicit)) return undefined
      const reference: unknown = explicit[0]
      if (typeof reference === 'number') return reference + 1
      return isReference(reference) ? await document.getPageIndex(reference) + 1 : undefined
    }
    const destinations = new Map<string, number | undefined>()
    for (const id of ids) destinations.set(id, await pageOf(id))
    const entries = async (items: readonly PdfJsOutline[]): Promise<OutlineEntry[]> => {
      const result: OutlineEntry[] = []
      for (const item of items) result.push({ title: item.title, page: await pageOf(item.dest), children: await entries(item.items) })
      return result
    }
    const top: PdfJsOutline[] | null = outline ? await document.getOutline() : null
    if (!details) return { destinations, outline: top ? await entries(top) : [], fonts }

    const found: Details = { fills: [], images: [], widgets: [], fieldCounts: new Map(), acroForm: false, title: undefined, language: undefined, marked: false, structure: [] }
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      try {
        // The operator list loads the fonts into commonObjs.
        const paint = await paintOf(pdfjs, page, number)
        found.fills.push(...paint.fills)
        found.images.push(...paint.images)
        const names = new Map<string, string | undefined>()
        const nameOf = (id: string): string | undefined => {
          if (!names.has(id)) {
            let name: string | undefined
            try {
              const font: unknown = page.commonObjs.get(id)
              if (font && typeof font === 'object' && 'name' in font && typeof font.name === 'string') name = font.name.replace(/^[A-Z]{6}\+/, '')
            }
            catch {
              // A font pdf.js did not load stays unnamed; I18 reports its tokens.
            }
            names.set(id, name)
          }
          return names.get(id)
        }
        const content = await page.getTextContent()
        fonts.push(content.items.flatMap(item => 'str' in item ? [nameOf(item.fontName)] : []))
        for (const annotation of await page.getAnnotations()) {
          if (annotation.subtype !== 'Widget' || !Array.isArray(annotation.rect) || annotation.rect.length !== 4) continue
          const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = annotation.rect as number[]
          found.widgets.push({ page: number, name: String(annotation.fieldName), value: annotation.fieldValue, rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] })
        }
        found.structure.push(structureOf(await page.getStructTree() as StructNode | null))
      }
      finally {
        page.cleanup()
      }
    }
    const objects: unknown = await document.getFieldObjects()
    if (objects && typeof objects === 'object') {
      for (const [name, list] of Object.entries(objects)) found.fieldCounts.set(name, Array.isArray(list) ? list.length : 0)
    }
    const { info } = await document.getMetadata()
    const record = (info ?? {}) as Record<string, unknown>
    found.acroForm = record.IsAcroFormPresent === true
    found.title = typeof record.Title === 'string' ? record.Title : undefined
    found.language = typeof record.Language === 'string' ? record.Language : undefined
    const mark: unknown = await document.getMarkInfo()
    found.marked = typeof mark === 'object' && mark !== null && 'Marked' in mark && mark.Marked === true
    return { destinations, outline: top ? await entries(top) : [], details: found, fonts }
  }
  finally {
    await task.destroy()
  }
}

/** Text, link annotations and (when asked for) destination and outline pages of a PDF; `details` for a mixed document. */
export const readPdf = async (
  bytes: Uint8Array,
  navigation: { ids: readonly string[], outline: boolean } = { ids: [], outline: false },
  { password, details = false }: { password?: string, details?: boolean } = {},
): Promise<ReadPdf> => {
  const parsed = await parsePdf(bytes, password === undefined ? {} : { password })
  const extra = await readExtra(bytes, { ...navigation, details, ...(password === undefined ? {} : { password }) })
  const words: Word[] = []
  const runs: Run[] = []
  const links: LinkRect[] = []
  for (const page of parsed.pages) {
    for (const [item, textRun] of page.textRuns.entries()) {
      const font = extra.fonts[page.number - 1]?.[item]
      const found = runWords(textRun.text, textRun.x, textRun.width, textRun.fontSize, metricsOf(font))
      if (found.length === 0) continue
      const run = runs.length
      runs.push({
        page: page.number, x: textRun.x, y: textRun.y, width: textRun.width, fontSize: textRun.fontSize, words: found.map(word => word.text),
        text: textRun.text, direction: textRun.direction, ...(font === undefined ? {} : { font }),
      })
      for (const word of found) words.push({ ...word, page: page.number, y: textRun.y, fontSize: textRun.fontSize, run })
    }
    for (const annotation of page.annotations) {
      if (annotation.subtype !== 'Link' || annotation.rect?.length !== 4) continue
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = annotation.rect
      links.push({
        page: page.number,
        rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
        ...(annotation.url === undefined ? {} : { url: annotation.url }),
        ...(typeof annotation.destination === 'string' ? { destination: annotation.destination } : {}),
      })
    }
  }
  return {
    parsed, words: joinSpacedLetters(words), runs, links, destinations: extra.destinations, outline: extra.outline,
    ...(extra.details ? { details: extra.details } : {}),
  }
}
