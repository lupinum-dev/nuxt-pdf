import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'

const { PdfDocument, PdfPage, PdfPageCount, PdfPageNumber, PdfText } = PDF_COMPONENTS

// Vue-only fixture with a COMPUTED oracle.
//
// Page tokens become the engine's dynamic text. React PDF's dynamic `render`
// text re-resolves its `lineHeight` on every pagination pass, compounding fontSize * lineHeight until the dynamic line box
// drifts off-page; nuxt-pdf's engine shields dynamic text with a `''`
// lineHeight sentinel (see render-document.ts `normalizeDynamicTextLineHeight`).
// The two renderers therefore diverge by design on dynamic text, so this
// behavior is proven against a computed oracle rather than the React oracle: on
// a wrapped (not explicitly broken) N-page flow, page k's footer must read
// exactly `PN k/N`.
export const dynamicBodyCount = 140
export const dynamicBody = Array.from(
  { length: dynamicBodyCount },
  (_, index) => `Body paragraph ${index + 1} flowing across many pages`,
)

export const dynamicPageMarker = (pageNumber: number, totalPages: number): string =>
  `PN ${pageNumber}/${totalPages}`

export const dynamicPageStyle = {
  page: {
    fontFamily: 'Roboto',
    fontSize: 12,
    paddingTop: 50,
    paddingBottom: 50,
    paddingHorizontal: 30,
  },
  footer: { position: 'absolute' as const, bottom: 20, left: 30 },
  body: { marginBottom: 2 },
}

export const VueDynamicPageNumberDocument = defineComponent({
  name: 'VueDynamicPageNumberDocument',
  setup() {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: dynamicPageStyle.page,
      }, {
        default: () => [
          h(PdfText, {
            fixed: true,
            style: dynamicPageStyle.footer,
          }, () => ['PN ', h(PdfPageNumber), '/', h(PdfPageCount)]),
          ...dynamicBody.map((line, index) =>
            h(PdfText, { key: index, style: dynamicPageStyle.body }, () => line),
          ),
        ],
      }),
    })
  },
})
