import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
} from '@react-pdf/renderer'
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

const h = React.createElement

const pageStyle = {
  fontFamily: ROBOTO,
  fontSize: 12,
  paddingTop: 40,
  paddingBottom: 40,
  paddingLeft: 40,
  paddingRight: 40,
}

const doc = (child: React.ReactElement) => h(
  Document,
  { ...textCorpusMeta },
  h(Page, { size: 'A4', style: pageStyle }, child),
)

type ViewStyle = React.ComponentProps<typeof View>['style']

const column = (
  columnStyle: ViewStyle,
  children: React.ReactElement | React.ReactElement[],
) => h(View, { style: columnStyle }, children)

export const reactHyphenationDoc = () => doc(column(
  hyphenationStyles.column,
  [
    h(Text, {
      key: 'off',
      style: hyphenationStyles.text,
      hyphenationCallback: noHyphenation,
    }, longToken),
    h(Text, {
      key: 'split',
      style: hyphenationStyles.text,
      hyphenationCallback: sixCharHyphenation,
    }, longToken),
  ],
))

export const reactSpacingDoc = () => doc(column(
  spacingStyles.column,
  [
    h(Text, { key: 'tight', style: spacingStyles.tight }, spacingText),
    h(Text, { key: 'wide', style: spacingStyles.wide }, spacingText),
  ],
))

export const reactAlignDoc = () => doc(column(
  alignStyles.column,
  [
    h(Text, { key: 'left', style: alignStyles.left }, alignParagraph),
    h(Text, { key: 'center', style: alignStyles.center }, alignParagraph),
    h(Text, { key: 'right', style: alignStyles.right }, alignParagraph),
    h(Text, { key: 'justify', style: alignStyles.justify }, alignParagraph),
  ],
))

export const reactInheritanceDoc = () => doc(column(
  inheritanceStyles.column,
  [
    h(Text, { key: 'roboto', style: inheritanceStyles.roboto }, switchWord),
    h(Text, { key: 'helvetica', style: inheritanceStyles.helvetica }, switchWord),
    h(Text, { key: 'nested', style: inheritanceStyles.outer }, [
      inheritanceSegments.head,
      h(Text, {
        key: 'child',
        style: inheritanceStyles.nestedOverride,
      }, inheritanceSegments.nested),
      inheritanceSegments.tail,
    ]),
  ],
))

export const reactDiacriticsDoc = () => doc(
  h(Text, { style: diacriticsStyle }, diacriticsText),
)

export const reactTruncationDoc = () => doc(column(
  truncationStyles.column,
  h(Text, { style: truncationStyles.clamped }, truncationParagraph),
))
