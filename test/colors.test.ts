import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { rasterizePdf } from '../src/test/pdf'
import { readPdfColor } from '../src/runtime/shared/color'
import { renderPreparedPdfTemplate } from '../src/test/render-template'

// The one colour rule (shared/color.ts): every colour-valued key and prop
// takes the same forms, and a colour's alpha multiplies the opacity that
// applies to it, as in CSS. Each document paints black at alpha 0.5 under
// an opacity of 0.5 (or none) on white; the darkest pixel shows the alpha
// that reached the page: 255 × (1 − 0.25) = 191 or 255 × (1 − 0.5) = 127.

const { PdfDefs, PdfLine, PdfLinearGradient, PdfPage, PdfDocument, PdfRect, PdfStop, PdfSvg, PdfText, PdfView } = PDF_COMPONENTS

const HALF = 'rgba(0, 0, 0, 0.5)'
const svg = (content: () => VNode[]) => h(PdfSvg, { viewBox: '0 0 40 40', style: { width: 40, height: 40 } }, content)

/** The smallest red value on the page. */
const darkest = async (content: () => VNode[]): Promise<number> => {
  const { bytes } = await renderPreparedPdfTemplate(
    defineComponent(() => () => h(PdfDocument, null, () => h(PdfPage, { size: [80, 80], style: { padding: 10 } }, content))),
    {},
  )
  const [page] = await rasterizePdf(bytes, { scale: 2 })
  let red = 255
  for (let index = 0; index < page!.pixels.length; index += 4) red = Math.min(red, page!.pixels[index]!)
  return red
}

describe('the one colour rule', () => {
  it.each<[string, () => VNode[], number]>([
    // CSS multiplies; the painter took the lower of the two (upstream quirk).
    ['a background colour with alpha under opacity', () => [h(PdfView, { style: { width: 40, height: 40, backgroundColor: HALF, opacity: 0.5 } })], 191],
    // Borders were refused with alpha: pdfkit misread the colour.
    ['a border colour with alpha under opacity', () => [h(PdfView, { style: { width: 40, height: 40, borderWidth: 12, borderColor: '#00000080', opacity: 0.5 } })], 191],
    // The text opacity replaced the colour's alpha.
    ['a text colour with alpha under opacity', () => [h(PdfText, { style: { fontSize: 40, color: HALF, opacity: 0.5 } }, () => 'I')], 191],
    ['an SVG fill with alpha', () => [svg(() => [h(PdfRect, { width: 40, height: 40, fill: HALF })])], 127],
    ['an SVG fill with alpha and fillOpacity', () => [svg(() => [h(PdfRect, { width: 40, height: 40, fill: HALF, fillOpacity: 0.5 })])], 191],
    ['an SVG stroke with alpha', () => [svg(() => [h(PdfLine, { x1: 0, y1: 20, x2: 40, y2: 20, stroke: '#0008', strokeWidth: 12 })])], 119],
    ['an SVG gradient stop with alpha', () => [svg(() => [
      h(PdfDefs, () => [h(PdfLinearGradient, { id: 'half' }, () => [h(PdfStop, { offset: 0, stopColor: HALF }), h(PdfStop, { offset: 1, stopColor: HALF })])]),
      h(PdfRect, { width: 40, height: 40, fill: 'url(#half)' }),
    ])], 127],
    ['an SVG text fill with alpha', () => [svg(() => [h(PdfText, { x: 0, y: 36, fill: HALF, style: { fontSize: 40 } }, () => 'I')])], 127],
  ])('paints %s', async (_name, content, red) => {
    expect(Math.abs(await darkest(content) - red)).toBeLessThanOrEqual(1)
  }, 20_000)
})

// What each form reads, not only which forms are accepted: catches a channel,
// alpha or hue read on the wrong scale, a clamp that is lost, or rounding
// before the conversion.
describe('readPdfColor', () => {
  it.each<[string, [number, number, number], number]>([
    ['#36c', [51, 102, 204], 1],
    ['#36c8', [51, 102, 204], 136 / 255],
    [' #336699cc ', [51, 102, 153], 0.8],
    ['rgb(255, 128, 0)', [255, 128, 0], 1],
    ['rgba(10 20 30 / 50%)', [10, 20, 30], 0.5],
    ['rgb(100%, 40%, 0%)', [255, 102, 0], 1],
    ['rgba(0%, 0%, 100%, 25%)', [0, 0, 255], 0.25],
    ['rgba(300, -20, 128.6, 1.5)', [255, 0, 129], 1],
    ['rgba(0, 0, 0, -1)', [0, 0, 0], 0],
    ['hsla(120, 100%, 25%, 0.5)', [0, 128, 0], 0.5],
    ['hsl(0, 100%, 50.4%)', [255, 2, 2], 1],
    ['hsl(-240deg, 150%, 50%)', [0, 255, 0], 1],
    ['hwb(240, 20%, 30%, 0.25)', [51, 51, 179], 0.25],
    ['hwb(0 60% 60%)', [128, 128, 128], 1],
    ['transparent', [0, 0, 0], 0],
    ['RebeccaPurple', [102, 51, 153], 1],
  ])('reads %s', (value, rgb, alpha) => {
    const color = readPdfColor(value)
    expect(color?.rgb).toEqual(rgb)
    expect(color?.alpha).toBeCloseTo(alpha, 6)
  })
})
