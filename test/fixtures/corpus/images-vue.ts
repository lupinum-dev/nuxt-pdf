import { defineComponent, h } from 'vue'
import {
  PdfDocument,
  PdfImage,
  PdfPage,
  PdfText,
  PdfView,
} from '../../../src/runtime/components'
import {
  documentMeta,
  fixedHeaderBody,
  headerLabelText,
  imageStyles as styles,
  pngBufferSource,
  pngDataUri,
} from './images-data'

const jpegPathProp = { jpegPath: { type: String, required: true } } as const

// Mirror of createReactSourcesDocument: identical node tree through the Vue
// custom renderer so any divergence is the renderer boundary, not the inputs.
export const VueSourcesDocument = defineComponent({
  name: 'VueImagesSourcesDocument',
  props: jpegPathProp,
  setup(props) {
    return () => h(PdfDocument, { title: 'Image sources and sizing', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', style: styles.page }, {
        default: () => [
          h(PdfText, { style: styles.title }, () => 'Image sources and sizing'),
          h(PdfText, { style: styles.caption }, () => 'JPEG file, data URL, and buffer sources.'),
          h(PdfImage, { src: props.jpegPath, style: styles.jpegExplicit }),
          h(PdfImage, { src: pngDataUri, style: styles.pngAspectWidth }),
          h(PdfImage, { source: pngBufferSource, style: styles.pngPercentWidth }),
        ],
      }),
    })
  },
})

export const VueObjectFitDocument = defineComponent({
  name: 'VueImagesObjectFitDocument',
  props: jpegPathProp,
  setup(props) {
    return () => h(PdfDocument, { title: 'Image objectFit', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', style: styles.page }, {
        default: () => h(PdfView, { style: styles.objectFitRow }, {
          default: () => [
            h(PdfImage, { src: props.jpegPath, style: styles.objectFitContain }),
            h(PdfImage, { src: props.jpegPath, style: styles.objectFitCover }),
          ],
        }),
      }),
    })
  },
})

export const VueFixedHeaderDocument = defineComponent({
  name: 'VueImagesFixedHeaderDocument',
  props: jpegPathProp,
  setup(props) {
    return () => h(PdfDocument, { title: 'Fixed header image', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', wrap: true, style: styles.page }, {
        default: () => [
          h(PdfView, { fixed: true, style: styles.header }, {
            default: () => [
              h(PdfImage, { src: props.jpegPath, style: styles.headerImage }),
              h(PdfText, { style: styles.headerLabel }, () => headerLabelText),
            ],
          }),
          h(PdfText, { style: styles.body }, () => fixedHeaderBody.first),
          h(PdfView, { break: true }, {
            default: () => h(PdfText, { style: styles.body }, () => fixedHeaderBody.second),
          }),
        ],
      }),
    })
  },
})
