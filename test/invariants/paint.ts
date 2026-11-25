// I24, I25 (guards that need no old writer): the paint of the mixed profile's paint boxes, read from pixels that
// pdf.js renders, so the rules hold whatever operators the painter uses.
//
// Each paint box sits in a marker view whose background is boxColor(boxId),
// PAINT_MARKER wide on every side: pdf.js finds that fill as I16 finds a box,
// and the paint box lies PAINT_MARKER inside it. Pixels are read at known
// depths from the box's edges, at least EDGE from any edge, so no pixel is
// partly covered: the background in the middle of the content, each border
// inside its band, the background just inside a border, the marker just
// outside the box and in a rounded corner. A colour is the one CSS gives its
// form (generator.ts, BACKGROUND_COLORS and BORDER_COLORS), blended over what
// lies below with the alpha CSS gives: the colour's alpha times the
// opacity (the border colours are opaque).

import { createRequire } from 'node:module'
import { installPdfCanvasGlobals } from '../../src/test/pdf'
import type { ReadPdf } from './document'
import { BACKGROUND_COLORS, BORDER_COLORS, boxColor, PAINT_MARKER, type DocumentSpec, type NodeSpec, type PaintSpec } from './generator'
import type { InvariantId, Violation } from './invariants'

// The canvas module as src/test/pdf.ts loads it (require). pdf.js gets a
// factory on it too, as there: a second copy of the native addon (an ESM
// import, or pdf.js's own require for its scratch canvases) crashes the
// process in a Skia finalizer.
const { createCanvas } = createRequire(import.meta.url)('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
type NapiCanvas = ReturnType<typeof createCanvas>

class CanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height)
    return { canvas, context: canvas.getContext('2d') }
  }

  reset({ canvas }: { canvas: NapiCanvas }, width: number, height: number) {
    canvas.width = width
    canvas.height = height
  }

  destroy({ canvas }: { canvas: NapiCanvas }) {
    canvas.width = 0
    canvas.height = 0
  }
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfJsPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs['getDocument']>['promise']>['getPage']>>
type Rgb = readonly [number, number, number]
type Rect = readonly [number, number, number, number]

/** Pixels per pt: a 1 pt border is 4 pixels deep. */
const SCALE = 4
/** A pixel whose centre lies this far (pt) from an edge lies wholly on one side of it. */
const EDGE = 1.5 / SCALE
/** Per channel: the rounding of a colour form and of the blend. */
const COLOR_TOLERANCE = 6
/** The marker's size and x: pdf.js reads path bounds as 32-bit floats. */
const BOX_TOLERANCE = 0.05
const MAX_REPORTED = 5

const report = (invariant: InvariantId, messages: readonly string[]): Violation[] => {
  if (messages.length === 0) return []
  const shown = messages.slice(0, MAX_REPORTED)
  if (messages.length > MAX_REPORTED) shown.push(`… and ${messages.length - MAX_REPORTED} more`)
  return [{ invariant, message: shown.join('; ') }]
}

const blend = (top: Rgb, alpha: number, below: Rgb): Rgb =>
  [top[0] * alpha + below[0] * (1 - alpha), top[1] * alpha + below[1] * (1 - alpha), top[2] * alpha + below[2] * (1 - alpha)]
const hexRgb = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
const sameColor = (a: Rgb, b: Rgb): boolean => a.every((channel, index) => Math.abs(channel - b[index]!) <= COLOR_TOLERANCE)
const showColor = (color: Rgb): string => `rgb(${color.map(Math.round).join(' ')})`

const paintsOf = (nodes: readonly NodeSpec[]): PaintSpec[] =>
  nodes.flatMap(node => node.kind === 'view' ? [...(node.paint ? [node.paint] : []), ...paintsOf(node.children)] : [])

/** A region of a page (PDF coordinates) rendered by pdf.js at SCALE; reads the pixel under a PDF point. */
const renderRegion = async (page: PdfJsPage, [x1, y1, x2, y2]: Rect): Promise<(x: number, y: number) => Rgb | undefined> => {
  const whole = page.getViewport({ scale: SCALE })
  const [ax, ay] = whole.convertToViewportPoint(x1, y2)
  const [bx, by] = whole.convertToViewportPoint(x2, y1)
  const left = Math.floor(Math.min(ax!, bx!))
  const top = Math.floor(Math.min(ay!, by!))
  const width = Math.ceil(Math.max(ax!, bx!)) - left
  const height = Math.ceil(Math.max(ay!, by!)) - top
  const viewport = page.getViewport({ scale: SCALE, offsetX: -left, offsetY: -top })
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  // pdf.js types its context as the DOM's; @napi-rs/canvas implements it (as rasterizePdf in src/test/pdf.ts passes it).
  await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' }).promise
  const data = context.getImageData(0, 0, width, height).data
  return (x, y) => {
    const [px, py] = viewport.convertToViewportPoint(x, y)
    const column = Math.floor(px!)
    const row = Math.floor(py!)
    if (column < 0 || row < 0 || column >= width || row >= height) return undefined
    const index = (row * width + column) * 4
    return [data[index]!, data[index + 1]!, data[index + 2]!]
  }
}

/**
 * I24: each paint box's marker is painted once at the box's size and x; the
 * content shows the background (or the marker without one) at its alpha; the
 * marker shows just outside each side; a corner with a radius shows the
 * marker, a square corner its border (paint where two borders meet) or the
 * background.
 *
 * I25: each side with a width shows its colour at its opacity over the
 * background, from just inside its outer edge to just inside its inner edge,
 * and the background just past it; a side without a width shows the
 * background there.
 *
 * Pixels under a text run (its box as I22 covers it) are not read: fixed
 * absolute texts may lie over a box.
 */
export const checkPaint = async (spec: DocumentSpec, read: ReadPdf, bytes: Uint8Array): Promise<Violation[]> => {
  const paints = spec.pages.flatMap(page => paintsOf(page.children))
  const fills = read.details?.fills
  if (paints.length === 0 || !fills) return []
  const backgrounds: string[] = []
  const borders: string[] = []
  installPdfCanvasGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ CanvasFactory, data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 })
  const document = await task.promise
  try {
    for (const paint of paints) {
      const label = `paint box ${paint.boxId.toString(16)}`
      const markers = fills.filter(fill => fill.color === boxColor(paint.boxId))
      if (markers.length !== 1) {
        backgrounds.push(`${label}: its marker is painted ${markers.length} times`)
        continue
      }
      const { page: number, rect } = markers[0]!
      const [x1, y1, x2, y2] = rect
      const near = (a: number, b: number) => Math.abs(a - b) <= BOX_TOLERANCE
      if (!near(x2 - x1, paint.width + 2 * PAINT_MARKER) || !near(y2 - y1, paint.height + 2 * PAINT_MARKER) || !near(x1, paint.left - PAINT_MARKER)) {
        backgrounds.push(`${label}: marker ${(x2 - x1).toFixed(2)}×${(y2 - y1).toFixed(2)} at x ${x1.toFixed(2)}, expected ${paint.width + 2 * PAINT_MARKER}×${paint.height + 2 * PAINT_MARKER} at x ${paint.left - PAINT_MARKER}`)
        continue
      }
      const page = await document.getPage(number)
      try {
        const pixel = await renderRegion(page, [x1 - 1, y1 - 1, x2 + 1, y2 + 1])
        const covers: Rect[] = read.runs.filter(run => run.page === number).map(run =>
          [run.x - 0.3 * run.fontSize - EDGE, run.y - 0.45 * run.fontSize - EDGE, run.x + run.width + 0.3 * run.fontSize + EDGE, run.y + 1.15 * run.fontSize + EDGE])
        const boxLeft = x1 + PAINT_MARKER
        const boxTop = y2 - PAINT_MARKER
        /** The pixel at (x, y) pt from the paint box's top left corner, y down; none under a text. */
        const at = (x: number, y: number): Rgb | undefined => {
          const px = boxLeft + x
          const py = boxTop - y
          if (covers.some(([a, b, c, d]) => px >= a && px <= c && py >= b && py <= d)) return undefined
          return pixel(px, py)
        }
        const expect = (messages: string[], what: string, x: number, y: number, wanted: readonly Rgb[]) => {
          const found = at(x, y)
          if (found === undefined || wanted.some(color => sameColor(found, color))) return
          messages.push(`${label} p${number}: ${what} at (${x.toFixed(2)}, ${y.toFixed(2)}) is ${showColor(found)}, expected ${wanted.map(showColor).join(' or ')}`)
        }

        const expectPainted = (messages: string[], what: string, x: number, y: number, below: Rgb) => {
          const found = at(x, y)
          if (found === undefined || !sameColor(found, below)) return
          messages.push(`${label} p${number}: ${what} at (${x.toFixed(2)}, ${y.toFixed(2)}) is unpainted ${showColor(found)}`)
        }

        const { width: w, height: h, borders: widths, radii } = paint
        const marker = hexRgb(boxColor(paint.boxId))
        const fill = paint.background === undefined ? undefined : BACKGROUND_COLORS[paint.background]!
        const inside = fill === undefined ? marker : blend(fill.rgb, fill.alpha * paint.opacity, marker)
        const side = widths.map((_, index) => blend(BORDER_COLORS[paint.colors[index]!]!.rgb, paint.opacity, inside))
        const [top, right, bottom, left] = widths
        /** A point of side `index` at `depth` pt in from its outer edge, halfway along it. */
        const onSide = (index: number, depth: number): [number, number] =>
          [[w / 2, depth], [w - depth, h / 2], [w / 2, h - depth], [depth, h / 2]][index] as [number, number]
        const sideName = ['top', 'right', 'bottom', 'left'] as const

        // I24: the content, outside each side, the corners.
        const across = [left!, w - right!]
        const down = [top!, h - bottom!]
        const middle: [number, number] = [(across[0]! + across[1]!) / 2, (down[0]! + down[1]!) / 2]
        for (const [x, y] of [
          middle,
          [across[0]! + (across[1]! - across[0]!) / 4, middle[1]],
          [across[0]! + 3 * (across[1]! - across[0]!) / 4, middle[1]],
          [middle[0], down[0]! + (down[1]! - down[0]!) / 4],
          [middle[0], down[0]! + 3 * (down[1]! - down[0]!) / 4],
        ] as const) expect(backgrounds, 'content', x, y, [inside])
        for (let index = 0; index < 4; index += 1) expect(backgrounds, `outside the ${sideName[index]} side`, ...onSide(index, -EDGE), [marker])
        const cornerSides = [[0, 3], [0, 1], [2, 1], [2, 3]] as const
        const cornerPoints = [[EDGE, EDGE], [w - EDGE, EDGE], [w - EDGE, h - EDGE], [EDGE, h - EDGE]] as const
        cornerPoints.forEach(([x, y], index) => {
          const what = `corner ${index + 1}${radii[index]! > 0 ? ` (radius ${radii[index]})` : ''}`
          const painted = cornerSides[index]!.filter(sideIndex => widths[sideIndex]! > 0).map(sideIndex => side[sideIndex]!)
          if (radii[index]! > 0) expect(backgrounds, what, x, y, [marker])
          // Two sides meet on a diagonal through the corner: its pixel mixes them (and what lies below), so only "painted" holds.
          else if (painted.length === 2) expectPainted(backgrounds, what, x, y, marker)
          else expect(backgrounds, what, x, y, painted.length === 1 ? painted : [inside])
        })

        // I25: each side's band and what lies past it.
        widths.forEach((width, index) => {
          const name = `${sideName[index]} border (${width} pt)`
          if (width === 0) {
            expect(borders, `${name}, its edge`, ...onSide(index, EDGE), [inside])
            return
          }
          const color = side[index]!
          expect(borders, `${name}, outer`, ...onSide(index, EDGE), [color])
          expect(borders, `${name}, inner`, ...onSide(index, width - EDGE), [color])
          if (!sameColor(color, inside)) expect(borders, `${name}, past it`, ...onSide(index, width + EDGE), [inside])
        })
      }
      finally {
        page.cleanup()
      }
    }
  }
  finally {
    await task.destroy()
  }
  return [...report('I24', backgrounds), ...report('I25', borders)]
}
