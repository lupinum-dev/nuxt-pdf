import React from 'react'
import { defineComponent, h } from 'vue'
import {
  Document,
  Page,
  Text,
  View,
} from '@react-pdf/renderer'
import {
  PdfDocument,
  PdfPage,
  PdfText,
  PdfView,
} from '../../../src/runtime/components'

// Three wrappable nested Views; the 2nd and 3rd each carry `break: true`, so an
// otherwise short single-page document must land each block on its own page.
export const explicitBreakBlocks = [
  { marker: 'EB-A', text: 'First block stays on page one', break: false },
  { marker: 'EB-B', text: 'Second block after an explicit break', break: true },
  { marker: 'EB-C', text: 'Third block after an explicit break', break: true },
] as const

export const explicitBreakStyle = {
  page: { fontFamily: 'Roboto', fontSize: 12, padding: 30 },
  block: { marginBottom: 6 },
}

const reactH = React.createElement

export const createReactExplicitBreakDocument = () =>
  reactH(
    Document,
    null,
    reactH(
      Page,
      { size: 'A4', wrap: true, style: explicitBreakStyle.page },
      ...explicitBreakBlocks.map(block =>
        reactH(
          View,
          {
            key: block.marker,
            wrap: true,
            break: block.break,
            style: explicitBreakStyle.block,
          },
          reactH(Text, null, `${block.marker} ${block.text}`),
        ),
      ),
    ),
  )

export const VueExplicitBreakDocument = defineComponent({
  name: 'VueExplicitBreakDocument',
  setup() {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: explicitBreakStyle.page,
      }, {
        default: () => explicitBreakBlocks.map(block =>
          h(PdfView, {
            key: block.marker,
            wrap: true,
            break: block.break,
            style: explicitBreakStyle.block,
          }, {
            default: () => h(PdfText, null, () => `${block.marker} ${block.text}`),
          }),
        ),
      }),
    })
  },
})
