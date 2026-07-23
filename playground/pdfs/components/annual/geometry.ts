// Pure SVG geometry for the annual-report charts. No layout, no styling —
// just the arithmetic that turns data into `d`/`points` strings and pixel
// coordinates inside a chart's user space. Kept out of the .vue files so the
// components stay declarative and this can be reasoned about on its own.

/** A point on a circle, measured clockwise from 12 o'clock (SVG y-down). */
export const polar = (
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number, y: number } => {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

const n = (value: number): string => Number(value.toFixed(3)).toString()

/**
 * A filled donut segment between two angles (degrees, clockwise from top).
 * Outer arc runs clockwise, inner arc back counter-clockwise, closing the ring.
 */
export const donutSegment = (
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string => {
  const outerStart = polar(cx, cy, outerR, startAngle)
  const outerEnd = polar(cx, cy, outerR, endAngle)
  const innerEnd = polar(cx, cy, innerR, endAngle)
  const innerStart = polar(cx, cy, innerR, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0

  return [
    `M ${n(outerStart.x)} ${n(outerStart.y)}`,
    `A ${n(outerR)} ${n(outerR)} 0 ${largeArc} 1 ${n(outerEnd.x)} ${n(outerEnd.y)}`,
    `L ${n(innerEnd.x)} ${n(innerEnd.y)}`,
    `A ${n(innerR)} ${n(innerR)} 0 ${largeArc} 0 ${n(innerStart.x)} ${n(innerStart.y)}`,
    'Z',
  ].join(' ')
}

/** Cumulative [start, end] angle spans (degrees) for a set of values. */
export const angularSpans = (
  values: readonly number[],
  gapDeg = 0,
): Array<{ start: number, end: number }> => {
  const total = values.reduce((sum, v) => sum + v, 0)
  let cursor = 0
  return values.map((value) => {
    const sweep = (value / total) * 360
    const start = cursor + gapDeg / 2
    const end = cursor + sweep - gapDeg / 2
    cursor += sweep
    return { start, end }
  })
}

/** Map a value in [0, max] to a y-pixel inside a plot of the given height. */
export const yScale = (value: number, max: number, height: number): number =>
  height - (value / max) * height

/** A polyline `points` string for a sequence of values across a fixed width. */
export const linePoints = (
  values: readonly number[],
  width: number,
  height: number,
  max: number,
): string =>
  values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      return `${n(x)},${n(yScale(value, max, height))}`
    })
    .join(' ')

/** Closed area `d` under a value sequence, sealed down to the baseline. */
export const areaPath = (
  values: readonly number[],
  width: number,
  height: number,
  max: number,
): string => {
  const step = width / (values.length - 1)
  const top = values
    .map((value, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command} ${n(index * step)} ${n(yScale(value, max, height))}`
    })
    .join(' ')
  return `${top} L ${n(width)} ${n(height)} L 0 ${n(height)} Z`
}

/** x-pixel of the nth point in an evenly spaced sequence across a width. */
export const pointX = (index: number, count: number, width: number): number =>
  (index / (count - 1)) * width
