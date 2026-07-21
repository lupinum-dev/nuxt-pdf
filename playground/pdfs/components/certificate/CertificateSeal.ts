import { defineComponent, h } from 'vue'
import {
  PdfCircle,
  PdfDefs,
  PdfPath,
  PdfRadialGradient,
  PdfStop,
  PdfSvg,
} from '../../../../src/runtime/components'

// A self-contained wax-and-foil seal drawn purely in SVG: two concentric rules,
// a beaded coin edge, a single bronze RadialGradient fill (used ONCE here), a
// hairline inner keyline, and a crisp five-point star. Rendered in a 100x100
// user space; the parent scales it via `size`.

const BRONZE_DEEP = '#7E5F2B'
const CREAM = '#F4EAD0'

// Evenly spaced dots in the band between the two rules.
const BEADS = Array.from({ length: 32 }, (_, index) => {
  const angle = (index / 32) * Math.PI * 2 - Math.PI / 2
  return { cx: 50 + 45.2 * Math.cos(angle), cy: 50 + 45.2 * Math.sin(angle) }
})

// Five-point star, outer R 15 / inner r 6.5, centred at (50,50), point up.
const STAR
  = 'M 50 35 L 53.82 44.74 L 64.27 45.37 L 56.18 52.01 L 58.82 62.14 '
    + 'L 50 56.5 L 41.18 62.14 L 43.82 52.01 L 35.73 45.37 L 46.18 44.74 Z'

export default defineComponent({
  name: 'CertificateSeal',
  props: {
    size: { type: Number, default: 82 },
  },
  setup(props) {
    return () =>
      h(PdfSvg, { viewBox: '0 0 100 100', style: { width: props.size, height: props.size } }, {
        default: () => [
          h(PdfDefs, null, {
            default: () =>
              h(PdfRadialGradient, { id: 'seal-bronze', cx: '0.5', cy: '0.38', r: '0.62' }, {
                default: () => [
                  h(PdfStop, { offset: '0', stopColor: '#E7CC86' }),
                  h(PdfStop, { offset: '0.55', stopColor: '#C9A24B' }),
                  h(PdfStop, { offset: '1', stopColor: '#8A6A2F' }),
                ],
              }),
          }),
          // Outer rule
          h(PdfCircle, { cx: 50, cy: 50, r: 47, fill: 'none', stroke: BRONZE_DEEP, strokeWidth: 1.4 }),
          // Bronze disc
          h(PdfCircle, { cx: 50, cy: 50, r: 43.5, fill: 'url(#seal-bronze)' }),
          // Beaded coin edge
          ...BEADS.map((bead, index) =>
            h(PdfCircle, { key: `bead-${index}`, cx: bead.cx, cy: bead.cy, r: 0.75, fill: BRONZE_DEEP }),
          ),
          // Hairline keyline inside the disc
          h(PdfCircle, { cx: 50, cy: 50, r: 38.5, fill: 'none', stroke: CREAM, strokeWidth: 0.7 }),
          // Star
          h(PdfPath, { d: STAR, fill: CREAM, stroke: BRONZE_DEEP, strokeWidth: 0.5, strokeLinejoin: 'miter' }),
        ],
      })
  },
})
