import { readFileSync } from 'node:fs'
import { defineComponent, h } from 'vue'
import { PDF_COMPONENTS } from '../../../src/runtime/components'
import {
  documentMeta,
  fixedHeaderBody,
  headerLabelText,
  imageStyles as styles,
  pngBufferSource,
} from './images-data'

const { PdfDocument, PdfImage, PdfPage, PdfText, PdfView } = PDF_COMPONENTS

const jpegPathProp = { jpegPath: { type: String, required: true } } as const

// The images hold the bytes a path, a data URL and a `{ data, format }`
// source resolve to: renderPdf admits every source as bytes before layout,
// and the layout takes nothing else.
export const VueSourcesDocument = defineComponent({
  name: 'VueImagesSourcesDocument',
  props: jpegPathProp,
  setup(props) {
    const jpeg = readFileSync(props.jpegPath)
    return () => h(PdfDocument, { title: 'Image sources and sizing', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', style: styles.page }, {
        default: () => [
          h(PdfText, { style: styles.title }, () => 'Image sources and sizing'),
          h(PdfText, { style: styles.caption }, () => 'JPEG file, data URL, and buffer sources.'),
          h(PdfImage, { src: jpeg, style: styles.jpegExplicit }),
          h(PdfImage, { src: pngBufferSource.data, style: styles.pngAspectWidth }),
          h(PdfImage, { src: pngBufferSource.data, style: styles.pngPercentWidth }),
        ],
      }),
    })
  },
})

export const VueObjectFitDocument = defineComponent({
  name: 'VueImagesObjectFitDocument',
  props: jpegPathProp,
  setup(props) {
    const jpeg = readFileSync(props.jpegPath)
    return () => h(PdfDocument, { title: 'Image objectFit', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', style: styles.page }, {
        default: () => h(PdfView, { style: styles.objectFitRow }, {
          default: () => [
            h(PdfImage, { src: jpeg, style: styles.objectFitContain }),
            h(PdfImage, { src: jpeg, style: styles.objectFitCover }),
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
    const jpeg = readFileSync(props.jpegPath)
    return () => h(PdfDocument, { title: 'Fixed header image', ...documentMeta }, {
      default: () => h(PdfPage, { size: 'A4', wrap: true, style: styles.page }, {
        default: () => [
          h(PdfView, { fixed: true, style: styles.header }, {
            default: () => [
              h(PdfImage, { src: jpeg, style: styles.headerImage }),
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
