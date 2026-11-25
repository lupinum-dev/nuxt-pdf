import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

// Filler pushes a single long paragraph so it starts low on page one and must
// wrap across the page boundary. `orphans`/`widows` control how many wrapped
// lines may stay behind / must carry over, which changes WHERE the split lands.
export const widowsOrphansFillerCount = 44
export const widowsOrphansWordCount = 70
export const widowsOrphansStart = 'PARA-START'
export const widowsOrphansEnd = 'PARA-END'

export const widowsOrphansFiller = Array.from(
  { length: widowsOrphansFillerCount },
  (_, index) => `Pre ${index + 1} lorem ipsum dolor sit amet`,
)
export const widowsOrphansWords = Array.from(
  { length: widowsOrphansWordCount },
  (_, index) => `word${index}`,
)
export const widowsOrphansParagraph
  = `${widowsOrphansStart} ${widowsOrphansWords.join(' ')} ${widowsOrphansEnd}`

export const widowsOrphansStyle = {
  page: { fontFamily: 'Roboto', fontSize: 12, padding: 30 },
  filler: { marginBottom: 2 },
}

export interface WidowsOrphansOptions {
  orphans?: number
  widows?: number
}

export const VueWidowsOrphansDocument = defineComponent({
  name: 'VueWidowsOrphansDocument',
  props: {
    orphans: { type: Number, default: 2 },
    widows: { type: Number, default: 2 },
  },
  setup(props) {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: widowsOrphansStyle.page,
      }, {
        default: () => [
          ...widowsOrphansFiller.map((line, index) =>
            h(PdfText, { key: index, style: widowsOrphansStyle.filler }, () => line),
          ),
          h(PdfText, {
            orphans: props.orphans,
            widows: props.widows,
          }, () => widowsOrphansParagraph),
        ],
      }),
    })
  },
})
