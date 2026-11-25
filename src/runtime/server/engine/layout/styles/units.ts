import { readPdfPoints } from '../../../../shared/style-values'

/**
 * What lengths in a page's styles resolve against. A page with an automatic
 * height has none, and its `fontSize` (the `rem` base) may be a string: a
 * `vh` or `rem` length then gives what `*` makes of it, as before the port.
 */
export interface StyleContainer {
  width: unknown
  height: unknown
  dpi: number
  remBase: unknown
}

const LENGTH = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(in|mm|cm|pt|vh|vw|px|rem)?$/
const POINTS_PER_INCH = 72

/**
 * A length in points: a number as it is, `<number><unit>` converted (no unit
 * is points; `px` counts at the page's `dpi`), and a point length in the
 * forms admission reads with `readPdfPoints` (`'+0'`, `'1e1'`, `'5.'`) as that
 * number. Any other value, such as a percentage or `auto`, stays as it is.
 */
export const toPoints = (container: StyleContainer, value: unknown): unknown => {
  if (typeof value === 'number') return value
  const match = LENGTH.exec(String(value))
  if (!match) return readPdfPoints(String(value)) ?? value
  const number = Number.parseFloat(match[1]!)
  switch (match[2]) {
    case 'rem': return number * Number(container.remBase)
    case 'in': return number * POINTS_PER_INCH
    case 'mm': return number * (POINTS_PER_INCH / 25.4)
    case 'cm': return number * (POINTS_PER_INCH / 2.54)
    case 'vh': return number * (Number(container.height) / 100)
    case 'vw': return number * (Number(container.width) / 100)
    case 'px': return number * (POINTS_PER_INCH / container.dpi)
    default: return number
  }
}
