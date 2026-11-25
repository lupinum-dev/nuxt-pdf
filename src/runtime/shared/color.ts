import { NAMED_COLORS } from './named-colors'

// The one colour rule of Nuxt PDF. Every colour-valued style key and prop
// (backgrounds, text, decorations, borders, SVG paint and gradient stops,
// form fields) takes a colour exactly when `readPdfColor` reads it: the
// render check, the `<style>` compiler and the painter all call it.
//
// The forms are the ones color-string 2.1.4 read: hex with 3, 4, 6 or 8
// digits, rgb() and rgba() (commas or spaces, numbers or percentages, an
// alpha after a comma or slash), hsl() and hsla(), hwb(), the CSS colour
// names in any case and `transparent`. Two of its forms are refused: an hwb()
// without a hue (it gave NaN) and an hsl() hue run into its saturation
// (`hsl(12050%,50%)`). Each pattern matches in linear time.

export interface PdfColor {
  /** Red, green and blue, whole numbers from 0 to 255. */
  rgb: readonly [number, number, number]
  /** From 0 (invisible) to 1 (opaque). */
  alpha: number
}

/** The colour forms, in words, for error messages. */
export const PDF_COLOR_FORMS = 'a hex color (#rgb, #rgba, #rrggbb or #rrggbbaa), rgb(), hsl(), hwb(), a color name or transparent'

const SHORT_HEX = /^#([a-f\d]{3,4})$/i
const LONG_HEX = /^#([a-f\d]{6})([a-f\d]{2})?$/i
const RGB = /^rgba?\(\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?=[\s,])\s*(?:,\s*)?([+-]?(?:\d*\.)?\d+(?:e\d+)?)(?:(?:\s*[,|/]|\s)\s*([+-]?(?:\d*\.)?\d+(?:e\d+)?)(%?))?\s*\)$/i
const RGB_PERCENT = /^rgba?\(\s*([+-]?[\d.]+)%\s*(?:,\s*)?([+-]?[\d.]+)%\s*(?:,\s*)?([+-]?[\d.]+)%(?:(?:\s*[,|/]|\s)\s*([+-]?[\d.]+)(%?))?\s*\)$/i
const HSL = /^hsla?\(\s*([+-]?(?:\d{0,3}\.)?\d+)(?:deg|(?=[\s,]))\s*(?:,\s*)?([+-]?[\d.]+)%\s*(?:,\s*)?([+-]?[\d.]+)%(?:\s*[,|/]\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?))?\s*\)$/i
const HWB = /^hwb\(\s*([+-]?(?=\.?\d)\d{0,3}(?:\.\d+)?)(?:deg)?(?:\s*,|\s)\s*([+-]?[\d.]+)%(?:\s*,|\s)\s*([+-]?[\d.]+)%(?:(?:\s*,|\s)\s*([+-]?(?=\.\d|\d)(?:0|[1-9]\d*)?(?:\.\d*)?(?:e[+-]?\d+)?))?\s*\)$/i

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
const channel = (value: number): number => Math.round(clamp(value, 0, 255))
const hue = (value: string): number => ((Number.parseFloat(value) % 360) + 360) % 360
/** An optional alpha: a number, or a percentage when `percent` is set; 1 without one. */
const alphaOf = (value: string | undefined, percent = ''): number => {
  const alpha = value === undefined ? Number.NaN : Number.parseFloat(value) * (percent ? 0.01 : 1)
  return clamp(Number.isNaN(alpha) ? 1 : alpha, 0, 1)
}

/** The pure hue at full saturation and half lightness. */
const hueRgb = (degrees: number): [number, number, number] => {
  const x = 1 - Math.abs(((degrees / 60) % 2) - 1)
  return degrees < 60 ? [1, x, 0] : degrees < 120 ? [x, 1, 0] : degrees < 180 ? [0, 1, x] : degrees < 240 ? [0, x, 1] : degrees < 300 ? [x, 0, 1] : [1, 0, x]
}

const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  return hueRgb(h).map(part => channel(((part - 0.5) * chroma + l) * 255)) as [number, number, number]
}

/** As `@react-pdf/render`'s `hwbToRgb`, whose bytes the painter keeps: the hue is rounded to whole channels first. */
const fromHwb = (h: number, white: number, black: number): [number, number, number] => {
  if (white + black >= 1) {
    const gray = Math.round((white / (white + black)) * 255)
    return [gray, gray, gray]
  }
  return hueRgb(h).map(part => Math.round((Math.round(part * 255) / 255) * (1 - white - black) * 255 + white * 255)) as [number, number, number]
}

/** A colour in one of the forms above, or `undefined` for anything else. */
export const readPdfColor = (value: string): PdfColor | undefined => {
  const color = value.trim()
  let match = LONG_HEX.exec(color)
  if (match !== null) {
    const digits = match[1]!
    const pair = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16)
    return { rgb: [pair(0), pair(1), pair(2)], alpha: match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255 }
  }
  match = SHORT_HEX.exec(color)
  if (match !== null) {
    const digits = match[1]!
    const digit = (index: number) => Number.parseInt(digits[index]! + digits[index]!, 16)
    return { rgb: [digit(0), digit(1), digit(2)], alpha: digits[3] === undefined ? 1 : digit(3) / 255 }
  }
  match = RGB.exec(color)
  if (match !== null) return { rgb: [channel(Number.parseFloat(match[1]!)), channel(Number.parseFloat(match[2]!)), channel(Number.parseFloat(match[3]!))], alpha: alphaOf(match[4], match[5]) }
  match = RGB_PERCENT.exec(color)
  if (match !== null) {
    const percent = (index: number) => channel(Math.round(Number.parseFloat(match![index]!) * 2.55))
    return { rgb: [percent(1), percent(2), percent(3)], alpha: alphaOf(match[4], match[5]) }
  }
  match = HSL.exec(color)
  if (match !== null) {
    return { rgb: fromHsl(hue(match[1]!), clamp(Number.parseFloat(match[2]!), 0, 100) / 100, clamp(Number.parseFloat(match[3]!), 0, 100) / 100), alpha: alphaOf(match[4]) }
  }
  match = HWB.exec(color)
  if (match !== null) {
    return { rgb: fromHwb(hue(match[1]!), clamp(Number.parseFloat(match[2]!), 0, 100) / 100, clamp(Number.parseFloat(match[3]!), 0, 100) / 100), alpha: alphaOf(match[4]) }
  }
  const name = color.toLowerCase()
  if (name === 'transparent') return { rgb: [0, 0, 0], alpha: 0 }
  const named = NAMED_COLORS.get(name)
  return named === undefined ? undefined : { rgb: named, alpha: 1 }
}
