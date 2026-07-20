import { defineComponent, h } from 'vue'
import {
  PdfDocument,
  PdfLink,
  PdfNote,
  PdfPage,
  PdfText,
} from '../../../src/runtime/components'
import {
  documentMeta,
  linkTargets,
  noteContent,
  pageSetupCases,
} from './annotations-data'

export const VueAnnotationsDocument = defineComponent({
  name: 'VueAnnotationsDocument',
  setup() {
    return () => h(PdfDocument, {
      title: 'Nuxt PDF annotations proof',
      creationDate: documentMeta.creationDate,
    }, {
      default: () => h(PdfPage, { size: 'A4' }, {
        default: () => [
          h(PdfLink, { src: linkTargets.external }, { default: () => 'External documentation' }),
          h(PdfLink, { src: linkTargets.mailto }, { default: () => 'Email the report owner' }),
          h(PdfNote, null, { default: () => noteContent }),
        ],
      }),
    })
  },
})

export const VueMetadataDocument = defineComponent({
  name: 'VueMetadataDocument',
  setup() {
    return () => h(PdfDocument, {
      title: documentMeta.title,
      author: documentMeta.author,
      subject: documentMeta.subject,
      keywords: documentMeta.keywords,
      creator: documentMeta.creator,
      producer: documentMeta.producer,
      language: documentMeta.language,
      creationDate: documentMeta.creationDate,
      pdfVersion: documentMeta.pdfVersion,
      pageLayout: documentMeta.pageLayout,
    }, {
      default: () => h(PdfPage, { size: 'A4' }, {
        default: () => h(PdfText, null, { default: () => 'Metadata round-trip page' }),
      }),
    })
  },
})

export const VuePageSetupDocument = defineComponent({
  name: 'VuePageSetupDocument',
  setup() {
    return () => h(PdfDocument, {
      title: 'Nuxt PDF page setup proof',
      creationDate: documentMeta.creationDate,
    }, {
      default: () => pageSetupCases.map(pageCase => h(PdfPage, {
        key: pageCase.id,
        size: pageCase.size,
        orientation: pageCase.orientation,
        dpi: pageCase.dpi,
      }, {
        default: () => h(PdfText, null, { default: () => pageCase.id }),
      })),
    })
  },
})
