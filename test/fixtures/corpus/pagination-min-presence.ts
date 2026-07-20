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

// A tall spacer pushes the heading to the very bottom of page one. Without
// `minPresenceAhead` the heading fits there and its body flows onto page two
// (heading stranded from its block). With `minPresenceAhead` large enough that
// the remaining space fails the check, the heading itself breaks to page two,
// keeping it beside its following block.
export const minPresenceSpacerHeight = 760
export const minPresenceHeading = 'MPA-HEADING'
export const minPresenceBody = 'MPA-BODY'
export const minPresenceSpacerMarker = 'MPA-SPACER'

export const minPresenceStyle = {
  page: { fontFamily: 'Roboto', fontSize: 12, padding: 30 },
  spacer: { height: minPresenceSpacerHeight },
  heading: { fontSize: 13 },
  body: { fontSize: 12 },
}

const reactH = React.createElement

export interface MinPresenceOptions {
  minPresenceAhead?: number
}

export const createReactMinPresenceDocument = (
  { minPresenceAhead }: MinPresenceOptions = {},
) =>
  reactH(
    Document,
    null,
    reactH(
      Page,
      { size: 'A4', wrap: true, style: minPresenceStyle.page },
      reactH(
        View,
        { style: minPresenceStyle.spacer },
        reactH(Text, null, minPresenceSpacerMarker),
      ),
      reactH(
        Text,
        { minPresenceAhead, style: minPresenceStyle.heading },
        `${minPresenceHeading} kept with block`,
      ),
      reactH(Text, { style: minPresenceStyle.body }, `${minPresenceBody} under the heading`),
    ),
  )

export const VueMinPresenceDocument = defineComponent({
  name: 'VueMinPresenceDocument',
  props: {
    minPresenceAhead: { type: Number, default: undefined },
  },
  setup(props) {
    return () => h(PdfDocument, null, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: minPresenceStyle.page,
      }, {
        default: () => [
          h(PdfView, { style: minPresenceStyle.spacer }, {
            default: () => h(PdfText, null, () => minPresenceSpacerMarker),
          }),
          h(PdfText, {
            minPresenceAhead: props.minPresenceAhead,
            style: minPresenceStyle.heading,
          }, () => `${minPresenceHeading} kept with block`),
          h(PdfText, { style: minPresenceStyle.body }, () => `${minPresenceBody} under the heading`),
        ],
      }),
    })
  },
})
