import React from 'react'
import { defineComponent, h } from 'vue'
import {
  Document,
  Page,
  Text,
} from '@react-pdf/renderer'
import {
  PdfDocument,
  PdfPage,
  PdfText,
} from '../../../src/runtime/components'

// A body long enough to span four+ pages, with a `fixed` header and footer that
// must repeat on EVERY page of the wrapped flow.
export const fixedHeader = 'FIX-HEADER'
export const fixedFooter = 'FIX-FOOTER'
export const fixedBodyCount = 140
export const fixedBody = Array.from(
  { length: fixedBodyCount },
  (_, index) => `Body paragraph ${index + 1} flowing across many pages`,
)

export const fixedMultipageStyle = {
  page: {
    fontFamily: 'Roboto',
    fontSize: 12,
    paddingTop: 50,
    paddingBottom: 50,
    paddingHorizontal: 30,
  },
  header: { position: 'absolute' as const, top: 20, left: 30 },
  footer: { position: 'absolute' as const, bottom: 20, left: 30 },
  body: { marginBottom: 2 },
}

const reactH = React.createElement

export const createReactFixedMultipageDocument = () =>
  reactH(
    Document,
    null,
    reactH(
      Page,
      { size: 'A4', wrap: true, style: fixedMultipageStyle.page },
      reactH(Text, { fixed: true, style: fixedMultipageStyle.header }, fixedHeader),
      reactH(Text, { fixed: true, style: fixedMultipageStyle.footer }, fixedFooter),
      ...fixedBody.map((line, index) =>
        reactH(Text, { key: index, style: fixedMultipageStyle.body }, line),
      ),
    ),
  )

export const VueFixedMultipageDocument = defineComponent({
  name: 'VueFixedMultipageDocument',
  setup() {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: fixedMultipageStyle.page,
      }, {
        default: () => [
          h(PdfText, { fixed: true, style: fixedMultipageStyle.header }, () => fixedHeader),
          h(PdfText, { fixed: true, style: fixedMultipageStyle.footer }, () => fixedFooter),
          ...fixedBody.map((line, index) =>
            h(PdfText, { key: index, style: fixedMultipageStyle.body }, () => line),
          ),
        ],
      }),
    })
  },
})
