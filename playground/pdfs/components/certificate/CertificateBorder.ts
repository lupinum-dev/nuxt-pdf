import { defineComponent, h } from 'vue'
import { PdfPath, PdfRect, PdfSvg, PdfView } from '../../../../src/runtime/components'

// Double-rule engraver's border with mitred corner joins and four small corner
// diamonds. Drawn as one absolute full-bleed SVG in the page's user space so the
// content flows above it untouched.

export default defineComponent({
  name: 'CertificateBorder',
  props: {
    width: { type: Number, default: 842 },
    height: { type: Number, default: 595 },
    inset: { type: Number, default: 40 },
    ink: { type: String, default: '#7E5F2B' },
  },
  setup(props) {
    return () => {
      const { width, height, inset, ink } = props
      const gap = 6
      const outer = { x: inset, y: inset, w: width - inset * 2, h: height - inset * 2 }
      const inner = {
        x: inset + gap,
        y: inset + gap,
        w: width - (inset + gap) * 2,
        h: height - (inset + gap) * 2,
      }
      const d = 4
      const corners = [
        { x: inner.x, y: inner.y },
        { x: inner.x + inner.w, y: inner.y },
        { x: inner.x + inner.w, y: inner.y + inner.h },
        { x: inner.x, y: inner.y + inner.h },
      ].map(c => `M ${c.x} ${c.y - d} L ${c.x + d} ${c.y} L ${c.x} ${c.y + d} L ${c.x - d} ${c.y} Z`)

      return h(PdfView, { style: { position: 'absolute', top: 0, left: 0, width, height } }, {
        default: () => h(PdfSvg, {
          viewBox: `0 0 ${width} ${height}`,
          style: { width, height },
        }, {
          default: () => [
            h(PdfRect, {
              x: outer.x, y: outer.y, width: outer.w, height: outer.h,
              fill: 'none', stroke: ink, strokeWidth: 1.5, strokeLinejoin: 'miter',
            }),
            h(PdfRect, {
              x: inner.x, y: inner.y, width: inner.w, height: inner.h,
              fill: 'none', stroke: ink, strokeWidth: 0.5, strokeLinejoin: 'miter',
            }),
            ...corners.map((corner, index) =>
              h(PdfPath, { key: `corner-${index}`, d: corner, fill: ink }),
            ),
          ],
        }),
      })
    }
  },
})
