import React from 'react'
import {
  Document,
  Link,
  Note,
  Page,
  Text,
} from '@react-pdf/renderer'
import {
  documentMeta,
  linkTargets,
  noteContent,
  pageSetupCases,
} from './annotations-data'

const h = React.createElement

/** Two external Link annotations (http + mailto) plus one Note annotation. */
export const createReactAnnotationsDocument = () => h(
  Document,
  { title: 'Nuxt PDF annotations proof', creationDate: documentMeta.creationDate },
  h(
    Page,
    { size: 'A4' },
    h(Link, { src: linkTargets.external }, 'External documentation'),
    h(Link, { src: linkTargets.mailto }, 'Email the report owner'),
    h(Note, null, noteContent),
  ),
)

/** Every metadata field flows into the info dictionary / catalog. */
export const createReactMetadataDocument = () => h(
  Document,
  {
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
  },
  h(Page, { size: 'A4' }, h(Text, null, 'Metadata round-trip page')),
)

/** One page per size / orientation / dpi case, in declaration order. */
export const createReactPageSetupDocument = () => h(
  Document,
  { title: 'Nuxt PDF page setup proof', creationDate: documentMeta.creationDate },
  ...pageSetupCases.map(pageCase => h(
    Page,
    {
      key: pageCase.id,
      size: pageCase.size,
      orientation: pageCase.orientation,
      dpi: pageCase.dpi,
    },
    h(Text, null, pageCase.id),
  )),
)
