import { defineComponent, h } from 'vue'
import { PdfPath, PdfSvg, PdfView } from '../../../../src/runtime/components'

// A single oversized star watermark, filled at a whisper-low opacity so it reads
// as a faint deboss behind the composition and never competes with the ink. It
// echoes the seal's star motif to keep the page one visual system.

export default defineComponent({
  name: 'CertificateBackground',
  props: {
    width: { type: Number, default: 842 },
    height: { type: Number, default: 595 },
    opacity: { type: Number, default: 0.03 },
    ink: { type: String, default: '#1B2229' },
  },
  setup(props) {
    return () => {
      const { width, height, opacity, ink } = props
      const cx = width / 2
      const cy = height / 2
      const outerR = 188
      const innerR = 77
      const star = Array.from({ length: 10 }, (_, index) => {
        const radius = index % 2 === 0 ? outerR : innerR
        const angle = (index / 10) * Math.PI * 2 - Math.PI / 2
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
      }).join(' ') + ' Z'

      return h(PdfView, { style: { position: 'absolute', top: 0, left: 0, width, height } }, {
        default: () => h(PdfSvg, {
          viewBox: `0 0 ${width} ${height}`,
          style: { width, height },
        }, {
          default: () => h(PdfPath, { d: star, fill: ink, fillOpacity: opacity }),
        }),
      })
    }
  },
})
