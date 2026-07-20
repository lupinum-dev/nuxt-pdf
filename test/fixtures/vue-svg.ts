import { defineComponent, h } from 'vue'
import {
  PdfCircle,
  PdfClipPath,
  PdfDefs,
  PdfDocument,
  PdfEllipse,
  PdfG,
  PdfLine,
  PdfLinearGradient,
  PdfPage,
  PdfPath,
  PdfPolygon,
  PdfPolyline,
  PdfRect,
  PdfStop,
  PdfSvg,
  PdfText,
  PdfTspan,
  PdfView,
} from '../../src/runtime/components'
import { logo, showcase, svgStyles as styles } from './svg-data'

export const VueSvgDocument = defineComponent({
  name: 'VueSvgDocument',
  setup() {
    return () => h(PdfDocument, {
      title: 'Nuxt PDF SVG conformance proof',
      language: 'en',
      creationDate: new Date('2026-07-20T00:00:00.000Z'),
    }, {
      default: () => h(PdfPage, { size: 'A4', style: styles.page }, {
        default: () => [
          h(PdfText, { style: styles.title }, () => 'SVG drawing primitives'),
          h(
            PdfText,
            { style: styles.intro },
            () => 'This page exercises the SVG primitives through the shared layout and render engine so React and Vue produce equivalent output.',
          ),
          h(PdfView, { style: styles.logoRow }, {
            default: () => [
              h(PdfSvg, { ...logo.svg, style: styles.logo }, {
                default: () => h(PdfPath, logo.path),
              }),
              h(PdfText, { style: styles.logoLabel }, () => 'Inline logo in normal page flow'),
            ],
          }),
          h(PdfSvg, { ...showcase.svg, style: styles.showcase }, {
            default: () => [
              h(PdfDefs, null, {
                default: () => [
                  h(PdfLinearGradient, showcase.linearGradient, {
                    default: () => showcase.gradientStops.map((stop, index) =>
                      h(PdfStop, { key: `stop-${index}`, ...stop }),
                    ),
                  }),
                  h(PdfClipPath, showcase.clipPath, {
                    default: () => h(PdfCircle, showcase.clipCircle),
                  }),
                ],
              }),
              h(PdfRect, showcase.gradientRect),
              h(PdfCircle, showcase.circle),
              h(PdfEllipse, showcase.ellipse),
              h(PdfLine, showcase.line),
              h(PdfPolyline, showcase.polyline),
              h(PdfPolygon, showcase.polygon),
              h(PdfPath, showcase.checkPath),
              h(PdfRect, showcase.clippedRect),
              h(PdfG, showcase.group, {
                default: () => showcase.groupRects.map((rect, index) =>
                  h(PdfRect, { key: `group-rect-${index}`, ...rect }),
                ),
              }),
              h(PdfText, {
                x: showcase.text.x,
                y: showcase.text.y,
                style: showcase.text.style,
              }, {
                default: () => showcase.textTspans.map((tspan, index) =>
                  h(
                    PdfTspan,
                    { key: `tspan-${index}`, ...(tspan.x === undefined ? {} : { x: tspan.x }) },
                    () => tspan.text,
                  ),
                ),
              }),
            ],
          }),
        ],
      }),
    })
  },
})
