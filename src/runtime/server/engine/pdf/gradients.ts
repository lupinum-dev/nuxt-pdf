import { clamp, PROC_SET, rgb, type PageContent } from './content'
import type { PdfFile } from './file'
import { formatNumber as n, type PdfRef, type PdfValue } from './objects'
import type { Gradient, GradientStop } from './writer'

// Gradients in our writer: shading patterns, with a luminosity mask for stop
// opacities.

/**
 * A function from 0 to 1 over stops whose offsets rise from 0 to 1 (ISO
 * 32000-1, 7.10): each stop at its offset, a jump where two share one, and
 * the first and last colour beyond them.
 */
const stopFunction = (stops: readonly GradientStop[], value: (stop: GradientStop) => number[]): PdfValue => {
  const points = stops.map(stop => ({ at: stop.offset, value: value(stop) }))
  const first = points[0]!
  const last = points.at(-1)!
  const segments: Array<{ from: number, to: number, c0: number[], c1: number[] }> = []
  if (first.at > 0) segments.push({ from: 0, to: first.at, c0: first.value, c1: first.value })
  for (let index = 1; index < points.length; index += 1) {
    const [start, end] = [points[index - 1]!, points[index]!]
    if (end.at > start.at) segments.push({ from: start.at, to: end.at, c0: start.value, c1: end.value })
  }
  if (last.at < 1 || segments.length === 0) segments.push({ from: last.at, to: 1, c0: last.value, c1: last.value })
  const exponential = ({ c0, c1 }: { c0: number[], c1: number[] }) => ({ FunctionType: 2, Domain: [0, 1], C0: c0, C1: c1, N: 1 })
  if (segments.length === 1) return exponential(segments[0]!)
  return {
    FunctionType: 3,
    Domain: [0, 1],
    Functions: segments.map(exponential),
    Bounds: segments.slice(1).map(segment => segment.from),
    Encode: segments.flatMap(() => [0, 1]),
  }
}

/**
 * The shading's geometry and stops. Offsets are clamped to 0 to 1 and never
 * fall below the one before (SVG); the span from the first stop to the last
 * moves into the geometry, so the stops run from 0 to 1 and `Extend` paints
 * the first and last colour beyond them, as SVG pads (pdfkit blended from 0
 * to 1 whatever the offsets). A radial gradient runs from its focus to its
 * circle.
 */
const shadingOf = (gradient: Gradient): { type: number, coords: number[], stops: GradientStop[] } => {
  let floor = 0
  const clamped = gradient.stops.map((stop) => {
    floor = Math.max(floor, clamp(stop.offset))
    return { ...stop, offset: floor }
  })
  const from = clamped[0]!.offset
  const span = clamped.at(-1)!.offset - from
  const stops = span > 0 ? clamped.map(stop => ({ ...stop, offset: (stop.offset - from) / span })) : clamped
  const [start, end] = span > 0 ? [from, from + span] : [0, 1]
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  if (gradient.kind === 'linear') {
    const { x1, y1, x2, y2 } = gradient
    return { type: 2, coords: [lerp(x1, x2, start), lerp(y1, y2, start), lerp(x1, x2, end), lerp(y1, y2, end)], stops }
  }
  const { fx, fy, cx, cy, r } = gradient
  return { type: 3, coords: [lerp(fx, cx, start), lerp(fy, cy, start), r * start, lerp(fx, cx, end), lerp(fy, cy, end), r * end], stops }
}

/**
 * A gradient as the fill colour: a shading pattern in page space (the
 * current matrix); with stop opacities its colour is painted through a
 * luminosity mask of the same gradient in grey, inside a tiling pattern of
 * the page's size, as pdfkit built it.
 */
export const createGradients = (file: PdfFile, content: PageContent): (gradient: Gradient) => void => {
  const { current, write } = content
  let patternCount = 0
  return (gradient) => {
    const [first] = gradient.stops
    if (first === undefined) throw new Error('Nuxt PDF cannot fill with a gradient without stops.')
    // One colour (one stop, or all alike) is a solid fill (SVG).
    if (gradient.stops.every(stop => stop.opacity === first.opacity && stop.color.every((part, index) => part === first.color[index]))) {
      write(`${rgb(first.color)} rg`)
      if (first.opacity < 1) content.graphicsState({ ca: clamp(first.opacity) })
      return
    }
    const { type, coords, stops } = shadingOf(gradient)
    const { width, height } = current()
    const matrix = [...content.ctm()]
    const pattern = (colorSpace: string, value: (stop: GradientStop) => number[]): PdfRef => file.set({
      Type: 'Pattern',
      PatternType: 2,
      Shading: { ShadingType: type, ColorSpace: colorSpace, Coords: coords, Function: stopFunction(stops, value), Extend: [true, true] },
      Matrix: matrix,
    })
    const colour = pattern('DeviceRGB', stop => stop.color.map(part => part / 255))
    let fill = colour
    if (stops.some(stop => stop.opacity < 1)) {
      const box = [0, 0, width, height]
      const rectangle = `${box.map(n).join(' ')} re f`
      const mask = file.stream({
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: box,
        Group: { Type: 'Group', S: 'Transparency', CS: 'DeviceGray' },
        Resources: { ProcSet: PROC_SET, Pattern: { Sh1: pattern('DeviceGray', stop => [clamp(stop.opacity)]) } },
      }, `/Pattern cs /Sh1 scn\n${rectangle}`)
      const state = file.set({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: mask } })
      fill = file.stream({
        Type: 'Pattern',
        PatternType: 1,
        PaintType: 1,
        TilingType: 2,
        BBox: box,
        XStep: width,
        YStep: height,
        Resources: { ProcSet: PROC_SET, Pattern: { Sh1: colour }, ExtGState: { Gs1: state } },
      }, `/Gs1 gs /Pattern cs /Sh1 scn\n${rectangle}`)
    }
    patternCount += 1
    const name = `Sh${patternCount}`
    current().patterns.set(name, fill)
    write(`/Pattern cs /${name} scn`)
  }
}
