import { defineComponent, h } from 'vue'
import {
  PdfDocument,
  PdfPage,
  PdfText,
  PdfView,
} from '../../../src/runtime/components'
import type { PdfStyleValue } from '../../../src/runtime/authoring'
import {
  ROBOTO,
  alignParagraph,
  alignStyles,
  diacriticsStyle,
  diacriticsText,
  hyphenationStyles,
  inheritanceSegments,
  inheritanceStyles,
  longToken,
  noHyphenation,
  sixCharHyphenation,
  spacingStyles,
  spacingText,
  switchWord,
  textCorpusMeta,
  truncationParagraph,
  truncationStyles,
} from './text-data'

const pageStyle = {
  fontFamily: ROBOTO,
  fontSize: 12,
  paddingTop: 40,
  paddingBottom: 40,
  paddingLeft: 40,
  paddingRight: 40,
}

const document = (child: unknown) => h(PdfDocument, { ...textCorpusMeta }, {
  default: () => h(PdfPage, { size: 'A4', style: pageStyle }, { default: () => child }),
})

const column = (columnStyle: PdfStyleValue, children: unknown) =>
  h(PdfView, { style: columnStyle }, { default: () => children })

export const VueHyphenationDoc = defineComponent({
  name: 'VueTextHyphenationDoc',
  setup: () => () => document(column(hyphenationStyles.column, [
    h(PdfText, {
      style: hyphenationStyles.text,
      hyphenationCallback: noHyphenation,
    }, () => longToken),
    h(PdfText, {
      style: hyphenationStyles.text,
      hyphenationCallback: sixCharHyphenation,
    }, () => longToken),
  ])),
})

export const VueSpacingDoc = defineComponent({
  name: 'VueTextSpacingDoc',
  setup: () => () => document(column(spacingStyles.column, [
    h(PdfText, { style: spacingStyles.tight }, () => spacingText),
    h(PdfText, { style: spacingStyles.wide }, () => spacingText),
    h(PdfText, { style: spacingStyles.wordSpaced }, () => spacingText),
  ])),
})

export const VueAlignDoc = defineComponent({
  name: 'VueTextAlignDoc',
  setup: () => () => document(column(alignStyles.column, [
    h(PdfText, { style: alignStyles.left }, () => alignParagraph),
    h(PdfText, { style: alignStyles.center }, () => alignParagraph),
    h(PdfText, { style: alignStyles.right }, () => alignParagraph),
    h(PdfText, { style: alignStyles.justify }, () => alignParagraph),
  ])),
})

export const VueInheritanceDoc = defineComponent({
  name: 'VueTextInheritanceDoc',
  setup: () => () => document(column(inheritanceStyles.column, [
    h(PdfText, { style: inheritanceStyles.roboto }, () => switchWord),
    h(PdfText, { style: inheritanceStyles.helvetica }, () => switchWord),
    h(PdfText, { style: inheritanceStyles.outer }, () => [
      inheritanceSegments.head,
      h(PdfText, { style: inheritanceStyles.nestedOverride }, () => inheritanceSegments.nested),
      inheritanceSegments.tail,
    ]),
  ])),
})

export const VueDiacriticsDoc = defineComponent({
  name: 'VueTextDiacriticsDoc',
  setup: () => () => document(h(PdfText, { style: diacriticsStyle }, () => diacriticsText)),
})

export const VueTruncationDoc = defineComponent({
  name: 'VueTextTruncationDoc',
  setup: () => () => document(column(
    truncationStyles.column,
    h(PdfText, { style: truncationStyles.clamped }, () => truncationParagraph),
  )),
})
