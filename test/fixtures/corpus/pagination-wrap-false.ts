import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'

const { PdfDocument, PdfPage, PdfText } = PDF_COMPONENTS

// The rows overflow one A4 page: with `wrap: false` the page must NOT
// paginate — it grows to a single tall page that holds every row (page height
// exceeds A4); with `wrap: true` the identical content paginates across
// standard-height pages.
export const wrapFalseStart = 'WF-START'
export const wrapFalseEnd = 'WF-END'
export const wrapFalseRows = Array.from(
  { length: 60 },
  (_, index) => `Row ${index + 1} content line`,
)

export const wrapFalseStyle = {
  page: { fontFamily: 'Roboto', fontSize: 12, padding: 30 },
  row: { marginBottom: 2 },
}

export interface WrapFalseOptions {
  wrap: boolean
}

export const VueWrapFalseDocument = defineComponent({
  name: 'VueWrapFalseDocument',
  props: {
    wrap: { type: Boolean, required: true },
  },
  setup(props) {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: props.wrap,
        style: wrapFalseStyle.page,
      }, {
        default: () => [
          h(PdfText, { style: wrapFalseStyle.row }, () => wrapFalseStart),
          ...wrapFalseRows.map((row, index) =>
            h(PdfText, { key: index, style: wrapFalseStyle.row }, () => row),
          ),
          h(PdfText, { style: wrapFalseStyle.row }, () => wrapFalseEnd),
        ],
      }),
    })
  },
})
