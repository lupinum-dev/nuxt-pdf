import type { PdfWriter } from '../pdf/writer'

// SVG path data: the tokenizer and the drawing of `@react-pdf/pdfkit` 5.1.1
// (`SVGPath`), and the bounding box `@react-pdf/render` 4.5.1 takes for a
// gradient (`normalize-svg-path` and `svg-arc-to-cubic-bezier` points).

export interface PathCommand {
  command: string
  args: readonly number[]
}

const ARGUMENTS: Readonly<Record<string, number>> = {
  M: 2, m: 2, Z: 0, z: 0, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
  C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, A: 7, a: 7,
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\r' || c === '\n'
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** A number at `start`: the index of its last character and its value, or `null`. */
const readNumber = (data: string, start: number): [number, number | null] => {
  let state: 'none' | 'sign' | 'whole' | 'point' | 'decimal' | 'e' | 'exponentSign' | 'exponent' = 'none'
  let index = start
  for (; index < data.length; index += 1) {
    const c = data[index]!
    if ((c === '+' || c === '-') && (state === 'none' || state === 'e')) state = state === 'none' ? 'sign' : 'exponentSign'
    else if (isDigit(c) && (state === 'none' || state === 'sign' || state === 'whole')) state = 'whole'
    else if (isDigit(c) && (state === 'point' || state === 'decimal')) state = 'decimal'
    else if (isDigit(c) && (state === 'e' || state === 'exponentSign' || state === 'exponent')) state = 'exponent'
    else if (c === '.' && (state === 'none' || state === 'sign' || state === 'whole')) state = 'point'
    else if ((c === 'e' || c === 'E') && (state === 'whole' || state === 'point' || state === 'decimal')) state = 'e'
    else break
  }
  const value = Number.parseFloat(data.slice(start, index))
  return Number.isNaN(value) ? [start, null] : [index - 1, value]
}

/**
 * The commands of a path, each with all its arguments. Parsing stops at the
 * first error and keeps what came before; the path must start with a moveto.
 * Arc flags are single digits, so `a1 1 0 0110 10` reads.
 */
export const parsePathData = (data: string): PathCommand[] => {
  const commands: PathCommand[] = []
  let command: string | null = null
  let args: number[] = []
  let canHaveComma = false
  let hadComma = false
  for (let index = 0; index < data.length; index += 1) {
    const c = data[index]!
    if (isSpace(c)) continue
    if (canHaveComma && c === ',') {
      if (hadComma) break
      hadComma = true
      continue
    }
    if (c in ARGUMENTS) {
      if (hadComma) return commands
      if (command === null ? c !== 'M' && c !== 'm' : args.length !== 0) return commands
      command = c
      args = []
      canHaveComma = false
      if (ARGUMENTS[c] === 0) commands.push({ command, args })
      continue
    }
    if (command === null) return commands
    let end = index
    let value: number | null = null
    if (command === 'A' || command === 'a') {
      const position = args.length
      // Radii have no sign; the flags are one digit each.
      if ((position === 0 || position === 1) && c !== '+' && c !== '-') [end, value] = readNumber(data, index)
      if (position === 2 || position === 5 || position === 6) [end, value] = readNumber(data, index)
      if ((position === 3 || position === 4) && (c === '0' || c === '1')) value = Number(c)
    }
    else {
      [end, value] = readNumber(data, index)
    }
    if (value === null) return commands
    args.push(value)
    canHaveComma = true
    hadComma = false
    index = end
    if (args.length === ARGUMENTS[command]) {
      commands.push({ command, args })
      // More coordinates after a moveto are linetos.
      if (command === 'M') command = 'L'
      if (command === 'm') command = 'l'
      args = []
    }
  }
  return commands
}

/** The cubic curves of an arc from (ox, oy), as Inkscape's svgtopdf splits it; also its intermediate point. */
const arcCurves = (ox: number, oy: number, args: readonly number[]) => {
  const [radiusX, radiusY, rotation, large, sweep, x, y] = args as [number, number, number, number, number, number, number]
  const th = rotation * (Math.PI / 180)
  const sinTh = Math.sin(th)
  const cosTh = Math.cos(th)
  let rx = Math.abs(radiusX)
  let ry = Math.abs(radiusY)
  const px = cosTh * (ox - x) * 0.5 + sinTh * (oy - y) * 0.5
  const py = cosTh * (oy - y) * 0.5 - sinTh * (ox - x) * 0.5
  let pl = px * px / (rx * rx) + py * py / (ry * ry)
  if (pl > 1) {
    pl = Math.sqrt(pl)
    rx *= pl
    ry *= pl
  }
  const a00 = cosTh / rx
  const a01 = sinTh / rx
  const a10 = -sinTh / ry
  const a11 = cosTh / ry
  const x0 = a00 * ox + a01 * oy
  const y0 = a10 * ox + a11 * oy
  const x1 = a00 * x + a01 * y
  const y1 = a10 * x + a11 * y
  const d = (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)
  let factor = Math.sqrt(Math.max(1 / d - 0.25, 0))
  if (sweep === large) factor = -factor
  const xc = 0.5 * (x0 + x1) - factor * (y1 - y0)
  const yc = 0.5 * (y0 + y1) + factor * (x1 - x0)
  const th0 = Math.atan2(y0 - yc, x0 - xc)
  const th1 = Math.atan2(y1 - yc, x1 - xc)
  let arc = th1 - th0
  if (arc < 0 && sweep === 1) arc += 2 * Math.PI
  else if (arc > 0 && sweep === 0) arc -= 2 * Math.PI
  const segments = Math.ceil(Math.abs(arc / (Math.PI * 0.5 + 0.001)))
  const b00 = cosTh * rx
  const b01 = -sinTh * ry
  const b10 = sinTh * rx
  const b11 = cosTh * ry
  const curves: [number, number, number, number, number, number][] = []
  for (let index = 0; index < segments; index += 1) {
    const from = th0 + index * arc / segments
    const to = th0 + (index + 1) * arc / segments
    const half = 0.5 * (to - from)
    const t = 8 / 3 * Math.sin(half * 0.5) * Math.sin(half * 0.5) / Math.sin(half)
    const cx1 = xc + Math.cos(from) - t * Math.sin(from)
    const cy1 = yc + Math.sin(from) + t * Math.cos(from)
    const ex = xc + Math.cos(to)
    const ey = yc + Math.sin(to)
    const cx2 = ex + t * Math.sin(to)
    const cy2 = ey - t * Math.cos(to)
    curves.push([b00 * cx1 + b01 * cy1, b10 * cx1 + b11 * cy1, b00 * cx2 + b01 * cy2, b10 * cx2 + b11 * cy2, b00 * ex + b01 * ey, b10 * ex + b11 * ey])
  }
  return { curves, px, py }
}

/**
 * Draws the commands. The last control point (`px`, `py`) is reflected by a
 * smooth curve (S, T); as in pdfkit, an arc leaves its own intermediate point
 * there, so a smooth curve right after an arc reflects that point. Kept until
 * its fix, because the fix changes the bytes.
 */
export const drawPath = (writer: PdfWriter, commands: readonly PathCommand[]): void => {
  let cx = 0
  let cy = 0
  let px: number | null = 0
  let py: number | null = 0
  let sx = 0
  let sy = 0
  /** A smooth curve's first control point: the last one reflected, or the current point. */
  const reflected = (): [number, number] => px === null || py === null ? [cx, cy] : [cx - (px - cx), cy - (py - cy)]
  for (const { command, args: a } of commands) {
    const [a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0] = a
    switch (command) {
      case 'M':
      case 'm':
        cx = command === 'M' ? a0 : cx + a0
        cy = command === 'M' ? a1 : cy + a1
        px = py = null
        sx = cx
        sy = cy
        writer.moveTo(cx, cy)
        break
      case 'C':
        cx = a4
        cy = a5
        px = a2
        py = a3
        writer.bezierCurveTo(a0, a1, a2, a3, a4, a5)
        break
      case 'c':
        writer.bezierCurveTo(a0 + cx, a1 + cy, a2 + cx, a3 + cy, a4 + cx, a5 + cy)
        px = cx + a2
        py = cy + a3
        cx += a4
        cy += a5
        break
      case 'S':
      case 's': {
        const [x1, y1] = reflected()
        const ox = command === 'S' ? 0 : cx
        const oy = command === 'S' ? 0 : cy
        writer.bezierCurveTo(x1, y1, ox + a0, oy + a1, ox + a2, oy + a3)
        px = ox + a0
        py = oy + a1
        cx = command === 'S' ? a2 : cx + a2
        cy = command === 'S' ? a3 : cy + a3
        break
      }
      case 'Q':
        px = a0
        py = a1
        cx = a2
        cy = a3
        writer.quadraticCurveTo(a0, a1, cx, cy)
        break
      case 'q':
        writer.quadraticCurveTo(a0 + cx, a1 + cy, a2 + cx, a3 + cy)
        px = cx + a0
        py = cy + a1
        cx += a2
        cy += a3
        break
      case 'T':
      case 't': {
        [px, py] = reflected()
        writer.quadraticCurveTo(px, py, command === 'T' ? a0 : cx + a0, command === 'T' ? a1 : cy + a1)
        cx = command === 'T' ? a0 : cx + a0
        cy = command === 'T' ? a1 : cy + a1
        break
      }
      case 'A':
      case 'a': {
        const end = command === 'A' ? [a5, a6] : [a5 + cx, a6 + cy]
        const arc = arcCurves(cx, cy, [a0, a1, a2, a3, a4, end[0]!, end[1]!])
        for (const curve of arc.curves) writer.bezierCurveTo(...curve)
        px = arc.px
        py = arc.py
        cx = end[0]!
        cy = end[1]!
        break
      }
      case 'L':
      case 'l':
      case 'H':
      case 'h':
      case 'V':
      case 'v':
        if (command === 'L' || command === 'H') cx = a0
        if (command === 'l' || command === 'h') cx += a0
        if (command === 'L') cy = a1
        if (command === 'l') cy += a1
        if (command === 'V') cy = a0
        if (command === 'v') cy += a0
        px = py = null
        writer.lineTo(cx, cy)
        break
      case 'Z':
      case 'z':
        writer.closePath()
        cx = sx
        cy = sy
        break
    }
  }
}

/** The cubic curves of an arc as `svg-arc-to-cubic-bezier` 3.2.0 splits it: end and control points. */
const unitArcCurves = (px: number, py: number, cx: number, cy: number, radiusX: number, radiusY: number, rotation: number, large: number, sweep: number): number[][] => {
  const TAU = Math.PI * 2
  if (radiusX === 0 || radiusY === 0) return []
  const sinPhi = Math.sin(rotation * TAU / 360)
  const cosPhi = Math.cos(rotation * TAU / 360)
  const pxp = cosPhi * (px - cx) / 2 + sinPhi * (py - cy) / 2
  const pyp = -sinPhi * (px - cx) / 2 + cosPhi * (py - cy) / 2
  if (pxp === 0 && pyp === 0) return []
  let rx = Math.abs(radiusX)
  let ry = Math.abs(radiusY)
  const lambda = Math.pow(pxp, 2) / Math.pow(rx, 2) + Math.pow(pyp, 2) / Math.pow(ry, 2)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const rxsq = Math.pow(rx, 2)
  const rysq = Math.pow(ry, 2)
  const pxpsq = Math.pow(pxp, 2)
  const pypsq = Math.pow(pyp, 2)
  let radicant = Math.max(rxsq * rysq - rxsq * pypsq - rysq * pxpsq, 0)
  radicant /= rxsq * pypsq + rysq * pxpsq
  radicant = Math.sqrt(radicant) * (large === sweep ? -1 : 1)
  const centerXp = radicant * rx / ry * pyp
  const centerYp = radicant * -ry / rx * pxp
  const centerX = cosPhi * centerXp - sinPhi * centerYp + (px + cx) / 2
  const centerY = sinPhi * centerXp + cosPhi * centerYp + (py + cy) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number): number =>
    (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(Math.min(Math.max(ux * vx + uy * vy, -1), 1))
  const vx1 = (pxp - centerXp) / rx
  const vy1 = (pyp - centerYp) / ry
  let from = angle(1, 0, vx1, vy1)
  let sweepAngle = angle(vx1, vy1, (-pxp - centerXp) / rx, (-pyp - centerYp) / ry)
  if (sweep === 0 && sweepAngle > 0) sweepAngle -= TAU
  if (sweep === 1 && sweepAngle < 0) sweepAngle += TAU
  let ratio = Math.abs(sweepAngle) / (TAU / 4)
  if (Math.abs(1.0 - ratio) < 0.0000001) ratio = 1.0
  const segments = Math.max(Math.ceil(ratio), 1)
  sweepAngle /= segments
  const onEllipse = (x: number, y: number): [number, number] => [
    cosPhi * (x * rx) - sinPhi * (y * ry) + centerX,
    sinPhi * (x * rx) + cosPhi * (y * ry) + centerY,
  ]
  const curves: number[][] = []
  for (let index = 0; index < segments; index += 1) {
    const a = sweepAngle === 1.5707963267948966 ? 0.551915024494 : sweepAngle === -1.5707963267948966 ? -0.551915024494 : 4 / 3 * Math.tan(sweepAngle / 4)
    const x1 = Math.cos(from)
    const y1 = Math.sin(from)
    const x2 = Math.cos(from + sweepAngle)
    const y2 = Math.sin(from + sweepAngle)
    curves.push([...onEllipse(x1 - y1 * a, y1 + x1 * a), ...onEllipse(x2 + y2 * a, y2 - x2 * a), ...onEllipse(x2, y2)])
    from += sweepAngle
  }
  return curves
}

/**
 * The box `@react-pdf/render` places a gradient in: the extremes of every
 * point of the path as cubic curves, control points included (not the tight
 * box of the shape; step 2 fixes that). An arc that is no curve (a zero
 * radius or no length) adds no point and does not move the current point.
 */
export const pathBounds = (commands: readonly PathCommand[]): [number, number, number, number] => {
  if (commands.length === 0) return [0, 0, 0, 0]
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  const add = (points: readonly number[]) => {
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index]!
      const y = points[index + 1]!
      if (x < bounds[0]) bounds[0] = x
      if (y < bounds[1]) bounds[1] = y
      if (x > bounds[2]) bounds[2] = x
      if (y > bounds[3]) bounds[3] = y
    }
  }
  // Two cursors, as in the packages: `abs-svg-path` resolves relative
  // coordinates against its own (which an arc without curves still moves).
  let absoluteX = 0
  let absoluteY = 0
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let previous = ''
  let controlX = 0
  let controlY = 0
  let quadX = 0
  let quadY = 0
  const quadratic = (qx: number, qy: number, endX: number, endY: number): number[] =>
    [x / 3 + (2 / 3) * qx, y / 3 + (2 / 3) * qy, endX / 3 + (2 / 3) * qx, endY / 3 + (2 / 3) * qy, endX, endY]
  for (const { command: written, args } of commands) {
    const command = written.toUpperCase()
    // Relative coordinates against the current point.
    const relative = written !== command
    const a = args.map((value, index) => {
      if (!relative) return value
      if (command === 'A') return index === 5 ? value + absoluteX : index === 6 ? value + absoluteY : value
      if (command === 'V') return value + absoluteY
      return value + (index % 2 === 0 ? absoluteX : absoluteY)
    })
    if (command === 'Z') [absoluteX, absoluteY] = [startX, startY]
    else if (command === 'H') absoluteX = a[0]!
    else if (command === 'V') absoluteY = a[0]!
    else [absoluteX, absoluteY] = [a.at(-2)!, a.at(-1)!]
    let points: number[]
    switch (command) {
      case 'M':
        startX = a[0]!
        startY = a[1]!
        points = a
        break
      case 'A': {
        const curves = unitArcCurves(x, y, a[5]!, a[6]!, a[0]!, a[1]!, a[2]!, a[3]!, a[4]!)
        if (curves.length === 0) continue
        curves.forEach(add)
        points = curves.at(-1)!
        break
      }
      case 'S': {
        const reflect = previous === 'C' || previous === 'S'
        points = [reflect ? x + (x - controlX) : x, reflect ? y + (y - controlY) : y, ...a]
        break
      }
      case 'T':
        if (previous === 'Q' || previous === 'T') {
          quadX = x * 2 - quadX
          quadY = y * 2 - quadY
        }
        else {
          quadX = x
          quadY = y
        }
        points = quadratic(quadX, quadY, a[0]!, a[1]!)
        break
      case 'Q':
        quadX = a[0]!
        quadY = a[1]!
        points = quadratic(a[0]!, a[1]!, a[2]!, a[3]!)
        break
      case 'L': points = [x, y, a[0]!, a[1]!, a[0]!, a[1]!]
        break
      case 'H': points = [x, y, a[0]!, y, a[0]!, y]
        break
      case 'V': points = [x, y, x, a[0]!, x, a[0]!]
        break
      case 'Z': points = [x, y, startX, startY, startX, startY]
        break
      default: points = a
    }
    if (command !== 'A') add(points)
    previous = command
    x = points[points.length - 2]!
    y = points[points.length - 1]!
    controlX = points.length > 4 ? points[points.length - 4]! : x
    controlY = points.length > 4 ? points[points.length - 3]! : y
  }
  return bounds
}
