import type { PdfFile } from './file'
import type { MarkedContent } from './marked-content'
import { formatNumber as n, type PdfRef, type PdfValue } from './objects'
import type { FillRule, Matrix, PdfWriter, Rgb } from './writer'

// The pages of our writer and their content streams: the page objects, the
// current transformation matrix, the graphics states and the path and paint
// operators.

/** A page while it is painted: its content lines and the resources they name. */
export interface Page {
  readonly ref: PdfRef
  readonly width: number
  readonly height: number
  readonly lines: string[]
  readonly fonts: Map<string, PdfRef>
  readonly states: Map<string, PdfRef>
  readonly images: Map<string, PdfRef>
  readonly patterns: Map<string, PdfRef>
  readonly annotations: PdfRef[]
}

export const PROC_SET = ['PDF', 'Text', 'ImageB', 'ImageC', 'ImageI']
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const CAPS: Readonly<Record<string, number>> = { butt: 0, round: 1, square: 2 }
const JOINS: Readonly<Record<string, number>> = { miter: 0, round: 1, bevel: 2 }

export const clamp = (value: number): number => Math.max(0, Math.min(1, value))
export const rgb = (color: Rgb): string => color.map(part => n(part / 255)).join(' ')
const windingRule = (rule: FillRule | undefined): string => rule !== undefined && /even-?odd/.test(rule) ? '*' : ''

/** `m` then `n`: the matrix of a `cm` with `n` under the current matrix `m`. */
const multiply = ([a, b, c, d, e, f]: Matrix, [na, nb, nc, nd, ne, nf]: Matrix): Matrix =>
  [a * na + c * nb, b * na + d * nb, a * nc + c * nd, b * nc + d * nd, a * ne + c * nf + e, b * ne + d * nf + f]

/** A point of the user space under `ctm` in page space. */
export const pagePoint = ([a, b, c, d, e, f]: Matrix, x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f]

/** The rectangle in page space of a box under `ctm`: the bounds of its four corners. */
export const pageRect = (ctm: Matrix, x: number, y: number, width: number, height: number): number[] => {
  const corners = [pagePoint(ctm, x, y), pagePoint(ctm, x + width, y), pagePoint(ctm, x, y + height), pagePoint(ctm, x + width, y + height)]
  const xs = corners.map(([px]) => px)
  const ys = corners.map(([, py]) => py)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** The operators that only write content, as `PdfWriter` names them. */
export type ContentOperators = Pick<PdfWriter,
  'save' | 'restore' | 'transform' | 'moveTo' | 'lineTo' | 'bezierCurveTo' | 'quadraticCurveTo' | 'rect' | 'closePath'
  | 'fill' | 'stroke' | 'fillAndStroke' | 'clip' | 'fillColor' | 'strokeColor' | 'fillOpacity' | 'strokeOpacity' | 'opacity'
  | 'lineWidth' | 'lineCap' | 'lineJoin' | 'dash' | 'undash'>

export interface PageContent {
  /** The page being painted. */
  current(): Page
  /** One content operator; in a tagged document after the marked-content operators it needs. */
  write(line: string): void
  /** The current transformation matrix, for annotation rectangles and gradient patterns. */
  ctm(): Matrix
  /** A graphics state with these entries, as a resource of the current page. */
  graphicsState(entries: { ca?: number, CA?: number }): void
  /** Ends the page before (if any) and starts a new one. */
  addPage(width: number, height: number): void
  /** Writes the last page's object. */
  finishPage(): void
  /** Each page's object and height, in order. */
  readonly pages: ReadonlyArray<{ readonly ref: PdfRef, readonly height: number }>
  readonly operators: ContentOperators
}

export const createPageContent = (file: PdfFile, marked: MarkedContent | undefined, pagesRef: PdfRef): PageContent => {
  const pages: Array<{ ref: PdfRef, height: number }> = []
  // One object per graphics state, shared by the pages that use it.
  const states = new Map<string, { name: string, ref: PdfRef }>()
  let page: Page | undefined
  let ctm: Matrix = IDENTITY
  const ctmStack: Matrix[] = []

  const current = (): Page => {
    if (page === undefined) throw new Error('Nuxt PDF painted before the first page.')
    return page
  }
  const write = (line: string): void => {
    const { lines } = current()
    if (marked !== undefined) lines.push(...marked.before())
    lines.push(line)
  }

  const finishPage = (): void => {
    if (page === undefined) return
    const resources: Record<string, PdfValue> = { ProcSet: PROC_SET }
    if (page.fonts.size > 0) resources.Font = Object.fromEntries(page.fonts)
    if (page.states.size > 0) resources.ExtGState = Object.fromEntries(page.states)
    if (page.images.size > 0) resources.XObject = Object.fromEntries(page.images)
    if (page.patterns.size > 0) resources.Pattern = Object.fromEntries(page.patterns)
    const tagged = marked?.endPage(page.ref)
    if (tagged !== undefined) page.lines.push(...tagged.lines)
    const contents = file.stream({}, `${page.lines.join('\n')}\n`)
    file.set({
      Type: 'Page',
      Parent: pagesRef,
      MediaBox: [0, 0, page.width, page.height],
      Contents: contents,
      Resources: resources,
      Annots: page.annotations.length > 0 ? page.annotations : undefined,
      // A tagged page: annotations in structure order, and its parent tree key.
      Tabs: tagged === undefined ? undefined : 'S',
      StructParents: tagged?.structParents,
    }, page.ref)
    page = undefined
  }

  const graphicsState = (entries: { ca?: number, CA?: number }): void => {
    const key = `${entries.ca ?? ''}_${entries.CA ?? ''}`
    let state = states.get(key)
    if (state === undefined) {
      state = { name: `Gs${states.size + 1}`, ref: file.set({ Type: 'ExtGState', ...entries }) }
      states.set(key, state)
    }
    current().states.set(state.name, state.ref)
    write(`/${state.name} gs`)
  }

  const addPage = (width: number, height: number): void => {
    finishPage()
    const ref = file.reserve()
    pages.push({ ref, height })
    // The page's own space has its origin at the bottom left; the painter's at the top left.
    ctm = [1, 0, 0, -1, 0, height]
    ctmStack.length = 0
    page = { ref, width, height, lines: [`1 0 0 -1 0 ${n(height)} cm`], fonts: new Map(), states: new Map(), images: new Map(), patterns: new Map(), annotations: [] }
  }

  const operators: ContentOperators = {
    save: () => {
      ctmStack.push(ctm)
      write('q')
    },
    restore: () => {
      ctm = ctmStack.pop() ?? IDENTITY
      write('Q')
    },
    transform: (...matrix: Matrix) => {
      const [a, b, c, d, e, f] = matrix
      if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) return
      ctm = multiply(ctm, matrix)
      write(`${matrix.map(n).join(' ')} cm`)
    },
    moveTo: (x, y) => write(`${n(x)} ${n(y)} m`),
    lineTo: (x, y) => write(`${n(x)} ${n(y)} l`),
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) => write(`${n(cp1x)} ${n(cp1y)} ${n(cp2x)} ${n(cp2y)} ${n(x)} ${n(y)} c`),
    // Wrong as ported from pdfkit, kept until its fix (it changes the bytes): `v` takes the
    // current point as the first control point, so the curve is not the quadratic one.
    quadraticCurveTo: (cpx, cpy, x, y) => write(`${n(cpx)} ${n(cpy)} ${n(x)} ${n(y)} v`),
    rect: (x, y, width, height) => write(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re`),
    closePath: () => write('h'),
    fill: rule => write(`f${windingRule(rule)}`),
    stroke: () => write('S'),
    fillAndStroke: rule => write(`B${windingRule(rule)}`),
    clip: rule => write(`W${windingRule(rule)} n`),
    fillColor: (color) => {
      if (color !== null) write(`${rgb(color)} rg`)
    },
    strokeColor: (color) => {
      if (color !== null) write(`${rgb(color)} RG`)
    },
    fillOpacity: opacity => graphicsState({ ca: clamp(opacity) }),
    strokeOpacity: opacity => graphicsState({ CA: clamp(opacity) }),
    opacity: opacity => graphicsState({ ca: clamp(opacity), CA: clamp(opacity) }),
    lineWidth: width => write(`${n(width)} w`),
    lineCap: (cap) => {
      const value = CAPS[cap]
      if (value === undefined) throw new Error(`Nuxt PDF cannot write the line cap "${cap}".`)
      write(`${value} J`)
    },
    lineJoin: (join) => {
      const value = JOINS[join]
      if (value === undefined) throw new Error(`Nuxt PDF cannot write the line join "${join}".`)
      write(`${value} j`)
    },
    dash: (lengths, phase = 0) => write(`[${lengths.map(n).join(' ')}] ${n(phase)} d`),
    undash: () => write('[] 0 d'),
  }

  return { current, write, ctm: () => ctm, graphicsState, addPage, finishPage, pages, operators }
}
